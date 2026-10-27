package org.ecotwin.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.Test;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Base64;
import static org.junit.Assert.*;

public class SimulationRunValidationTest {
    private static final String ID = "5db496cc-f539-4a1e-b045-3f870596731b";
    private final ObjectMapper json = new ObjectMapper();
    ObjectNode fixture() throws Exception {
        ObjectNode payload = (ObjectNode) json.readTree("""
          {"version":"ecotwin-run-v1","runId":"5db496cc-f539-4a1e-b045-3f870596731b","completedAt":1000,
           "model":{"id":"test","name":"Test model","species":["codfish","plankton"]},
           "config":{"maxSteps":1,"sampleEvery":4,"seed":42,"tickDurationDays":0.25,"mappingVersion":"hav-west-native-v1"},
           "input":{"id":"input","grid":{"crs":"EPSG:3035","extent":[0,0,3000,3000],"width":3,"height":3,"cellMetres":1000},
            "water":[1,0,1,0,0,0,0,0,0],"waterCells":2,"assumptions":["Synthetic depth"],
            "source":{"version":"calculation-input-v1","calculationId":7,"baselineName":"HAV_2019_WEST_LOCAL","bands":[]},
            "nativeGrid":{"domainCoverage":[1,0,0.5,0,0,0,0,0,0]},
            "impacts":{"inputId":"input","version":"hav-west-native-v1","layers":[]}},
           "result":{"steps":[0,1],"species":["codfish","plankton"],"units":"tonnes/cell","order":"frame,row,column,species"}}
          """);
        var input = (ObjectNode) payload.path("input");
        ((ObjectNode) input.path("source")).put("fingerprint", "a".repeat(64));
        var nativeGrid = (ObjectNode) input.path("nativeGrid");
        nativeGrid.put("fingerprint", "a".repeat(64)); nativeGrid.set("grid",input.path("grid"));
        ByteBuffer bytes = ByteBuffer.allocate(2*9*2*4).order(ByteOrder.LITTLE_ENDIAN);
        for(int frame=0;frame<2;frame++) for(int cell=0;cell<9;cell++) {
            bytes.putFloat(cell==0 || cell==2 ? frame+1 : 999);
            bytes.putFloat(frame==0 ? 0 : 4);
        }
        ((ObjectNode) payload.path("result")).put("biomassB64",Base64.getEncoder().encodeToString(bytes.array()));
        return payload;
    }
    @Test public void generatesSummaryFromTensorAndDomainRatherThanSubmittedTotals() throws Exception {
        var payload=fixture(); payload.put("totals",999999);
        var validated=SimulationRunValidation.validate(payload,7,ID);
        assertEquals(2,validated.summary().path("totals").get(0).get(0).asDouble(),0);
        assertEquals(4,validated.summary().path("totals").get(0).get(1).asDouble(),0);
        assertEquals(0,validated.summary().path("totals").get(1).get(0).asDouble(),0);
        assertEquals(8,validated.summary().path("totals").get(1).get(1).asDouble(),0);
        assertEquals(1.5,validated.summary().path("nativeAreaKm2").asDouble(),0);
        assertFalse(validated.metadata().path("result").has("biomassB64"));
        assertEquals(validated.hash(),SimulationRunValidation.validate(payload,7,ID).hash());
    }
    @Test public void rejectsWrongIdentityUnsupportedUnitsAndMismatchedMasks() throws Exception {
        var payload=fixture();
        assertThrows(SimulationValidationException.class,()->SimulationRunValidation.validate(payload,8,ID));
        assertThrows(SimulationValidationException.class,()->SimulationRunValidation.validate(payload,7,"not-a-uuid"));
        ((ObjectNode)payload.path("result")).put("units","kg");
        assertThrows(SimulationValidationException.class,()->SimulationRunValidation.validate(payload,7,ID));
        ((ObjectNode)payload.path("result")).put("units","tonnes/cell");
        ((ObjectNode)payload.path("input")).put("waterCells",5);
        assertThrows(SimulationValidationException.class,()->SimulationRunValidation.validate(payload,7,ID));
    }
    @Test public void rejectsNonfiniteNegativeTruncatedAndOversizedTensors() throws Exception {
        var payload=fixture(); var result=(ObjectNode)payload.path("result");
        byte[] valid=Base64.getDecoder().decode(result.path("biomassB64").asText());
        for(float bad:new float[]{Float.NaN,Float.POSITIVE_INFINITY,-1}) {
            byte[] bytes=valid.clone(); ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).putFloat(bad);
            result.put("biomassB64",Base64.getEncoder().encodeToString(bytes));
            assertThrows(SimulationValidationException.class,()->SimulationRunValidation.validate(payload,7,ID));
        }
        result.put("biomassB64","AA==");
        assertThrows(SimulationValidationException.class,()->SimulationRunValidation.validate(payload,7,ID));
        result.put("biomassB64",Base64.getEncoder().encodeToString(new byte[valid.length+4]));
        assertThrows(SimulationValidationException.class,()->SimulationRunValidation.validate(payload,7,ID));
    }
}
