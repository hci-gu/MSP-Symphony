package org.ecotwin.integration.jakarta;

import org.ecotwin.core.SimulationValidationException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.util.Map;

@Provider
public class SimulationValidationExceptionMapper implements ExceptionMapper<SimulationValidationException> {
    @Override public Response toResponse(SimulationValidationException error) {
        return Response.status(400).type("application/json").entity(Map.of("message", error.getMessage())).build();
    }
}
