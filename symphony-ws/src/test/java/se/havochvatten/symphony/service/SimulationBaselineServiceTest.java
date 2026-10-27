package se.havochvatten.symphony.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import org.geotools.coverage.grid.GridCoverage2D;
import org.junit.Before;
import org.junit.Test;
import se.havochvatten.symphony.dto.CalculationInputDto.Manifest;
import se.havochvatten.symphony.entity.*;
import se.havochvatten.symphony.exception.CalculationInputException;
import java.security.Principal;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

public class SimulationBaselineServiceTest {
    private SimulationBaselineService service;
    private CalculationResult source;
    private Manifest manifest;
    private final Principal owner = () -> "owner";
    @Before public void setup() throws Exception {
        service = new SimulationBaselineService();
        service.em = mock(EntityManager.class); service.inputs = mock(CalculationInputService.class);
        service.calculations = mock(CalcService.class);
        source = mock(CalculationResult.class); when(source.getOwner()).thenReturn("owner");
        when(source.getCalculationName()).thenReturn("Scenario");
        when(service.inputs.authorize(9, owner)).thenReturn(source);
        manifest = mock(Manifest.class); when(manifest.available()).thenReturn(true);
        when(manifest.fingerprint()).thenReturn("hash"); when(service.inputs.manifest(source)).thenReturn(manifest);
    }
    @Test public void readingDoesNotCreateOrCalculateAnything() {
        assertNull(service.find(9, owner));
        verifyNoInteractions(service.calculations);
        verify(service.em, never()).persist(any());
    }
    @Test public void explicitCreationPersistsIndependentPrivateCalculationAndLink() throws Exception {
        var snapshot = mock(ScenarioSnapshot.class); var clean = new ScenarioSnapshot();
        when(source.getScenarioSnapshot()).thenReturn(snapshot);
        when(snapshot.withoutLayerChanges("owner", "Baseline — Scenario")).thenReturn(clean);
        var baseline = mock(CalculationResult.class); var coverage = mock(GridCoverage2D.class);
        when(baseline.getCoverage()).thenReturn(coverage); when(baseline.getId()).thenReturn(10);
        when(service.calculations.getImplicitBaselineCalculation(source)).thenReturn(baseline);
        when(service.calculations.writeGeoTiff(coverage)).thenReturn(new byte[]{1, 2});
        var link = service.create(9, owner);
        assertEquals(10, link.baselineCalculationId); assertEquals(9, link.scenarioCalculationId);
        assertEquals("hash", link.sourceFingerprint);
        verify(baseline).setOwner("owner"); verify(baseline).setBaselineCalculation(false);
        verify(baseline).setScenarioSnapshot(clean); verify(baseline).setRasterData(new byte[]{1, 2});
        verify(service.em).persist(baseline); verify(service.em).persist(link);
        verify(service.em, never()).persist(source); verify(coverage).dispose(false);
        var order = inOrder(service.em, service.calculations);
        order.verify(service.em).lock(source, LockModeType.PESSIMISTIC_WRITE);
        order.verify(service.calculations).getImplicitBaselineCalculation(source);
    }
    @Test public void retryReusesTheSavedBaselineAndRejectsChangedSources() throws Exception {
        var link = new SimulationBaseline(); link.baselineCalculationId = 10; link.sourceFingerprint = "hash";
        when(service.em.find(SimulationBaseline.class, 9)).thenReturn(link);
        assertSame(link, service.create(9, owner));
        verify(service.inputs).authorize(10, owner);
        verifyNoInteractions(service.calculations);
        when(manifest.fingerprint()).thenReturn("changed");
        assertEquals(409, assertThrows(CalculationInputException.class, () -> service.create(9, owner)).status);
        verify(service.em, never()).persist(any());
    }
    @Test public void deniesNonOwnerAndUnverifiedSources() throws Exception {
        when(source.getOwner()).thenReturn("other");
        assertEquals(403, assertThrows(CalculationInputException.class, () -> service.create(9, owner)).status);
        verifyNoInteractions(service.em);
        when(source.getOwner()).thenReturn("owner"); when(manifest.available()).thenReturn(false);
        assertEquals(422, assertThrows(CalculationInputException.class, () -> service.create(9, owner)).status);
        verifyNoInteractions(service.calculations);
    }
}
