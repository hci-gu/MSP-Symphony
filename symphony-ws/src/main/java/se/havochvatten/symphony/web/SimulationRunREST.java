package se.havochvatten.symphony.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ejb.EJB;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.Context;
import se.havochvatten.symphony.exception.CalculationInputException;
import se.havochvatten.symphony.service.*;
import java.io.InputStream;
import java.util.List;

@Path("/calculation/{id}/simulations")
@Produces("application/json") @RolesAllowed("GRP_SYMPHONY")
public class SimulationRunREST {
    @EJB SimulationRunService runs;
    @GET
    public List<JsonNode> list(@Context HttpServletRequest req, @PathParam("id") int id) {
        return runs.list(id, req.getUserPrincipal());
    }
    @PUT @Path("{runId}") @Consumes("application/json")
    public JsonNode save(@Context HttpServletRequest req, @PathParam("id") int id,
                         @PathParam("runId") String runId, InputStream body) throws Exception {
        byte[] bytes = body.readNBytes(SimulationRunValidation.MAX_PAYLOAD_BYTES + 1);
        if (bytes.length > SimulationRunValidation.MAX_PAYLOAD_BYTES)
            throw new CalculationInputException(413, "Simulation payload exceeds 16 MiB.");
        JsonNode payload;
        try { payload = new ObjectMapper().readTree(bytes); }
        catch (Exception e) { throw new CalculationInputException(400, "Invalid simulation JSON."); }
        if (payload == null) throw new CalculationInputException(400, "Simulation data is required.");
        return runs.save(id, runId, req.getUserPrincipal(), payload);
    }
    @GET @Path("{runId}")
    public JsonNode detail(@Context HttpServletRequest req, @PathParam("id") int id,
                           @PathParam("runId") String runId, @QueryParam("view") String view) {
        return runs.detail(id, runId, req.getUserPrincipal(), "report".equals(view));
    }
}
