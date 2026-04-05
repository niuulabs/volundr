"""ModelRouter — resolve model names, aliases, and route between providers.

The router maps a model name (possibly an alias) to the correct provider adapter
and selects/orders candidates according to the configured RoutingStrategy.
"""

from __future__ import annotations

import importlib
import logging
import time
from collections.abc import AsyncIterator

import httpx

from bifrost.config import BifrostConfig, ProviderConfig, RoutingStrategy
from bifrost.ports.provider import ProviderError, ProviderPort
from bifrost.translation.models import AnthropicRequest, AnthropicResponse

logger = logging.getLogger(__name__)

# HTTP status codes that trigger failover to an alternative provider.
_FAILOVER_STATUS_CODES = frozenset({429, 500, 502, 503, 504})

# Map provider name → adapter class dotted path.
_PROVIDER_ADAPTER_MAP: dict[str, str] = {
    "anthropic": "bifrost.adapters.anthropic.AnthropicAdapter",
    "openai": "bifrost.adapters.openai_compat.OpenAICompatAdapter",
    "ollama": "bifrost.adapters.ollama.OllamaAdapter",
}


def _load_adapter(provider_name: str, cfg: ProviderConfig, base_url: str) -> ProviderPort:
    """Instantiate the appropriate adapter for *provider_name*."""
    dotted = _PROVIDER_ADAPTER_MAP.get(
        provider_name,
        "bifrost.adapters.openai_compat.OpenAICompatAdapter",
    )
    module_path, class_name = dotted.rsplit(".", 1)
    module = importlib.import_module(module_path)
    cls = getattr(module, class_name)
    kwargs: dict = {}
    if base_url:
        kwargs["base_url"] = base_url
    api_key = cfg.api_key
    if api_key:
        kwargs["api_key"] = api_key
    if cfg.timeout != 120.0:
        kwargs["timeout"] = cfg.timeout
    return cls(**kwargs)


class RouterError(Exception):
    """Raised when no provider can fulfil the request."""


class ModelRouter:
    """Routes requests to the right provider using the configured RoutingStrategy.

    Providers are loaded lazily on first use so that no connections are
    opened until an actual request arrives.
    """

    def __init__(self, config: BifrostConfig) -> None:
        self._config = config
        self._adapters: dict[str, ProviderPort] = {}
        # Per-model request counter used by the round_robin strategy.
        self._round_robin_counters: dict[str, int] = {}
        # Per-provider EWMA latency (seconds) used by the latency_optimised strategy.
        self._latency_ewma: dict[str, float] = {}

    def _get_adapter(self, provider_name: str) -> ProviderPort:
        if provider_name not in self._adapters:
            cfg = self._config.providers.get(provider_name, ProviderConfig())
            base_url = self._config.effective_base_url(provider_name)
            self._adapters[provider_name] = _load_adapter(provider_name, cfg, base_url)
        return self._adapters[provider_name]

    def _record_latency(self, provider: str, elapsed: float) -> None:
        """Update the EWMA latency estimate for *provider*."""
        alpha = self._config.latency_ewma_alpha
        current = self._latency_ewma.get(provider)
        if current is None:
            self._latency_ewma[provider] = elapsed
            return
        self._latency_ewma[provider] = alpha * elapsed + (1 - alpha) * current

    def _build_candidates(self, raw_model: str) -> list[tuple[str, str]]:
        """Return an ordered list of (provider, model) pairs to try.

        Order is determined by the configured RoutingStrategy.

        Raises:
            RouterError: If no provider is configured for the resolved model.
        """
        model = self._config.resolve_alias(raw_model)
        providers = self._config.providers_for_model(model)
        if not providers:
            raise RouterError(
                f"No provider configured for model '{model}' "
                f"(requested: '{raw_model}'). "
                f"Configured providers: {list(self._config.providers)}"
            )

        match self._config.routing_strategy:
            case RoutingStrategy.DIRECT:
                return [(providers[0], model)]

            case RoutingStrategy.FAILOVER:
                return [(p, model) for p in providers]

            case RoutingStrategy.COST_OPTIMISED:
                return self._cost_optimised_candidates(providers, model)

            case RoutingStrategy.ROUND_ROBIN:
                return self._round_robin_candidates(providers, model)

            case RoutingStrategy.LATENCY_OPTIMISED:
                return self._latency_optimised_candidates(providers, model)

            case _:
                raise ValueError(f"Unknown routing strategy: {self._config.routing_strategy}")

    def _cost_optimised_candidates(self, providers: list[str], model: str) -> list[tuple[str, str]]:
        """Sort providers cheapest-first by their configured cost_per_token."""

        def cost(name: str) -> float:
            cfg = self._config.providers.get(name)
            return cfg.cost_per_token if cfg else 0.0

        ordered = sorted(providers, key=cost)
        return [(p, model) for p in ordered]

    def _round_robin_candidates(self, providers: list[str], model: str) -> list[tuple[str, str]]:
        """Rotate the provider list so a different provider leads each request."""
        idx = self._round_robin_counters.get(model, 0)
        self._round_robin_counters[model] = (idx + 1) % len(providers)
        rotated = providers[idx:] + providers[:idx]
        return [(p, model) for p in rotated]

    def _latency_optimised_candidates(
        self, providers: list[str], model: str
    ) -> list[tuple[str, str]]:
        """Sort providers fastest-first by EWMA latency.

        Providers with no recorded latency are placed after those with data,
        preserving config order among unknowns.
        """

        def latency_key(name: str) -> tuple[int, float]:
            ewma = self._latency_ewma.get(name)
            if ewma is None:
                return (1, 0.0)
            return (0, ewma)

        ordered = sorted(providers, key=latency_key)
        return [(p, model) for p in ordered]

    async def complete(self, request: AnthropicRequest) -> AnthropicResponse:
        """Route a non-streaming completion request.

        Tries candidates in order; moves to the next on retryable errors.
        """
        candidates = self._build_candidates(request.model)
        last_exc: Exception | None = None

        for pname, pmodel in candidates:
            try:
                adapter = self._get_adapter(pname)
                t0 = time.monotonic()
                result = await adapter.complete(request, pmodel)
                self._record_latency(pname, time.monotonic() - t0)
                return result
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code not in _FAILOVER_STATUS_CODES:
                    raise
                logger.warning(
                    "Provider %s returned HTTP %d for model %s; trying next candidate",
                    pname,
                    exc.response.status_code,
                    pmodel,
                )
                last_exc = exc
            except ProviderError as exc:
                logger.warning("Provider %s error for model %s: %s", pname, pmodel, exc)
                last_exc = exc

        raise RouterError(
            f"All providers failed for model '{candidates[0][1]}': {last_exc}"
        ) from last_exc

    async def stream(self, request: AnthropicRequest) -> AsyncIterator[str]:
        """Route a streaming request.

        Failover is attempted on connection or HTTP errors before the first
        byte is yielded.
        """
        candidates = self._build_candidates(request.model)
        last_exc: Exception | None = None

        for pname, pmodel in candidates:
            try:
                adapter = self._get_adapter(pname)
                t0 = time.monotonic()
                async for chunk in adapter.stream(request, pmodel):
                    yield chunk
                self._record_latency(pname, time.monotonic() - t0)
                return
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code not in _FAILOVER_STATUS_CODES:
                    raise
                logger.warning(
                    "Provider %s returned HTTP %d; trying next candidate",
                    pname,
                    exc.response.status_code,
                )
                last_exc = exc
            except ProviderError as exc:
                logger.warning("Provider %s error: %s", pname, exc)
                last_exc = exc

        raise RouterError(
            f"All providers failed for model '{candidates[0][1]}': {last_exc}"
        ) from last_exc

    async def close(self) -> None:
        """Close all open provider adapters."""
        for adapter in self._adapters.values():
            await adapter.close()
        self._adapters.clear()
