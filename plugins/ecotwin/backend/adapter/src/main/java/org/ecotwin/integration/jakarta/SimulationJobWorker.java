package org.ecotwin.integration.jakarta;

import org.ecotwin.integration.ecoevo.SimulationModelClient;
import org.ecotwin.core.SimulationEnsemble;
import org.ecotwin.core.SimulationRunValidation;
import jakarta.ejb.*;
import java.util.logging.*;

/** One seed at a time; database checkpoints survive reloads and server restarts.
 * Deploy a single enabled worker instance for a model server (its RNG is process-global).
 */
@Singleton @Startup @Lock(LockType.WRITE) @AccessTimeout(0)
@TransactionAttribute(TransactionAttributeType.NOT_SUPPORTED)
public class SimulationJobWorker {
    @EJB SimulationJobService jobs;
    SimulationModelClient model = new SimulationModelClient();
    private static final Logger LOG = Logger.getLogger(SimulationJobWorker.class.getName());

    @AccessTimeout(100)
    public com.fasterxml.jackson.databind.JsonNode preview(org.ecotwin.integration.jakarta.SimulationJob job) throws Exception {
        if (!SimulationModelClient.executionEnabled()) throw new CalculationInputException(503, "Simulation execution is disabled.");
        if (jobs.hasPending()) throw new org.ecotwin.integration.jakarta.CalculationInputException(409, "A full simulation is using the model server. Try your preview after it finishes.");
        var response = model.run(job.execution());
        byte[] tensor = SimulationModelClient.decode(response, job.execution());
        SimulationRunValidation.validateSeed(SimulationEnsemble.envelope(job.request, tensor), job.calculationId, job.id);
        return response;
    }

    @Schedule(hour = "*", minute = "*", second = "*/5", persistent = false)
    public void tick() {
        if (!SimulationModelClient.executionEnabled()) return;
        var job = jobs.next();
        if (job == null) return;
        try {
            if (job.completedSeeds == SimulationEnsemble.REPLICATES) { jobs.finish(job.id); return; }
            var response = model.status(job.execution());
            // Resume an already-running request without submitting another seed.
            if (response != null && "running".equals(response.path("status").asText())) return;
            if (response != null && "failed".equals(response.path("status").asText())) {
                jobs.newAttempt(job.id, job.completedSeeds); job.attempt++;
                response = null;
            }
            if (response == null) response = model.run(job.execution());
            byte[] tensor = SimulationModelClient.decode(response, job.execution());
            var envelope = SimulationEnsemble.envelope(job.request, tensor);
            var validated = SimulationRunValidation.validateSeed(envelope, job.calculationId, job.id);
            jobs.checkpoint(job.id, job.completedSeeds, validated.tensor(), validated.summary().path("totals"));
            if (job.completedSeeds + 1 == SimulationEnsemble.REPLICATES) jobs.finish(job.id);
        } catch (Exception error) {
            LOG.log(Level.WARNING, "EcoTwin job " + job.id + " failed", error);
            jobs.fail(job.id, error.getMessage());
        }
    }
}
