-- Add chronicles table for session history and relaunch

CREATE TABLE IF NOT EXISTS chronicles (
    id UUID PRIMARY KEY,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    project VARCHAR(255) NOT NULL,
    repo VARCHAR(500) NOT NULL,
    branch VARCHAR(255) NOT NULL,
    model VARCHAR(100) NOT NULL,
    config_snapshot JSONB NOT NULL DEFAULT '{}',
    summary TEXT,
    key_changes JSONB NOT NULL DEFAULT '[]',
    unfinished_work TEXT,
    token_usage INTEGER NOT NULL DEFAULT 0,
    cost NUMERIC(10, 6),
    duration_seconds INTEGER,
    tags TEXT[] NOT NULL DEFAULT '{}',
    parent_chronicle_id UUID REFERENCES chronicles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chronicles_session_id ON chronicles(session_id);
CREATE INDEX IF NOT EXISTS idx_chronicles_project ON chronicles(project);
CREATE INDEX IF NOT EXISTS idx_chronicles_repo ON chronicles(repo);
CREATE INDEX IF NOT EXISTS idx_chronicles_created_at ON chronicles(created_at);
CREATE INDEX IF NOT EXISTS idx_chronicles_tags ON chronicles USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_chronicles_parent_id ON chronicles(parent_chronicle_id);
