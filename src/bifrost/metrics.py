"""Bifröst Prometheus metrics registry.

Provides a minimal thread-safe registry that generates Prometheus text-format
output without requiring the ``prometheus_client`` package.  All metrics are
module-level singletons so they accumulate across the process lifetime.

Usage::

    from bifrost.metrics import REGISTRY, record_request, record_cache_hit

    record_request(provider="anthropic", model="claude-sonnet-4-6", status="200",
                   duration_seconds=1.23, input_tokens=100, output_tokens=50,
                   cost_usd=0.002)
    record_cache_hit(provider="anthropic", model="claude-sonnet-4-6")
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from io import StringIO
from typing import NamedTuple

# ---------------------------------------------------------------------------
# Internal metric primitives
# ---------------------------------------------------------------------------


class LabelKey(NamedTuple):
    """Immutable tuple of label values (preserves order for text output)."""

    values: tuple[str, ...]


@dataclass
class Counter:
    """Thread-safe monotonically increasing counter."""

    name: str
    help: str
    label_names: tuple[str, ...]
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    _values: dict[LabelKey, float] = field(default_factory=dict, init=False, repr=False)

    def inc(self, labels: tuple[str, ...], amount: float = 1.0) -> None:
        key = LabelKey(labels)
        with self._lock:
            self._values[key] = self._values.get(key, 0.0) + amount

    def collect(self) -> dict[LabelKey, float]:
        with self._lock:
            return dict(self._values)


# Default histogram buckets suitable for request durations (seconds).
_DURATION_BUCKETS = (0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0)


@dataclass
class Histogram:
    """Thread-safe histogram with configurable buckets."""

    name: str
    help: str
    label_names: tuple[str, ...]
    buckets: tuple[float, ...] = _DURATION_BUCKETS
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    # Maps label key → list of bucket counts (len == len(buckets)+1 for +Inf)
    _buckets: dict[LabelKey, list[float]] = field(default_factory=dict, init=False, repr=False)
    _sums: dict[LabelKey, float] = field(default_factory=dict, init=False, repr=False)
    _counts: dict[LabelKey, float] = field(default_factory=dict, init=False, repr=False)

    def observe(self, labels: tuple[str, ...], value: float) -> None:
        key = LabelKey(labels)
        with self._lock:
            if key not in self._buckets:
                self._buckets[key] = [0.0] * (len(self.buckets) + 1)
                self._sums[key] = 0.0
                self._counts[key] = 0.0
            for i, bound in enumerate(self.buckets):
                if value <= bound:
                    self._buckets[key][i] += 1.0
            # +Inf bucket always incremented
            self._buckets[key][-1] += 1.0
            self._sums[key] += value
            self._counts[key] += 1.0

    def collect(self) -> dict[LabelKey, tuple[list[float], float, float]]:
        """Return {label_key: (bucket_counts, sum, count)}."""
        with self._lock:
            return {k: (list(v), self._sums[k], self._counts[k]) for k, v in self._buckets.items()}


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


@dataclass
class Registry:
    """Container for all registered metrics."""

    _metrics: list[Counter | Histogram] = field(default_factory=list, init=False)

    def register(self, metric: Counter | Histogram) -> Counter | Histogram:
        self._metrics.append(metric)
        return metric

    def generate_text(self) -> str:
        """Render all metrics in Prometheus text exposition format."""
        buf = StringIO()
        for metric in self._metrics:
            _write_metric(buf, metric)
        return buf.getvalue()


def _label_str(names: tuple[str, ...], values: tuple[str, ...]) -> str:
    if not names:
        return ""
    pairs = ",".join(f'{n}="{_escape(v)}"' for n, v in zip(names, values, strict=True))
    return "{" + pairs + "}"


def _escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _write_metric(buf: StringIO, metric: Counter | Histogram) -> None:
    buf.write(f"# HELP {metric.name} {metric.help}\n")
    if isinstance(metric, Counter):
        buf.write(f"# TYPE {metric.name} counter\n")
        for key, value in metric.collect().items():
            labels = _label_str(metric.label_names, key.values)
            buf.write(f"{metric.name}{labels} {value}\n")
    elif isinstance(metric, Histogram):
        buf.write(f"# TYPE {metric.name} histogram\n")
        for key, (buckets, total, count) in metric.collect().items():
            base_labels = _label_str(metric.label_names, key.values)
            # Strip trailing } to insert le label
            prefix = base_labels[:-1] if base_labels else "{"
            for i, bound in enumerate(metric.buckets):
                le = f"{bound:g}"
                if base_labels:
                    bucket_labels = f'{prefix},le="{le}"}}'
                else:
                    bucket_labels = f'{{le="{le}"}}'
                buf.write(f"{metric.name}_bucket{bucket_labels} {buckets[i]}\n")
            # +Inf
            if base_labels:
                inf_labels = f'{prefix},le="+Inf"}}'
            else:
                inf_labels = '{le="+Inf"}'
            buf.write(f"{metric.name}_bucket{inf_labels} {buckets[-1]}\n")
            buf.write(f"{metric.name}_sum{base_labels} {total}\n")
            buf.write(f"{metric.name}_count{base_labels} {count}\n")
    buf.write("\n")


# ---------------------------------------------------------------------------
# Global registry and metric definitions
# ---------------------------------------------------------------------------

REGISTRY = Registry()

# Counters
requests_total = REGISTRY.register(
    Counter(
        name="bifrost_requests_total",
        help="Total LLM proxy requests by provider, model, and HTTP status.",
        label_names=("provider", "model", "status"),
    )
)

tokens_total = REGISTRY.register(
    Counter(
        name="bifrost_tokens_total",
        help="Total tokens processed by provider, model, and type (input/output/cache).",
        label_names=("provider", "model", "type"),
    )
)

cost_usd_total = REGISTRY.register(
    Counter(
        name="bifrost_cost_usd_total",
        help="Cumulative USD cost of all LLM requests by provider and model.",
        label_names=("provider", "model"),
    )
)

cache_hits_total = REGISTRY.register(
    Counter(
        name="bifrost_cache_hits_total",
        help="Number of requests served from the semantic response cache.",
        label_names=("provider", "model"),
    )
)

cache_misses_total = REGISTRY.register(
    Counter(
        name="bifrost_cache_misses_total",
        help="Number of requests that missed the semantic response cache.",
        label_names=("provider", "model"),
    )
)

quota_rejections_total = REGISTRY.register(
    Counter(
        name="bifrost_quota_rejections_total",
        help="Number of requests rejected due to quota limits, by agent_id.",
        label_names=("agent_id",),
    )
)

rule_hits_total = REGISTRY.register(
    Counter(
        name="bifrost_rule_hits_total",
        help="Number of times a declarative routing rule fired, by rule name and action.",
        label_names=("rule_name", "action"),
    )
)

# Histograms
request_duration_seconds = REGISTRY.register(
    Histogram(
        name="bifrost_request_duration_seconds",
        help="End-to-end request duration in seconds by provider and model.",
        label_names=("provider", "model"),
    )
)


# ---------------------------------------------------------------------------
# Convenience helpers called from route handlers
# ---------------------------------------------------------------------------


def record_request(
    *,
    provider: str,
    model: str,
    status: str,
    duration_seconds: float,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    cost_usd: float = 0.0,
) -> None:
    """Record a completed LLM request in all relevant metrics."""
    requests_total.inc((provider, model, status))
    request_duration_seconds.observe((provider, model), duration_seconds)
    if input_tokens:
        tokens_total.inc((provider, model, "input"), float(input_tokens))
    if output_tokens:
        tokens_total.inc((provider, model, "output"), float(output_tokens))
    if cache_read_tokens:
        tokens_total.inc((provider, model, "cache"), float(cache_read_tokens))
    if cache_write_tokens:
        tokens_total.inc((provider, model, "cache_write"), float(cache_write_tokens))
    if cost_usd:
        cost_usd_total.inc((provider, model), cost_usd)


def record_cache_hit(*, provider: str, model: str) -> None:
    cache_hits_total.inc((provider, model))


def record_cache_miss(*, provider: str, model: str) -> None:
    cache_misses_total.inc((provider, model))


def record_quota_rejection(*, agent_id: str) -> None:
    quota_rejections_total.inc((agent_id,))


def record_rule_hit(*, rule_name: str, action: str) -> None:
    rule_hits_total.inc((rule_name, action))
