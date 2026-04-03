-- Credential metadata table for the pluggable credential store

CREATE TABLE IF NOT EXISTS credential_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(253) NOT NULL,
    secret_type VARCHAR(50) NOT NULL,
    keys TEXT[] NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    owner_id VARCHAR(255) NOT NULL,
    owner_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(owner_type, owner_id, name)
);

CREATE INDEX IF NOT EXISTS idx_credential_metadata_owner
    ON credential_metadata(owner_type, owner_id);
