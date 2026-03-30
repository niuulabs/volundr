DROP INDEX IF EXISTS idx_raids_planner_session;
ALTER TABLE raids DROP COLUMN IF EXISTS planner_session_id;
ALTER TABLE raid_progress DROP COLUMN IF EXISTS planner_session_id;
