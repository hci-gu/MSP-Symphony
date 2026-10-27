package se.havochvatten.symphony.web;

import jakarta.annotation.security.RolesAllowed;
import jakarta.ejb.EJB;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.Context;
import se.havochvatten.symphony.entity.SimulationBaseline;
import se.havochvatten.symphony.service.SimulationBaselineService;

@Path("/calculation/{id}/simulation-baseline")
@Produces("application/json") @RolesAllowed("GRP_SYMPHONY")
public class SimulationBaselineREST {
    @EJB SimulationBaselineService baselines;
    @GET public SimulationBaseline find(@Context HttpServletRequest req, @PathParam("id") int id) {
        return baselines.find(id, req.getUserPrincipal());
    }
    @POST public SimulationBaseline create(@Context HttpServletRequest req, @PathParam("id") int id) throws Exception {
        return baselines.create(id, req.getUserPrincipal());
    }
}
