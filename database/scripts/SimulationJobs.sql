-- Full EcoTwin simulations survive browser closure. Apply after SimulationRuns.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS simulation_job (
    run_id varchar(36) PRIMARY KEY,
    calculation_id integer NOT NULL REFERENCES calculationresult(cares_id) ON DELETE CASCADE,
    owner text NOT NULL,
    status varchar(16) NOT NULL CHECK (status IN ('queued', 'running', 'failed', 'completed')),
    created_at bigint NOT NULL,
    completed_seeds integer NOT NULL DEFAULT 0 CHECK (completed_seeds BETWEEN 0 AND 10),
    attempt integer NOT NULL DEFAULT 0,
    request_hash varchar(64) NOT NULL,
    request jsonb NOT NULL,
    totals jsonb NOT NULL DEFAULT '[]',
    accumulator bytea CHECK (octet_length(accumulator) <= 16777216),
    error text
);
CREATE INDEX IF NOT EXISTS simulation_job_calculation ON simulation_job(calculation_id, created_at);
CREATE INDEX IF NOT EXISTS simulation_job_pending ON simulation_job(status, created_at);
COMMIT;
