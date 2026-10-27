package org.ecotwin.core;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

public record SeedExecution(String id, int calculationId, int completedSeeds, int attempt, JsonNode request) {
    public SeedExecution { request = request.deepCopy(); }
    @Override public JsonNode request() { return request.deepCopy(); }
    public String engineRunId() {
        return UUID.nameUUIDFromBytes((id + ":" + completedSeeds + ":" + attempt).getBytes(StandardCharsets.UTF_8)).toString();
    }
}
