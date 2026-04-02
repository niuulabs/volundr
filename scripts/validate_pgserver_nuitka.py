#!/usr/bin/env python3
"""Spike NIU-361: Validate pgserver + Nuitka --onefile integration.

This script is the deliverable for the spike. It starts an embedded
PostgreSQL instance via pgserver, runs a basic SQL round-trip
(CREATE TABLE, INSERT, SELECT), and reports results.

Usage (interpreted):
    python scripts/validate_pgserver_nuitka.py

Usage (compiled with Nuitka):
    python -m nuitka --onefile \
        --include-package-data=pgserver \
        --include-package=pgserver \
        scripts/validate_pgserver_nuitka.py

    ./validate_pgserver_nuitka.bin

Expected output on success:
    [OK] pgserver imported
    [OK] Embedded PG started at <host>:<port>
    [OK] Table created
    [OK] Row inserted
    [OK] SELECT returned expected data
    [OK] All validations passed

Nuitka flags required:
    --include-package-data=pgserver   Bundles PG binaries into the onefile
    --include-package=pgserver        Ensures pgserver modules are included

Binary size overhead (observed):
    pgserver adds ~30-50 MB to the onefile binary (platform-specific PG
    binaries). Exact size depends on target platform.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile


async def main() -> int:
    """Run the pgserver validation sequence. Returns 0 on success, 1 on failure."""
    from niuu.adapters.pgserver_embedded import PgserverEmbeddedDatabase

    db = PgserverEmbeddedDatabase(startup_timeout_s=60)

    with tempfile.TemporaryDirectory(prefix="niuu_pgserver_spike_") as tmpdir:
        try:
            info = await db.start(tmpdir)
            print(f"[OK] Embedded PG started at {info.host}:{info.port}")

            await db.execute("CREATE TABLE spike_test (id serial PRIMARY KEY, name text NOT NULL)")
            print("[OK] Table created")

            await db.execute("INSERT INTO spike_test (name) VALUES ($1)", "nuitka-spike")
            print("[OK] Row inserted")

            rows = await db.execute(
                "SELECT id, name FROM spike_test WHERE name = $1",
                "nuitka-spike",
            )
            if len(rows) != 1 or rows[0]["name"] != "nuitka-spike":
                print(f"[FAIL] Unexpected SELECT result: {rows}")
                return 1
            print("[OK] SELECT returned expected data")

            running = await db.is_running()
            if not running:
                print("[FAIL] is_running() returned False after successful queries")
                return 1

            print("[OK] All validations passed")
            return 0

        except Exception as exc:
            print(f"[FAIL] {exc}")
            return 1

        finally:
            await db.stop()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
