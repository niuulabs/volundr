-- Add acceptance_criteria and declared_files to raid_progress for contract engine.
-- The raids table (NativeAdapter) already has these columns.
ALTER TABLE raid_progress ADD COLUMN IF NOT EXISTS acceptance_criteria TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE raid_progress ADD COLUMN IF NOT EXISTS declared_files TEXT[] NOT NULL DEFAULT '{}';
