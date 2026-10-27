package org.ecotwin.integration.jakarta;

import com.fasterxml.jackson.databind.JsonNode;
import org.ecotwin.core.HavWestProfile;
import org.ecotwin.integration.ecoevo.SimulationModelClient;
import org.ecotwin.integration.symphony.CalculationInputService;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ejb.EJB;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.Context;
import java.util.List;

/** Plugin discovery never requires native source rasters or calls the model implicitly. */
@Path("/extensions/ecotwin")
@Produces("application/json") @RolesAllowed("GRP_SYMPHONY")
public class EcotwinREST {
    @EJB CalculationInputService inputs;
    private final SimulationModelClient model = new SimulationModelClient();
    public record Capabilities(boolean installed, String mode, boolean reporting, boolean execution, boolean discovery, String profile) {}
    @GET @Path("capabilities")
    public Capabilities capabilities() {
        boolean execution = SimulationModelClient.executionEnabled();
        return new Capabilities(true, execution ? "enabled" : "reporting-only", true, execution, execution, HavWestProfile.id());
    }
    @GET @Path("models")
    public JsonNode models() throws Exception {
        if (!SimulationModelClient.executionEnabled()) throw new CalculationInputException(503, "Simulation execution is disabled.");
        return model.models();
    }
    @GET @Path("calculations")
    public List<JsonNode> calculations(@Context HttpServletRequest request) {
        return inputs.calculations(request.getUserPrincipal());
    }
}
