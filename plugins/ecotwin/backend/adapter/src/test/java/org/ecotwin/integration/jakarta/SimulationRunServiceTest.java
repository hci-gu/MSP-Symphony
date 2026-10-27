package org.ecotwin.integration.jakarta;

import org.ecotwin.integration.symphony.CalculationInputService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import org.junit.Before;
import org.junit.Test;

import java.security.Principal;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

public class SimulationRunServiceTest {
    private SimulationRunService service;
    private final Principal owner = () -> "owner";

    @Before public void setup() {
        service = new SimulationRunService();
        service.em = mock(EntityManager.class);
        service.inputs = mock(CalculationInputService.class);
    }
    private SimulationRun savedRun() {
        var run = new SimulationRun(); run.id = "saved"; run.calculationId = 7;
        when(service.em.find(SimulationRun.class, run.id)).thenReturn(run);
        return run;
    }
    @Test public void deletesLegacyRunAndKeepsCalculation() {
        var run = savedRun();
        service.delete(7, run.id, owner);
        verify(service.em).remove(run);
        verify(service.inputs).requireOwnerAndLock(7, owner);
        verify(service.em).flush();
    }
    @Test public void deletesCompletedJobWithItsRunInCalculationFirstLockOrder() {
        var run = savedRun();
        var job = new SimulationJob(); job.calculationId = 7; job.status = "completed";
        when(service.em.find(SimulationJob.class, run.id, LockModeType.PESSIMISTIC_WRITE)).thenReturn(job);
        service.delete(7, run.id, owner);
        var order = inOrder(service.inputs, service.em);
        order.verify(service.inputs).requireOwnerAndLock(7, owner);
        order.verify(service.em).find(SimulationJob.class, run.id, LockModeType.PESSIMISTIC_WRITE);
        order.verify(service.em).remove(job);
        order.verify(service.em).remove(run);
    }
    @Test public void deniesNonOwnerEvenIfCalculationCanBeRead() {
        doThrow(new CalculationInputException(403, "Forbidden")).when(service.inputs).requireOwnerAndLock(7, owner);
        assertEquals(403, assertThrows(CalculationInputException.class,
            () -> service.delete(7, "saved", owner)).status);
        verifyNoInteractions(service.em);
    }
    @Test public void rejectsRunBelongingToAnotherCalculation() {
        savedRun().calculationId = 8;
        assertEquals(404, assertThrows(CalculationInputException.class,
            () -> service.delete(7, "saved", owner)).status);
        verify(service.em, never()).remove(any());
    }
    @Test public void doesNotDeleteUnfinishedWork() {
        var run = savedRun();
        var job = new SimulationJob(); job.calculationId = 7; job.status = "running";
        when(service.em.find(SimulationJob.class, run.id, LockModeType.PESSIMISTIC_WRITE)).thenReturn(job);
        assertEquals(409, assertThrows(CalculationInputException.class,
            () -> service.delete(7, run.id, owner)).status);
        verify(service.em, never()).remove(any());
    }
    @Test public void retryAfterDeletionIsHarmless() {
        service.delete(7, "missing", owner);
        verify(service.em, never()).remove(any());
    }
}
