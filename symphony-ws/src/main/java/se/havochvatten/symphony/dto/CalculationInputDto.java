package se.havochvatten.symphony.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;

/** Versioned, read-only inputs of a persisted calculation, never a live scenario. */
public final class CalculationInputDto {
    public record Band(LayerType category, int bandNumber, String title, String units,
                       String sourceSha256) {}
    public record Manifest(String version, int calculationId, String name, long timestamp,
                           int baselineId, String baselineName, String fingerprint,
                           String geometryCrs, String sourceCrs, JsonNode geometry, Grid suggestedGrid,
                           List<Band> bands, JsonNode changes, String operation,
                           Map<String, String> operationOptions, boolean available,
                           List<String> notes, Map<String, String> sourceFingerprints) {}
    public record Grid(String crs, double[] extent, int width, int height, double cellMetres) {}
    public record BandKey(LayerType category, int bandNumber) {}
    public record GridRequest(String fingerprint, Grid grid, List<BandKey> bands) {}
    public record GridBand(LayerType category, int bandNumber, String title, String units,
                           Double[] values, double[] coverage, String sourceSha256) {}
    public record GridResult(String version, int calculationId, String fingerprint, Grid grid,
                             String rowOrder, double[] domainCoverage, List<GridBand> bands) {}
    private CalculationInputDto() {}
}
