package org.ecotwin.integration.jakarta;

import org.junit.After;
import org.junit.Test;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

public class EcotwinCapabilitiesTest {
    @After public void cleanup() {
        System.clearProperty("ecotwin.api.url"); System.clearProperty("ecotwin.execution.enabled");
    }
    @Test public void explicitReportingOnlyDisablesModelWorkAndLeavesReportingAvailable() {
        System.setProperty("ecotwin.api.url", "http://127.0.0.1:1");
        System.setProperty("ecotwin.execution.enabled", "false");
        var capabilities = new EcotwinREST().capabilities();
        assertTrue(capabilities.installed()); assertTrue(capabilities.reporting());
        assertFalse(capabilities.execution()); assertFalse(capabilities.discovery());
        assertEquals("reporting-only", capabilities.mode());
        var worker = new SimulationJobWorker(); worker.jobs = mock(SimulationJobService.class);
        worker.tick(); verifyNoInteractions(worker.jobs);
        assertThrows(CalculationInputException.class, () -> new EcotwinREST().models());
    }
    @Test public void modelUrlEnablesExecutionUnlessExplicitlyDisabled() {
        System.setProperty("ecotwin.api.url", "http://127.0.0.1:1/");
        System.setProperty("ecotwin.execution.enabled", "true");
        assertTrue(new EcotwinREST().capabilities().execution());
        System.setProperty("ecotwin.api.url", "");
        assertFalse(new EcotwinREST().capabilities().execution());
    }
}
