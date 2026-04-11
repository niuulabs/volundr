-- Remove depends_on column from raid_progress and raids.

ALTER TABLE raid_progress DROP COLUMN IF EXISTS depends_on;
ALTER TABLE raids DROP COLUMN IF EXISTS depends_on;
