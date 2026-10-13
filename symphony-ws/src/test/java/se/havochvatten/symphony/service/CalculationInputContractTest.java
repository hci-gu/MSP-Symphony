package se.havochvatten.symphony.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.Test;
import org.locationtech.jts.geom.Envelope;
import se.havochvatten.symphony.calculation.CalculationDomain;
import se.havochvatten.symphony.dto.CalculationInputDto.Grid;
import se.havochvatten.symphony.exception.CalculationInputException;
import se.havochvatten.symphony.util.InputFingerprint;
import static org.junit.Assert.*;

public class CalculationInputContractTest {
    @Test public void fingerprintIgnoresKeyOrderAndJsonNumericFormattingButNotInputs() throws Exception {
        var json = new ObjectMapper();
        assertEquals(InputFingerprint.hash(json.readTree("{\"a\":[1,2],\"grid\":1000.0}")),
            InputFingerprint.hash(json.readTree("{\"grid\":1e3,\"a\":[1.0,2.0]}")));
        assertNotEquals(InputFingerprint.hash(json.readTree("{\"a\":[1,2]}")),
            InputFingerprint.hash(json.readTree("{\"a\":[2,1]}")));
    }
    @Test public void gridBoundsAndAlignmentAreEnforced() {
        CalculationInputService.validateGrid(new Grid("EPSG:3035", new double[]{4358000,3858000,4397000,3897000},39,39,1000));
        for (Grid invalid : new Grid[]{
            new Grid("EPSG:4326",new double[]{0,0,3000,3000},3,3,1000),
            new Grid("EPSG:3035",new double[]{0,0,61000,3000},61,3,1000),
            new Grid("EPSG:3035",new double[]{1,0,3001,3000},3,3,1000),
            new Grid("EPSG:3035",new double[]{0,0,4000,3000},3,3,1000),
            new Grid("EPSG:3035",new double[]{Double.NaN,0,3000,3000},3,3,1000)}) {
            assertThrows(CalculationInputException.class, () -> CalculationInputService.validateGrid(invalid));
        }
    }
    @Test public void sharedNativeLayoutRetainsHistoricalIntegerTruncation() {
        var layout = CalculationDomain.layout(new Envelope(14.999999,170.999998,-2.5,153.499999));
        assertEquals(14,layout.getMinX(null)); assertEquals(-2,layout.getMinY(null));
        assertEquals(155,layout.getWidth(null)); assertEquals(155,layout.getHeight(null));
    }
}
