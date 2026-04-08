-- Add slug column to integration_connections for catalog definition references

ALTER TABLE integration_connections
    ADD COLUMN IF NOT EXISTS slug VARCHAR(100) NOT NULL DEFAULT '';
