-- Initial schema for tyr saga coordinator

CREATE TABLE IF NOT EXISTS sagas (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tracker_id    TEXT NOT NULL,
    tracker_type  TEXT NOT NULL,
    slug          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL DEFAULT '',
    repos         TEXT[] NOT NULL DEFAULT '{}',
    status        TEXT NOT NULL DEFAULT 'ACTIVE',
    confidence    FLOAT DEFAULT 0,
    owner_id      TEXT NOT NULL DEFAULT 'default',
    base_branch   TEXT NOT NULL DEFAULT 'main',
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sagas_owner_id ON sagas(owner_id);

CREATE TABLE IF NOT EXISTS phases (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    saga_id       UUID NOT NULL REFERENCES sagas(id),
    tracker_id    TEXT NOT NULL,
    number        INT NOT NULL,
    name          TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'GATED',
    confidence    FLOAT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_phases_saga_id ON phases(saga_id);

CREATE TABLE IF NOT EXISTS raids (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phase_id            UUID NOT NULL REFERENCES phases(id),
    tracker_id          TEXT NOT NULL,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    acceptance_criteria TEXT[] NOT NULL DEFAULT '{}',
    declared_files      TEXT[],
    estimate_hours      FLOAT,
    status              TEXT NOT NULL DEFAULT 'PENDING',
    confidence          FLOAT DEFAULT 0,
    session_id          TEXT,
    branch              TEXT,
    chronicle_summary   TEXT,
    pr_url              TEXT,
    pr_id               TEXT,
    reason              TEXT,
    retry_count         INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raids_phase_id ON raids(phase_id);
CREATE INDEX IF NOT EXISTS idx_raids_status ON raids(status);
CREATE INDEX IF NOT EXISTS idx_raids_session_id ON raids(session_id) WHERE session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS confidence_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raid_id       UUID NOT NULL REFERENCES raids(id),
    event_type    TEXT NOT NULL,
    delta         FLOAT NOT NULL,
    score_after   FLOAT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_confidence_events_raid_id ON confidence_events(raid_id);

CREATE TABLE IF NOT EXISTS dispatcher_state (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id             TEXT NOT NULL DEFAULT 'default',
    running              BOOL DEFAULT TRUE,
    threshold            FLOAT DEFAULT 0.75,
    max_concurrent_raids INT NOT NULL DEFAULT 3,
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatcher_state_owner ON dispatcher_state(owner_id);
