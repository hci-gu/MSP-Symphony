package se.havochvatten.symphony.web;

import jakarta.annotation.security.RolesAllowed;
import jakarta.ejb.EJB;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.Context;
import se.havochvatten.symphony.dto.CalculationInputDto.*;
import se.havochvatten.symphony.service.CalculationInputService;

@Path("/calculation/{id}/inputs")
@Produces("application/json")
@RolesAllowed("GRP_SYMPHONY")
public class CalculationInputREST {
    @EJB CalculationInputService inputs;
    @GET
    public Manifest manifest(@Context HttpServletRequest request, @PathParam("id") int id) throws Exception {
        return inputs.manifest(inputs.authorize(id, request.getUserPrincipal()));
    }
}
