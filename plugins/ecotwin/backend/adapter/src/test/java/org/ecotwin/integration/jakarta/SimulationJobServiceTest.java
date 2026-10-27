package org.ecotwin.integration.jakarta;

import org.ecotwin.integration.symphony.CalculationInputService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.TypedQuery;
import org.junit.Test;

import java.util.List;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

public class SimulationJobServiceTest {
    @Test @SuppressWarnings("unchecked")
    public void commitsFailureWhenOwnershipChangesWithoutInvokingRollbackOnlyAuthorization() {
        var service = new SimulationJobService(); service.em = mock(EntityManager.class); service.inputs = mock(CalculationInputService.class);
        TypedQuery<SimulationJob> query = mock(TypedQuery.class);
        when(service.em.createQuery(anyString(),eq(SimulationJob.class))).thenReturn(query);
        when(query.setMaxResults(1)).thenReturn(query);
        var job = new SimulationJob();job.calculationId=7;job.owner="original";job.status="queued";
        when(service.inputs.isCurrentOwner(7, "original")).thenReturn(false);
        when(query.getResultList()).thenReturn(List.of(job));
        assertNull(service.next()); assertEquals("failed",job.status); assertTrue(job.error.contains("ownership"));
        verify(service.inputs).isCurrentOwner(7, "original");
    }
}
