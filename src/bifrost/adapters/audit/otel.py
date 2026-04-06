"""OpenTelemetry-backed AuditPort adapter.

Emits each audit event as a completed OTel span so Bifröst integrates with
any OTel-compatible observability backend (Jaeger, Grafana Tempo, etc.).

The adapter is a thin wrapper around the OTel SDK:
  - A ``TracerProvider`` is created with the configured exporter attached.
  - ``log()`` creates a span per audit event, sets span attributes, and
    closes the span immediately (start_time == end_time ≈ now).
  - ``query()`` is a no-op that always returns an empty list — OTel spans
    are write-only; queries go to the observability backend directly.

The exporter sends spans over gRPC (OTLP) to the configured endpoint.

Configuration (via ``OtelAuditConfig``):
  - ``endpoint``: OTLP gRPC endpoint (e.g. ``http://otel-collector:4317``)
  - ``service_name``: Service name set on the ``Resource`` (default: ``bifrost``)
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from bifrost.ports.audit import AuditEvent, AuditPort

logger = logging.getLogger(__name__)

# Span name used for all audit events.
_SPAN_NAME = "bifrost.audit"


def _epoch_nanos(dt: datetime) -> int:
    """Convert a datetime to nanoseconds since the UNIX epoch."""
    return int(dt.timestamp() * 1_000_000_000)


def _build_attributes(event: AuditEvent) -> dict[str, Any]:
    """Build OTel span attributes from an AuditEvent."""
    attrs: dict[str, Any] = {
        "bifrost.agent_id": event.agent_id,
        "bifrost.tenant_id": event.tenant_id,
        "bifrost.model": event.model,
        "bifrost.outcome": event.outcome,
        "bifrost.status_code": event.status_code,
        "bifrost.latency_ms": event.latency_ms,
    }

    if event.session_id:
        attrs["bifrost.session_id"] = event.session_id
    if event.saga_id:
        attrs["bifrost.saga_id"] = event.saga_id
    if event.provider:
        attrs["bifrost.provider"] = event.provider
    if event.rule_name:
        attrs["bifrost.rule_matched"] = event.rule_name
    if event.rule_action:
        attrs["bifrost.rule_action"] = event.rule_action
    if event.error_message:
        attrs["bifrost.error_message"] = event.error_message

    # Flatten tags as bifrost.tag.<key> attributes.
    for tag_key, tag_value in event.tags.items():
        attrs[f"bifrost.tag.{tag_key}"] = tag_value

    return attrs


class OtelAuditAdapter(AuditPort):
    """OTel span-emitting implementation of ``AuditPort``.

    Each call to ``log()`` produces one completed span with all audit
    attributes set.  The exporter flushes spans to the OTLP endpoint
    asynchronously via the SDK's batch span processor.

    ``query()`` is not supported (always returns ``[]``) — queries belong
    to the observability backend (Jaeger, Tempo, etc.).
    """

    def __init__(
        self,
        endpoint: str = "http://localhost:4317",
        service_name: str = "bifrost",
    ) -> None:
        self._endpoint = endpoint
        self._service_name = service_name
        self._tracer = self._build_tracer()

    def _build_tracer(self) -> Any:
        """Construct a tracer backed by an OTLP gRPC exporter."""
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        resource = Resource.create({"service.name": self._service_name})
        provider = TracerProvider(resource=resource)
        exporter = OTLPSpanExporter(endpoint=self._endpoint)
        provider.add_span_processor(BatchSpanProcessor(exporter))
        self._provider = provider
        return provider.get_tracer(__name__)

    # ------------------------------------------------------------------
    # Port implementation
    # ------------------------------------------------------------------

    async def log(self, event: AuditEvent) -> None:
        """Emit *event* as a completed OTel span.

        The span start and end times are set to the event timestamp so
        the span shows up at the correct point in the trace timeline.
        Errors are caught and logged — audit failures must never propagate
        to callers.
        """
        try:
            start_ns = _epoch_nanos(event.timestamp)
            attributes = _build_attributes(event)
            with self._tracer.start_as_current_span(
                _SPAN_NAME,
                start_time=start_ns,
                attributes=attributes,
            ):
                pass  # span ends immediately; all data is in the attributes
        except Exception:
            logger.exception("Failed to emit OTel audit span for %s", event.request_id)

    async def query(
        self,
        *,
        agent_id: str | None = None,
        tenant_id: str | None = None,
        model: str | None = None,
        outcome: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 1000,
    ) -> list[AuditEvent]:
        """Not supported — OTel spans are write-only.

        Returns an empty list.  Use the observability backend (Jaeger,
        Grafana Tempo, etc.) to query spans.
        """
        return []

    async def close(self) -> None:
        """Flush pending spans and shut down the provider.

        Safe to call multiple times (idempotent after the first call).
        """
        if hasattr(self, "_provider"):
            self._provider.shutdown()
