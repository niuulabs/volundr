-- Add chronicle_events table for session timeline tracking

CREATE TABLE IF NOT EXISTS chronicle_events (
    id UUID PRIMARY KEY,
    chronicle_id UUID NOT NULL REFERENCES chronicles(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    t INTEGER NOT NULL,
    type VARCHAR(20) NOT NULL,
    label TEXT NOT NULL,
    tokens INTEGER,
    action VARCHAR(20),
    ins INTEGER,
    del INTEGER,
    hash VARCHAR(40),
    exit_code INTEGER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chronicle_events_chronicle_id ON chronicle_events(chronicle_id);
CREATE INDEX IF NOT EXISTS idx_chronicle_events_session_id ON chronicle_events(session_id);
CREATE INDEX IF NOT EXISTS idx_chronicle_events_t ON chronicle_events(t);
