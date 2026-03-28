ALTER TABLE raids ADD COLUMN IF NOT EXISTS reviewer_session_id TEXT;
ALTER TABLE raids ADD COLUMN IF NOT EXISTS review_round INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_raids_reviewer_session ON raids (reviewer_session_id) WHERE reviewer_session_id IS NOT NULL;

ALTER TABLE raid_progress ADD COLUMN IF NOT EXISTS reviewer_session_id TEXT;
ALTER TABLE raid_progress ADD COLUMN IF NOT EXISTS review_round INTEGER NOT NULL DEFAULT 0;
