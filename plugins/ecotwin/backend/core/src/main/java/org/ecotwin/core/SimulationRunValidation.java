package org.ecotwin.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.ecotwin.core.CalculationInputDto.Grid;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.*;

/** Versioned envelope validation and deterministic report aggregation. No model calls. */
public final class SimulationRunValidation {
    private static final ObjectMapper JSON = new ObjectMapper();
    public static final int MAX_TENSOR_BYTES = 8 * 1024 * 1024;
    public static final int MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
    public record Validated(ObjectNode metadata, byte[] tensor, ObjectNode summary, String hash) {}

    static void require(boolean condition, String message) {
        if (!condition) throw new SimulationValidationException(message);
    }
    static int integer(JsonNode node, int min, int max, String field) {
        require(node != null && node.isIntegralNumber() && node.canConvertToInt() && node.intValue() >= min && node.intValue() <= max,
            "Invalid " + field + ".");
        return node.intValue();
    }
    static String label(JsonNode node, String field) {
        require(node != null && node.isTextual() && !node.asText().isBlank() && node.asText().length() <= 300, "Invalid " + field + ".");
        return node.asText();
    }
    public static Validated validate(JsonNode payload, int calculationId, String runId) throws Exception {
        return validate(payload, calculationId, runId, false);
    }
    /** Internal worker validation of a single seed, before adding it to an ensemble. */
    public static Validated validateSeed(JsonNode payload, int calculationId, String runId) throws Exception {
        return validate(payload, calculationId, runId, true);
    }
    private record Definition(ObjectNode metadata, JsonNode input, JsonNode source, JsonNode config,
        Grid grid, int cells, int waterCells, double nativeArea, boolean ensemble, List<Integer> steps,
        JsonNode species, JsonNode model, long count) {}

    /** Validate a frozen request without fabricating a tensor, result or completion time. */
    public static void validateRequest(JsonNode request, int calculationId, String runId) throws Exception {
        definition(request, calculationId, runId);
        require(JSON.writeValueAsBytes(request).length <= 2 * 1024 * 1024, "Simulation metadata exceeds 2 MiB.");
    }
    private static Definition definition(JsonNode payload, int calculationId, String runId) throws Exception {
        boolean ensemble = payload != null && "ecotwin-run-v2".equals(payload.path("version").asText());
        require(payload != null && payload.isObject() && (ensemble || "ecotwin-run-v1".equals(payload.path("version").asText())), "Unsupported simulation format.");
        require(runId.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}") &&
            runId.equals(payload.path("runId").asText()), "Invalid run identity.");
        var metadata = ((ObjectNode) payload).deepCopy();
        JsonNode input = metadata.path("input"), source = input.path("source"), config = metadata.path("config");
        require(source.path("calculationId").asInt(-1) == calculationId && source.path("fingerprint").asText().matches("[a-f0-9]{64}"), "Invalid calculation reference.");
        require(HavWestProfile.specification().path("inputVersion").asText().equals(source.path("version").asText()) &&
            HavWestProfile.id().equals(config.path("mappingVersion").asText()), "Unsupported input or mapping version.");
        Grid grid;
        try { grid = JSON.treeToValue(input.path("grid"), Grid.class); }
        catch (Exception e) { throw new SimulationValidationException("Invalid simulation grid."); }
        HavWestProfile.validateGrid(grid);
        int cells = grid.width() * grid.height();
        JsonNode water = input.path("water"), nativeGrid = input.path("nativeGrid");
        require(water.isArray() && water.size() == cells && nativeGrid.path("domainCoverage").isArray() && nativeGrid.path("domainCoverage").size() == cells &&
            nativeGrid.path("fingerprint").equals(source.path("fingerprint")) &&
            InputFingerprint.hash(nativeGrid.path("grid")).equals(InputFingerprint.hash(input.path("grid"))), "Invalid saved domain.");
        int waterCells = 0;
        double nativeArea = 0;
        for (int i = 0; i < cells; i++) {
            int v = integer(water.get(i), 0, 1, "water mask");
            JsonNode fraction = nativeGrid.path("domainCoverage").get(i);
            require(fraction.isNumber() && Double.isFinite(fraction.asDouble()) && fraction.asDouble() >= 0 && fraction.asDouble() <= 1 &&
                (fraction.asDouble() > 0) == (v == 1), "Invalid native domain coverage.");
            nativeArea += fraction.asDouble();
            waterCells += v;
        }
        require(waterCells > 0 && input.path("waterCells").asInt(-1) == waterCells, "Invalid water-cell count.");
        HavWestProfile.validatePrepared(input, cells);
        int maxSteps = integer(config.path("maxSteps"), 1, HavWestProfile.specification().path("maxSteps").asInt(), "simulation duration");
        int interval = Math.max(4, (int) Math.ceil(maxSteps / 50.0));
        require(config.path("sampleEvery").asInt(-1) == interval && (ensemble || config.path("seed").asInt(-1) == 42) &&
            config.path("tickDurationDays").asDouble() == HavWestProfile.specification().path("tickDurationDays").asDouble(), "Invalid simulation configuration.");
        if (ensemble) {
            integer(config.path("seed"), 0, Integer.MAX_VALUE - 10, "base seed");
            require(config.path("replicates").asInt() == SimulationEnsemble.REPLICATES, "A full simulation requires ten seeds.");
        }
        List<Integer> steps = SimulationEnsemble.sampleSteps(maxSteps);
        JsonNode model = metadata.path("model"), species = model.path("species");
        require(species.isArray() && species.size() >= 1 && species.size() <= 64, "Invalid result species.");
        Set<String> names = new HashSet<>();
        for (JsonNode name : species) require(names.add(label(name, "species")), "Duplicate result species.");
        label(model.path("id"), "model ID"); label(model.path("name"), "model name");
        long count = (long) steps.size() * cells * species.size();
        require(count * 4 <= MAX_TENSOR_BYTES, "Simulation exceeds the result size limit.");
        return new Definition(metadata,input,source,config,grid,cells,waterCells,nativeArea,ensemble,steps,species,model,count);
    }
    private static Validated validate(JsonNode payload, int calculationId, String runId, boolean seedOnly) throws Exception {
        Definition d = definition(payload, calculationId, runId);
        var metadata = d.metadata(); var input = d.input(); var source = d.source(); var config = d.config();
        var grid = d.grid(); int cells = d.cells(), waterCells = d.waterCells(); double nativeArea = d.nativeArea();
        boolean ensemble = d.ensemble(); var steps = d.steps(); var species = d.species(); var model = d.model(); long count = d.count();
        JsonNode result = metadata.path("result"), water = input.path("water");
        require(JSON.valueToTree(steps).equals(result.path("steps")), "Invalid saved frame schedule.");
        require(species.equals(result.path("species")), "Invalid result species.");
        require("tonnes/cell".equals(result.path("units").asText()) && "frame,row,column,species".equals(result.path("order").asText()), "Invalid tensor units or ordering.");
        String encoded = result.path("biomassB64").asText();
        require(encoded.length() == 4 * ((count * 4 + 2) / 3), "Unexpected result tensor size.");
        byte[] tensor;
        try { tensor = Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException e) { throw new SimulationValidationException("Invalid tensor encoding."); }
        require(tensor.length == count * 4, "Unexpected result tensor length.");
        ((ObjectNode) result).remove("biomassB64");
        require(JSON.writeValueAsBytes(metadata).length <= 2 * 1024 * 1024, "Simulation metadata exceeds 2 MiB.");
        long completed = payload.path("completedAt").asLong(0);
        require(completed > 0 && completed <= System.currentTimeMillis() + 300000, "Invalid completion timestamp.");
        double[][] totals = new double[species.size()][steps.size()];
        double[] maxima = new double[species.size()];
        ByteBuffer bytes = ByteBuffer.wrap(tensor).order(ByteOrder.LITTLE_ENDIAN);
        for (int frame = 0; frame < steps.size(); frame++)
            for (int cell = 0; cell < cells; cell++)
                for (int s = 0; s < species.size(); s++) {
                    float value = bytes.getFloat();
                    require(Float.isFinite(value) && value >= 0, "Invalid biomass value.");
                    maxima[s] = Math.max(maxima[s], value);
                    if (water.get(cell).asInt() == 1) totals[s][frame] += value;
                }
        ObjectNode summary = JSON.createObjectNode();
        summary.put("version", ensemble ? "ecotwin-report-v2" : "ecotwin-report-v1"); summary.put("runId", runId);
        summary.put("calculationId", calculationId); summary.put("completedAt", completed);
        summary.set("source", source); summary.set("model", model); summary.set("config", config);
        summary.set("grid", input.path("grid")); summary.set("steps", result.path("steps"));
        summary.set("species", species); summary.put("units", "tonnes/cell");
        summary.put("waterCells", waterCells); summary.put("nativeAreaKm2", nativeArea);
        summary.set("assumptions", input.path("assumptions"));
        summary.set("totals", JSON.valueToTree(totals)); summary.set("maxima", JSON.valueToTree(maxima));
        summary.set("water", water);
        // Include the actual inputs' lightweight provenance, not every cell in a list response.
        var inputs = summary.putArray("pressures");
        for (JsonNode layer : input.path("impacts").path("layers")) {
            var item = inputs.addObject();
            for (String key : List.of("kind", "sourceId", "sourceSha256", "strength", "coverage", "affectedCells")) item.set(key, layer.path(key));
        }
        if (ensemble && !seedOnly) {
            ObjectNode statistics = SimulationEnsemble.statistics(payload.path("ensemble"), config.path("seed").asInt(), totals);
            metadata.set("ensemble", statistics);
            summary.set("ensemble", statistics);
            summary.set("totals", statistics.path("mean"));
        }
        return new Validated(metadata, tensor, summary, InputFingerprint.hash(payload));
    }

    private SimulationRunValidation() {}
}
