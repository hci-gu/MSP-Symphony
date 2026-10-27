package org.ecotwin.integration.jakarta;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Lightweight report metadata; tensors live in a separate, explicitly fetched entity. */
@Entity @Table(name = "simulation_run")
public class SimulationRun {
    @Id @Column(name = "run_id") public String id;
    @Column(name = "calculation_id", nullable = false) public int calculationId;
    @Column(name = "completed_at", nullable = false) public long completedAt;
    @Column(name = "content_hash", nullable = false) public String contentHash;
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb", nullable = false) public JsonNode summary;
}
