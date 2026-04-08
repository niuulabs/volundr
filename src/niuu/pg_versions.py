"""PostgreSQL and pgvector version constants.

Single source of truth consumed by:
- ``scripts/build_postgres.sh`` (via Makefile shell evaluation)
- ``niuu.adapters.embedded_postgres`` (runtime diagnostics)
"""

from __future__ import annotations

POSTGRES_VERSION = "17.9"
PGVECTOR_VERSION = "0.8.2"
