"""Integration tests for saved prompt endpoints."""

from __future__ import annotations

import httpx
import pytest

BASE = "/api/v1/volundr"


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_create_and_list_prompts(
    volundr_client: httpx.AsyncClient,
    auth_headers,
):
    """POST a prompt then GET /prompts includes it."""
    headers = auth_headers()

    create_resp = await volundr_client.post(
        f"{BASE}/prompts",
        json={
            "name": "test-prompt",
            "content": "You are a helpful assistant.",
        },
        headers=headers,
    )
    assert create_resp.status_code == 201, create_resp.text
    prompt_id = create_resp.json()["id"]

    list_resp = await volundr_client.get(f"{BASE}/prompts", headers=headers)
    assert list_resp.status_code == 200
    ids = {p["id"] for p in list_resp.json()}
    assert prompt_id in ids


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_delete_prompt(volundr_client: httpx.AsyncClient, auth_headers):
    """Create a prompt, delete it, then verify it is gone."""
    headers = auth_headers()

    create_resp = await volundr_client.post(
        f"{BASE}/prompts",
        json={
            "name": "delete-me",
            "content": "Temporary prompt.",
        },
        headers=headers,
    )
    assert create_resp.status_code == 201
    prompt_id = create_resp.json()["id"]

    del_resp = await volundr_client.delete(
        f"{BASE}/prompts/{prompt_id}",
        headers=headers,
    )
    assert del_resp.status_code == 204

    # Verify it is no longer in the list
    list_resp = await volundr_client.get(f"{BASE}/prompts", headers=headers)
    assert list_resp.status_code == 200
    ids = {p["id"] for p in list_resp.json()}
    assert prompt_id not in ids
