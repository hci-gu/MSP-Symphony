package se.havochvatten.symphony.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.ejb.EJB;
import jakarta.ejb.Stateless;
import jakarta.persistence.*;
import se.havochvatten.symphony.entity.*;
import se.havochvatten.symphony.exception.CalculationInputException;
import se.havochvatten.symphony.util.InputFingerprint;
import se.havochvatten.symphony.dto.CalculationInputDto.*;
import java.security.Principal;
import java.util.*;

@Stateless
public class SimulationRunService {
    @PersistenceContext(unitName = "symphonyPU") EntityManager em;
    @EJB CalculationInputService inputs;

    public List<JsonNode> list(int id, Principal principal) {
        inputs.authorize(id, principal);
        return em.createQuery("SELECT r FROM SimulationRun r WHERE r.calculationId = :id ORDER BY r.completedAt, r.id", SimulationRun.class)
            .setParameter("id", id).getResultList().stream().map(r -> r.summary).toList();
    }

    public JsonNode save(int id, String runId, Principal principal, JsonNode payload) throws Exception {
        var calculation = inputs.authorize(id, principal);
        if (!principal.getName().equals(calculation.getOwner()))
            throw new CalculationInputException(403, "Only the calculation owner can attach a simulation.");
        // Serialize writes with calculation deletion and same-calculation retries.
        em.lock(calculation, LockModeType.PESSIMISTIC_WRITE);
        var existing = em.find(SimulationRun.class, runId);
        if (existing != null) {
            if (existing.calculationId != id || !existing.contentHash.equals(InputFingerprint.hash(payload)))
                throw new CalculationInputException(409, "This run ID already contains a different saved result.");
            return existing.summary;
        }
        var validated = SimulationRunValidation.validate(payload, id, runId);
        var manifest = inputs.manifest(calculation);
        if (!manifest.fingerprint().equals(payload.path("input").path("source").path("fingerprint").asText()))
            throw new CalculationInputException(409, "Calculation sources changed since simulation preparation. The result was not attached.");
        ObjectMapper json = new ObjectMapper();
        ObjectNode claimedSource = ((ObjectNode) payload.path("input").path("source")).deepCopy();
        ObjectNode verifiedSource = json.valueToTree(manifest);
        // A normal rename may happen while a run is executing; it is not an input change.
        claimedSource.remove("name"); verifiedSource.remove("name");
        if (!InputFingerprint.hash(claimedSource).equals(InputFingerprint.hash(verifiedSource)))
            throw new CalculationInputException(400, "Saved calculation provenance does not match the source manifest.");
        GridResult verifiedGrid = inputs.grid(calculation, new GridRequest(manifest.fingerprint(),
            json.treeToValue(payload.path("input").path("grid"), Grid.class),
            manifest.bands().stream().map(b -> new BandKey(b.category(), b.bandNumber())).toList()));
        if (!InputFingerprint.hash(json.valueToTree(verifiedGrid)).equals(InputFingerprint.hash(payload.path("input").path("nativeGrid"))))
            throw new CalculationInputException(400, "Saved native inputs do not match this calculation's effective input grid.");
        var run = new SimulationRun();
        run.id = runId; run.calculationId = id; run.completedAt = payload.path("completedAt").asLong();
        run.contentHash = validated.hash(); run.summary = validated.summary();
        var artifact = new SimulationArtifact();
        artifact.id = runId; artifact.metadata = validated.metadata(); artifact.tensor = validated.tensor();
        em.persist(run); em.flush(); em.persist(artifact); em.flush();
        return run.summary;
    }

    public JsonNode detail(int id, String runId, Principal principal, boolean reportOnly) {
        inputs.authorize(id, principal);
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
}
