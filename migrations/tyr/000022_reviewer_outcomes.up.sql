CREATE TABLE IF NOT EXISTS tyr_reviewer_outcomes (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raid_id               UUID NOT NULL,
    owner_id              TEXT NOT NULL,
    reviewer_decision     TEXT NOT NULL,
    reviewer_confidence   FLOAT NOT NULL,
    reviewer_issues_count INT NOT NULL DEFAULT 0,
    actual_outcome        TEXT,
    decision_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at           TIMESTAMPTZ,
    notes                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_reviewer_outcomes_owner ON tyr_reviewer_outcomes (owner_id, decision_at);
CREATE INDEX IF NOT EXISTS idx_reviewer_outcomes_raid ON tyr_reviewer_outcomes (raid_id);
