"""Smoke test: verify the integration test infrastructure works."""

import pytest


@pytest.mark.integration
async def test_database_connection(txn_pool):
    """Verify we can connect and query the test database."""
    row = await txn_pool.fetchrow("SELECT 1 AS ok")
    assert row["ok"] == 1
