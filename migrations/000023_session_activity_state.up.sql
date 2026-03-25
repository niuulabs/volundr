-- Add activity state tracking columns to sessions table
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS activity_state TEXT DEFAULT 'idle';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS activity_metadata JSONB DEFAULT '{}';
