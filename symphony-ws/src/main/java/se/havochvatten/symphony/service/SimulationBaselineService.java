package se.havochvatten.symphony.service;

import jakarta.ejb.EJB;
import jakarta.ejb.Stateless;
import jakarta.persistence.*;
import se.havochvatten.symphony.entity.SimulationBaseline;
import se.havochvatten.symphony.exception.CalculationInputException;
import java.security.Principal;

@Stateless
public class SimulationBaselineService {
    @PersistenceContext(unitName = "symphonyPU") EntityManager em;
    @EJB CalculationInputService inputs;
    @EJB CalcService calculations;

    public SimulationBaseline find(int id, Principal principal) {
        inputs.authorize(id, principal);
        var link = em.find(SimulationBaseline.class, id);
        if (link != null) inputs.authorize(link.baselineCalculationId, principal);
        return link;
    }

    public SimulationBaseline create(int id, Principal principal) throws Exception {
        var source = inputs.authorize(id, principal);
        if (!principal.getName().equals(source.getOwner()))
            throw new CalculationInputException(403, "Only the calculation owner can prepare its baseline.");
        em.lock(source, LockModeType.PESSIMISTIC_WRITE);
        var existing = em.find(SimulationBaseline.class, id);
        var manifest = inputs.manifest(source);
        if (existing != null) {
            inputs.authorize(existing.baselineCalculationId, principal);
            if (!existing.sourceFingerprint.equals(manifest.fingerprint()))
                throw new CalculationInputException(409, "Calculation sources changed since this baseline was saved. Create a new scenario calculation to prepare a new baseline.");
            return existing;
        }
        if (!manifest.available()) throw new CalculationInputException(422, "Verified calculation sources are required to prepare a simulation baseline.");
        var baseline = calculations.getImplicitBaselineCalculation(source);
        var coverage = baseline.getCoverage();
        try {
            String name = "Baseline — " + source.getCalculationName();
            if (name.length() > 255) name = name.substring(0, 255);
            baseline.setCalculationName(name);
            baseline.setOwner(principal.getName());
            baseline.setScenarioSnapshot(source.getScenarioSnapshot().withoutLayerChanges(principal.getName(), name));
            baseline.setBaselineCalculation(false); // User-owned, not a shared regional baseline.
            baseline.setRasterData(calculations.writeGeoTiff(coverage));
            em.persist(baseline);
            em.flush();
            var link = new SimulationBaseline();
            link.scenarioCalculationId = id;
            link.baselineCalculationId = baseline.getId();
            link.sourceFingerprint = manifest.fingerprint();
            em.persist(link);
            em.flush();
            return link;
        } finally {
            baseline.setCoverage(null);
            if (coverage != null) coverage.dispose(false);
        }
    }
}
