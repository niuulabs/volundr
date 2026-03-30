ALTER TABLE raids ADD COLUMN IF NOT EXISTS planner_session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_raids_planner_session
    ON raids (planner_session_id) WHERE planner_session_id IS NOT NULL;

ALTER TABLE raid_progress ADD COLUMN IF NOT EXISTS planner_session_id TEXT;
