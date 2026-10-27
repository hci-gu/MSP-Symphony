package org.ecotwin.integration.jakarta;

import org.ecotwin.integration.symphony.CalculationInputService;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ejb.EJB;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.Context;
import org.ecotwin.core.CalculationInputDto.*;

@Path("/calculation/{id}/inputs")
@Produces("application/json")
@RolesAllowed("GRP_SYMPHONY")
public class CalculationInputREST {
    @EJB CalculationInputService inputs;
    @GET
    public Manifest manifest(@Context HttpServletRequest request, @PathParam("id") int id) throws Exception {
        return inputs.manifest(id, request.getUserPrincipal());
    }
}
