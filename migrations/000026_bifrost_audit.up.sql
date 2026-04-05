-- Bifrost per-request audit log table.
-- One row per LLM request attempt: outcome, rule matches, and security metadata.

CREATE TABLE IF NOT EXISTS bifrost_audit (
    id            BIGSERIAL   PRIMARY KEY,
    request_id    TEXT        NOT NULL DEFAULT '',
    agent_id      TEXT        NOT NULL,
    tenant_id     TEXT        NOT NULL,
    session_id    TEXT        NOT NULL DEFAULT '',
    saga_id       TEXT        NOT NULL DEFAULT '',
    model         TEXT        NOT NULL,
    provider      TEXT        NOT NULL DEFAULT '',
    outcome       TEXT        NOT NULL DEFAULT 'success',
    status_code   INTEGER     NOT NULL DEFAULT 200,
    rule_name     TEXT        NOT NULL DEFAULT '',
    rule_action   TEXT        NOT NULL DEFAULT '',
    tags          JSONB       NOT NULL DEFAULT '{}',
    error_message TEXT        NOT NULL DEFAULT '',
    latency_ms    REAL        NOT NULL DEFAULT 0,
    timestamp     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bifrost_audit_tenant_ts  ON bifrost_audit(tenant_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_bifrost_audit_agent_ts   ON bifrost_audit(agent_id,  timestamp);
CREATE INDEX IF NOT EXISTS idx_bifrost_audit_outcome    ON bifrost_audit(outcome);
CREATE INDEX IF NOT EXISTS idx_bifrost_audit_request_id ON bifrost_audit(request_id);
