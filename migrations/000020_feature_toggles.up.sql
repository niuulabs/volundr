-- Feature toggles: admin-level overrides for which features are available.
CREATE TABLE IF NOT EXISTS feature_toggles (
    feature_key     TEXT PRIMARY KEY,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- User feature preferences: per-user visibility and ordering.
CREATE TABLE IF NOT EXISTS user_feature_preferences (
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature_key     TEXT NOT NULL,
    visible         BOOLEAN NOT NULL DEFAULT true,
    sort_order      INT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_user_feature_prefs_user
    ON user_feature_preferences(user_id);
