-- Add archived_at column and index for session archiving

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_sessions_archived_at ON sessions(archived_at);
