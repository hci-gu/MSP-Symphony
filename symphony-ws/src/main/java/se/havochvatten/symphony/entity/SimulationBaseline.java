package se.havochvatten.symphony.entity;

import jakarta.persistence.*;

@Entity @Table(name = "simulation_baseline")
public class SimulationBaseline {
    @Id @Column(name = "scenario_calculation_id") public int scenarioCalculationId;
    @Column(name = "baseline_calculation_id", nullable = false) public int baselineCalculationId;
    @Column(name = "source_fingerprint", nullable = false) public String sourceFingerprint;
}
