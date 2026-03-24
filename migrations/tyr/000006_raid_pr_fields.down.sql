-- Revert PR tracking fields on raids

DROP INDEX IF EXISTS idx_raids_session_id;
ALTER TABLE raids DROP COLUMN IF EXISTS pr_id;
ALTER TABLE raids DROP COLUMN IF EXISTS pr_url;
