-- Add identifier and url columns to raids for tracker display.

ALTER TABLE raids ADD COLUMN IF NOT EXISTS identifier TEXT NOT NULL DEFAULT '';
ALTER TABLE raids ADD COLUMN IF NOT EXISTS url TEXT NOT NULL DEFAULT '';
