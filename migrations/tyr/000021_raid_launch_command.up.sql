ALTER TABLE raids ADD COLUMN IF NOT EXISTS launch_command TEXT;
ALTER TABLE raid_progress ADD COLUMN IF NOT EXISTS launch_command TEXT;
