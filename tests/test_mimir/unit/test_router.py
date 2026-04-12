"""Unit tests for MimirRouter — all nine HTTP endpoints.

Tests use a real MarkdownMimirAdapter backed by a tmp_path and the HTTPX
test client, so no network is involved.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mimir.adapters.markdown import MarkdownMimirAdapter
from mimir.router import MimirRouter

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_app(tmp_path: Path) -> FastAPI:
    adapter = MarkdownMimirAdapter(root=tmp_path / "mimir")
    router = MimirRouter(adapter=adapter, name="test", role="local")
    app = FastAPI()
    app.include_router(router.router, prefix="/mimir")
    return app


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    return TestClient(_make_app(tmp_path))


@pytest.fixture()
def client_with_page(tmp_path: Path) -> TestClient:
    """Build a TestClient pre-populated with one wiki page."""
    adapter = MarkdownMimirAdapter(root=tmp_path / "mimir")
    # Populate via the HTTP client itself — avoids direct asyncio.run()
    router = MimirRouter(adapter=adapter, name="test", role="local")
    app = FastAPI()
    app.include_router(router.router, prefix="/mimir")
    tc = TestClient(app)

    # Ingest a source and write a page via the API
    tc.post(
        "/mimir/ingest",
        json={
            "title": "Test Source",
            "content": "Hello world.",
            "source_type": "document",
        },
    )
    tc.put(
        "/mimir/page",
        json={
            "path": "technical/test.md",
            "content": (
                "# Test Page\n"
                "This is a test page about ravn and tools.\n"
                "<!-- sources: src_test1 -->"
            ),
        },
    )
    return tc


# ---------------------------------------------------------------------------
# GET /mimir/stats
# ---------------------------------------------------------------------------


def test_stats_empty_wiki(client: TestClient) -> None:
    resp = client.get("/mimir/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["page_count"] == 0
    assert data["healthy"] is True
    assert data["categories"] == []


def test_stats_with_page(client_with_page: TestClient) -> None:
    resp = client_with_page.get("/mimir/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["page_count"] == 1
    assert "technical" in data["categories"]


# ---------------------------------------------------------------------------
# GET /mimir/pages
# ---------------------------------------------------------------------------


def test_list_pages_empty(client: TestClient) -> None:
    resp = client.get("/mimir/pages")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_pages_returns_page(client_with_page: TestClient) -> None:
    resp = client_with_page.get("/mimir/pages")
    assert resp.status_code == 200
    pages = resp.json()
    assert len(pages) == 1
    assert pages[0]["path"] == "technical/test.md"
    assert pages[0]["title"] == "Test Page"


def test_list_pages_category_filter(client_with_page: TestClient) -> None:
    resp = client_with_page.get("/mimir/pages", params={"category": "technical"})
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    resp2 = client_with_page.get("/mimir/pages", params={"category": "research"})
    assert resp2.status_code == 200
    assert len(resp2.json()) == 0


# ---------------------------------------------------------------------------
# GET /mimir/page
# ---------------------------------------------------------------------------


def test_read_page_found(client_with_page: TestClient) -> None:
    resp = client_with_page.get("/mimir/page", params={"path": "technical/test.md"})
    assert resp.status_code == 200
    data = resp.json()
    assert "Test Page" in data["content"]
    assert data["path"] == "technical/test.md"


def test_read_page_not_found(client: TestClient) -> None:
    resp = client.get("/mimir/page", params={"path": "technical/missing.md"})
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /mimir/search
# ---------------------------------------------------------------------------


def test_search_finds_page(client_with_page: TestClient) -> None:
    resp = client_with_page.get("/mimir/search", params={"q": "ravn tools"})
    assert resp.status_code == 200
    results = resp.json()
    assert len(results) >= 1
    assert results[0]["path"] == "technical/test.md"


def test_search_no_results(client_with_page: TestClient) -> None:
    resp = client_with_page.get("/mimir/search", params={"q": "kanuck valley models"})
    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# GET /mimir/lint
# ---------------------------------------------------------------------------


def test_lint_empty_wiki(client: TestClient) -> None:
    resp = client.get("/mimir/lint")
    assert resp.status_code == 200
    data = resp.json()
    assert data["pages_checked"] == 0
    assert data["issues_found"] is False
    assert data["issues"] == []
    assert "summary" in data


def test_lint_finds_issues_with_page(client_with_page: TestClient) -> None:
    # The page exists and is indexed; new structural checks (e.g. L12) may fire
    resp = client_with_page.get("/mimir/lint")
    assert resp.status_code == 200
    data = resp.json()
    assert "pages_checked" in data
    assert data["pages_checked"] >= 1
    assert "issues" in data
    assert "summary" in data
    # Every issue must have the required fields
    for issue in data["issues"]:
        assert "id" in issue
        assert "severity" in issue
        assert issue["severity"] in ("error", "warning", "info")
        assert "message" in issue
        assert "page_path" in issue
        assert "auto_fixable" in issue


def test_lint_fix_endpoint(client_with_page: TestClient) -> None:
    resp = client_with_page.post("/mimir/lint/fix")
    assert resp.status_code == 200
    data = resp.json()
    assert "issues" in data
    assert "summary" in data


# ---------------------------------------------------------------------------
# GET /mimir/graph
# ---------------------------------------------------------------------------


def test_graph_empty(client: TestClient) -> None:
    resp = client.get("/mimir/graph")
    assert resp.status_code == 200
    data = resp.json()
    assert data["nodes"] == []
    assert data["edges"] == []


def test_graph_has_nodes(client_with_page: TestClient) -> None:
    resp = client_with_page.get("/mimir/graph")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["nodes"]) == 1
    assert data["nodes"][0]["id"] == "technical/test.md"
    assert data["nodes"][0]["category"] == "technical"


# ---------------------------------------------------------------------------
# PUT /mimir/page
# ---------------------------------------------------------------------------


def test_upsert_page(client: TestClient) -> None:
    payload = {"path": "technical/new.md", "content": "# New\nSome content."}
    resp = client.put("/mimir/page", json=payload)
    assert resp.status_code == 204

    # Verify it was written
    resp2 = client.get("/mimir/pages")
    paths = [p["path"] for p in resp2.json()]
    assert "technical/new.md" in paths


# ---------------------------------------------------------------------------
# POST /mimir/ingest
# ---------------------------------------------------------------------------


def test_ingest_source(client: TestClient) -> None:
    payload = {
        "title": "Test Doc",
        "content": "Some raw content about ODIN.",
        "source_type": "document",
    }
    resp = client.post("/mimir/ingest", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "source_id" in data
    assert data["source_id"].startswith("src_")


# ---------------------------------------------------------------------------
# GET /mimir/log
# ---------------------------------------------------------------------------


def test_log_after_ingest(client: TestClient) -> None:
    client.post(
        "/mimir/ingest",
        json={"title": "Log Test", "content": "log test content"},
    )
    resp = client.get("/mimir/log")
    assert resp.status_code == 200
    data = resp.json()
    assert "entries" in data
