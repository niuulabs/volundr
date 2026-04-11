-- Add reason column to raids for reject context
ALTER TABLE raids ADD COLUMN IF NOT EXISTS reason TEXT;
