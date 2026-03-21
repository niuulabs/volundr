-- Add source, integration_ids, and setup_scripts to presets

ALTER TABLE volundr_presets ADD COLUMN IF NOT EXISTS source JSONB;
ALTER TABLE volundr_presets ADD COLUMN IF NOT EXISTS integration_ids JSONB NOT NULL DEFAULT '[]';
ALTER TABLE volundr_presets ADD COLUMN IF NOT EXISTS setup_scripts JSONB NOT NULL DEFAULT '[]';
