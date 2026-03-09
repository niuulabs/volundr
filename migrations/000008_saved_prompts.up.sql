-- Add saved_prompts table for reusable prompt storage

CREATE TABLE IF NOT EXISTS saved_prompts (
    id              UUID PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    content         TEXT NOT NULL,
    scope           VARCHAR(20) NOT NULL DEFAULT 'global',
    project_repo    VARCHAR(500),
    tags            TEXT[] NOT NULL DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_prompts_scope
    ON saved_prompts(scope);
CREATE INDEX IF NOT EXISTS idx_saved_prompts_project_repo
    ON saved_prompts(project_repo);
CREATE INDEX IF NOT EXISTS idx_saved_prompts_tags
    ON saved_prompts USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_saved_prompts_name_content
    ON saved_prompts USING GIN(to_tsvector('english', name || ' ' || content));
