# Bifröst Architecture Audit — NIU-474

**Date:** 2026-04-05
**Branch audited:** `feat/bifrost` (commits `29cbc00` – `050447f`)
**Auditor:** Claude Code

---

## Summary

The Bifröst implementation is in excellent shape. 128 tests pass, coverage is 93%, lint is clean. The core proxy functionality (Anthropic-compatible inbound API, multi-provider routing, translation layer, streaming SSE passthrough, model failover) fully matches the architecture vision.

Four gaps were found and filed as child issues of this ticket (all blocked-by NIU-474):

| Issue | Gap | Priority |
|-------|-----|----------|
| NIU-511 | Missing routing strategies: `cost_optimised`, `round_robin`, `latency_optimised` | High |
| NIU-512 | `cache_control` field not handled in translation layer | Medium |
| NIU-514 | No Pi-mode config example (local-only, no auth) | Medium |
| NIU-513 | `inbound/` package layer missing — routes live in root `app.py` | Low |

---

## Checklist Results

### Inbound layer

| Item | Status | Location |
|------|--------|----------|
| `POST /v1/messages` — Anthropic-compatible endpoint | ✅ | `app.py:137` |
| `GET /v1/models` — model listing | ✅ | `app.py:126` |
| Streaming SSE passthrough (non-buffering) | ✅ | `app.py:154-163` — `cache-control: no-cache`, `x-accel-buffering: no` |

### Provider adapters

| Item | Status | Location |
|------|--------|----------|
| `AnthropicAdapter` — passthrough, headers, streaming | ✅ | `adapters/anthropic.py` — sends `x-api-key` + `anthropic-version: 2023-06-01` |
| `OpenAIAdapter` — full translation (roles, system, tool_use, streaming) | ✅ | `adapters/openai_compat.py` + `translation/` |
| `OllamaAdapter` — local endpoint, OpenAI-compat quirks | ✅ | `adapters/ollama.py` — strips `top_p`, 300s timeout, defaults to `localhost:11434` |
| `GenericOpenAIAdapter` — any OpenAI-compatible endpoint | ✅ | `OpenAICompatAdapter` with configurable `base_url` |

### Domain

| Item | Status | Notes |
|------|--------|-------|
| Model alias resolution | ✅ | `config.resolve_alias()` → `router._resolve()` |
| Routing strategies: `direct`, `failover` | ✅ | Implemented in `router.py` |
| Routing strategies: `cost_optimised`, `round_robin`, `latency_optimised` | ❌ | Filed as NIU-511 |
| Translation: role names | ✅ | `user`/`assistant` passthrough; `tool` role created for `ToolResultBlock` |
| Translation: system prompt | ✅ | Anthropic top-level `system` → OpenAI `{"role":"system"}` message |
| Translation: tool calling (request + response) | ✅ | Full `tool_use`/`tool_result` ↔ `tool_calls`/`tool` round-trip |
| Translation: streaming events | ✅ | `openai_stream_to_anthropic()` — complete state machine in `streaming.py` |
| Translation: `cache_control` | ❌ | Field not in models; silently dropped. Filed as NIU-512 |
| Translation: thinking blocks | ✅ (partial) | `<thinking>` tag extraction for OpenAI; native Anthropic passthrough |

### Config

| Item | Status | Notes |
|------|--------|-------|
| `api_key_env`, `models`, `base_url` load correctly | ✅ | `ProviderConfig` with env-var indirection |
| Pi mode (local-only, no auth) boots cleanly | ❌ | No example config. Filed as NIU-514 |
| Ravn `BifrostAdapter` one-line switchover | ✅ | `src/tyr/adapters/bifrost.py` — configure `base_url` to point at Bifröst |

### Package structure

| Item | Status | Notes |
|------|--------|-------|
| `domain/` — models only, no infra imports | ✅ | `domain/models.py` — pure dataclasses |
| `ports/` — abstract interfaces | ✅ | `ports/provider.py` — `ProviderPort` ABC |
| `adapters/` — implementations only | ✅ | No business logic; delegate to translation layer |
| `inbound/` — HTTP layer | ❌ | Routes live in root `app.py`; no `inbound/` subdirectory. Filed as NIU-513 |
| No business logic in adapters | ✅ | Adapters only call HTTP and delegate to `translation/` |
| No port imports in domain | ✅ | `domain/models.py` has zero imports from `ports/` or `adapters/` |

---

## Test coverage

```
TOTAL   691 stmts   33 miss   180 branches   17 partial   93% coverage
```

All 128 tests pass. Coverage is above the 85% threshold. Lint (`ruff check` + `ruff format`) is clean.

---

## Detailed gap notes

### NIU-511 — Missing routing strategies

`ModelRouter` implements a single combined strategy: try primary provider, then on 429/5xx optionally try alternatives (failover). The config has `failover_enabled: bool` but no `routing_strategy` field. The three missing strategies require:

- **`cost_optimised`**: Needs a cost-per-token table in config; select cheapest provider for the model on each request.
- **`round_robin`**: Needs a per-model counter (thread/async-safe) that advances on each request.
- **`latency_optimised`**: Needs a sliding window P99 tracker updated after each request.

These are non-trivial additions and belong in a dedicated Phase 3 milestone.

### NIU-512 — `cache_control` not forwarded

Anthropic's prompt-caching feature works by adding `{"cache_control": {"type": "ephemeral"}}` to content blocks. This field is absent from all Pydantic models in `translation/models.py`. Pydantic silently drops unknown fields on parse, so clients that rely on prompt caching via Bifröst will lose cache hits without any error signal.

Fix is mechanical: add `cache_control: dict | None = None` to `TextBlock`, `ToolResultBlock`, and the system-block type; the `AnthropicAdapter` already uses `model_dump(exclude_none=True)` so it will forward it automatically once the field exists.

### NIU-514 — No Pi-mode config

The architecture vision mentions running Bifröst on resource-constrained hardware with only Ollama. The `BifrostConfig` already supports this (providers dict can contain only `ollama`), but there is no example YAML demonstrating the setup, making discoverability poor.

### NIU-513 — `inbound/` layer not a package

Routes, middleware, and SSE tracking helpers are all in `app.py` (~188 lines). This is acceptable for the current scope but deviates from the vision's `inbound/` layer. Low priority until the inbound surface grows.
