package org.ecotwin.integration.ecoevo;

import org.ecotwin.core.SeedExecution;
import org.ecotwin.integration.jakarta.SimulationRun;
import org.ecotwin.core.SimulationEnsemble;
import org.ecotwin.core.SimulationRunValidation;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;

/** Server-owned model endpoint; clients cannot supply URLs or local paths. */
public class SimulationModelClient {
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
    public static String baseUrl() {
        return System.getProperty("ecotwin.api.url", System.getenv().getOrDefault("ECOTWIN_API_URL", "")).replaceAll("/+$", "");
    }
    public static boolean executionEnabled() {
        String enabled = System.getProperty("ecotwin.execution.enabled", System.getenv().getOrDefault("ECOTWIN_EXECUTION_ENABLED", "true"));
        return Boolean.parseBoolean(enabled) && !baseUrl().isBlank();
    }
    public JsonNode models() throws Exception {
        return response(http.send(HttpRequest.newBuilder(URI.create(baseUrl() + "/v1/models"))
            .timeout(Duration.ofSeconds(30)).GET().build(), HttpResponse.BodyHandlers.ofInputStream()), false);
    }
    public static String seedRunId(SeedExecution job) {
        return job.engineRunId();
    }
    public JsonNode status(SeedExecution job) throws Exception {
        return response(http.send(HttpRequest.newBuilder(URI.create(baseUrl() + "/v1/runs/" + seedRunId(job)))
            .timeout(Duration.ofSeconds(30)).GET().build(), HttpResponse.BodyHandlers.ofInputStream()), true);
    }
    public JsonNode run(SeedExecution job) throws Exception {
        JsonNode frozen = job.request(), input = frozen.path("input"), config = frozen.path("config");
        ObjectNode request = SimulationEnsemble.JSON.createObjectNode();
        request.put("run_id", seedRunId(job)); request.put("seed", config.path("seed").asInt() + job.completedSeeds());
        request.putObject("model").set("id", frozen.path("model").path("id"));
        ObjectNode grid = request.putObject("grid"); grid.set("width", input.path("grid").path("width")); grid.set("height", input.path("grid").path("height"));
        ObjectNode time = request.putObject("time");
        time.set("max_steps", config.path("maxSteps")); time.set("sample_every", config.path("sampleEvery"));
        time.put("include_final", true); time.set("tick_duration_days", config.path("tickDurationDays"));
        request.set("species", frozen.path("model").path("species"));
        var output = request.putObject("output"); output.put("dtype", "float32"); output.put("tensor_order", "frame,row,column,species");
        output.put("replicates", 1); output.put("include_summary", false);
        var pressures = request.putArray("pressures"); var masks = request.putArray("masks");
        Map<String, byte[]> files = new LinkedHashMap<>();
        for (String kind : List.of("noise", "trawling")) pressures.add(pressure(kind, kind + "-reset", 0, config, false));
        for (JsonNode layer : input.path("impacts").path("layers")) for (JsonNode band : layer.path("bands")) {
            String id = band.path("id").asText();
            masks.addObject().put("id", id).put("file", id + ".png");
            pressures.add(pressure(layer.path("kind").asText(), id, band.path("intensity").asDouble(), config, true));
            files.put(id + ".png", png(input, band.path("mask"), false));
        }
        String boundary = "symphony-" + UUID.randomUUID();
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        part(body, boundary, "request", null, SimulationEnsemble.JSON.writeValueAsBytes(request));
        part(body, boundary, "texture", "texture.png", png(input, input.path("water"), true));
        part(body, boundary, "depth", "depth.png", png(input, null, false));
        for (var file : files.entrySet()) part(body, boundary, "mask", file.getKey(), file.getValue());
        body.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return response(http.send(HttpRequest.newBuilder(URI.create(baseUrl() + "/v1/runs"))
            .timeout(Duration.ofMinutes(30)).header("Content-Type", "multipart/form-data; boundary=" + boundary)
            .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build(), HttpResponse.BodyHandlers.ofInputStream()), false);
    }
    private JsonNode response(HttpResponse<InputStream> response, boolean allowMissing) throws Exception {
        try (InputStream body = response.body()) {
            if (allowMissing && response.statusCode() == 404) return null;
            byte[] bytes = body.readNBytes(SimulationRunValidation.MAX_PAYLOAD_BYTES + 1);
            if (bytes.length > SimulationRunValidation.MAX_PAYLOAD_BYTES) throw new IOException("Model response exceeds 16 MiB.");
            if (response.statusCode() < 200 || response.statusCode() >= 300)
                throw new IOException("The model server returned HTTP " + response.statusCode() + ". Retry when the model server is available.");
            return SimulationEnsemble.JSON.readTree(bytes);
        }
    }
    public static byte[] decode(JsonNode payload, SeedExecution job) {
        JsonNode result = payload.path("result");
        JsonNode request = job.request();
        JsonNode schedule = SimulationEnsemble.JSON.valueToTree(SimulationEnsemble.sampleSteps(request.path("config").path("maxSteps").asInt()));
        JsonNode species = request.path("model").path("species");
        int width = request.path("input").path("grid").path("width").asInt();
        int height = request.path("input").path("grid").path("height").asInt();
        long bytes = (long) schedule.size() * height * width * species.size() * 4;
        SimulationEnsemble.require(bytes > 0 && bytes <= SimulationRunValidation.MAX_TENSOR_BYTES, "Unexpected model tensor size.");
        var shape = SimulationEnsemble.JSON.createArrayNode().add(schedule.size()).add(height).add(width).add(species.size());
        SimulationEnsemble.require("completed".equals(payload.path("status").asText()) &&
            seedRunId(job).equals(payload.path("run_id").asText()) && "float32".equals(result.path("dtype").asText()) &&
            schedule.equals(result.path("steps")) && species.equals(result.path("species")) && shape.equals(result.path("shape")),
            "The model returned an incompatible seed result.");
        String data = result.path("biomass_b64").asText();
        SimulationEnsemble.require(data.length() == 4 * ((bytes + 2) / 3), "Unexpected model tensor size.");
        return Base64.getDecoder().decode(data);
    }
    private static ObjectNode pressure(String kind, String id, double intensity, JsonNode config, boolean mask) {
        ObjectNode out = SimulationEnsemble.JSON.createObjectNode();
        out.put("id", id); out.put("type", kind + "_pressure");
        var scope = out.putObject("scope"); scope.put("kind", mask ? "mask" : "whole_grid");
        if (mask) scope.put("mask_id", id);
        out.putObject("parameters").put("intensity", intensity);
        out.putObject("time_window").put("start_step", 0).set("end_step", config.path("maxSteps"));
        return out;
    }
    private static byte[] png(JsonNode input, JsonNode mask, boolean invert) throws IOException {
        int width = input.path("grid").path("width").asInt(), height = input.path("grid").path("height").asInt();
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        for (int i = 0; i < width * height; i++) {
            boolean on = mask != null && mask.get(i).asInt() == 1;
            image.setRGB(i % width, i / width, (on != invert) ? 0xffffff : 0);
        }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(); ImageIO.write(image, "png", bytes); return bytes.toByteArray();
    }
    private static void part(OutputStream out, String boundary, String name, String file, byte[] bytes) throws IOException {
        out.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"" +
            (file == null ? "" : "; filename=\"" + file + "\"") + "\r\nContent-Type: " +
            (file == null ? "application/json" : "image/png") + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(bytes); out.write("\r\n".getBytes(StandardCharsets.UTF_8));
    }
}
