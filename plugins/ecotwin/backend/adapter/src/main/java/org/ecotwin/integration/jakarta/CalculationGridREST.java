package org.ecotwin.integration.jakarta;

import org.ecotwin.integration.symphony.CalculationInputService;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ejb.EJB;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.Context;
import org.ecotwin.core.CalculationInputDto.*;

// The complete path prevents a broad /calculation/{id} resource from shadowing
// native routes such as /calculation/sum in RESTEasy's class-path selection.
@Path("/calculation/{id}/input-grid")
@Produces("application/json") @RolesAllowed("GRP_SYMPHONY")
public class CalculationGridREST {
    @EJB CalculationInputService inputs;
    @POST @Consumes("application/json")
    public GridResult grid(@Context HttpServletRequest request, @PathParam("id") int id,
                           GridRequest grid) throws Exception {
        return inputs.grid(id, request.getUserPrincipal(), grid);
    }
}
