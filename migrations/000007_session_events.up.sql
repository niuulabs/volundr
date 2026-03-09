CREATE TABLE IF NOT EXISTS session_events (
    id              UUID PRIMARY KEY,
    session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    event_type      VARCHAR(30) NOT NULL,
    timestamp       TIMESTAMP WITH TIME ZONE NOT NULL,
    data            JSONB NOT NULL DEFAULT '{}',
    tokens_in       INTEGER,
    tokens_out      INTEGER,
    cost            NUMERIC(10, 6),
    duration_ms     INTEGER,
    model           VARCHAR(100),
    sequence        INTEGER NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_events_session_id
    ON session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_session_events_session_type
    ON session_events(session_id, event_type);
CREATE INDEX IF NOT EXISTS idx_session_events_session_ts
    ON session_events(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_session_events_sequence
    ON session_events(session_id, sequence);
