-- Migrate sessions from flat repo/branch columns to source JSONB.

-- Add the new source column
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS source JSONB;

-- Backfill existing rows: convert repo+branch into a GitSource JSON object
UPDATE sessions
SET source = jsonb_build_object(
    'type', 'git',
    'repo', COALESCE(repo, ''),
    'branch', COALESCE(branch, 'main')
)
WHERE source IS NULL;

-- Set a default for future inserts
ALTER TABLE sessions ALTER COLUMN source SET DEFAULT '{"type": "git", "repo": "", "branch": "main"}'::jsonb;
ALTER TABLE sessions ALTER COLUMN source SET NOT NULL;

-- Drop old columns
ALTER TABLE sessions DROP COLUMN IF EXISTS repo;
ALTER TABLE sessions DROP COLUMN IF EXISTS branch;
