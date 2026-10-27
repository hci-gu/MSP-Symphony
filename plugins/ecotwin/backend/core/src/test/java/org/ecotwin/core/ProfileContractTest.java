package org.ecotwin.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.Test;
import static org.junit.Assert.*;

/** Shared language-independent cases exercise the actual server verification, not only constants. */
public class ProfileContractTest {
    private JsonNode cases() throws Exception {
        try (var input = getClass().getResourceAsStream("/fixtures/hav-west-native-v1.json")) {
            assertNotNull(input); return new ObjectMapper().readTree(input);
        }
    }
    private ObjectNode request() throws Exception {
        ObjectNode p = new SimulationRunValidationTest().fixture();
        p.remove("result"); p.remove("completedAt"); p.put("version", "ecotwin-run-v2");
        ((ObjectNode)p.path("config")).put("replicates", 10);
        return p;
    }
    private ObjectNode pressure(ObjectNode request, String kind, JsonNode value, double coverage) {
        ObjectNode input = (ObjectNode) request.path("input");
        var source = (ObjectNode)input.path("source");
        JsonNode spec = null;
        for (JsonNode band : HavWestProfile.specification().path("pressureBands")) if (kind.equals(band.path("kind").asText())) spec = band;
        assertNotNull(spec);
        source.putArray("bands").addObject().put("category", "PRESSURE").put("bandNumber", spec.path("bandNumber").asInt())
            .put("sourceSha256", spec.path("sourceSha256").asText()).put("units", HavWestProfile.specification().path("pressureUnits").asText());
        var export = ((ObjectNode)input.path("nativeGrid")).putArray("bands").addObject();
        export.put("category", "PRESSURE").put("bandNumber", spec.path("bandNumber").asInt());
        var values = export.putArray("values"); var support = export.putArray("coverage");
        var layer = ((ObjectNode)input.path("impacts")).putArray("layers").addObject();
        layer.put("kind", kind).put("strength", 1).put("sourceSha256", spec.path("sourceSha256").asText()).put("coverage", 1);
        var intensities = layer.putArray("values"); var masks = layer.putArray("bands");
        int level = value.isNumber() && value.asDouble() >= 0 ? HavWestProfile.quantize(value.asDouble()) : 0;
        double intensity = HavWestProfile.intensity(kind, level);
        layer.put("affectedCells", level == 0 ? 0 : 2);
        com.fasterxml.jackson.databind.node.ArrayNode mask = null;
        if (level > 0) mask = masks.addObject().put("id", kind + "-" + String.format("%02d", level)).put("level", level).put("intensity", intensity).putArray("mask");
        for (int i = 0; i < 9; i++) {
            boolean water = input.path("water").get(i).asInt() == 1;
            values.add(value); support.add(coverage); intensities.add(water ? (float)intensity : 0);
            if (mask != null) mask.add(water ? 1 : 0);
        }
        return layer;
    }
    @Test public void sharedQuantizationCasesPassIndependentServerValidation() throws Exception {
        var json = new ObjectMapper();
        for (JsonNode c : cases().path("quantization")) {
            String kind = c.path("kind").asText();
            int level = HavWestProfile.quantize(c.path("nativeValue").asDouble());
            assertEquals(c.path("level").asInt(), level);
            assertEquals(c.path("intensity").asDouble(), HavWestProfile.intensity(kind, level), 0);
            assertEquals(c.path("float32").asDouble(), (double)(float)HavWestProfile.intensity(kind, level), 0);
            var request = request(); var layer = pressure(request, kind, c.path("nativeValue"), 1);
            SimulationRunValidation.validateRequest(request, 7, request.path("runId").asText());
            ((com.fasterxml.jackson.databind.node.ArrayNode)layer.path("values")).set(0, json.valueToTree(999));
            assertThrows(SimulationValidationException.class, () -> SimulationRunValidation.validateRequest(request, 7, request.path("runId").asText()));
        }
    }
    @Test public void sharedInvalidSupportCasesAreRejected() throws Exception {
        for (JsonNode c : cases().path("invalid")) {
            var request = request(); pressure(request, "noise", c.path("value"), c.path("coverage").asDouble());
            assertThrows(c.path("reason").asText(), SimulationValidationException.class,
                () -> SimulationRunValidation.validateRequest(request, 7, request.path("runId").asText()));
        }
    }
    @Test public void sharedWaterCasesRetainFractionsAndWholeCellMask() throws Exception {
        for (JsonNode c : cases().path("water")) {
            var request = request(); var input = (ObjectNode)request.path("input");
            ((com.fasterxml.jackson.databind.node.ArrayNode)input.path("water")).set(0, c.path("water"));
            ((com.fasterxml.jackson.databind.node.ArrayNode)input.path("nativeGrid").path("domainCoverage")).set(0, c.path("domainCoverage"));
            input.put("waterCells", 1 + c.path("water").asInt());
            SimulationRunValidation.validateRequest(request, 7, request.path("runId").asText());
        }
    }
    @Test public void preparedValidationDoesNotMutateRequestOrRequireAResult() throws Exception {
        var request = request(); var before = request.deepCopy();
        SimulationRunValidation.validateRequest(request, 7, request.path("runId").asText());
        assertEquals(before, request); assertFalse(request.has("result")); assertFalse(request.has("completedAt"));
        var execution = new SeedExecution(request.path("runId").asText(), 7, 0, 0, request);
        request.put("changed", true); assertFalse(execution.request().has("changed"));
        ((ObjectNode)execution.request()).put("changed", true); assertFalse(execution.request().has("changed"));
        assertNotEquals(execution.engineRunId(), new SeedExecution(execution.id(), 7, 0, 1, before).engineRunId());
    }
}
