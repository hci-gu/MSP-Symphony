package org.ecotwin.integration.jakarta;

import org.ecotwin.core.InputFingerprint;
import org.ecotwin.integration.ecoevo.SimulationModelClient;
import org.ecotwin.integration.symphony.CalculationInputService;
import org.ecotwin.core.SimulationEnsemble;
import org.ecotwin.core.SimulationRunValidation;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.ejb.*;
import jakarta.persistence.*;

import java.security.Principal;
import java.util.*;

@Stateless
public class SimulationJobService {
    @PersistenceContext(unitName = "symphonyPU") EntityManager em;
    @EJB CalculationInputService inputs;
    @EJB SimulationRunService runs;

    public List<JsonNode> list(int id, Principal principal) {
        inputs.requireReadable(id, principal);
        return em.createQuery("SELECT j FROM SimulationJob j WHERE j.calculationId = :id ORDER BY j.createdAt DESC", SimulationJob.class)
            .setParameter("id", id).getResultList().stream().map(this::summary).toList();
    }
    public JsonNode submit(int id, String runId, Principal principal, JsonNode request) throws Exception {
        if (!SimulationModelClient.executionEnabled())
            throw new CalculationInputException(503, "Full simulations are not configured on this Symphony server.");
        inputs.requireOwnerAndLock(id, principal);
        SimulationEnsemble.require(request.isObject() && "ecotwin-run-v2".equals(request.path("version").asText()), "Unsupported full simulation request.");
        ObjectNode frozen = SimulationEnsemble.JSON.createObjectNode();
        for (String key : List.of("version", "runId", "input", "model", "config")) frozen.set(key, request.path(key));
        String hash = InputFingerprint.hash(frozen);
        var existing = em.find(SimulationJob.class, runId);
        if (existing != null) {
            if (existing.calculationId != id || !hash.equals(existing.requestHash)) throw new CalculationInputException(409, "This run ID already has different settings.");
            return summary(existing);
        }
        if (em.find(SimulationRun.class, runId) != null) throw new CalculationInputException(409, "This run ID is already saved.");
        if (em.createQuery("SELECT COUNT(j) FROM SimulationJob j WHERE j.calculationId = :id AND j.status IN ('queued','running')", Long.class)
            .setParameter("id", id).getSingleResult() > 0)
            throw new CalculationInputException(409, "This calculation already has a full simulation in progress.");
        SimulationRunValidation.validateRequest(frozen, id, runId);
        inputs.verifyInput(id, principal, frozen);
        var job = new SimulationJob();
        job.id = runId; job.calculationId = id; job.owner = principal.getName();
        job.createdAt = System.currentTimeMillis(); job.status = "queued";
        job.request = frozen; job.requestHash = hash; job.totals = SimulationEnsemble.JSON.createArrayNode();
        em.persist(job); em.flush();
        return summary(job);
    }
    public SimulationJob preview(int id, Principal principal, JsonNode request) throws Exception {
        if (!SimulationModelClient.executionEnabled()) throw new CalculationInputException(503, "Simulations are not configured on this Symphony server.");
        inputs.requireReadable(id, principal);
        SimulationEnsemble.require(request.isObject() && "ecotwin-preview-v1".equals(request.path("version").asText()) && request.path("config").path("replicates").asInt() == 1,
            "Invalid preview request.");
        ObjectNode frozen = ((ObjectNode) request).deepCopy();
        frozen.put("version", "ecotwin-run-v2"); ((ObjectNode) frozen.path("config")).put("replicates", 10);
        String runId = frozen.path("runId").asText();
        SimulationRunValidation.validateRequest(frozen, id, runId);
        inputs.verifyInput(id, principal, frozen);
        var job = new SimulationJob(); job.id = runId; job.calculationId = id; job.request = frozen;
        return job;
    }
    public boolean hasPending() {
        return em.createQuery("SELECT COUNT(j) FROM SimulationJob j WHERE j.status IN ('queued','running')", Long.class).getSingleResult() > 0;
    }
    public JsonNode retry(int id, String runId, Principal principal) {
        if (!SimulationModelClient.executionEnabled()) throw new CalculationInputException(503, "Simulation execution is disabled.");
        inputs.requireOwnerAndLock(id, principal);
        var job = em.find(SimulationJob.class, runId, LockModeType.PESSIMISTIC_WRITE);
        if (job == null || job.calculationId != id) throw new CalculationInputException(404, "Simulation job not found.");
        if (!"failed".equals(job.status)) return summary(job);
        if (em.createQuery("SELECT COUNT(j) FROM SimulationJob j WHERE j.calculationId = :id AND j.status IN ('queued','running')", Long.class)
            .setParameter("id", id).getSingleResult() > 0)
            throw new CalculationInputException(409, "Wait for this calculation's active simulation before retrying.");
        job.owner = principal.getName();
        job.status = "queued"; job.error = null; // Keep the engine identity: recover a timed-out seed before rerunning it.
        return summary(job);
    }
    public SimulationJob next() {
        var jobs = em.createQuery("SELECT j FROM SimulationJob j WHERE j.status IN ('queued','running') ORDER BY j.createdAt", SimulationJob.class)
            .setMaxResults(1).getResultList();
        if (jobs.isEmpty()) return null;
        var job = jobs.get(0);
        // A caught authorization exception from another EJB would mark this transaction rollback-only.
        // The worker is owner-only, so check the current owner directly and commit the failure state.
        if (!inputs.isCurrentOwner(job.calculationId, job.owner)) {
            job.status = "failed"; job.error = "Calculation access or ownership changed."; return null;
        }
        job.status = "running";
        return job;
    }
    public void newAttempt(String id, int completed) {
        var job = em.find(SimulationJob.class, id, LockModeType.PESSIMISTIC_WRITE);
        if (job != null && job.completedSeeds == completed) job.attempt++;
    }
    public void checkpoint(String id, int completed, byte[] tensor, JsonNode totals) {
        var job = em.find(SimulationJob.class, id, LockModeType.PESSIMISTIC_WRITE);
        if (job == null || job.completedSeeds != completed || !"running".equals(job.status)) return;
        job.accumulator = SimulationEnsemble.accumulate(job.accumulator, tensor);
        ArrayNode all = ((ArrayNode) job.totals).deepCopy(); all.add(totals); job.totals = all;
        job.completedSeeds++; job.attempt = 0;
    }
    public void finish(String id) throws Exception {
        var job = em.find(SimulationJob.class, id);
        if (job == null || job.completedSeeds != SimulationEnsemble.REPLICATES) return;
        // Match deletion/submission lock order: calculation first, then its dependent job.
        inputs.requireOwnerAndLock(job.calculationId, () -> job.owner);
        em.lock(job, LockModeType.PESSIMISTIC_WRITE);
        var payload = SimulationEnsemble.envelope(job.request, SimulationEnsemble.mean(job.accumulator, job.completedSeeds));
        var ensemble = payload.putObject("ensemble"); ensemble.set("totals", job.totals);
        var seeds = ensemble.putArray("seeds"); int seed = job.request.path("config").path("seed").asInt();
        for (int i = 0; i < job.completedSeeds; i++) seeds.add(seed + i);
        runs.save(job.calculationId, job.id, () -> job.owner, payload);
        job.status = "completed"; job.error = null; job.accumulator = null;
    }
    @TransactionAttribute(TransactionAttributeType.REQUIRES_NEW)
    public void fail(String id, String message) {
        var job = em.find(SimulationJob.class, id, LockModeType.PESSIMISTIC_WRITE);
        if (job != null && !"completed".equals(job.status)) {
            job.status = "failed"; job.error = message == null ? "Simulation failed." : message.substring(0, Math.min(600, message.length()));
        }
    }
    private JsonNode summary(SimulationJob job) {
        ObjectNode out = SimulationEnsemble.JSON.createObjectNode();
        out.put("runId", job.id); out.put("calculationId", job.calculationId); out.put("status", job.status);
        out.put("createdAt", job.createdAt); out.put("completedSeeds", job.completedSeeds); out.put("replicates", 10);
        out.set("config", job.request.path("config")); out.set("model", job.request.path("model"));
        if (job.error != null) out.put("error", job.error);
        return out;
    }
}
