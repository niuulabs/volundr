-- Personal access tokens: stores PAT metadata and bcrypt hash of the raw JWT.
CREATE TABLE IF NOT EXISTS personal_access_tokens (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT        NOT NULL,
    token_hash   TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pats_owner_id ON personal_access_tokens(owner_id);
