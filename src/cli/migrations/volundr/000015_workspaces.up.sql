-- Workspaces table for per-user/per-session storage isolation

CREATE TABLE IF NOT EXISTS workspaces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES sessions(id),
    user_id         TEXT NOT NULL REFERENCES users(id),
    tenant_id       TEXT NOT NULL REFERENCES tenants(id),
    pvc_name        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',
    size_gb         INT NOT NULL DEFAULT 1,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    archived_at     TIMESTAMP WITH TIME ZONE,
    deleted_at      TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_workspaces_session_id ON workspaces(session_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_tenant_id ON workspaces(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_status ON workspaces(status);

ALTER TABLE users ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS provision_error TEXT;

-- Allow sessions to reference an existing workspace for reuse
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);
