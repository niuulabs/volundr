"""Integration tests for session CRUD endpoints.

Each test creates its own data, uses transaction rollback for isolation,
and exercises the full HTTP → FastAPI → service → PostgreSQL path.
"""

from __future__ import annotations

import httpx
import pytest

BASE = "/api/v1/volundr"


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_create_session(volundr_client: httpx.AsyncClient, auth_headers):
    """POST /api/sessions creates a session and returns 201."""
    headers = auth_headers()
    resp = await volundr_client.post(
        f"{BASE}/sessions",
        json={"name": "integ-test-create"},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "integ-test-create"
    assert body["id"]
    assert body["status"] in ("created", "provisioning", "running")


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_list_sessions(volundr_client: httpx.AsyncClient, auth_headers):
    """Create 3 sessions, then GET /api/sessions returns all of them."""
    headers = auth_headers()
    names = ["list-a", "list-b", "list-c"]
    for name in names:
        resp = await volundr_client.post(
            f"{BASE}/sessions",
            json={"name": name},
            headers=headers,
        )
        assert resp.status_code == 201, resp.text

    resp = await volundr_client.get(f"{BASE}/sessions", headers=headers)
    assert resp.status_code == 200
    returned_names = {s["name"] for s in resp.json()}
    for name in names:
        assert name in returned_names


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_get_session(volundr_client: httpx.AsyncClient, auth_headers):
    """Create a session, then GET by ID returns matching fields."""
    headers = auth_headers()
    create_resp = await volundr_client.post(
        f"{BASE}/sessions",
        json={"name": "get-by-id"},
        headers=headers,
    )
    assert create_resp.status_code == 201
    session_id = create_resp.json()["id"]

    resp = await volundr_client.get(
        f"{BASE}/sessions/{session_id}",
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == session_id
    assert body["name"] == "get-by-id"


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_delete_session(volundr_client: httpx.AsyncClient, auth_headers):
    """Create a session, DELETE it, then GET returns 404."""
    headers = auth_headers()
    create_resp = await volundr_client.post(
        f"{BASE}/sessions",
        json={"name": "to-delete"},
        headers=headers,
    )
    assert create_resp.status_code == 201
    session_id = create_resp.json()["id"]

    del_resp = await volundr_client.delete(
        f"{BASE}/sessions/{session_id}",
        headers=headers,
    )
    assert del_resp.status_code == 204

    get_resp = await volundr_client.get(
        f"{BASE}/sessions/{session_id}",
        headers=headers,
    )
    assert get_resp.status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_create_session_invalid_name(
    volundr_client: httpx.AsyncClient,
    auth_headers,
):
    """POST with an invalid (uppercase) name returns 422."""
    headers = auth_headers()
    resp = await volundr_client.post(
        f"{BASE}/sessions",
        json={"name": "Invalid-Name!"},
        headers=headers,
    )
    assert resp.status_code == 422


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_session_owner_filtering(
    volundr_client: httpx.AsyncClient,
    auth_headers,
):
    """Sessions created by user A are not visible to user B."""
    headers_a = auth_headers(user_id="owner-a", email="a@test.com")
    headers_b = auth_headers(user_id="owner-b", email="b@test.com")

    # User A creates a session
    resp = await volundr_client.post(
        f"{BASE}/sessions",
        json={"name": "owned-by-a"},
        headers=headers_a,
    )
    assert resp.status_code == 201

    # User B lists sessions — should not see user A's session
    resp = await volundr_client.get(f"{BASE}/sessions", headers=headers_b)
    assert resp.status_code == 200
    names = {s["name"] for s in resp.json()}
    assert "owned-by-a" not in names
