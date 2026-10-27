package se.havochvatten.symphony.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.TypedQuery;
import jakarta.transaction.UserTransaction;
import org.junit.Test;
import se.havochvatten.symphony.entity.CalculationResult;
import se.havochvatten.symphony.entity.Scenario;
import java.util.List;
import static org.mockito.Mockito.*;

/** Native history deletion must not leave a dangling convenience pointer. */
public class CalculationHistoryDeletionTest {
    @Test @SuppressWarnings("unchecked")
    public void clearsScenarioPointersBeforeDeletingCalculationInTheSameTransaction() throws Exception {
        var service = new CalcService(); service.em = mock(EntityManager.class);
        var transaction = mock(UserTransaction.class);
        var field = CalcService.class.getDeclaredField("transaction"); field.setAccessible(true); field.set(service, transaction);
        var calculation = mock(CalculationResult.class); when(calculation.getId()).thenReturn(7);
        var scenario = mock(Scenario.class);
        TypedQuery<Scenario> query = mock(TypedQuery.class);
        when(service.em.createQuery(anyString(), eq(Scenario.class))).thenReturn(query);
        when(query.setParameter("id", 7)).thenReturn(query); when(query.getResultList()).thenReturn(List.of(scenario));
        when(service.em.merge(calculation)).thenReturn(calculation);
        service.delete(calculation);
        var order = inOrder(transaction, scenario, service.em);
        order.verify(transaction).begin(); order.verify(scenario).setLatestCalculation(null);
        order.verify(service.em).flush(); order.verify(service.em).remove(calculation); order.verify(transaction).commit();
    }
}
