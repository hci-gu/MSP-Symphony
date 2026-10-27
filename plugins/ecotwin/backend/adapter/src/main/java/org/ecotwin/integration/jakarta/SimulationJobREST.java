package org.ecotwin.integration.jakarta;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ejb.EJB;
import jakarta.ejb.ConcurrentAccessException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.Context;
import java.io.InputStream;
import java.util.List;

@Path("/calculation/{id}/simulation-jobs")
@Produces("application/json") @RolesAllowed("GRP_SYMPHONY")
public class SimulationJobREST {
    @EJB SimulationJobService jobs;
    @EJB org.ecotwin.integration.jakarta.SimulationJobWorker worker;
    @GET public List<JsonNode> list(@Context HttpServletRequest req, @PathParam("id") int id) {
        return jobs.list(id, req.getUserPrincipal());
    }
    @PUT @Path("{runId}") @Consumes("application/json")
    public JsonNode submit(@Context HttpServletRequest req, @PathParam("id") int id, @PathParam("runId") String runId, InputStream body) throws Exception {
        byte[] bytes = body.readNBytes(2 * 1024 * 1024 + 1);
        if (bytes.length > 2 * 1024 * 1024) throw new CalculationInputException(413, "Simulation request exceeds 2 MiB.");
        JsonNode payload;
        try { payload = new ObjectMapper().readTree(bytes); }
        catch (Exception e) { throw new CalculationInputException(400, "Invalid simulation JSON."); }
        if (payload == null) throw new CalculationInputException(400, "Simulation settings are required.");
        return jobs.submit(id, runId, req.getUserPrincipal(), payload);
    }
    @POST @Path("preview") @Consumes("application/json")
    public JsonNode preview(@Context HttpServletRequest req, @PathParam("id") int id, InputStream body) throws Exception {
        byte[] bytes = body.readNBytes(2 * 1024 * 1024 + 1);
        if (bytes.length > 2 * 1024 * 1024) throw new CalculationInputException(413, "Preview request exceeds 2 MiB.");
        JsonNode request;
        try { request = new ObjectMapper().readTree(bytes); }
        catch (Exception e) { throw new CalculationInputException(400, "Invalid preview JSON."); }
        if (request == null) throw new CalculationInputException(400, "Preview settings are required.");
        var job = jobs.preview(id, req.getUserPrincipal(), request);
        try { return worker.preview(job); }
        catch (ConcurrentAccessException e) { throw new CalculationInputException(409, "The model server is busy. Try again after the current simulation finishes."); }
    }
    @POST @Path("{runId}/retry")
    public JsonNode retry(@Context HttpServletRequest req, @PathParam("id") int id, @PathParam("runId") String runId) {
        return jobs.retry(id, runId, req.getUserPrincipal());
    }
}
