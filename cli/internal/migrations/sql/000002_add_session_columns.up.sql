-- Add last_active, message_count, and tokens_used columns to sessions table

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_active TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS message_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tokens_used INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active);
