-- Personal access tokens for Tyr API callers (e.g. Telegram bot, ODIN/Móði)
-- owner_id is the IDP sub claim from Envoy headers, treated as an opaque string

CREATE TABLE IF NOT EXISTS personal_access_tokens (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     TEXT        NOT NULL,
    name         TEXT        NOT NULL,
    token_hash   TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pats_owner_id ON personal_access_tokens(owner_id);
