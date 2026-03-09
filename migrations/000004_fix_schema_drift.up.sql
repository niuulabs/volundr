-- Fix remaining schema drift - add all missing columns

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
