-- Add owner_id to sagas, rename user_id→owner_id on integration_connections

ALTER TABLE sagas ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_sagas_owner_id ON sagas(owner_id);

-- Align with Volundr convention (sessions.owner_id, workspaces FK, etc.)
ALTER TABLE integration_connections RENAME COLUMN user_id TO owner_id;
