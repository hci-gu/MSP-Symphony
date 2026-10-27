package org.ecotwin.integration.jakarta;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Durable frozen request and per-seed checkpoint, separate from completed report artifacts. */
@Entity @Table(name = "simulation_job")
public class SimulationJob {
    public org.ecotwin.core.SeedExecution execution() {
        return new org.ecotwin.core.SeedExecution(id, calculationId, completedSeeds, attempt, request);
    }
    @Id @Column(name = "run_id") public String id;
    @Column(name = "calculation_id", nullable = false) public int calculationId;
    @Column(nullable = false) public String owner;
    @Column(nullable = false) public String status;
    @Column(name = "created_at", nullable = false) public long createdAt;
    @Column(name = "completed_seeds", nullable = false) public int completedSeeds;
    @Column(nullable = false) public int attempt;
    @Column(name = "request_hash", nullable = false) public String requestHash;
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb", nullable = false) public JsonNode request;
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb", nullable = false) public JsonNode totals;
    @Column(columnDefinition = "bytea") public byte[] accumulator;
    @Column public String error;
}
