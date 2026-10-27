package se.havochvatten.symphony.entity;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.Test;
import se.havochvatten.symphony.dto.NormalizationOptions;
import java.util.Map;
import static org.junit.Assert.*;

public class ScenarioSnapshotCopyTest {
    @Test public void removesAllLayerChangesWithoutMutatingTheSavedScenario() throws Exception {
        var json = new ObjectMapper();
        var source = new ScenarioSnapshot();
        source.id = 7; source.name = "Scenario"; source.owner = "owner"; source.baselineId = 4;
        source.polygon = json.readTree("{\"type\":\"Polygon\",\"coordinates\":[]}");
        source.areas = json.readTree("{\"3\":{\"areaName\":\"Coastal exclusion\",\"featureJson\":{},\"excludedCoastal\":12}}");
        source.ecosystemsToInclude = new int[]{1, 2}; source.pressuresToInclude = new int[]{3, 13};
        source.normalization = new NormalizationOptions(45.0);
        source.setNormalizationValue(new double[]{45}); source.setAreaMatrixMap(Map.of(3, 8));
        source.changes = json.readTree("{\"baseChanges\":{\"PRESSURE\":{\"3\":{\"multiplier\":0.5}}},\"areaChanges\":{\"3\":{\"ECOSYSTEM\":{\"1\":{\"multiplier\":0.1}}}}}");
        var original = source.changes.deepCopy();
        var baseline = source.withoutLayerChanges("owner", "Baseline");
        assertNull(baseline.id);
        assertEquals(source.polygon, baseline.polygon);
        assertEquals(source.areas, baseline.areas);
        assertEquals(Map.of(3, 12), baseline.getAreasExcludingCoastal());
        assertEquals(Map.of(3, 8), baseline.getAreaMatrixMap());
        assertEquals(45, baseline.normalization.getUserDefinedValue(), 0);
        assertNotSame(source.normalization, baseline.normalization);
        assertTrue(baseline.getChangeMap().isEmpty());
        assertTrue(baseline.getTmpAreas().get(0).getChangeMap().isEmpty());
        assertEquals(original, source.changes);
        baseline.ecosystemsToInclude[0] = 99;
        baseline.pressuresToInclude[0] = 99;
        baseline.getNormalizationValue()[0] = 99;
        assertArrayEquals(new int[]{1, 2}, source.ecosystemsToInclude);
        assertArrayEquals(new int[]{3, 13}, source.pressuresToInclude);
        assertArrayEquals(new double[]{45}, source.getNormalizationValue(), 0);
    }
}
