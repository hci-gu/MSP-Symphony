package org.ecotwin.integration.jakarta;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity @Table(name = "simulation_artifact")
public class SimulationArtifact {
    @Id @Column(name = "run_id") public String id;
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb", nullable = false) public JsonNode metadata;
    @Column(columnDefinition = "bytea", nullable = false) public byte[] tensor;
}
