package org.ecotwin.integration.symphony;

import org.ecotwin.core.InputFingerprint;
import org.ecotwin.integration.jakarta.CalculationInputException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import it.geosolutions.jaiext.JAIExt;
import jakarta.persistence.EntityManager;
import org.geotools.coverage.grid.GridCoverageFactory;
import org.geotools.data.geojson.GeoJSONWriter;
import org.geotools.gce.geotiff.GeoTiffReader;
import org.geotools.gce.geotiff.GeoTiffWriter;
import org.geotools.geometry.jts.JTS;
import org.geotools.geometry.jts.ReferencedEnvelope;
import org.geotools.referencing.CRS;
import org.junit.*;
import se.havochvatten.symphony.service.*;
import org.junit.rules.TemporaryFolder;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.io.WKTReader;
import se.havochvatten.symphony.calculation.Operations;
import org.ecotwin.core.CalculationInputDto.*;
import org.ecotwin.core.CalculationInputDto.LayerType;
import se.havochvatten.symphony.entity.*;

import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.util.*;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

/** Small asymmetric real GeoTIFFs exercise the complete export, not mocked raster math. */
public class CalculationInputServiceTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private final ObjectMapper json = new ObjectMapper();
    private CalculationInputService service;
    private CalculationResult calculation;
    private ScenarioSnapshot snapshot;
    private Path root;
    private Geometry area;

    @Before public void setup() throws Exception {
        JAIExt.initJAIEXT(); root = tmp.getRoot().toPath();
        writeRaster("native.tif", false); writeRaster("domain.tif", true); writeRaster("support.tif", true);
        ObjectNode support = json.createObjectNode();
        support.put("version","native-input-support-v1").put("baselineName","test");
        support.put("domainFile","domain.tif").put("domainSha256",InputFingerprint.hash(root.resolve("domain.tif")));
        ObjectNode sources = support.putObject("sources");
        var layers = support.putArray("layers");
        for (LayerType category : List.of(LayerType.ECOSYSTEM,LayerType.PRESSURE)) {
            sources.putObject(category.name()).put("sha256",InputFingerprint.hash(root.resolve("native.tif")))
                .put("supportFile","support.tif").put("supportSha256",InputFingerprint.hash(root.resolve("support.tif")));
            layers.addObject().put("category",category.name()).put("bandNumber",0).put("units","index").put("sourceSha256","test");
        }
        Files.writeString(root.resolve("calculation-input-support.json"),support.toString());
        service = new CalculationInputService(); service.data = mock(DataLayerService.class);
        service.metadata = mock(MetaDataService.class); service.properties = mock(PropertiesService.class);
        service.scenarios = new ScenarioService(new Operations()); service.em = mock(EntityManager.class);
        when(service.properties.getProperty("data.source.crs","EPSG:3035")).thenReturn("EPSG:3035");
        when(service.data.getComponentFilePath(any(),anyInt())).thenReturn(root.resolve("native.tif").toString());
        when(service.data.getCoverage(any(),anyInt())).thenAnswer(call -> {
            var reader = new GeoTiffReader(root.resolve("native.tif").toFile());
            try { return reader.read(null); } finally { reader.dispose(); }
        });
        when(service.metadata.getSingleMetaFieldForComponent(anyInt(),any(),anyString(),any())).thenReturn(Map.of(0,"Test"));
        var baseline = mock(BaselineVersion.class); when(baseline.getId()).thenReturn(4); when(baseline.getName()).thenReturn("test");
        snapshot = spy(new ScenarioSnapshot()); snapshot.setEcosystemsToInclude(new int[]{0});
        doReturn(new int[]{0}).when(snapshot).getPressuresToInclude();
        snapshot.setChanges(json.readTree("{\"baseChanges\":{},\"areaChanges\":{\"1\":{},\"16\":{}}}"));
        // A disconnected island plus a main polygon with a 1 km hole.
        area = new WKTReader().read("MULTIPOLYGON (((4301000 3801000,4304000 3801000,4304000 3804000,4301000 3804000,4301000 3801000),(4302000 3802000,4302000 3803000,4303000 3803000,4303000 3802000,4302000 3802000)),((4300250 3800250,4300750 3800250,4300750 3800750,4300250 3800750,4300250 3800250)))");
        setAreas(area, false);
        calculation = mock(CalculationResult.class); when(calculation.getId()).thenReturn(7); when(calculation.getOwner()).thenReturn("owner");
        when(calculation.getBaselineVersion()).thenReturn(baseline); when(calculation.getScenarioSnapshot()).thenReturn(snapshot);
        when(calculation.getTimestamp()).thenReturn(new Date(1000)); when(calculation.getCalculationName()).thenReturn("Saved fixture");
        when(service.em.find(CalculationResult.class,7)).thenReturn(calculation);
    }
    private void writeRaster(String name, boolean support) throws Exception {
        var image = new BufferedImage(20,20,BufferedImage.TYPE_BYTE_GRAY);
        for(int y=0;y<20;y++) for(int x=0;x<20;x++)
            image.getRaster().setSample(x,y,0,support ? 1 : y < 10 ? 20 : 80);
        // Distinguish supported true zero from unknown data in the west/north corner.
        if(name.equals("native.tif")) for(int y=0;y<8;y++) for(int x=0;x<8;x++) image.getRaster().setSample(x,y,0,0);
        if(name.equals("support.tif")) for(int y=0;y<8;y++) for(int x=12;x<16;x++) image.getRaster().setSample(x,y,0,0);
        var coverage = new GridCoverageFactory().create(name,image,new ReferencedEnvelope(4300000,4305000,3800000,3805000,CRS.decode("EPSG:3035",true)));
        var writer = new GeoTiffWriter(root.resolve(name).toFile());
        try { writer.write(coverage,null); } finally { writer.dispose(); coverage.dispose(false); }
    }
    private ScenarioArea makeArea(int id, Geometry geometry, boolean coastal) throws Exception {
        var geographic=JTS.transform(geometry,CRS.findMathTransform(CRS.decode("EPSG:3035",true),CRS.decode("EPSG:4326",true)));
        var feature=json.createObjectNode().put("type","Feature"); feature.putObject("properties").put("name","Test");
        feature.set("geometry",json.readTree(GeoJSONWriter.toGeoJSON(geographic,12)));
        var result=spy(new ScenarioArea()); result.setId(id); result.setFeature(feature); doReturn(coastal ? 1 : -1).when(result).getExcludedCoastal();
        result.setChanges(json.createObjectNode()); return result;
    }
    private void setAreas(Geometry effective, boolean coastal) throws Exception {
        snapshot.setPolygon(json.readTree(GeoJSONWriter.toGeoJSON(effective,12)));
        // Deliberately reverse IDs; export must retain native ascending edit order.
        snapshot.setAreas(List.of(makeArea(16,area,coastal),makeArea(1,area,coastal)));
        snapshot.setAreaMatrixMap(Map.of(16,1,1,1)); snapshot.setNormalizationValue(new double[]{1,1});
    }
    private GridResult export() throws Exception {
        var source=service.manifest(calculation);
        return service.grid(calculation,new GridRequest(source.fingerprint(),source.suggestedGrid(),List.of(new BandKey(LayerType.PRESSURE,0))));
    }
    private int index(GridResult result,double x,double y) {
        return (int)((result.grid().extent()[3]-y)/1000)*result.grid().width()+(int)((x-result.grid().extent()[0])/1000);
    }
    @Test public void holesIslandsOrientationAndMissingSupportSurviveExport() throws Exception {
        var source=service.manifest(calculation); assertEquals("EPSG:4326",source.geometryCrs());
        assertTrue(source.geometry().path("coordinates").toString().contains("."));
        var grid=export(); var band=grid.bands().get(0);
        assertTrue(grid.domainCoverage()[index(grid,4302500,3802500)] < 1);
        assertTrue(grid.domainCoverage()[index(grid,4300500,3800500)]>0);
        int zero=index(grid,4301500,3803500), missing=index(grid,4303500,3803500), south=index(grid,4301500,3801500);
        assertEquals(0,band.values()[zero],0); assertEquals(1,band.coverage()[zero],0);
        assertNull(band.values()[missing]); assertEquals(0,band.coverage()[missing],0);
        assertEquals(80,band.values()[south],0); assertEquals("north-first",grid.rowOrder());
        verifyNoInteractions(service.em); // No result load/update/persist during raster export.
    }
    @Test public void frozenGlobalAndOverlappingAreaChangesAreAppliedBeforeAggregation() throws Exception {
        var base=export(); int south=index(base,4301500,3801500);
        snapshot.setChanges(json.readTree("{\"baseChanges\":{\"PRESSURE\":{\"0\":{\"multiplier\":0.5}}},\"areaChanges\":{\"1\":{\"PRESSURE\":{\"0\":{\"multiplier\":0.25}}},\"16\":{\"PRESSURE\":{\"0\":{\"offset\":10}}}}}"));
        var modified=export(); assertNotEquals(base.fingerprint(),modified.fingerprint());
        assertTrue(modified.bands().get(0).values()[south]<80);
        assertArrayEquals(base.domainCoverage(),modified.domainCoverage(),0);
        assertEquals(InputFingerprint.hash(json.valueToTree(modified)),InputFingerprint.hash(json.valueToTree(export())));
    }
    @Test public void savedCoastalExclusionIsUsedWithoutReadingTodaysCoast() throws Exception {
        var before=export();
        var exclusion=new WKTReader().read("POLYGON ((4300000 3800000,4305000 3800000,4305000 3802000,4300000 3802000,4300000 3800000))");
        setAreas(area.difference(exclusion),true); var after=export();
        assertTrue(Arrays.stream(after.domainCoverage()).sum()<Arrays.stream(before.domainCoverage()).sum());
        assertTrue(after.grid().extent()[1] >= 3802000);
    }
    @Test public void accessIsCheckedBeforeRasterWork() {
        assertSame(calculation,service.authorize(7,()->"owner"));
        assertEquals(401,assertThrows(CalculationInputException.class,()->service.authorize(7,null)).status);
        assertEquals(403,assertThrows(CalculationInputException.class,()->service.authorize(7,()->"stranger")).status);
        assertEquals(404,assertThrows(CalculationInputException.class,()->service.authorize(8,()->"owner")).status);
        when(calculation.isBaselineCalculation()).thenReturn(true); assertSame(calculation,service.authorize(7,()->"stranger"));
        verifyNoInteractions(service.data);
    }
    @Test public void sharedBaselineReadAccessDoesNotGrantMutationOrAWriteLock() {
        when(calculation.isBaselineCalculation()).thenReturn(true);
        service.requireReadable(7, () -> "stranger");
        assertEquals(403, assertThrows(CalculationInputException.class, () -> service.requireOwnerAndLock(7, () -> "stranger")).status);
        verify(service.em, never()).lock(any(), any());
        service.requireOwnerAndLock(7, () -> "owner");
        verify(service.em).lock(calculation, jakarta.persistence.LockModeType.PESSIMISTIC_WRITE);
        assertTrue(service.isCurrentOwner(7, "owner"));
        assertFalse(service.isCurrentOwner(7, "stranger"));
        assertFalse(service.isCurrentOwner(8, "owner"));
        verifyNoInteractions(service.data);
    }
    @Test public void concurrentDeletionDuringLockBecomesARollbackMarkedConflict() {
        var deleted = new jakarta.persistence.OptimisticLockException("row disappeared");
        doThrow(deleted).when(service.em).lock(calculation, jakarta.persistence.LockModeType.PESSIMISTIC_WRITE);
        var failure = assertThrows(CalculationInputException.class, () -> service.requireOwnerAndLock(7, () -> "owner"));
        assertEquals(409, failure.status); assertSame(deleted, failure.getCause());
        assertTrue(CalculationInputException.class.getAnnotation(jakarta.ejb.ApplicationException.class).rollback());
        verify(service.em, never()).refresh(any());
        verify(service.em, never()).persist(any());
        verifyNoInteractions(service.data);
    }
    @Test public void ownershipIsRecheckedFromRefreshedStateAfterWaitingForALock() {
        doAnswer(call -> { when(calculation.getOwner()).thenReturn("new-owner"); return null; }).when(service.em).refresh(calculation);
        assertEquals(403, assertThrows(CalculationInputException.class, () -> service.requireOwnerAndLock(7, () -> "owner")).status);
        var order = inOrder(service.em);
        order.verify(service.em).lock(calculation, jakarta.persistence.LockModeType.PESSIMISTIC_WRITE);
        order.verify(service.em).refresh(calculation);
        verify(service.em, never()).persist(any());
        verifyNoInteractions(service.data);
    }
}
