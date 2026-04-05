"""Per-model pricing table and cost calculation.

Prices are USD per million tokens (input / output / cache variants).
The built-in snapshot can be extended or overridden via ``BifrostConfig``.
"""

from __future__ import annotations

from dataclasses import dataclass

from bifrost.domain.models import TokenUsage


@dataclass(frozen=True)
class ModelPricing:
    """USD cost per one million tokens for a single model."""

    input_per_million: float = 0.0
    output_per_million: float = 0.0
    cache_creation_per_million: float = 0.0
    cache_read_per_million: float = 0.0


# ---------------------------------------------------------------------------
# Built-in pricing snapshot — USD/million tokens as of 2026-04.
# These can be overridden or extended through BifrostConfig.pricing.
# ---------------------------------------------------------------------------
BUILTIN_PRICING: dict[str, ModelPricing] = {
    # Anthropic ──────────────────────────────────────────────────────────────
    "claude-opus-4-6": ModelPricing(
        input_per_million=15.00,
        output_per_million=75.00,
        cache_creation_per_million=18.75,
        cache_read_per_million=1.50,
    ),
    "claude-sonnet-4-6": ModelPricing(
        input_per_million=3.00,
        output_per_million=15.00,
        cache_creation_per_million=3.75,
        cache_read_per_million=0.30,
    ),
    "claude-haiku-4-5-20251001": ModelPricing(
        input_per_million=0.80,
        output_per_million=4.00,
        cache_creation_per_million=1.00,
        cache_read_per_million=0.08,
    ),
    # OpenAI ─────────────────────────────────────────────────────────────────
    "gpt-4o": ModelPricing(input_per_million=2.50, output_per_million=10.00),
    "gpt-4o-mini": ModelPricing(input_per_million=0.15, output_per_million=0.60),
    # Local / free (Ollama) ──────────────────────────────────────────────────
    "llama3.1:8b": ModelPricing(),
}


def calculate_cost(
    model: str,
    usage: TokenUsage,
    overrides: dict[str, ModelPricing] | None = None,
) -> float:
    """Return the USD cost for *usage* on *model*.

    Pricing is looked up in *overrides* first, then ``BUILTIN_PRICING``.
    Returns ``0.0`` when the model has no pricing entry.

    Args:
        model:     Canonical model identifier.
        usage:     Token counts from the completed request.
        overrides: Optional per-model overrides from config.

    Returns:
        Cost in USD (may be 0.0 for unknown / free models).
    """
    pricing = (overrides or {}).get(model) or BUILTIN_PRICING.get(model)
    if pricing is None:
        return 0.0

    return (
        usage.input_tokens * pricing.input_per_million / 1_000_000
        + usage.output_tokens * pricing.output_per_million / 1_000_000
        + usage.cache_creation_input_tokens * pricing.cache_creation_per_million / 1_000_000
        + usage.cache_read_input_tokens * pricing.cache_read_per_million / 1_000_000
    )
