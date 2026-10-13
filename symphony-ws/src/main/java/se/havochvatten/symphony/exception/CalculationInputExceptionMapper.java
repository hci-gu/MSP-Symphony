package se.havochvatten.symphony.exception;

import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.util.Map;

@Provider
public class CalculationInputExceptionMapper implements ExceptionMapper<CalculationInputException> {
    public Response toResponse(CalculationInputException error) {
        return Response.status(error.status).type("application/json")
            .entity(Map.of("message", error.getMessage())).build();
    }
}
