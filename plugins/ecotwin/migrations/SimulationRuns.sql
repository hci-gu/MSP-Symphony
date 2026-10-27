-- Completed optional simulations; apply explicitly before deploying the feature.
-- No changes to native calculation statistics, rasters or scenario snapshots.
BEGIN;
CREATE TABLE IF NOT EXISTS simulation_run (
    run_id varchar(36) PRIMARY KEY,
    calculation_id integer NOT NULL REFERENCES calculationresult(cares_id) ON DELETE CASCADE,
    completed_at bigint NOT NULL,
    content_hash varchar(64) NOT NULL,
    summary jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS simulation_run_calculation_order
    ON simulation_run(calculation_id, completed_at, run_id);
CREATE TABLE IF NOT EXISTS simulation_artifact (
    run_id varchar(36) PRIMARY KEY REFERENCES simulation_run(run_id) ON DELETE CASCADE,
    metadata jsonb NOT NULL,
    tensor bytea NOT NULL CHECK (octet_length(tensor) <= 8388608)
);
COMMIT;
