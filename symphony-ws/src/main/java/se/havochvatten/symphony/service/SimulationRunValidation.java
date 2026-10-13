package se.havochvatten.symphony.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import se.havochvatten.symphony.dto.CalculationInputDto.Grid;
import se.havochvatten.symphony.exception.CalculationInputException;
import se.havochvatten.symphony.util.InputFingerprint;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.*;

/** Versioned envelope validation and deterministic report aggregation. No model calls. */
public final class SimulationRunValidation {
    private static final ObjectMapper JSON = new ObjectMapper();
    public static final int MAX_TENSOR_BYTES = 8 * 1024 * 1024;
    public static final int MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
    public record Validated(ObjectNode metadata, byte[] tensor, ObjectNode summary, String hash) {}

    private static void require(boolean condition, String message) {
        if (!condition) throw new CalculationInputException(400, message);
    }
    private static int integer(JsonNode node, int min, int max, String field) {
        require(node != null && node.isIntegralNumber() && node.canConvertToInt() && node.intValue() >= min && node.intValue() <= max,
            "Invalid " + field + ".");
        return node.intValue();
    }
    private static String label(JsonNode node, String field) {
        require(node != null && node.isTextual() && !node.asText().isBlank() && node.asText().length() <= 300, "Invalid " + field + ".");
        return node.asText();
    }
    public static Validated validate(JsonNode payload, int calculationId, String runId) throws Exception {
        require(payload != null && payload.isObject() && "ecotwin-run-v1".equals(payload.path("version").asText()), "Unsupported simulation format.");
        require(runId.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}") &&
            runId.equals(payload.path("runId").asText()), "Invalid run identity.");
        var metadata = ((ObjectNode) payload).deepCopy();
        JsonNode result = metadata.path("result"), input = metadata.path("input"), source = input.path("source"), config = metadata.path("config");
        require(source.path("calculationId").asInt(-1) == calculationId && source.path("fingerprint").asText().matches("[a-f0-9]{64}"), "Invalid calculation reference.");
        require("calculation-input-v1".equals(source.path("version").asText()) &&
            "hav-west-native-v1".equals(config.path("mappingVersion").asText()), "Unsupported input or mapping version.");
        Grid grid;
        try { grid = JSON.treeToValue(input.path("grid"), Grid.class); }
        catch (Exception e) { throw new CalculationInputException(400, "Invalid simulation grid."); }
        CalculationInputService.validateGrid(grid);
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
        validatePrepared(input, cells);
        int maxSteps = integer(config.path("maxSteps"), 1, 10000, "simulation duration");
        int interval = Math.max(4, (int) Math.ceil(maxSteps / 50.0));
        require(config.path("sampleEvery").asInt(-1) == interval && config.path("seed").asInt(-1) == 42 &&
            config.path("tickDurationDays").asDouble() == 0.25, "Invalid simulation configuration.");
        List<Integer> steps = new ArrayList<>();
        for (int i = 0; i <= maxSteps; i += interval) steps.add(i);
        if (steps.get(steps.size() - 1) != maxSteps) steps.add(maxSteps);
        require(JSON.valueToTree(steps).equals(result.path("steps")), "Invalid saved frame schedule.");
        JsonNode species = result.path("species"), model = metadata.path("model");
        require(species.isArray() && species.size() >= 1 && species.size() <= 64 && species.equals(model.path("species")), "Invalid result species.");
        Set<String> names = new HashSet<>();
        for (JsonNode name : species) require(names.add(label(name, "species")), "Duplicate result species.");
        label(model.path("id"), "model ID"); label(model.path("name"), "model name");
        require("tonnes/cell".equals(result.path("units").asText()) && "frame,row,column,species".equals(result.path("order").asText()), "Invalid tensor units or ordering.");
        long count = (long) steps.size() * cells * species.size();
        require(count * 4 <= MAX_TENSOR_BYTES, "Simulation exceeds the result size limit.");
        String encoded = result.path("biomassB64").asText();
        require(encoded.length() == 4 * ((count * 4 + 2) / 3), "Unexpected result tensor size.");
        byte[] tensor;
        try { tensor = Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException e) { throw new CalculationInputException(400, "Invalid tensor encoding."); }
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
        summary.put("version", "ecotwin-report-v1"); summary.put("runId", runId);
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
        return new Validated(metadata, tensor, summary, InputFingerprint.hash(payload));
    }

    private static void validatePrepared(JsonNode input, int cells) {
        JsonNode source = input.path("source"), nativeGrid = input.path("nativeGrid"), impacts = input.path("impacts");
        require("HAV_2019_WEST_LOCAL".equals(source.path("baselineName").asText()) &&
            "hav-west-native-v1".equals(impacts.path("version").asText()) &&
            impacts.path("inputId").equals(input.path("id")), "Invalid prepared-input identity.");
        require(input.path("assumptions").isArray() && input.path("assumptions").size() <= 20, "Invalid simulation assumptions.");
        for (JsonNode note : input.path("assumptions")) label(note, "simulation assumption");
        Map<Integer, JsonNode> selected = new HashMap<>();
        for (JsonNode band : source.path("bands")) {
            if (!"PRESSURE".equals(band.path("category").asText())) continue;
            int number = band.path("bandNumber").asInt(-1);
            String hash = number == 3 ? "b0c2bb630a7694306139512667058d275b88ffb8cebe33f21ac66806c9f331bf" :
                number == 13 ? "716dbf1e91bb1dcd53b65a790799b8272682ea6eb44a973fa10d2392103d7dc1" : "";
            require(!hash.isEmpty() && hash.equals(band.path("sourceSha256").asText()) &&
                "relative index 0–100".equals(band.path("units").asText()) && selected.put(number, band) == null,
                "Unsupported selected pressure in saved simulation.");
        }
        require(impacts.path("layers").isArray() && impacts.path("layers").size() == selected.size(), "Missing prepared pressure.");
        Set<String> kinds = new HashSet<>();
        for (JsonNode layer : impacts.path("layers")) {
            String kind = layer.path("kind").asText();
            int number = kind.equals("trawling") ? 3 : kind.equals("noise") ? 13 : -1;
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
                        exported.path("coverage").get(i).asDouble() >= 1 - 1e-9, "Missing pressure support inside saved domain.");
                    if (value.asDouble() > 0) levels[i] = (int) Math.max(1, Math.min(16, Math.round(value.asDouble() / 100 * 16)));
                }
                if (levels[i] > 0) { expectedLevels.add(levels[i]); affected++; }
                float expected = (float) intensity(kind, levels[i]);
                require(layer.path("values").get(i).isNumber() && (float) layer.path("values").get(i).asDouble() == expected,
                    "Prepared model intensity disagrees with native input.");
            }
            require(layer.path("affectedCells").asInt(-1) == affected && layer.path("bands").isArray() && layer.path("bands").size() == expectedLevels.size(), "Invalid pressure masks.");
            for (JsonNode band : layer.path("bands")) {
                int level = integer(band.path("level"), 1, 16, "pressure quantization");
                require(expectedLevels.remove(level) && band.path("mask").isArray() && band.path("mask").size() == cells &&
                    band.path("intensity").asDouble() == intensity(kind, level) &&
                    band.path("id").asText().equals(kind + "-" + String.format("%02d", level)), "Invalid quantized pressure band.");
                for (int i = 0; i < cells; i++) require(integer(band.path("mask").get(i), 0, 1, "pressure mask") ==
                    (levels[i] == level ? 1 : 0), "Pressure mask disagrees with native input.");
            }
        }
    }
    private static double intensity(String kind, int level) {
        return level == 0 ? 0 : kind.equals("noise") ? 60 + 60 * (level / 16.0) : 0.2 * (level / 16.0);
    }
    private SimulationRunValidation() {}
}
