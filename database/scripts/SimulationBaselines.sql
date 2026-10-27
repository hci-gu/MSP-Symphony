-- Saved counterparts for the optional automatic-baseline simulation workflow.
BEGIN;
CREATE TABLE IF NOT EXISTS simulation_baseline (
    scenario_calculation_id integer PRIMARY KEY REFERENCES calculationresult(cares_id) ON DELETE CASCADE,
    baseline_calculation_id integer UNIQUE NOT NULL REFERENCES calculationresult(cares_id) ON DELETE CASCADE,
    source_fingerprint varchar(64) NOT NULL,
    CHECK (scenario_calculation_id <> baseline_calculation_id)
);
COMMIT;
