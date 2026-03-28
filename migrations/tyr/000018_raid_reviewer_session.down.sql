DROP INDEX IF EXISTS idx_raids_reviewer_session;
ALTER TABLE raids DROP COLUMN IF EXISTS review_round;
ALTER TABLE raids DROP COLUMN IF EXISTS reviewer_session_id;
