-- Add volundr_presets table and preset_id on sessions

CREATE TABLE IF NOT EXISTS volundr_presets (
    id                UUID PRIMARY KEY,
    name              VARCHAR(255) NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    is_default        BOOLEAN NOT NULL DEFAULT FALSE,
    cli_tool          VARCHAR(100) NOT NULL DEFAULT '',
    workload_type     VARCHAR(100) NOT NULL DEFAULT 'session',
    model             VARCHAR(100),
    system_prompt     TEXT,
    resource_config   JSONB NOT NULL DEFAULT '{}',
    mcp_servers       JSONB NOT NULL DEFAULT '[]',
    terminal_sidecar  JSONB NOT NULL DEFAULT '{}',
    skills            JSONB NOT NULL DEFAULT '[]',
    rules             JSONB NOT NULL DEFAULT '[]',
    env_vars          JSONB NOT NULL DEFAULT '{}',
    env_secret_refs   JSONB NOT NULL DEFAULT '[]',
    workload_config   JSONB NOT NULL DEFAULT '{}',
    created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_volundr_presets_name
    ON volundr_presets(name);
CREATE INDEX IF NOT EXISTS idx_volundr_presets_cli_tool
    ON volundr_presets(cli_tool);
CREATE INDEX IF NOT EXISTS idx_volundr_presets_is_default
    ON volundr_presets(is_default);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS preset_id UUID;
