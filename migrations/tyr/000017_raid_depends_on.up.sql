-- Add depends_on column to raid_progress for inter-raid dependency tracking.
-- Values are raid names (not IDs) within the same saga.

ALTER TABLE raid_progress ADD COLUMN IF NOT EXISTS depends_on TEXT[] DEFAULT '{}';

-- Also add to the raids table used by NativeAdapter.
ALTER TABLE raids ADD COLUMN IF NOT EXISTS depends_on TEXT[] DEFAULT '{}';
