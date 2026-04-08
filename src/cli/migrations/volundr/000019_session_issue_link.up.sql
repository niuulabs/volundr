-- Add issue tracker URL to sessions for direct linking

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS issue_tracker_url VARCHAR(500);
