-- Add project_mappings table and tracker_issue_id column on sessions

CREATE TABLE IF NOT EXISTS project_mappings (
    id              UUID PRIMARY KEY,
    repo_url        VARCHAR(500) NOT NULL,
    project_id      VARCHAR(255) NOT NULL,
    project_name    VARCHAR(255) NOT NULL DEFAULT '',
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_mappings_repo_url
    ON project_mappings(repo_url);
CREATE INDEX IF NOT EXISTS idx_project_mappings_project_id
    ON project_mappings(project_id);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tracker_issue_id VARCHAR(255);
