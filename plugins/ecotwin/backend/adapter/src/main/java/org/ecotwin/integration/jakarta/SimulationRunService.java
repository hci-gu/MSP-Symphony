package org.ecotwin.integration.jakarta;

import org.ecotwin.core.InputFingerprint;
import org.ecotwin.integration.symphony.CalculationInputService;
import org.ecotwin.core.SimulationRunValidation;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.ejb.EJB;
import jakarta.ejb.Stateless;
import jakarta.persistence.*;

import org.ecotwin.core.CalculationInputDto.*;
import java.security.Principal;
import java.util.*;

@Stateless
public class SimulationRunService {
    @PersistenceContext(unitName = "symphonyPU") EntityManager em;
    @EJB CalculationInputService inputs;

    public List<JsonNode> list(int id, Principal principal) {
        inputs.requireReadable(id, principal);
        return em.createQuery("SELECT r FROM SimulationRun r WHERE r.calculationId = :id ORDER BY r.completedAt, r.id", SimulationRun.class)
            .setParameter("id", id).getResultList().stream().map(r -> r.summary).toList();
    }

    public JsonNode save(int id, String runId, Principal principal, JsonNode payload) throws Exception {
        inputs.requireOwnerAndLock(id, principal);
        var existing = em.find(SimulationRun.class, runId);
        if (existing != null) {
            if (existing.calculationId != id || !existing.contentHash.equals(InputFingerprint.hash(payload)))
                throw new CalculationInputException(409, "This run ID already contains a different saved result.");
            return existing.summary;
        }
        var validated = SimulationRunValidation.validate(payload, id, runId);
        inputs.verifyInput(id, principal, payload);
        var run = new SimulationRun();
        run.id = runId; run.calculationId = id; run.completedAt = payload.path("completedAt").asLong();
        run.contentHash = validated.hash(); run.summary = validated.summary();
        var artifact = new SimulationArtifact();
        artifact.id = runId; artifact.metadata = validated.metadata(); artifact.tensor = validated.tensor();
        em.persist(run); em.flush(); em.persist(artifact); em.flush();
        return run.summary;
    }

    public JsonNode detail(int id, String runId, Principal principal, boolean reportOnly) {
        inputs.requireReadable(id, principal);
        var run = em.find(SimulationRun.class, runId);
        if (run == null || run.calculationId != id) throw new CalculationInputException(404, "Saved simulation not found.");
        var artifact = em.find(SimulationArtifact.class, runId);
        if (reportOnly) {
            ObjectNode report = ((ObjectNode) run.summary).deepCopy();
            int length = report.path("grid").path("width").asInt() * report.path("grid").path("height").asInt() * report.path("species").size() * 4;
            report.put("finalBiomassB64", Base64.getEncoder().encodeToString(Arrays.copyOfRange(artifact.tensor, artifact.tensor.length - length, artifact.tensor.length)));
            return report;
        }
        ObjectNode payload = ((ObjectNode) artifact.metadata).deepCopy();
        ((ObjectNode) payload.path("result")).put("biomassB64", Base64.getEncoder().encodeToString(artifact.tensor));
        return payload;
    }

    public void delete(int id, String runId, Principal principal) {
        inputs.requireOwnerAndLock(id, principal);
        var run = em.find(SimulationRun.class, runId);
        if (run == null) return; // A retry after a successful deletion is harmless.
        if (run.calculationId != id)
            throw new CalculationInputException(404, "Saved simulation not found.");
        var job = em.find(SimulationJob.class, runId, LockModeType.PESSIMISTIC_WRITE);
        if (job != null) {
            if (job.calculationId != id || !"completed".equals(job.status))
                throw new CalculationInputException(409, "This simulation still has unfinished work.");
            em.remove(job);
        }
        // simulation_artifact references this row with ON DELETE CASCADE.
        em.remove(run);
        em.flush();
    }
}
