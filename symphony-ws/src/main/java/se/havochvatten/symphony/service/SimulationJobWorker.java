package se.havochvatten.symphony.service;

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
    public com.fasterxml.jackson.databind.JsonNode preview(se.havochvatten.symphony.entity.SimulationJob job) throws Exception {
        if (jobs.hasPending()) throw new se.havochvatten.symphony.exception.CalculationInputException(409, "A full simulation is using the model server. Try your preview after it finishes.");
        var response = model.run(job);
        byte[] tensor = SimulationModelClient.decode(response, job);
        SimulationRunValidation.validateSeed(SimulationEnsemble.envelope(job.request, tensor), job.calculationId, job.id);
        return response;
    }

    @Schedule(hour = "*", minute = "*", second = "*/5", persistent = false)
    public void tick() {
        if (SimulationModelClient.baseUrl().isBlank()) return;
        var job = jobs.next();
        if (job == null) return;
        try {
            if (job.completedSeeds == SimulationEnsemble.REPLICATES) { jobs.finish(job.id); return; }
            var response = model.status(job);
            // Resume an already-running request without submitting another seed.
            if (response != null && "running".equals(response.path("status").asText())) return;
            if (response != null && "failed".equals(response.path("status").asText())) {
                jobs.newAttempt(job.id, job.completedSeeds); job.attempt++;
                response = null;
            }
            if (response == null) response = model.run(job);
            byte[] tensor = SimulationModelClient.decode(response, job);
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
