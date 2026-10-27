package org.ecotwin.core;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.Test;

import java.nio.*;
import static org.junit.Assert.*;

public class SimulationEnsembleTest {
    @Test public void tenSeedsUseStudentTAndRejectIncompleteOrInconsistentResults() {
        var e = SimulationEnsemble.JSON.createObjectNode();
        var seeds = e.putArray("seeds"); var totals = e.putArray("totals");
        for (int i = 0; i < 10; i++) { seeds.add(42+i); totals.addArray().addArray().add(i+1).add(0); }
        var stats = SimulationEnsemble.statistics(e,42,new double[][]{{5.5,0}});
        assertEquals(3.33414941,stats.path("ciLow").get(0).get(0).asDouble(),1e-7);
        assertEquals(7.66585059,stats.path("ciHigh").get(0).get(0).asDouble(),1e-7);
        assertEquals(0,stats.path("ciHigh").get(0).get(1).asDouble(),0);
        assertThrows(SimulationValidationException.class,()->SimulationEnsemble.statistics(e,42,new double[][]{{6,0}}));
        assertThrows(SimulationValidationException.class,()->SimulationEnsemble.statistics(e,43,new double[][]{{5.5,0}}));
        totals.remove(9);
        assertThrows(SimulationValidationException.class,()->SimulationEnsemble.statistics(e,42,new double[][]{{5.5,0}}));
    }
    @Test public void persistsVerifiablePerSeedTotalsAndDerivesBandsInsteadOfTrustingSubmittedStatistics() throws Exception {
        var p = new SimulationRunValidationTest().fixture();
        p.put("version","ecotwin-run-v2"); ((ObjectNode)p.path("config")).put("replicates",10).put("seed",77);
        var e=p.putObject("ensemble"); var seeds=e.putArray("seeds"); var totals=e.putArray("totals");
        for(int i=0;i<10;i++) {seeds.add(77+i);totals.addArray().addArray().add(2).add(4); ((com.fasterxml.jackson.databind.node.ArrayNode)totals.get(i)).addArray().add(0).add(8);}
        e.put("ciLow",-999);
        var validated=SimulationRunValidation.validate(p,7,p.path("runId").asText());
        assertEquals("ecotwin-report-v2",validated.summary().path("version").asText());
        assertEquals(4,validated.summary().path("ensemble").path("ciLow").get(0).get(1).asDouble(),1e-12);
        assertEquals(10,validated.metadata().path("ensemble").path("totals").size());
        totals.remove(0);
        assertThrows(SimulationValidationException.class,()->SimulationRunValidation.validate(p,7,p.path("runId").asText()));
    }
    @Test public void checkpointAccumulatesDoublePrecisionAndProducesOneMeanMap() {
        ByteBuffer a=ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putFloat(1).putFloat(4);
        ByteBuffer b=ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putFloat(3).putFloat(8);
        byte[] sum=SimulationEnsemble.accumulate(null,a.array());
        sum=SimulationEnsemble.accumulate(sum,b.array());
        ByteBuffer mean=ByteBuffer.wrap(SimulationEnsemble.mean(sum,2)).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(2,mean.getFloat(),0); assertEquals(6,mean.getFloat(),0);
    }
}
