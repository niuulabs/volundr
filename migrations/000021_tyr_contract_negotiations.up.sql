-- Add contracting_session_id to tyr_raids and create contract negotiations table

ALTER TABLE tyr_raids ADD COLUMN IF NOT EXISTS contracting_session_id TEXT;

CREATE TABLE IF NOT EXISTS tyr_contract_negotiations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raid_id              UUID NOT NULL,
    planner_session_id   TEXT NOT NULL,
    working_session_id   TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'PENDING',
    acceptance_criteria  JSONB NOT NULL DEFAULT '[]',
    declared_files       JSONB NOT NULL DEFAULT '[]',
    rounds               INT NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    agreed_at            TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tyr_contract_negotiations_raid_id
    ON tyr_contract_negotiations (raid_id);
CREATE INDEX IF NOT EXISTS idx_tyr_contract_negotiations_planner_session_id
    ON tyr_contract_negotiations (planner_session_id);
