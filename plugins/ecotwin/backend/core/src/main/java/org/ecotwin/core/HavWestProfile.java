package org.ecotwin.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.ecotwin.core.CalculationInputDto.Grid;
import java.util.*;
import static org.ecotwin.core.SimulationRunValidation.*;

/** Reviewed scientific policy, deliberately independent of native Symphony interpretation. */
public final class HavWestProfile {
    private static final JsonNode SPEC = load();
    public static String id() { return SPEC.path("id").asText(); }
    public static JsonNode specification() { return SPEC.deepCopy(); }
    private static JsonNode load() {
        try (var stream = HavWestProfile.class.getResourceAsStream("/ecotwin/profiles/hav-west-native-v1/profile.json")) {
            if (stream == null) throw new IllegalStateException("EcoTwin profile resource is missing");
            return new ObjectMapper().readTree(stream);
        } catch (java.io.IOException e) { throw new ExceptionInInitializerError(e); }
    }
    private static JsonNode band(int number) {
        for (JsonNode b : SPEC.path("pressureBands")) if (b.path("bandNumber").asInt() == number) return b;
        return com.fasterxml.jackson.databind.node.MissingNode.getInstance();
    }
    private static JsonNode band(String kind) {
        for (JsonNode b : SPEC.path("pressureBands")) if (b.path("kind").asText().equals(kind)) return b;
        throw new SimulationValidationException("Unsupported pressure kind.");
    }
    public static int quantize(double value) {
        require(Double.isFinite(value) && value >= 0, "Invalid native pressure value.");
        return value == 0 ? 0 : (int) Math.max(1, Math.min(SPEC.path("levels").asInt(), Math.round(value / 100 * SPEC.path("levels").asInt())));
    }
    public static void validateGrid(Grid grid) {
        JsonNode rules = SPEC.path("grid");
        int min = rules.path("minCells").asInt(), max = rules.path("maxCells").asInt();
        double cell = rules.path("cellMetres").asDouble();
        require(grid != null && rules.path("crs").asText().equals(grid.crs()) && grid.width() >= min && grid.height() >= min &&
            grid.width() <= max && grid.height() <= max && grid.cellMetres() == cell && grid.extent() != null && grid.extent().length == 4,
            "Use a 3–60 cell grid at 1 km in EPSG:3035.");
        double[] e = grid.extent();
        require(Arrays.stream(e).allMatch(v -> Double.isFinite(v) && Math.abs(v / cell - Math.rint(v / cell)) <= 1e-6) &&
            Math.abs(e[2] - e[0] - grid.width() * cell) <= 0.001 && Math.abs(e[3] - e[1] - grid.height() * cell) <= 0.001,
            "Grid extent and dimensions do not agree.");
    }
    public static void validatePrepared(JsonNode input, int cells) {
        JsonNode source = input.path("source"), nativeGrid = input.path("nativeGrid"), impacts = input.path("impacts");
        require(SPEC.path("baselineName").asText().equals(source.path("baselineName").asText()) &&
            id().equals(impacts.path("version").asText()) &&
            impacts.path("inputId").equals(input.path("id")), "Invalid prepared-input identity.");
        require(input.path("assumptions").isArray() && input.path("assumptions").size() <= 20, "Invalid simulation assumptions.");
        for (JsonNode note : input.path("assumptions")) label(note, "simulation assumption");
        Map<Integer, JsonNode> selected = new HashMap<>();
        for (JsonNode band : source.path("bands")) {
            if (!"PRESSURE".equals(band.path("category").asText())) continue;
            int number = band.path("bandNumber").asInt(-1);
            String hash = band(number).path("sourceSha256").asText();
            require(!hash.isEmpty() && hash.equals(band.path("sourceSha256").asText()) &&
                SPEC.path("pressureUnits").asText().equals(band.path("units").asText()) && selected.put(number, band) == null,
                "Unsupported selected pressure in saved simulation.");
        }
        require(impacts.path("layers").isArray() && impacts.path("layers").size() == selected.size(), "Missing prepared pressure.");
        Set<String> kinds = new HashSet<>();
        for (JsonNode layer : impacts.path("layers")) {
            String kind = layer.path("kind").asText();
            int number = band(kind).path("bandNumber").asInt();
            require(selected.containsKey(number) && kinds.add(kind) && layer.path("strength").asDouble() == 1 &&
                layer.path("sourceSha256").equals(selected.get(number).path("sourceSha256")) &&
                layer.path("coverage").asDouble() == 1 && layer.path("values").isArray() && layer.path("values").size() == cells,
                "Invalid prepared pressure.");
            JsonNode exported = null;
            for (JsonNode band : nativeGrid.path("bands"))
                if ("PRESSURE".equals(band.path("category").asText()) && band.path("bandNumber").asInt(-1) == number) exported = band;
            require(exported != null && exported.path("values").isArray() && exported.path("coverage").isArray() && exported.path("values").size() == cells && exported.path("coverage").size() == cells,
                "Missing native pressure grid.");
            int[] levels = new int[cells];
            Set<Integer> expectedLevels = new HashSet<>();
            int affected = 0;
            for (int i = 0; i < cells; i++) {
                if (input.path("water").get(i).asInt() == 1) {
                    JsonNode value = exported.path("values").get(i);
                    require(value.isNumber() && Double.isFinite(value.asDouble()) && value.asDouble() >= 0 &&
                        exported.path("coverage").get(i).asDouble() >= 1 - SPEC.path("coverageTolerance").asDouble(), "Missing pressure support inside saved domain.");
                    levels[i] = quantize(value.asDouble());
                }
                if (levels[i] > 0) { expectedLevels.add(levels[i]); affected++; }
                float expected = (float) intensity(kind, levels[i]);
                require(layer.path("values").get(i).isNumber() && (float) layer.path("values").get(i).asDouble() == expected,
                    "Prepared model intensity disagrees with native input.");
            }
            require(layer.path("affectedCells").asInt(-1) == affected && layer.path("bands").isArray() && layer.path("bands").size() == expectedLevels.size(), "Invalid pressure masks.");
            for (JsonNode band : layer.path("bands")) {
                int level = integer(band.path("level"), 1, SPEC.path("levels").asInt(), "pressure quantization");
                require(expectedLevels.remove(level) && band.path("mask").isArray() && band.path("mask").size() == cells &&
                    band.path("intensity").asDouble() == intensity(kind, level) &&
                    band.path("id").asText().equals(kind + "-" + String.format("%02d", level)), "Invalid quantized pressure band.");
                for (int i = 0; i < cells; i++) require(integer(band.path("mask").get(i), 0, 1, "pressure mask") ==
                    (levels[i] == level ? 1 : 0), "Pressure mask disagrees with native input.");
            }
        }
    }
    public static double intensity(String kind, int level) {
        JsonNode range = band(kind).path("intensity");
        return level == 0 ? 0 : range.path("min").asDouble() + (range.path("max").asDouble() - range.path("min").asDouble()) * (level / (double) SPEC.path("levels").asInt());
    }
    private HavWestProfile() {}
}
