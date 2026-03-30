-- Rollback contract negotiations table and contracting_session_id column

DROP TABLE IF EXISTS tyr_contract_negotiations;
ALTER TABLE tyr_raids DROP COLUMN IF EXISTS contracting_session_id;
