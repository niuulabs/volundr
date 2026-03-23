-- Add feature_branch column to sagas for explicit branch naming

ALTER TABLE sagas ADD COLUMN IF NOT EXISTS feature_branch TEXT NOT NULL DEFAULT '';
