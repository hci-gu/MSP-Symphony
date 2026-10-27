package org.ecotwin.integration.jakarta;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.*;
import java.util.Base64;
public class SimulationFixtures {
    private final ObjectMapper json = new ObjectMapper();
    public ObjectNode fixture() throws Exception {
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
}
