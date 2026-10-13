package se.havochvatten.symphony.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ejb.EJB;
import jakarta.ejb.Stateless;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.geotools.coverage.grid.GridCoverage2D;
import org.geotools.coverage.grid.GridGeometry2D;
import org.geotools.data.geojson.GeoJSONWriter;
import org.geotools.gce.geotiff.GeoTiffReader;
import org.geotools.geometry.jts.JTS;
import org.geotools.referencing.CRS;
import org.geotools.referencing.crs.DefaultGeographicCRS;
import org.geotools.util.factory.Hints;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.prep.PreparedGeometryFactory;
import se.havochvatten.symphony.dto.CalculationInputDto.*;
import se.havochvatten.symphony.dto.LayerType;
import se.havochvatten.symphony.entity.CalculationResult;
import se.havochvatten.symphony.entity.ScenarioArea;
import se.havochvatten.symphony.exception.CalculationInputException;
import se.havochvatten.symphony.util.InputFingerprint;
import se.havochvatten.symphony.calculation.CalculationDomain;
import se.havochvatten.symphony.calculation.MatrixMask;

import java.awt.Rectangle;
import java.awt.image.Raster;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.Principal;
import java.util.*;
import javax.media.jai.ImageLayout;

/** Reconstructs saved inputs without calling the impact engine or updating results. */
@Stateless
public class CalculationInputService {
    private static final ObjectMapper JSON = new ObjectMapper();
    public static final String VERSION = "calculation-input-v1";
    @PersistenceContext(unitName = "symphonyPU") EntityManager em;
    @EJB DataLayerService data;
    @EJB ScenarioService scenarios;
    @EJB MetaDataService metadata;
    @EJB PropertiesService properties;

    public CalculationResult authorize(int id, Principal principal) {
        if (principal == null) throw new CalculationInputException(401, "Sign in to access this calculation.");
        var result = em.find(CalculationResult.class, id);
        if (result == null) throw new CalculationInputException(404, "The calculation no longer exists.");
        if (!result.isBaselineCalculation() && !principal.getName().equals(result.getOwner()))
            throw new CalculationInputException(403, "You cannot access this calculation.");
        return result;
    }

    private Path source(CalculationResult calculation, LayerType category) {
        return Path.of(data.getComponentFilePath(category, calculation.getBaselineVersion().getId()));
    }

    private Path supportManifest(CalculationResult calculation) {
        return source(calculation, LayerType.ECOSYSTEM).getParent().resolve("calculation-input-support.json");
    }

    private JsonNode support(CalculationResult calculation) throws Exception {
        Path file = supportManifest(calculation);
        if (!Files.isRegularFile(file)) return JSON.createObjectNode();
        if (Files.size(file) > 1_000_000) throw new CalculationInputException(422, "Input support metadata is too large.");
        return JSON.readTree(file.toFile());
    }

    private Path sidecar(CalculationResult calculation, String filename) {
        if (filename.isBlank() || !Path.of(filename).getFileName().toString().equals(filename))
            throw new CalculationInputException(422, "Invalid input-support asset.");
        return supportManifest(calculation).getParent().resolve(filename);
    }

    public Manifest manifest(CalculationResult calculation) throws Exception {
        var snapshot = calculation.getScenarioSnapshot();
        var baseline = calculation.getBaselineVersion();
        String sourceCrs = properties.getProperty("data.source.crs", "EPSG:3035");
        Geometry geometry = JTS.transform(snapshot.getGeometry(), CRS.findMathTransform(
            CRS.decode(sourceCrs, true), CRS.decode("EPSG:4326", true)));
        JsonNode provenance = support(calculation);
        Map<String, String> hashes = new TreeMap<>();
        List<String> notes = new ArrayList<>();
        boolean available = provenance.path("version").asText().equals("native-input-support-v1") &&
            provenance.path("baselineName").asText().equals(baseline.getName());
        if (!available) notes.add("This baseline has no verified input-support sidecars. Prepare its source provenance before simulation.");
        List<Band> bands = new ArrayList<>();
        for (LayerType category : List.of(LayerType.ECOSYSTEM, LayerType.PRESSURE)) {
            Path source = source(calculation, category);
            if (!Files.isRegularFile(source)) {
                available = false;
                notes.add("The " + category + " baseline source is unavailable.");
            } else {
                String hash = InputFingerprint.hash(source);
                hashes.put(category.name(), hash);
                if (!hash.equals(provenance.path("sources").path(category.name()).path("sha256").asText())) {
                    available = false;
                    notes.add("The " + category + " source does not match the support metadata.");
                }
            }
            var titles = metadata.getSingleMetaFieldForComponent(baseline.getId(), category, "title", baseline.getLocale());
            int[] included = category == LayerType.ECOSYSTEM ? snapshot.getEcosystemsToInclude() : snapshot.getPressuresToInclude();
            for (int number : included) {
                JsonNode entry = findSupportBand(provenance, category, number);
                bands.add(new Band(category, number, titles.getOrDefault(number, "Band " + number),
                    entry.path("units").asText("unspecified"), entry.path("sourceSha256").asText()));
            }
        }
        if (Files.isRegularFile(supportManifest(calculation)))
            hashes.put("supportManifest", InputFingerprint.hash(supportManifest(calculation)));
        notes.add(provenance.path("policy").asText("Source support is unknown."));
        notes.add("Source fingerprints describe the files available now; the saved calculation did not archive the original source files.");
        Grid suggestedGrid = null;
        if (available) {
            var coverage = data.getCoverage(LayerType.ECOSYSTEM, baseline.getId());
            try {
                var nativeDomain = nativeDomain(calculation, coverage, CRS.decode(sourceCrs, true));
                var roiBounds = snapshot.getGeometry().getEnvelopeInternal();
                double[] e = nativeDomain.extent();
                // Include native edge pixels as well as the vector area. Native integer
                // truncation can place edge pixels just outside the original polygon.
                double x0 = Math.floor(Math.min(e[0], roiBounds.getMinX()) / 1000) * 1000;
                double y0 = Math.floor(Math.min(e[1], roiBounds.getMinY()) / 1000) * 1000;
                double x1 = Math.ceil(Math.max(e[2], roiBounds.getMaxX()) / 1000) * 1000;
                double y1 = Math.ceil(Math.max(e[3], roiBounds.getMaxY()) / 1000) * 1000;
                int width = Math.max(3, (int) Math.round((x1 - x0) / 1000));
                int height = Math.max(3, (int) Math.round((y1 - y0) / 1000));
                suggestedGrid = new Grid(sourceCrs, new double[]{x0, y0, x0 + width * 1000, y0 + height * 1000}, width, height, 1000);
                notes.add("The model grid encloses both the saved vector area and the native calculation's edge pixels; these may extend beyond the vector boundary because of native raster rounding.");
            } finally { coverage.dispose(false); }
        }
        var identity = JSON.createObjectNode();
        identity.put("calculationId", calculation.getId());
        identity.put("baselineId", baseline.getId());
        identity.put("sourceCrs", sourceCrs);
        identity.set("geometry", snapshot.getPolygon());
        identity.set("areas", JSON.valueToTree(snapshot.getAreas()));
        identity.set("changes", snapshot.getChangesForReport());
        identity.set("ecosystems", JSON.valueToTree(snapshot.getEcosystemsToInclude()));
        identity.set("pressures", JSON.valueToTree(snapshot.getPressuresToInclude()));
        identity.set("normalization", JSON.valueToTree(snapshot.getNormalization()));
        identity.set("matrices", JSON.valueToTree(snapshot.getAreaMatrixMap()));
        identity.set("sources", JSON.valueToTree(hashes));
        identity.set("suggestedGrid", JSON.valueToTree(suggestedGrid));
        identity.put("operation", calculation.getOperationName());
        identity.set("operationOptions", JSON.valueToTree(calculation.getOperationOptions()));
        return new Manifest(VERSION, calculation.getId(), calculation.getCalculationName(), calculation.getTimestamp().getTime(),
            baseline.getId(), baseline.getName(), InputFingerprint.hash(identity), "EPSG:4326", sourceCrs,
            JSON.readTree(GeoJSONWriter.toGeoJSON(geometry, 12)), suggestedGrid, bands, snapshot.getChangesForReport(),
            calculation.getOperationName(), calculation.getOperationOptions(), available, notes, hashes);
    }

    private JsonNode findSupportBand(JsonNode manifest, LayerType category, int number) {
        for (JsonNode band : manifest.path("layers"))
            if (band.path("category").asText().equals(category.name()) && band.path("bandNumber").asInt(-1) == number)
                return band;
        return JSON.createObjectNode();
    }

    public static void validateGrid(Grid grid) {
        if (grid == null || !"EPSG:3035".equals(grid.crs()) || grid.width() < 3 || grid.height() < 3 ||
            grid.width() > 60 || grid.height() > 60 || grid.cellMetres() != 1000 || grid.extent() == null || grid.extent().length != 4)
            throw new CalculationInputException(400, "Use a 3–60 cell grid at 1 km in EPSG:3035.");
        double[] e = grid.extent();
        if (Arrays.stream(e).anyMatch(v -> !Double.isFinite(v) || Math.abs(v / 1000 - Math.rint(v / 1000)) > 1e-6) ||
            Math.abs(e[2] - e[0] - grid.width() * 1000) > 0.001 ||
            Math.abs(e[3] - e[1] - grid.height() * 1000) > 0.001)
            throw new CalculationInputException(400, "Grid extent and dimensions do not agree.");
    }

    public GridResult grid(CalculationResult calculation, GridRequest request) throws Exception {
        if (request == null) throw new CalculationInputException(400, "Input grid request is required.");
        validateGrid(request.grid());
        if (request.bands() == null || request.bands().isEmpty() || request.bands().size() > 80 ||
            new HashSet<>(request.bands()).size() != request.bands().size())
            throw new CalculationInputException(400, "Select 1–80 distinct calculation bands.");
        Manifest manifest = manifest(calculation);
        if (!manifest.fingerprint().equals(request.fingerprint()))
            throw new CalculationInputException(409, "Calculation sources changed. Reload the calculation before preparing inputs.");
        if (!manifest.available()) throw new CalculationInputException(422, String.join(" ", manifest.notes()));
        for (BandKey key : request.bands()) {
            if (key == null || manifest.bands().stream().noneMatch(b -> b.category() == key.category() && b.bandNumber() == key.bandNumber()))
                throw new CalculationInputException(400, "The requested band was not selected in this calculation.");
        }
        JsonNode support = support(calculation);
        var grid = request.grid();
        var sourceCrs = CRS.decode(manifest.sourceCrs(), true);
        if (!CRS.equalsIgnoreMetadata(sourceCrs, CRS.decode(grid.crs(), true)))
            throw new CalculationInputException(422, "This baseline's grid projection is not supported yet.");
        // This polygon is the saved, already coast-excluded calculation ROI in source CRS.
        // Reusing it avoids reading today's coastal definitions or excluding twice.
        Geometry roi = calculation.getScenarioSnapshot().getGeometry();
        var envelope = roi.getEnvelopeInternal();
        double[] extent = grid.extent();
        if (envelope.getMinX() < extent[0] - 0.01 || envelope.getMinY() < extent[1] - 0.01 ||
            envelope.getMaxX() > extent[2] + 0.01 || envelope.getMaxY() > extent[3] + 0.01)
            throw new CalculationInputException(400, "The simulation grid must contain the entire saved calculation area.");

        List<GridCoverage2D> resources = new ArrayList<>();
        try {
            GridCoverage2D eco = data.getCoverage(LayerType.ECOSYSTEM, manifest.baselineId()); resources.add(eco);
            GridCoverage2D pressure = data.getCoverage(LayerType.PRESSURE, manifest.baselineId()); resources.add(pressure);
            var areas = calculation.getScenarioSnapshot().getTmpAreas();
            areas.sort(Comparator.comparing(ScenarioArea::getId));
            var effective = scenarios.applyScenario(eco, pressure, areas, calculation.getScenarioSnapshot());
            resources.add(effective.getLeft()); resources.add(effective.getRight());
            // Reproduce native pixel truncation and Java2D area painting, rather than
            // treating the ROI's bounding rectangle or point-in-polygon as its mask.
            var nativeDomain = nativeDomain(calculation, eco, sourceCrs);
            double[] nativeExtent = nativeDomain.extent();
            if (nativeExtent[0] < extent[0] - 0.01 || nativeExtent[1] < extent[1] - 0.01 ||
                nativeExtent[2] > extent[2] + 0.01 || nativeExtent[3] > extent[3] + 0.01)
                throw new CalculationInputException(400, "The export grid would crop native calculation edge pixels. Use the suggested grid from the manifest.");
            Map<Integer, Integer> palette = new HashMap<>();
            for (Integer matrixId : calculation.getScenarioSnapshot().getAreaMatrixMap().values())
                if (matrixId != null && !palette.containsKey(matrixId)) palette.put(matrixId, palette.size() + 1);
            var mask = new MatrixMask(nativeDomain.geometry().toCanonical(), nativeDomain.layout(), calculation.getScenarioSnapshot().getMatrixResponse(),
                areas, palette, calculation.getScenarioSnapshot().getAreasExcludingCoastal().isEmpty() ? null : nativeDomain.geographicRoi()).getRaster();
            var domainCoverage = loadSidecar(calculation, support.path("domainFile").asText(), support.path("domainSha256").asText());
            resources.add(domainCoverage);
            var nativeGrid = new Window(eco, grid);
            var domain = new Window(domainCoverage, grid);
            nativeGrid.requireSameGrid(domain);
            Map<LayerType, Window> inputs = new EnumMap<>(LayerType.class);
            inputs.put(LayerType.ECOSYSTEM, new Window(effective.getLeft(), grid));
            inputs.put(LayerType.PRESSURE, new Window(effective.getRight(), grid));
            Map<LayerType, Window> supports = new EnumMap<>(LayerType.class);
            for (LayerType category : request.bands().stream().map(BandKey::category).distinct().toList()) {
                JsonNode specification = support.path("sources").path(category.name());
                var coverage = loadSidecar(calculation, specification.path("supportFile").asText(), specification.path("supportSha256").asText());
                resources.add(coverage);
                Window window = new Window(coverage, grid);
                nativeGrid.requireSameGrid(window);
                nativeGrid.requireSameGrid(inputs.get(category));
                supports.put(category, window);
            }
            int cells = grid.width() * grid.height();
            double[] counts = new double[cells];
            List<GridBand> outputs = new ArrayList<>();
            for (BandKey key : request.bands()) {
                Band band = manifest.bands().stream().filter(b -> b.category() == key.category() && b.bandNumber() == key.bandNumber()).findFirst().orElseThrow();
                outputs.add(new GridBand(key.category(), key.bandNumber(), band.title(), band.units(), new Double[cells], new double[cells], band.sourceSha256()));
            }
            for (int row = 0; row < nativeGrid.height; row++) {
                for (int col = 0; col < nativeGrid.width; col++) {
                    int x = nativeGrid.x + col, y = nativeGrid.y + row;
                    double worldX = nativeGrid.left + (x - nativeGrid.originX + 0.5) * nativeGrid.pixel;
                    double worldY = nativeGrid.top - (y - nativeGrid.originY + 0.5) * nativeGrid.pixel;
                    if (domain.value(x, y, 0) != 1 || !mask.getBounds().contains(x, y) || mask.getSample(x, y, 0) == 0) continue;
                    int targetCol = (int) Math.floor((worldX - extent[0]) / 1000);
                    int targetRow = (int) Math.floor((extent[3] - worldY) / 1000);
                    if (targetCol < 0 || targetCol >= grid.width() || targetRow < 0 || targetRow >= grid.height()) continue;
                    int index = targetRow * grid.width() + targetCol;
                    counts[index]++;
                    for (GridBand output : outputs) {
                        if (supports.get(output.category()).value(x, y, output.bandNumber()) != 1) continue;
                        double value = inputs.get(output.category()).value(x, y, output.bandNumber());
                        if (!Double.isFinite(value) || value < 0) continue;
                        output.values()[index] = (output.values()[index] == null ? 0 : output.values()[index]) + value;
                        output.coverage()[index]++;
                    }
                }
            }
            double[] fraction = new double[cells];
            for (int i = 0; i < cells; i++) {
                fraction[i] = counts[i] * nativeGrid.pixel * nativeGrid.pixel / 1_000_000;
                for (GridBand output : outputs) {
                    double valid = output.coverage()[i];
                    if (valid > 0) output.values()[i] /= valid;
                    output.coverage()[i] = counts[i] > 0 ? valid / counts[i] : 0;
                }
            }
            // A baseline replaced during preparation must not produce mixed-source data.
            if (!manifest.fingerprint().equals(manifest(calculation).fingerprint()))
                throw new CalculationInputException(409, "Calculation sources changed during export; reload and retry.");
            return new GridResult(VERSION, calculation.getId(), manifest.fingerprint(), grid, "north-first", fraction, outputs);
        } finally {
            Set<GridCoverage2D> unique = Collections.newSetFromMap(new IdentityHashMap<>());
            unique.addAll(resources);
            unique.forEach(coverage -> coverage.dispose(false));
        }
    }

    private GridCoverage2D loadSidecar(CalculationResult calculation, String name, String expected) throws Exception {
        Path path = sidecar(calculation, name);
        if (!Files.isRegularFile(path) || !InputFingerprint.hash(path).equals(expected))
            throw new CalculationInputException(422, "Input-support raster is missing or has changed. Prepare the baseline support again.");
        var reader = new GeoTiffReader(path.toFile(), new Hints(Hints.FORCE_LONGITUDE_FIRST_AXIS_ORDER, Boolean.TRUE));
        try { return reader.read(null); }
        finally { reader.dispose(); }
    }

    private record NativeDomain(Geometry geographicRoi, GridGeometry2D geometry, ImageLayout layout, double[] extent) {}
    private NativeDomain nativeDomain(CalculationResult calculation, GridCoverage2D coverage,
                                      org.opengis.referencing.crs.CoordinateReferenceSystem sourceCrs) throws Exception {
        var geographic = JTS.transform(calculation.getScenarioSnapshot().getGeometry(), CRS.findMathTransform(sourceCrs, DefaultGeographicCRS.WGS84));
        var nativeRoi = JTS.transform(geographic, CRS.findMathTransform(DefaultGeographicCRS.WGS84, coverage.getCoordinateReferenceSystem()));
        var world = JTS.bounds(nativeRoi, coverage.getCoordinateReferenceSystem());
        var pixels = JTS.transform(world, coverage.getGridGeometry().getCRSToGrid2D());
        var layout = CalculationDomain.layout(pixels);
        var image = coverage.getRenderedImage();
        var source = coverage.getEnvelope2D();
        double pixel = source.getWidth() / image.getWidth();
        double left = source.getMinX() + (layout.getMinX(null) - image.getMinX()) * pixel;
        double top = source.getMaxY() - (layout.getMinY(null) - image.getMinY()) * pixel;
        return new NativeDomain(geographic, CalculationDomain.geometry(pixels, world), layout,
            new double[]{left, top - layout.getHeight(null) * pixel, left + layout.getWidth(null) * pixel, top});
    }

    /** Materialize only the bounded export window, not the complete regional stack. */
    private static final class Window {
        final Raster raster;
        final double pixel, left, top;
        final int originX, originY, x, y, width, height;
        Window(GridCoverage2D coverage, Grid grid) {
            var image = coverage.getRenderedImage();
            var env = coverage.getEnvelope2D();
            pixel = env.getWidth() / image.getWidth();
            left = env.getMinX(); top = env.getMaxY();
            originX = image.getMinX(); originY = image.getMinY();
            if (pixel < 100 || Math.abs(pixel - env.getHeight() / image.getHeight()) > 0.001 ||
                Math.abs(1000 / pixel - Math.rint(1000 / pixel)) > 1e-6)
                throw new CalculationInputException(422, "Unsupported native grid resolution.");
            double[] e = grid.extent();
            int minX = originX + (int) Math.floor((e[0] - left) / pixel + 1e-6);
            int minY = originY + (int) Math.floor((top - e[3]) / pixel + 1e-6);
            Rectangle bounds = new Rectangle(minX, minY, (int) Math.ceil((e[2] - e[0]) / pixel), (int) Math.ceil((e[3] - e[1]) / pixel))
                .intersection(new Rectangle(originX, originY, image.getWidth(), image.getHeight()));
            if (bounds.isEmpty()) throw new CalculationInputException(422, "The native baseline does not overlap this calculation.");
            raster = image.getData(bounds);
            x = bounds.x; y = bounds.y; width = bounds.width; height = bounds.height;
        }
        void requireSameGrid(Window other) {
            if (Math.abs(pixel - other.pixel) > 0.001 || Math.abs(left - other.left) > 0.001 || Math.abs(top - other.top) > 0.001 ||
                originX != other.originX || originY != other.originY || x != other.x || y != other.y || width != other.width || height != other.height)
                throw new CalculationInputException(422, "Native input and support grids do not align.");
        }
        double value(int x, int y, int band) { return raster.getSampleDouble(x, y, band); }
    }
}
