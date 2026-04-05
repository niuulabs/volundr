"""ModelRouter — resolve model names, aliases, and failover between providers.

The router maps a model name (possibly an alias) to the correct provider
adapter and retries with alternatives when the primary provider fails.
"""

from __future__ import annotations

import importlib
import logging
from collections.abc import AsyncIterator

import httpx

from bifrost.config import BifrostConfig, ProviderConfig
from bifrost.ports.provider import ProviderError, ProviderPort
from bifrost.translation.models import AnthropicRequest, AnthropicResponse

logger = logging.getLogger(__name__)

# HTTP status codes that can trigger failover to an alternative provider.
_FAILOVER_STATUS_CODES = frozenset({429, 500, 502, 503, 504})

# Map provider name → (adapter class dotted path, extra default kwargs).
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
    """Routes requests to the right provider and handles failover.

    Providers are loaded lazily on first use so that no connections are
    opened until an actual request arrives.
    """

    def __init__(self, config: BifrostConfig) -> None:
        self._config = config
        self._adapters: dict[str, ProviderPort] = {}

    def _get_adapter(self, provider_name: str) -> ProviderPort:
        if provider_name not in self._adapters:
            cfg = self._config.providers.get(provider_name, ProviderConfig())
            base_url = self._config.effective_base_url(provider_name)
            self._adapters[provider_name] = _load_adapter(provider_name, cfg, base_url)
        return self._adapters[provider_name]

    def _resolve(self, raw_model: str) -> tuple[str, str]:
        """Return (provider_name, resolved_model) for *raw_model*.

        Expands aliases and looks up which provider owns the model.

        Raises:
            RouterError: If no provider is configured for the model.
        """
        model = self._config.resolve_alias(raw_model)
        provider = self._config.provider_for_model(model)
        if provider is None:
            raise RouterError(
                f"No provider configured for model '{model}' "
                f"(requested: '{raw_model}'). "
                f"Configured providers: {list(self._config.providers)}"
            )
        return provider, model

    def _failover_providers(self, primary: str, model: str) -> list[tuple[str, str]]:
        """Return alternative (provider, model) pairs for failover.

        We try every provider that also lists the model, excluding primary.
        """
        alternatives = []
        for name, cfg in self._config.providers.items():
            if name == primary:
                continue
            if model in cfg.models:
                alternatives.append((name, model))
        return alternatives

    async def complete(self, request: AnthropicRequest) -> AnthropicResponse:
        """Route a non-streaming completion request.

        Tries the primary provider and, if ``failover_enabled``, falls back
        to any alternative provider that also serves the model.
        """
        provider_name, model = self._resolve(request.model)
        candidates = [(provider_name, model)]
        if self._config.failover_enabled:
            candidates.extend(self._failover_providers(provider_name, model))

        last_exc: Exception | None = None
        for pname, pmodel in candidates:
            try:
                adapter = self._get_adapter(pname)
                return await adapter.complete(request, pmodel)
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code not in _FAILOVER_STATUS_CODES:
                    raise
                logger.warning(
                    "Provider %s returned HTTP %d for model %s; trying failover",
                    pname,
                    exc.response.status_code,
                    pmodel,
                )
                last_exc = exc
            except ProviderError as exc:
                logger.warning("Provider %s error for model %s: %s", pname, pmodel, exc)
                last_exc = exc

        raise RouterError(f"All providers failed for model '{model}': {last_exc}") from last_exc

    async def stream(self, request: AnthropicRequest) -> AsyncIterator[str]:
        """Route a streaming request.

        Returns an async generator; failover is attempted on connection
        or HTTP errors before the first byte is yielded.
        """
        provider_name, model = self._resolve(request.model)
        candidates = [(provider_name, model)]
        if self._config.failover_enabled:
            candidates.extend(self._failover_providers(provider_name, model))

        last_exc: Exception | None = None
        for pname, pmodel in candidates:
            try:
                adapter = self._get_adapter(pname)
                async for chunk in adapter.stream(request, pmodel):
                    yield chunk
                return
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code not in _FAILOVER_STATUS_CODES:
                    raise
                logger.warning(
                    "Provider %s returned HTTP %d; trying failover",
                    pname,
                    exc.response.status_code,
                )
                last_exc = exc
            except ProviderError as exc:
                logger.warning("Provider %s error: %s", pname, exc)
                last_exc = exc

        raise RouterError(f"All providers failed for model '{model}': {last_exc}") from last_exc

    async def close(self) -> None:
        """Close all open provider adapters."""
        for adapter in self._adapters.values():
            await adapter.close()
        self._adapters.clear()
