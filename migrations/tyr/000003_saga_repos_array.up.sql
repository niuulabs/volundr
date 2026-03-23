-- Fix sagas table: rename repo→repos as array, add name and status columns

ALTER TABLE sagas ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
ALTER TABLE sagas ADD COLUMN IF NOT EXISTS repos TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE sagas ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';

-- Migrate existing data from singular repo column
UPDATE sagas SET repos = ARRAY[repo] WHERE repo IS NOT NULL AND repo != '';

ALTER TABLE sagas DROP COLUMN IF EXISTS repo;
