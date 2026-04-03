"""Tests for Tyr plugin CLI commands (sagas and raids)."""

from __future__ import annotations

import json

import httpx
import respx
import typer
from typer.testing import CliRunner

from tyr.plugin import TyrPlugin

runner = CliRunner()
BASE = "http://localhost:8080"


def _make_app() -> typer.Typer:
    app = typer.Typer(no_args_is_help=False)
    TyrPlugin().register_commands(app)
    return app


# ── sagas list ───────────────────────────────────────────────────── #


class TestSagasList:
    @respx.mock
    def test_list_renders_table(self) -> None:
        respx.get(f"{BASE}/api/v1/tyr/sagas").mock(
            return_value=httpx.Response(
                200,
                json=[
                    {
                        "id": "sg1",
                        "name": "refactor-auth",
                        "status": "active",
                        "progress": "3/5",
                        "raid_count": 5,
                    }
                ],
            )
        )
        result = runner.invoke(_make_app(), ["sagas", "list"])
        assert result.exit_code == 0
        assert "refactor-auth" in result.output

    @respx.mock
    def test_list_json(self) -> None:
        data = [{"id": "sg1", "name": "refactor-auth"}]
        respx.get(f"{BASE}/api/v1/tyr/sagas").mock(return_value=httpx.Response(200, json=data))
        result = runner.invoke(_make_app(), ["sagas", "list", "--json"])
        assert result.exit_code == 0
        parsed = json.loads(result.output)
        assert parsed[0]["id"] == "sg1"

    @respx.mock
    def test_list_empty(self) -> None:
        respx.get(f"{BASE}/api/v1/tyr/sagas").mock(return_value=httpx.Response(200, json=[]))
        result = runner.invoke(_make_app(), ["sagas", "list"])
        assert result.exit_code == 0
        assert "No active sagas" in result.output

    @respx.mock
    def test_list_401(self) -> None:
        respx.get(f"{BASE}/api/v1/tyr/sagas").mock(
            return_value=httpx.Response(401, json={"detail": "unauthorized"})
        )
        result = runner.invoke(_make_app(), ["sagas", "list"])
        assert result.exit_code == 1

    def test_list_connection_refused(self) -> None:
        with respx.mock:
            respx.get(f"{BASE}/api/v1/tyr/sagas").mock(
                side_effect=httpx.ConnectError("Connection refused")
            )
            result = runner.invoke(_make_app(), ["sagas", "list"])
            assert result.exit_code == 1

    def test_list_timeout(self) -> None:
        with respx.mock:
            respx.get(f"{BASE}/api/v1/tyr/sagas").mock(side_effect=httpx.ReadTimeout("timed out"))
            result = runner.invoke(_make_app(), ["sagas", "list"])
            assert result.exit_code == 1


# ── sagas create ─────────────────────────────────────────────────── #


class TestSagasCreate:
    @respx.mock
    def test_create_success(self) -> None:
        respx.post(f"{BASE}/api/v1/tyr/sagas/commit").mock(
            return_value=httpx.Response(201, json={"id": "sg-new", "name": "test"})
        )
        result = runner.invoke(_make_app(), ["sagas", "create", "test"])
        assert result.exit_code == 0
        assert "sg-new" in result.output

    @respx.mock
    def test_create_json(self) -> None:
        data = {"id": "sg-new"}
        respx.post(f"{BASE}/api/v1/tyr/sagas/commit").mock(
            return_value=httpx.Response(201, json=data)
        )
        result = runner.invoke(_make_app(), ["sagas", "create", "test", "--json"])
        assert result.exit_code == 0
        parsed = json.loads(result.output)
        assert parsed["id"] == "sg-new"

    def test_create_connection_refused(self) -> None:
        with respx.mock:
            respx.post(f"{BASE}/api/v1/tyr/sagas/commit").mock(
                side_effect=httpx.ConnectError("Connection refused")
            )
            result = runner.invoke(_make_app(), ["sagas", "create", "test"])
            assert result.exit_code == 1


# ── sagas dispatch ───────────────────────────────────────────────── #


class TestSagasDispatch:
    @respx.mock
    def test_dispatch_success(self) -> None:
        respx.post(f"{BASE}/api/v1/tyr/dispatch/approve").mock(
            return_value=httpx.Response(200, json={"status": "dispatched"})
        )
        result = runner.invoke(_make_app(), ["sagas", "dispatch", "sg1"])
        assert result.exit_code == 0
        assert "dispatched" in result.output.lower()

    @respx.mock
    def test_dispatch_json(self) -> None:
        respx.post(f"{BASE}/api/v1/tyr/dispatch/approve").mock(
            return_value=httpx.Response(200, json={"status": "dispatched"})
        )
        result = runner.invoke(_make_app(), ["sagas", "dispatch", "sg1", "--json"])
        assert result.exit_code == 0
        parsed = json.loads(result.output)
        assert parsed["status"] == "dispatched"

    @respx.mock
    def test_dispatch_404(self) -> None:
        respx.post(f"{BASE}/api/v1/tyr/dispatch/approve").mock(
            return_value=httpx.Response(404, json={"detail": "saga not found"})
        )
        result = runner.invoke(_make_app(), ["sagas", "dispatch", "bad"])
        assert result.exit_code == 1


# ── raids active ─────────────────────────────────────────────────── #


class TestRaidsActive:
    @respx.mock
    def test_active_renders_table(self) -> None:
        respx.get(f"{BASE}/api/v1/tyr/raids/active").mock(
            return_value=httpx.Response(
                200,
                json=[
                    {
                        "id": "r1",
                        "name": "fix-bug",
                        "status": "running",
                        "confidence": 0.95,
                        "session": "s1",
                    }
                ],
            )
        )
        result = runner.invoke(_make_app(), ["raids", "active"])
        assert result.exit_code == 0
        assert "fix-bug" in result.output

    @respx.mock
    def test_active_json(self) -> None:
        data = [{"id": "r1", "name": "fix-bug"}]
        respx.get(f"{BASE}/api/v1/tyr/raids/active").mock(
            return_value=httpx.Response(200, json=data)
        )
        result = runner.invoke(_make_app(), ["raids", "active", "--json"])
        assert result.exit_code == 0
        parsed = json.loads(result.output)
        assert parsed[0]["id"] == "r1"

    @respx.mock
    def test_active_empty(self) -> None:
        respx.get(f"{BASE}/api/v1/tyr/raids/active").mock(return_value=httpx.Response(200, json=[]))
        result = runner.invoke(_make_app(), ["raids", "active"])
        assert result.exit_code == 0
        assert "No active raids" in result.output

    @respx.mock
    def test_active_500(self) -> None:
        respx.get(f"{BASE}/api/v1/tyr/raids/active").mock(
            return_value=httpx.Response(500, text="server error")
        )
        result = runner.invoke(_make_app(), ["raids", "active"])
        assert result.exit_code == 1

    def test_active_connection_refused(self) -> None:
        with respx.mock:
            respx.get(f"{BASE}/api/v1/tyr/raids/active").mock(
                side_effect=httpx.ConnectError("Connection refused")
            )
            result = runner.invoke(_make_app(), ["raids", "active"])
            assert result.exit_code == 1


# ── raids approve ────────────────────────────────────────────────── #


class TestRaidsApprove:
    @respx.mock
    def test_approve_success(self) -> None:
        respx.post(f"{BASE}/api/v1/tyr/raids/r1/approve").mock(
            return_value=httpx.Response(200, json={"status": "approved"})
        )
        result = runner.invoke(_make_app(), ["raids", "approve", "r1"])
        assert result.exit_code == 0
        assert "approved" in result.output.lower()

    @respx.mock
    def test_approve_json(self) -> None:
        respx.post(f"{BASE}/api/v1/tyr/raids/r1/approve").mock(
            return_value=httpx.Response(200, json={"status": "approved"})
        )
        result = runner.invoke(_make_app(), ["raids", "approve", "r1", "--json"])
        assert result.exit_code == 0
        parsed = json.loads(result.output)
        assert parsed["status"] == "approved"

    @respx.mock
    def test_approve_404(self) -> None:
        respx.post(f"{BASE}/api/v1/tyr/raids/bad/approve").mock(
            return_value=httpx.Response(404, json={"detail": "raid not found"})
        )
        result = runner.invoke(_make_app(), ["raids", "approve", "bad"])
        assert result.exit_code == 1


# ── raids reject ─────────────────────────────────────────────────── #


class TestRaidsReject:
    @respx.mock
    def test_reject_success(self) -> None:
        respx.post(f"{BASE}/api/v1/tyr/raids/r1/reject").mock(
            return_value=httpx.Response(200, json={"status": "rejected"})
        )
        result = runner.invoke(_make_app(), ["raids", "reject", "r1"])
        assert result.exit_code == 0
        assert "rejected" in result.output.lower()

    @respx.mock
    def test_reject_json(self) -> None:
        respx.post(f"{BASE}/api/v1/tyr/raids/r1/reject").mock(
            return_value=httpx.Response(200, json={"status": "rejected"})
        )
        result = runner.invoke(_make_app(), ["raids", "reject", "r1", "--json"])
        assert result.exit_code == 0
        parsed = json.loads(result.output)
        assert parsed["status"] == "rejected"

    def test_reject_connection_refused(self) -> None:
        with respx.mock:
            respx.post(f"{BASE}/api/v1/tyr/raids/r1/reject").mock(
                side_effect=httpx.ConnectError("Connection refused")
            )
            result = runner.invoke(_make_app(), ["raids", "reject", "r1"])
            assert result.exit_code == 1


# ── raids retry ──────────────────────────────────────────────────── #


class TestRaidsRetry:
    @respx.mock
    def test_retry_success(self) -> None:
        respx.post(f"{BASE}/api/v1/tyr/raids/r1/retry").mock(
            return_value=httpx.Response(200, json={"status": "retrying"})
        )
        result = runner.invoke(_make_app(), ["raids", "retry", "r1"])
        assert result.exit_code == 0
        assert "retry" in result.output.lower()

    @respx.mock
    def test_retry_json(self) -> None:
        respx.post(f"{BASE}/api/v1/tyr/raids/r1/retry").mock(
            return_value=httpx.Response(200, json={"status": "retrying"})
        )
        result = runner.invoke(_make_app(), ["raids", "retry", "r1", "--json"])
        assert result.exit_code == 0
        parsed = json.loads(result.output)
        assert parsed["status"] == "retrying"

    @respx.mock
    def test_retry_404(self) -> None:
        respx.post(f"{BASE}/api/v1/tyr/raids/bad/retry").mock(
            return_value=httpx.Response(404, json={"detail": "not found"})
        )
        result = runner.invoke(_make_app(), ["raids", "retry", "bad"])
        assert result.exit_code == 1
