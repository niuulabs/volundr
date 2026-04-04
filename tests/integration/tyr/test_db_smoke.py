"""Smoke test: verify the integration test infrastructure works."""

import os

import asyncpg
import pytest

_DB_HOST = os.environ.get("TEST_DATABASE_HOST", "localhost")
_DB_PORT = int(os.environ.get("TEST_DATABASE_PORT", "5432"))
_DB_USER = os.environ.get("TEST_DATABASE_USER", "volundr_test")
_DB_PASSWORD = os.environ.get("TEST_DATABASE_PASSWORD", "volundr_test")
_DB_NAME = os.environ.get("TEST_DATABASE_NAME", "volundr_test")


@pytest.mark.integration
async def test_database_connection():
    """Verify we can connect and query the test database."""
    conn = await asyncpg.connect(
        host=_DB_HOST,
        port=_DB_PORT,
        user=_DB_USER,
        password=_DB_PASSWORD,
        database=_DB_NAME,
    )
    try:
        row = await conn.fetchrow("SELECT 1 AS ok")
        assert row["ok"] == 1
    finally:
        await conn.close()
