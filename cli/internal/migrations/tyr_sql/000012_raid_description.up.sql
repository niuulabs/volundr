-- Add description and acceptance_criteria columns to raids for NativeAdapter

ALTER TABLE raids ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE raids ADD COLUMN IF NOT EXISTS acceptance_criteria TEXT[] NOT NULL DEFAULT '{}';
