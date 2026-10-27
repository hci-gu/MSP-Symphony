package org.ecotwin.integration.jakarta;

import com.sun.net.httpserver.HttpServer;
import org.junit.Test;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class ModelDiscoveryTest {
    @Test public void discoveryUsesTheSameTrustedEndpointAndPreservesTheEngineEnvelope() throws Exception {
        var requests = new AtomicInteger();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/models", exchange -> {
            requests.incrementAndGet();
            byte[] body = "{\"models\":[{\"id\":\"fixture\",\"species\":[\"codfish\"]}]}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (var output = exchange.getResponseBody()) { output.write(body); }
        });
        server.start();
        try {
            System.setProperty("ecotwin.api.url", "http://127.0.0.1:" + server.getAddress().getPort() + "/");
            System.setProperty("ecotwin.execution.enabled", "true");
            var rest = new EcotwinREST();
            assertTrue(rest.capabilities().discovery());
            assertEquals(0, requests.get()); // Capability lookup must not contact the engine.
            assertEquals("fixture", rest.models().path("models").get(0).path("id").asText());
            assertEquals(1, requests.get());
            System.setProperty("ecotwin.execution.enabled", "false");
            assertThrows(CalculationInputException.class, rest::models);
            assertEquals(1, requests.get());
        } finally {
            server.stop(0); System.clearProperty("ecotwin.api.url"); System.clearProperty("ecotwin.execution.enabled");
        }
    }
}
