-- Rename user_id to owner_id in integration_connections
-- Code already references owner_id; this migration aligns the schema.

ALTER TABLE integration_connections RENAME COLUMN user_id TO owner_id;

DROP INDEX IF EXISTS idx_integration_connections_user;
CREATE INDEX IF NOT EXISTS idx_integration_connections_owner
    ON integration_connections(owner_id, integration_type);
