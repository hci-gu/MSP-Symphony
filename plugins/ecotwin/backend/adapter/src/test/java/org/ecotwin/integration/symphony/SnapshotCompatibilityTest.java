package org.ecotwin.integration.symphony;

import org.junit.Test;
import se.havochvatten.symphony.entity.ScenarioSnapshot;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import static org.junit.Assert.*;

/** An upstream snapshot addition must be reviewed by the plugin before claiming compatibility. */
public class SnapshotCompatibilityTest {
    @Test public void savedBaselineAdapterHasReviewedEveryNativeSnapshotField() {
        var state = Arrays.stream(ScenarioSnapshot.class.getDeclaredFields())
            .filter(field -> !Modifier.isStatic(field.getModifiers()))
            .map(java.lang.reflect.Field::getName).collect(Collectors.toSet());
        assertEquals("Native snapshot changed: review baseline state preservation in the EcoTwin adapter before advancing its supported revision",
            Set.of("id", "name", "baselineId", "ecosystemsToInclude", "pressuresToInclude", "changes", "areas",
                "normalization", "owner", "timestamp", "polygon", "normalizationValue", "areaMatrixMap", "calculationresults"), state);
    }
}
