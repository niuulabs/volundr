-- Add all potentially missing columns to sessions table (fixes schema drift)
-- This migration ensures the sessions table matches the domain model

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS repo VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS branch VARCHAR(255) NOT NULL DEFAULT 'main';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS chat_endpoint TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS code_endpoint TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS message_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tokens_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pod_name VARCHAR(255);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS error TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active);
