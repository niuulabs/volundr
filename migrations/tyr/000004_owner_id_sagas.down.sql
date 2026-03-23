-- Revert owner_id on sagas, restore user_id on integration_connections

ALTER TABLE integration_connections RENAME COLUMN owner_id TO user_id;

DROP INDEX IF EXISTS idx_sagas_owner_id;
ALTER TABLE sagas DROP COLUMN IF EXISTS owner_id;
