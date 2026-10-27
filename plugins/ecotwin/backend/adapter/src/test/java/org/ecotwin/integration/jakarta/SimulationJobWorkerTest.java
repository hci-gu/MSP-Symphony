package org.ecotwin.integration.jakarta;

import org.ecotwin.integration.ecoevo.SimulationModelClient;
import org.ecotwin.core.SimulationEnsemble;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.Before;
import org.junit.Test;
import java.io.IOException;
import static org.mockito.Mockito.*;

public class SimulationJobWorkerTest {
    SimulationJobWorker worker;
    SimulationJob job;
    @Before public void setup() throws Exception {
        System.setProperty("ecotwin.api.url","http://127.0.0.1:1");
        worker=new SimulationJobWorker();worker.jobs=mock(SimulationJobService.class);worker.model=mock(SimulationModelClient.class);
        job=new SimulationJob();job.id="5db496cc-f539-4a1e-b045-3f870596731b";job.calculationId=7;
        ObjectNode request=new SimulationFixtures().fixture();request.remove("result");request.remove("completedAt");
        request.put("version","ecotwin-run-v2");((ObjectNode)request.path("config")).put("replicates",10);
        job.request=request;
        when(worker.jobs.next()).thenReturn(job);
    }
    @org.junit.After public void cleanup() { System.clearProperty("ecotwin.api.url"); }
    @Test public void recoversCompletedRemoteSeedAfterRestartWithoutSubmittingAgain() throws Exception {
        var fixture=new SimulationFixtures().fixture();
        var result=SimulationEnsemble.JSON.createObjectNode();result.put("status","completed");result.put("run_id",SimulationModelClient.seedRunId(job.execution()));
        var body=result.putObject("result");body.put("dtype","float32");body.putArray("shape").add(2).add(3).add(3).add(2);
        body.set("species",fixture.path("result").path("species"));body.set("steps",fixture.path("result").path("steps"));
        body.set("biomass_b64",fixture.path("result").path("biomassB64"));
        when(worker.model.status(job.execution())).thenReturn(result);
        worker.tick();
        verify(worker.model,never()).run(any());
        verify(worker.jobs).checkpoint(eq(job.id),eq(0),any(),any());
        verify(worker.jobs,never()).finish(any());
    }
    @Test public void waitsForAnAlreadyRunningSeedRatherThanSubmittingADuplicate() throws Exception {
        when(worker.model.status(job.execution())).thenReturn(SimulationEnsemble.JSON.createObjectNode().put("status","running"));
        worker.tick();verify(worker.model,never()).run(any());verify(worker.jobs,never()).checkpoint(any(),anyInt(),any(),any());
    }
    @Test public void leavesCheckpointsIntactOnFailureAndDoesNotPublishPartialEnsemble() throws Exception {
        job.completedSeeds=4;when(worker.model.status(job.execution())).thenThrow(new IOException("Offline"));
        worker.tick();verify(worker.jobs).fail(job.id,"Offline");verify(worker.jobs,never()).finish(any());
        verify(worker.jobs,never()).checkpoint(any(),anyInt(),any(),any());
    }
    @Test public void retriesFinalPersistenceWithoutRerunningAnySeed() throws Exception {
        job.completedSeeds=10;worker.tick();verify(worker.jobs).finish(job.id);verifyNoInteractions(worker.model);
    }
    @Test public void previewSharesWorkerAndCannotOverlapQueuedFullRuns() {
        when(worker.jobs.hasPending()).thenReturn(true);
        org.junit.Assert.assertThrows(org.ecotwin.integration.jakarta.CalculationInputException.class,()->worker.preview(job));
        verifyNoInteractions(worker.model);
    }
}
