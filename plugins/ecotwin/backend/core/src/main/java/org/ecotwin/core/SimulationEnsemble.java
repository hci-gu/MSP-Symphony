package org.ecotwin.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.*;
import java.util.*;

/** Ten independent seeds, pointwise Student t intervals for the mean (9 degrees of freedom). */
public final class SimulationEnsemble {
    public static final ObjectMapper JSON = new ObjectMapper();
    public static final int REPLICATES = HavWestProfile.specification().path("replicates").asInt();
    public static final double T95 = HavWestProfile.specification().path("criticalValue").asDouble();

    public static ObjectNode statistics(JsonNode ensemble, int baseSeed, double[][] mapTotals) {
        JsonNode seeds = ensemble.path("seeds"), totals = ensemble.path("totals");
        require(seeds.isArray() && seeds.size() == REPLICATES && totals.isArray() && totals.size() == REPLICATES,
            "A completed ensemble must contain ten seeds and their totals.");
        int species = mapTotals.length, frames = mapTotals[0].length;
        double[][] mean = new double[species][frames], low = new double[species][frames], high = new double[species][frames];
        for (int r = 0; r < REPLICATES; r++) {
            require(seeds.get(r).isIntegralNumber() && seeds.get(r).asLong() == (long) baseSeed + r,
                "Ensemble seeds do not match the frozen configuration.");
            require(totals.get(r).isArray() && totals.get(r).size() == species, "Invalid replicate species.");
            for (int s = 0; s < species; s++) {
                require(totals.get(r).get(s).isArray() && totals.get(r).get(s).size() == frames, "Invalid replicate frames.");
                for (int f = 0; f < frames; f++) {
                    JsonNode value = totals.get(r).get(s).get(f);
                    require(value.isNumber() && Double.isFinite(value.asDouble()) && value.asDouble() >= 0, "Invalid replicate biomass.");
                    mean[s][f] += value.asDouble() / REPLICATES;
                }
            }
        }
        for (int s = 0; s < species; s++) for (int f = 0; f < frames; f++) {
            require(Math.abs(mean[s][f] - mapTotals[s][f]) <= Math.max(1e-5, mean[s][f] * 1e-6),
                "Ensemble totals disagree with the mean map.");
            double squared = 0;
            for (JsonNode replicate : totals) squared += Math.pow(replicate.get(s).get(f).asDouble() - mean[s][f], 2);
            double half = T95 * Math.sqrt(squared / (REPLICATES * (REPLICATES - 1)));
            low[s][f] = mean[s][f] - half; high[s][f] = mean[s][f] + half;
        }
        ObjectNode out = JSON.createObjectNode();
        out.set("seeds", seeds); out.set("totals", totals);
        out.put("confidenceLevel", 0.95); out.put("ciMethod", "student-t");
        out.set("mean", JSON.valueToTree(mean)); out.set("ciLow", JSON.valueToTree(low)); out.set("ciHigh", JSON.valueToTree(high));
        return out;
    }

    public static List<Integer> sampleSteps(int max) {
        require(max >= 1 && max <= HavWestProfile.specification().path("maxSteps").asInt(), "Choose 1–10000 simulation steps.");
        int interval = Math.max(4, (int) Math.ceil(max / 50.0));
        List<Integer> steps = new ArrayList<>();
        for (int i = 0; i <= max; i += interval) steps.add(i);
        if (steps.get(steps.size() - 1) != max) steps.add(max);
        return List.copyOf(steps);
    }

    /** Build a completed seed envelope after the model has returned a tensor. */
    public static ObjectNode envelope(JsonNode request, byte[] tensor) {
        ObjectNode out = ((ObjectNode) request).deepCopy();
        var steps = sampleSteps(request.path("config").path("maxSteps").asInt());
        var result = out.putObject("result"); result.set("steps", JSON.valueToTree(steps));
        long count = (long) steps.size() * request.path("input").path("grid").path("width").asInt() *
            request.path("input").path("grid").path("height").asInt() * request.path("model").path("species").size();
        require(count > 0 && count * 4 <= SimulationRunValidation.MAX_TENSOR_BYTES, "Simulation exceeds the result size limit.");
        require(tensor != null && tensor.length == count * 4, "Unexpected model tensor size.");
        result.set("species", request.path("model").path("species"));
        result.put("units", "tonnes/cell"); result.put("order", "frame,row,column,species");
        result.put("biomassB64", Base64.getEncoder().encodeToString(tensor));
        out.put("completedAt", System.currentTimeMillis());
        return out;
    }

    /** Double precision running sum; never retain ten spatial tensors. */
    public static byte[] accumulate(byte[] previous, byte[] tensor) {
        ByteBuffer sum = previous == null ? ByteBuffer.allocate(tensor.length * 2) : ByteBuffer.wrap(previous.clone());
        sum.order(ByteOrder.LITTLE_ENDIAN);
        ByteBuffer values = ByteBuffer.wrap(tensor).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < tensor.length / 4; i++) sum.putDouble(i * 8, sum.getDouble(i * 8) + values.getFloat());
        return sum.array();
    }
    public static byte[] mean(byte[] sum, int count) {
        ByteBuffer values = ByteBuffer.wrap(sum).order(ByteOrder.LITTLE_ENDIAN);
        ByteBuffer result = ByteBuffer.allocate(sum.length / 2).order(ByteOrder.LITTLE_ENDIAN);
        while (values.hasRemaining()) result.putFloat((float) (values.getDouble() / count));
        return result.array();
    }
    public static void require(boolean condition, String message) {
        if (!condition) throw new SimulationValidationException(message);
    }
    private SimulationEnsemble() {}
}
