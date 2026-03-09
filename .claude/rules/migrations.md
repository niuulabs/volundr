# Migration Rules

## Dual Location Requirement

When creating or modifying database migrations, you MUST update **both** locations:

1. **Local files**: `migrations/*.sql`
2. **Helm chart configmap**: `charts/volundr/templates/migrations-configmap.yaml`

These must be kept in sync. The Helm chart embeds migrations directly in the configmap template.

## Migration File Naming

Follow the pattern: `NNNNNN_description.up.sql` and `NNNNNN_description.down.sql`

- Use 6-digit zero-padded sequence numbers (000001, 000002, etc.)
- Always create both up and down migrations

## Idempotent Migrations

Use idempotent SQL statements:

```sql
-- Tables
CREATE TABLE IF NOT EXISTS ...

-- Columns
ALTER TABLE x ADD COLUMN IF NOT EXISTS ...

-- Indexes
CREATE INDEX IF NOT EXISTS ...
```

## Migration Tool

This project uses `migrate` (Kubernetes-native), NOT Alembic or other ORMs.
