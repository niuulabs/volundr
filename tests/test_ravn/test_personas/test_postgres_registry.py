"""Tests for PostgresPersonaRegistry."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

from ravn.adapters.personas.loader import PersonaConfig
from ravn.adapters.personas.postgres_registry import PostgresPersonaRegistry


def _mock_row(**overrides):
    defaults = {
        "name": "custom-agent",
        "config_json": {
            "name": "custom-agent",
            "role": "build",
            "letter": "C",
            "color": "var(--color-accent-indigo)",
            "summary": "Custom agent",
            "description": "Custom agent description",
            "system_prompt_template": "You are custom.",
            "allowed_tools": ["read"],
            "forbidden_tools": [],
            "permission_mode": "default",
            "executor": {
                "adapter": "ravn.adapters.executors.cli.CliTransportExecutor",
                "kwargs": {
                    "transport_adapter": "skuld.transports.codex_ws.CodexWebSocketTransport",
                    "transport_kwargs": {"model": ""},
                },
            },
            "iteration_budget": 7,
            "llm_primary_alias": "balanced",
            "llm_thinking_enabled": False,
            "llm_max_tokens": 4096,
            "llm_temperature": None,
            "produces_event_type": "code.changed",
            "produces_schema": {"file": "string"},
            "consumes_events": [{"name": "code.requested"}],
            "fan_in_strategy": "merge",
            "fan_in_params": {},
            "mimir_write_routing": None,
        },
    }
    defaults.update(overrides)
    row = MagicMock()
    row.__getitem__ = lambda self, key: defaults[key]
    return row


class _BuiltinLoader:
    def __init__(self) -> None:
        self._personas = {
            "coding-agent": PersonaConfig(
                name="coding-agent",
                system_prompt_template="Builtin coding agent.",
                allowed_tools=["file"],
                permission_mode="workspace-write",
                iteration_budget=40,
            )
        }

    def list_names(self) -> list[str]:
        return sorted(self._personas)

    def load(self, name: str) -> PersonaConfig | None:
        return self._personas.get(name)

    def is_builtin(self, name: str) -> bool:
        return name in self._personas


def _make_registry():
    pool = AsyncMock()
    loader = _BuiltinLoader()
    return PostgresPersonaRegistry(pool, builtin_loader=loader), pool


class TestListPersonas:
    async def test_merges_builtin_and_user_personas(self):
        registry, pool = _make_registry()
        pool.fetch.return_value = [_mock_row()]

        result = await registry.list_personas("user-1")

        names = [item.payload["name"] for item in result]
        assert names == ["coding-agent", "custom-agent"]
        assert result[0].is_builtin is True
        assert result[0].has_override is False
        assert result[1].is_builtin is False
        assert result[1].has_override is True

    async def test_custom_filter_returns_only_user_records(self):
        registry, pool = _make_registry()
        pool.fetch.return_value = [_mock_row()]

        result = await registry.list_personas("user-1", source="custom")

        assert [item.payload["name"] for item in result] == ["custom-agent"]


class TestGetPersona:
    async def test_prefers_user_override_for_builtin(self):
        registry, pool = _make_registry()
        pool.fetch.return_value = [
            _mock_row(
                name="coding-agent",
                config_json={
                    "name": "coding-agent",
                    "role": "build",
                    "letter": "C",
                    "color": "var(--color-accent-indigo)",
                    "summary": "Overridden coding agent",
                    "description": "Overridden coding agent",
                    "system_prompt_template": "Override prompt.",
                    "allowed_tools": ["read", "write"],
                    "forbidden_tools": [],
                    "permission_mode": "default",
                    "executor": {
                        "adapter": "ravn.adapters.executors.cli.CliTransportExecutor",
                        "kwargs": {
                            "transport_adapter": "skuld.transports.codex_ws.CodexWebSocketTransport",
                            "transport_kwargs": {"model": ""},
                        },
                    },
                    "iteration_budget": 11,
                    "llm_primary_alias": "balanced",
                    "llm_thinking_enabled": True,
                    "llm_max_tokens": 8192,
                    "llm_temperature": None,
                    "produces_event_type": "code.changed",
                    "produces_schema": {"file": "string"},
                    "consumes_events": [{"name": "code.requested"}],
                    "fan_in_strategy": "merge",
                    "fan_in_params": {},
                    "mimir_write_routing": None,
                },
            )
        ]

        result = await registry.get_persona("user-1", "coding-agent")

        assert result is not None
        assert result.is_builtin is True
        assert result.has_override is True
        assert result.yaml_source == "[built-in]"
        assert result.override_source == "[user:user-1]"
        assert result.payload["summary"] == "Overridden coding agent"
        assert result.config.permission_mode == "workspace-write"
        assert result.config.executor.adapter == "ravn.adapters.executors.cli.CliTransportExecutor"

    async def test_get_persona_yaml_returns_runtime_yaml(self):
        registry, pool = _make_registry()
        pool.fetch.return_value = [_mock_row()]

        yaml_text = await registry.get_persona_yaml("user-1", "custom-agent")

        assert yaml_text is not None
        assert "name: custom-agent" in yaml_text
        assert "permission_mode: workspace-write" in yaml_text


class TestSavePersona:
    async def test_persists_raw_and_runtime_json(self):
        registry, pool = _make_registry()
        payload = {
            "name": "custom-agent",
            "role": "build",
            "letter": "C",
            "color": "var(--color-accent-indigo)",
            "summary": "Custom agent",
            "description": "Custom agent description",
            "system_prompt_template": "You are custom.",
            "allowed_tools": ["read"],
            "forbidden_tools": [],
            "permission_mode": "safe",
            "executor": {
                "adapter": "ravn.adapters.executors.cli.CliTransportExecutor",
                "kwargs": {
                    "transport_adapter": "skuld.transports.codex_ws.CodexWebSocketTransport",
                    "transport_kwargs": {"model": ""},
                },
            },
            "iteration_budget": 7,
            "llm_primary_alias": "balanced",
            "llm_thinking_enabled": False,
            "llm_max_tokens": 4096,
            "produces_event_type": "code.changed",
            "produces_schema": {"file": "string"},
            "consumes_events": [{"name": "code.requested"}],
        }

        await registry.save_persona("user-1", payload)

        sql = pool.execute.call_args[0][0]
        raw_json = json.loads(pool.execute.call_args[0][3])
        runtime_json = json.loads(pool.execute.call_args[0][4])
        assert "runtime_config_json" in sql
        assert raw_json["permission_mode"] == "safe"
        assert runtime_json["permission_mode"] == "read-only"
        assert raw_json["executor"]["adapter"] == "ravn.adapters.executors.cli.CliTransportExecutor"
        assert runtime_json["executor"]["adapter"] == "ravn.adapters.executors.cli.CliTransportExecutor"


class TestDeletePersona:
    async def test_returns_true_when_row_deleted(self):
        registry, pool = _make_registry()
        pool.execute.return_value = "DELETE 1"

        result = await registry.delete_persona("user-1", "custom-agent")

        assert result is True
        assert "DELETE FROM ravn_personas" in pool.execute.call_args[0][0]


class TestParsePayload:
    async def test_handles_string_backed_json_rows(self):
        registry, pool = _make_registry()
        pool.fetch.return_value = [
            _mock_row(
                config_json=json.dumps(
                    {
                        "name": "custom-agent",
                        "role": "build",
                        "letter": "C",
                        "color": "var(--color-accent-indigo)",
                        "summary": "Custom agent",
                        "description": "Custom agent",
                        "system_prompt_template": "You are custom.",
                        "allowed_tools": [],
                        "forbidden_tools": [],
                        "permission_mode": "default",
                        "executor": {"adapter": "", "kwargs": {}},
                        "iteration_budget": 0,
                        "llm_primary_alias": "",
                        "llm_thinking_enabled": False,
                        "llm_max_tokens": 0,
                        "llm_temperature": None,
                        "produces_event_type": "",
                        "produces_schema": {},
                        "consumes_events": [],
                        "fan_in_strategy": None,
                        "fan_in_params": {},
                        "mimir_write_routing": None,
                    }
                )
            )
        ]

        result = await registry.list_personas("user-1", source="custom")

        assert len(result) == 1
        assert result[0].payload["name"] == "custom-agent"
