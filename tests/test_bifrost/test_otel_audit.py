"""Tests for OtelAuditAdapter (Logs SDK) and NullAuditAdapter.

Verifies:
- OtelAuditAdapter emits LogRecord via the OTel Logs SDK
- Severity mapping (error → ERROR, rejected → WARN, success → INFO)
- NullAuditAdapter is a no-op
- AuditConfig defaults and factory wiring
"""

from __future__ import annotations

import importlib
import sys
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from bifrost.adapters.audit.null import NullAuditAdapter
from bifrost.ports.audit import AuditEvent


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
# Mock OTel SDK modules
# ---------------------------------------------------------------------------


class _MockBatchLogRecordProcessor:
    def __init__(self, exporter):
        pass


class _MockLoggerProvider:
    resource = MagicMock()

    def __init__(self, resource=None):
        pass

    def add_log_record_processor(self, processor):
        pass

    def get_logger(self, name):
        return _MockOtelLogger()

    def shutdown(self):
        pass


class _MockOtelLogger:
    def __init__(self):
        self.emitted = []

    def emit(self, record):
        self.emitted.append(record)


class _MockLogRecord:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class _MockResource:
    @staticmethod
    def create(attrs):
        return MagicMock()


_INVALID_SPAN_CONTEXT = MagicMock()


def _make_otel_mocks():
    """Return a dict of mock modules for opentelemetry."""
    logs_mod = MagicMock()
    logs_mod.set_logger_provider = MagicMock()

    sdk_logs_mod = MagicMock()
    sdk_logs_mod.LoggerProvider = _MockLoggerProvider
    sdk_logs_mod.LogRecord = _MockLogRecord

    export_mod = MagicMock()
    export_mod.BatchLogRecordProcessor = _MockBatchLogRecordProcessor
    export_mod.ConsoleLogExporter = MagicMock(return_value=MagicMock())

    sdk_resources_mod = MagicMock()
    sdk_resources_mod.Resource = _MockResource

    trace_mod = MagicMock()
    trace_mod.INVALID_SPAN_CONTEXT = _INVALID_SPAN_CONTEXT

    return {
        "opentelemetry": MagicMock(),
        "opentelemetry._logs": logs_mod,
        "opentelemetry.sdk": MagicMock(),
        "opentelemetry.sdk._logs": sdk_logs_mod,
        "opentelemetry.sdk._logs.export": export_mod,
        "opentelemetry.sdk.resources": sdk_resources_mod,
        "opentelemetry.trace": trace_mod,
    }


def _load_otel_adapter(monkeypatch):
    """Reload the otel module with mocked OTel SDK and return it."""
    mocks = _make_otel_mocks()
    for mod_name, mod in mocks.items():
        monkeypatch.setitem(sys.modules, mod_name, mod)

    import bifrost.adapters.audit.otel as otel_mod

    importlib.reload(otel_mod)
    return otel_mod


# ---------------------------------------------------------------------------
# OtelAuditAdapter — uses mocked OTel SDK
# ---------------------------------------------------------------------------


class TestOtelAuditAdapterLog:
    @pytest.mark.asyncio
    async def test_log_emits_record(self, monkeypatch):
        otel_mod = _load_otel_adapter(monkeypatch)
        adapter = otel_mod.OtelAuditAdapter()
        otel_logger = adapter._otel_logger
        await adapter.log(_event())
        assert len(otel_logger.emitted) == 1

    @pytest.mark.asyncio
    async def test_log_with_full_fields(self, monkeypatch):
        otel_mod = _load_otel_adapter(monkeypatch)
        adapter = otel_mod.OtelAuditAdapter()
        event = _event(
            tags={"key": "value"},
            prompt_content="hello",
            response_content="world",
        )
        await adapter.log(event)
        assert len(adapter._otel_logger.emitted) == 1

    @pytest.mark.asyncio
    async def test_log_does_not_raise_on_error(self, monkeypatch):
        otel_mod = _load_otel_adapter(monkeypatch)
        adapter = otel_mod.OtelAuditAdapter()
        adapter._otel_logger.emit = MagicMock(side_effect=RuntimeError("otel down"))
        # Must not raise — audit errors are swallowed.
        await adapter.log(_event())


class TestOtelAuditAdapterQuery:
    @pytest.mark.asyncio
    async def test_query_returns_empty_list(self, monkeypatch):
        otel_mod = _load_otel_adapter(monkeypatch)
        adapter = otel_mod.OtelAuditAdapter()
        result = await adapter.query()
        assert result == []

    @pytest.mark.asyncio
    async def test_query_ignores_all_filters(self, monkeypatch):
        otel_mod = _load_otel_adapter(monkeypatch)
        adapter = otel_mod.OtelAuditAdapter()
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
    @pytest.mark.asyncio
    async def test_close_calls_provider_shutdown(self, monkeypatch):
        otel_mod = _load_otel_adapter(monkeypatch)
        adapter = otel_mod.OtelAuditAdapter()
        adapter._provider = MagicMock()
        await adapter.close()
        adapter._provider.shutdown.assert_called_once()

    @pytest.mark.asyncio
    async def test_close_does_not_raise_on_error(self, monkeypatch):
        otel_mod = _load_otel_adapter(monkeypatch)
        adapter = otel_mod.OtelAuditAdapter()
        adapter._provider.shutdown = MagicMock(side_effect=RuntimeError("shutdown error"))
        await adapter.close()  # must not raise


class TestSeverity:
    def test_error_outcome(self, monkeypatch):
        otel_mod = _load_otel_adapter(monkeypatch)
        num, text = otel_mod._severity("error")
        assert text == "ERROR"

    def test_rejected_outcome(self, monkeypatch):
        otel_mod = _load_otel_adapter(monkeypatch)
        num, text = otel_mod._severity("rejected")
        assert text == "WARN"

    def test_quota_exceeded_outcome(self, monkeypatch):
        otel_mod = _load_otel_adapter(monkeypatch)
        num, text = otel_mod._severity("quota_exceeded")
        assert text == "WARN"

    def test_success_outcome(self, monkeypatch):
        otel_mod = _load_otel_adapter(monkeypatch)
        num, text = otel_mod._severity("success")
        assert text == "INFO"


# ---------------------------------------------------------------------------
# NullAuditAdapter
# ---------------------------------------------------------------------------


class TestNullAuditAdapter:
    @pytest.mark.asyncio
    async def test_log_does_not_raise(self):
        adapter = NullAuditAdapter()
        await adapter.log(_event())

    @pytest.mark.asyncio
    async def test_close_does_not_raise(self):
        adapter = NullAuditAdapter()
        await adapter.close()

    @pytest.mark.asyncio
    async def test_query_returns_empty_list(self):
        adapter = NullAuditAdapter()
        result = await adapter.query()
        assert result == []

    @pytest.mark.asyncio
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

    def test_effective_dsn_empty_when_not_configured(self, monkeypatch):
        from bifrost.config import AuditConfig

        monkeypatch.delenv("BIFROST_AUDIT_DSN", raising=False)
        cfg = AuditConfig()
        assert cfg.effective_dsn() == ""

    def test_bifrost_config_has_audit_field(self):
        from bifrost.config import AuditConfig, BifrostConfig

        cfg = BifrostConfig()
        assert isinstance(cfg.audit, AuditConfig)


# ---------------------------------------------------------------------------
# App factory: _build_audit
# ---------------------------------------------------------------------------


class TestBuildAudit:
    def test_default_builds_null_adapter(self):
        from bifrost.adapters.audit.null import NullAuditAdapter
        from bifrost.app import _build_audit
        from bifrost.config import BifrostConfig

        adapter = _build_audit(BifrostConfig())
        assert isinstance(adapter, NullAuditAdapter)

    def test_null_adapter_explicit(self):
        from bifrost.adapters.audit.null import NullAuditAdapter
        from bifrost.app import _build_audit
        from bifrost.config import AuditConfig, BifrostConfig

        cfg = BifrostConfig(audit=AuditConfig(adapter="null"))
        adapter = _build_audit(cfg)
        assert isinstance(adapter, NullAuditAdapter)

    def test_otel_adapter_builds_with_config(self, monkeypatch):
        otel_mod = _load_otel_adapter(monkeypatch)

        with patch("bifrost.adapters.audit.otel.OtelAuditAdapter") as mock_cls:
            mock_cls.return_value = NullAuditAdapter()

            from bifrost.app import _build_audit
            from bifrost.config import AuditConfig, BifrostConfig, OtelAuditConfig

            cfg = BifrostConfig(
                audit=AuditConfig(
                    adapter="otel",
                    otel=OtelAuditConfig(
                        endpoint="http://otel-collector:4317",
                        service_name="bifrost",
                    ),
                )
            )
            _build_audit(cfg)
            mock_cls.assert_called_once_with(
                otel_endpoint="http://otel-collector:4317",
                service_name="bifrost",
            )

    def test_postgres_adapter_raises_without_dsn(self):
        from bifrost.app import _build_audit
        from bifrost.config import AuditConfig, BifrostConfig

        cfg = BifrostConfig(
            audit=AuditConfig(adapter="postgres", dsn="", dsn_env="NONEXISTENT_VAR_XYZ")
        )
        with pytest.raises(ValueError, match="PostgreSQL audit adapter requires a DSN"):
            _build_audit(cfg)

    def test_unknown_adapter_rejected_by_pydantic(self):
        from pydantic import ValidationError

        from bifrost.config import AuditConfig

        with pytest.raises(ValidationError):
            AuditConfig(adapter="nonexistent")
