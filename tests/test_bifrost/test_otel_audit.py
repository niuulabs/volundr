"""Tests for OtelAuditAdapter and NullAuditAdapter."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from bifrost.adapters.audit.null import NullAuditAdapter
from bifrost.adapters.audit.otel import OtelAuditAdapter, _build_attributes, _epoch_nanos
from bifrost.ports.audit import AuditEvent

_PATCH = "bifrost.adapters.audit.otel.OtelAuditAdapter._build_tracer"


def _event(**kwargs) -> AuditEvent:
    defaults = dict(
        request_id="req-otel-1",
        agent_id="agent-42",
        tenant_id="tenant-abc",
        session_id="sess-1",
        saga_id="saga-1",
        model="claude-sonnet-4-6",
        provider="anthropic",
        outcome="success",
        status_code=200,
        rule_name="",
        rule_action="",
        tags={},
        error_message="",
        latency_ms=12.5,
        timestamp=datetime(2026, 4, 6, 12, 0, 0, tzinfo=UTC),
    )
    defaults.update(kwargs)
    return AuditEvent(**defaults)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class TestEpochNanos:
    def test_unix_epoch(self):
        dt = datetime(1970, 1, 1, tzinfo=UTC)
        assert _epoch_nanos(dt) == 0

    def test_known_timestamp(self):
        dt = datetime(2026, 4, 6, 0, 0, 0, tzinfo=UTC)
        expected = int(dt.timestamp() * 1_000_000_000)
        assert _epoch_nanos(dt) == expected


class TestBuildAttributes:
    def test_required_fields_always_present(self):
        attrs = _build_attributes(_event())
        assert attrs["bifrost.agent_id"] == "agent-42"
        assert attrs["bifrost.tenant_id"] == "tenant-abc"
        assert attrs["bifrost.model"] == "claude-sonnet-4-6"
        assert attrs["bifrost.outcome"] == "success"
        assert attrs["bifrost.status_code"] == 200
        assert attrs["bifrost.latency_ms"] == 12.5

    def test_optional_session_id_included_when_set(self):
        attrs = _build_attributes(_event(session_id="my-session"))
        assert attrs["bifrost.session_id"] == "my-session"

    def test_optional_session_id_excluded_when_empty(self):
        attrs = _build_attributes(_event(session_id=""))
        assert "bifrost.session_id" not in attrs

    def test_optional_saga_id_included_when_set(self):
        attrs = _build_attributes(_event(saga_id="my-saga"))
        assert attrs["bifrost.saga_id"] == "my-saga"

    def test_optional_saga_id_excluded_when_empty(self):
        attrs = _build_attributes(_event(saga_id=""))
        assert "bifrost.saga_id" not in attrs

    def test_optional_provider_included_when_set(self):
        attrs = _build_attributes(_event(provider="openai"))
        assert attrs["bifrost.provider"] == "openai"

    def test_optional_provider_excluded_when_empty(self):
        attrs = _build_attributes(_event(provider=""))
        assert "bifrost.provider" not in attrs

    def test_rule_matched_included_when_rule_fires(self):
        attrs = _build_attributes(_event(rule_name="block-images", rule_action="reject"))
        assert attrs["bifrost.rule_matched"] == "block-images"
        assert attrs["bifrost.rule_action"] == "reject"

    def test_rule_matched_excluded_when_no_rule(self):
        attrs = _build_attributes(_event(rule_name="", rule_action=""))
        assert "bifrost.rule_matched" not in attrs
        assert "bifrost.rule_action" not in attrs

    def test_error_message_included_when_set(self):
        attrs = _build_attributes(_event(error_message="upstream timeout"))
        assert attrs["bifrost.error_message"] == "upstream timeout"

    def test_error_message_excluded_when_empty(self):
        attrs = _build_attributes(_event(error_message=""))
        assert "bifrost.error_message" not in attrs

    def test_tags_flattened_as_prefixed_attributes(self):
        attrs = _build_attributes(_event(tags={"env": "prod", "tier": "premium"}))
        assert attrs["bifrost.tag.env"] == "prod"
        assert attrs["bifrost.tag.tier"] == "premium"

    def test_empty_tags_produce_no_tag_attributes(self):
        attrs = _build_attributes(_event(tags={}))
        tag_keys = [k for k in attrs if k.startswith("bifrost.tag.")]
        assert tag_keys == []


# ---------------------------------------------------------------------------
# OtelAuditAdapter — uses patched OTel SDK to avoid real gRPC connections
# ---------------------------------------------------------------------------


def _make_otel_adapter(
    endpoint: str = "http://fake:4317",
    service_name: str = "test",
) -> tuple:
    """Return (adapter, mock_tracer) with the OTel SDK fully patched."""
    mock_span = MagicMock()
    mock_span.__enter__ = MagicMock(return_value=mock_span)
    mock_span.__exit__ = MagicMock(return_value=False)

    mock_tracer = MagicMock()
    mock_tracer.start_as_current_span.return_value = mock_span

    mock_provider = MagicMock()
    mock_provider.get_tracer.return_value = mock_tracer

    with patch(_PATCH, return_value=mock_tracer):
        adapter = OtelAuditAdapter(endpoint=endpoint, service_name=service_name)
        adapter._provider = mock_provider

    return adapter, mock_tracer, mock_span


class TestOtelAuditAdapterInit:
    def test_stores_endpoint(self):
        adapter, _, _ = _make_otel_adapter(endpoint="http://collector:4317")
        assert adapter._endpoint == "http://collector:4317"

    def test_stores_service_name(self):
        adapter, _, _ = _make_otel_adapter(service_name="my-service")
        assert adapter._service_name == "my-service"

    def test_default_endpoint(self):
        with patch(_PATCH, return_value=MagicMock()):
            adapter = OtelAuditAdapter()
        assert adapter._endpoint == "http://localhost:4317"

    def test_default_service_name(self):
        with patch(_PATCH, return_value=MagicMock()):
            adapter = OtelAuditAdapter()
        assert adapter._service_name == "bifrost"


class TestOtelAuditAdapterLog:
    async def test_log_calls_start_as_current_span(self):
        adapter, mock_tracer, _ = _make_otel_adapter()
        await adapter.log(_event())
        mock_tracer.start_as_current_span.assert_called_once()

    async def test_log_uses_bifrost_audit_span_name(self):
        adapter, mock_tracer, _ = _make_otel_adapter()
        await adapter.log(_event())
        call_kwargs = mock_tracer.start_as_current_span.call_args
        assert call_kwargs[0][0] == "bifrost.audit"

    async def test_log_passes_start_time(self):
        adapter, mock_tracer, _ = _make_otel_adapter()
        e = _event()
        await adapter.log(e)
        kwargs = mock_tracer.start_as_current_span.call_args[1]
        assert "start_time" in kwargs
        assert kwargs["start_time"] == _epoch_nanos(e.timestamp)

    async def test_log_passes_attributes(self):
        adapter, mock_tracer, _ = _make_otel_adapter()
        e = _event(agent_id="agent-99", outcome="rejected")
        await adapter.log(e)
        kwargs = mock_tracer.start_as_current_span.call_args[1]
        assert "attributes" in kwargs
        assert kwargs["attributes"]["bifrost.agent_id"] == "agent-99"
        assert kwargs["attributes"]["bifrost.outcome"] == "rejected"

    async def test_log_does_not_raise_on_tracer_error(self):
        adapter, mock_tracer, _ = _make_otel_adapter()
        mock_tracer.start_as_current_span.side_effect = RuntimeError("otel down")
        # Must not raise — audit errors are swallowed.
        await adapter.log(_event())

    async def test_log_with_rule_matched(self):
        adapter, mock_tracer, _ = _make_otel_adapter()
        e = _event(rule_name="pii-block", rule_action="reject")
        await adapter.log(e)
        kwargs = mock_tracer.start_as_current_span.call_args[1]
        assert kwargs["attributes"]["bifrost.rule_matched"] == "pii-block"

    async def test_log_with_tags(self):
        adapter, mock_tracer, _ = _make_otel_adapter()
        e = _event(tags={"team": "core", "env": "staging"})
        await adapter.log(e)
        kwargs = mock_tracer.start_as_current_span.call_args[1]
        assert kwargs["attributes"]["bifrost.tag.team"] == "core"
        assert kwargs["attributes"]["bifrost.tag.env"] == "staging"


class TestOtelAuditAdapterQuery:
    async def test_query_returns_empty_list(self):
        adapter, _, _ = _make_otel_adapter()
        result = await adapter.query()
        assert result == []

    async def test_query_ignores_all_filters(self):
        adapter, _, _ = _make_otel_adapter()
        result = await adapter.query(
            agent_id="a",
            tenant_id="t",
            model="m",
            outcome="success",
            since=datetime.now(UTC),
            until=datetime.now(UTC),
            limit=5,
        )
        assert result == []


class TestOtelAuditAdapterClose:
    async def test_close_calls_provider_shutdown(self):
        adapter, _, _ = _make_otel_adapter()
        await adapter.close()
        adapter._provider.shutdown.assert_called_once()

    async def test_close_without_provider_does_not_raise(self):
        with patch(_PATCH, return_value=MagicMock()):
            adapter = OtelAuditAdapter()
        # Remove the _provider attribute to simulate pre-init state.
        if hasattr(adapter, "_provider"):
            del adapter._provider
        await adapter.close()  # must not raise


class TestOtelBuildTracer:
    def test_build_tracer_returns_tracer(self):
        """Verify _build_tracer is called and returns the tracer."""
        mock_tracer = MagicMock()
        with patch(_PATCH, return_value=mock_tracer):
            adapter = OtelAuditAdapter(endpoint="http://test:4317", service_name="svc")
        assert adapter._tracer is mock_tracer


# ---------------------------------------------------------------------------
# NullAuditAdapter
# ---------------------------------------------------------------------------


class TestNullAuditAdapter:
    async def test_log_does_not_raise(self):
        adapter = NullAuditAdapter()
        await adapter.log(_event())  # no assertion needed — must not raise

    async def test_close_does_not_raise(self):
        adapter = NullAuditAdapter()
        await adapter.close()  # no assertion needed — must not raise

    async def test_query_returns_empty_list(self):
        adapter = NullAuditAdapter()
        result = await adapter.query()
        assert result == []

    async def test_query_with_all_filters_returns_empty(self):
        adapter = NullAuditAdapter()
        result = await adapter.query(
            agent_id="a",
            tenant_id="t",
            model="m",
            outcome="success",
            since=datetime.now(UTC),
            until=datetime.now(UTC),
            limit=10,
        )
        assert result == []


# ---------------------------------------------------------------------------
# Config: AuditConfig
# ---------------------------------------------------------------------------


class TestAuditConfig:
    def test_default_adapter_is_null(self):
        from bifrost.config import AuditAdapter, AuditConfig

        cfg = AuditConfig()
        assert cfg.adapter == AuditAdapter.NULL

    def test_default_otel_endpoint(self):
        from bifrost.config import AuditConfig

        cfg = AuditConfig()
        assert cfg.otel.endpoint == "http://localhost:4317"

    def test_default_otel_service_name(self):
        from bifrost.config import AuditConfig

        cfg = AuditConfig()
        assert cfg.otel.service_name == "bifrost"

    def test_effective_dsn_explicit(self):
        from bifrost.config import AuditConfig

        cfg = AuditConfig(dsn="postgresql://explicit/db")
        assert cfg.effective_dsn() == "postgresql://explicit/db"

    def test_effective_dsn_env_fallback(self, monkeypatch):
        from bifrost.config import AuditConfig

        monkeypatch.setenv("BIFROST_AUDIT_DSN", "postgresql://env/db")
        cfg = AuditConfig()
        assert cfg.effective_dsn() == "postgresql://env/db"

    def test_effective_dsn_empty_when_not_configured(self):
        from bifrost.config import AuditConfig

        cfg = AuditConfig()
        assert cfg.effective_dsn() == ""

    def test_bifrost_config_has_audit_field(self):
        from bifrost.config import AuditConfig, BifrostConfig

        cfg = BifrostConfig()
        assert isinstance(cfg.audit, AuditConfig)


# ---------------------------------------------------------------------------
# App factory: _build_audit_adapter
# ---------------------------------------------------------------------------


class TestBuildAuditAdapter:
    def test_default_builds_null_adapter(self):
        from bifrost.adapters.audit.null import NullAuditAdapter
        from bifrost.app import _build_audit_adapter
        from bifrost.config import BifrostConfig

        adapter = _build_audit_adapter(BifrostConfig())
        assert isinstance(adapter, NullAuditAdapter)

    def test_null_adapter_explicit(self):
        from bifrost.adapters.audit.null import NullAuditAdapter
        from bifrost.app import _build_audit_adapter
        from bifrost.config import AuditConfig, BifrostConfig

        cfg = BifrostConfig(audit=AuditConfig(adapter="null"))
        adapter = _build_audit_adapter(cfg)
        assert isinstance(adapter, NullAuditAdapter)

    def test_otel_adapter_builds_with_config(self):
        from bifrost.adapters.audit.otel import OtelAuditAdapter
        from bifrost.app import _build_audit_adapter
        from bifrost.config import AuditConfig, BifrostConfig, OtelAuditConfig

        with patch(_PATCH, return_value=MagicMock()):
            cfg = BifrostConfig(
                audit=AuditConfig(
                    adapter="otel",
                    otel=OtelAuditConfig(
                        endpoint="http://otel-collector:4317",
                        service_name="bifrost",
                    ),
                )
            )
            adapter = _build_audit_adapter(cfg)
        assert isinstance(adapter, OtelAuditAdapter)
        assert adapter._endpoint == "http://otel-collector:4317"
        assert adapter._service_name == "bifrost"

    def test_postgres_adapter_raises_without_dsn(self):
        from bifrost.app import _build_audit_adapter
        from bifrost.config import AuditConfig, BifrostConfig

        cfg = BifrostConfig(
            audit=AuditConfig(adapter="postgres", dsn="", dsn_env="NONEXISTENT_VAR_XYZ")
        )
        with pytest.raises(ValueError, match="PostgreSQL audit adapter requires a DSN"):
            _build_audit_adapter(cfg)

    def test_unknown_adapter_rejected_by_pydantic(self):
        from pydantic import ValidationError

        from bifrost.config import AuditConfig

        with pytest.raises(ValidationError):
            AuditConfig(adapter="nonexistent")
