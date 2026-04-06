# NIU-489 — Ravn Implementation Audit

**Date:** 2026-04-05
**Branch audited:** `feat/ravn` (commits up to `645ecc3`)
**Auditor:** automated audit via Claude Code

---

## Summary

The Ravn implementation is structurally sound and follows hexagonal architecture
correctly. The core agent loop, configuration system, and file tools are all
well-implemented with good test coverage of the existing test files. However,
several items from the architecture checklist are incomplete or missing entirely.

**Overall status:** ⚠️ Partial — core loop functional, but three adapter types
missing and event contract differs from spec.

---

## Audit Results

### Core Agent Loop (`agent.py`)

| Item | Status | Notes |
|------|--------|-------|
| Event type: THOUGHT | ✅ | `RavnEventType.THOUGHT` implemented |
| Event type: TOOL_START | ✅ | `RavnEventType.TOOL_START` implemented |
| Event type: TOOL_RESULT | ✅ | `RavnEventType.TOOL_RESULT` implemented |
| Event type: RESPONSE | ✅ | `RavnEventType.RESPONSE` implemented |
| Event type: ERROR | ✅ | `RavnEventType.ERROR` implemented |
| Event type: DECISION | ❌ | **Missing** — not in `RavnEventType` enum |
| RavnEvent field: `type` | ✅ | Present |
| RavnEvent field: `source` | ❌ | **Missing** — event has no source identifier |
| RavnEvent field: `payload` | ❌ | **Named differently** — field is `data`, not `payload` |
| RavnEvent field: `timestamp` | ❌ | **Missing** — no timestamp on events |
| RavnEvent field: `urgency` | ❌ | **Missing** — no urgency level |
| RavnEvent field: `correlation_id` | ❌ | **Missing** — no correlation tracking |
| Agent loop flow | ✅ | task → prompt → LLM → tool calls → events → iterate |
| Iteration budget enforced | ✅ | `max_iterations` shared across the turn (not per-call) |
| Graceful tool error handling | ✅ | exceptions caught, returned as `ToolResult(is_error=True)` |

**Gap detail:** `RavnEvent` currently has `type`, `data`, and `metadata` fields. The
architecture spec calls for `type`, `source`, `payload`, `timestamp`, `urgency`, and
`correlation_id`. The `data` field maps to `payload` by intent but the field name
diverges. The four missing fields (`source`, `timestamp`, `urgency`, `correlation_id`)
are needed for distributed tracing and multi-agent orchestration.

---

### Configuration System (`config.py`)

| Item | Status | Notes |
|------|--------|-------|
| Precedence: env > … | ✅ | `RAVN_` prefix env vars take highest precedence |
| Precedence: project (.ravn.yaml) | ⚠️ | Config searches `./ravn.yaml` (no dot prefix), not `.ravn.yaml` |
| Precedence: yaml (~/.ravn/config.yaml) | ✅ | User config at `~/.ravn/config.yaml` |
| Precedence: defaults | ✅ | Pydantic defaults are the fallback |
| Precedence order project > user | ❌ | **Wrong order** — config searches `~/.ravn/config.yaml` before `./ravn.yaml`; user config should be lower priority than project config |
| Dynamic adapter loading | ✅ | `LLMProviderConfig.adapter` is a fully-qualified class path |
| `RAVN_` prefix with `__` nesting | ✅ | `env_prefix="RAVN_"`, `env_nested_delimiter="__"` |
| Pydantic rejects invalid configs | ✅ | `BaseSettings` + typed fields; invalid values raise `ValidationError` |

**Gap detail:** The specified precedence order is
`env > project (.ravn.yaml / RAVN.md) > yaml (~/.ravn/config.yaml) > defaults`.
Current search order in `_DEFAULT_CONFIG_PATHS` is:
1. `~/.ravn/config.yaml`
2. `./ravn.yaml`
3. `/etc/ravn/config.yaml`

This means the user-level config file takes precedence over the project-local config,
which is inverted from the spec. Additionally, the project-local file is `./ravn.yaml`
not `./.ravn.yaml` (hidden file per spec). Note: `.ravn.yaml` is already discovered by
`context.py` for system prompt injection — the config system should also check it.

---

### Hexagonal Architecture

| Item | Status | Notes |
|------|--------|-------|
| Domain imports from ports only | ✅ | `agent.py`, `context.py` import only from `domain.*` and `ports.*` |
| Adapters import from ports only | ✅ | All adapters implement their port interface and import no other adapters |
| CLI is composition root | ✅ | `cli/commands.py` wires LLM + channel + permission + agent |
| `plugin.py` is composition root | ❌ | **Missing** — no `plugin.py` exists; only CLI entry point |
| New LLM adapter: zero changes outside `adapters/llm/` | ⚠️ | `adapters/llm/` subdirectory does not exist; LLM adapters are flat in `adapters/`. The principle holds (a new class works without touching other files) but the directory structure diverges from spec |

---

### LLM Adapters

| Item | Status | Notes |
|------|--------|-------|
| `AnthropicAdapter`: Messages API | ✅ | Uses `/v1/messages` endpoint with correct headers |
| `AnthropicAdapter`: streaming | ✅ | SSE streaming with `httpx` |
| `AnthropicAdapter`: tool_use blocks | ✅ | Parses `tool_use` content blocks, accumulates partial JSON |
| `AnthropicAdapter`: extended thinking passthrough | ❌ | **Missing** — no `thinking` parameter in `_build_request()` |
| `OpenAICompatAdapter` | ❌ | **Missing** — not implemented |
| `FallbackAdapter` | ❌ | **Missing** — config has `llm.fallbacks` list but no adapter to use it |

**Gap detail:** `OpenAICompatAdapter` (for Ollama, vLLM, TGI) and `FallbackAdapter`
(cascading fallback chain) are both absent. The `Settings.llm.fallbacks` config field
exists but is unused — there is no code that reads it and instantiates the chain.

---

### Channel Adapters

| Item | Status | Notes |
|------|--------|-------|
| `CliChannel`: renders THOUGHT | ✅ | Streams text inline with `end=""` |
| `CliChannel`: renders TOOL_START | ✅ | `⚙ tool_name(args)` prefix |
| `CliChannel`: renders TOOL_RESULT | ✅ | `✓`/`✗` prefix with truncation |
| `CliChannel`: renders RESPONSE | ✅ | Emits newline to close stream |
| `CliChannel`: renders ERROR | ✅ | `[error]` prefix |
| `CliChannel`: renders DECISION | ❌ | **No handler** — DECISION missing from enum and unhandled in `CliChannel.emit()` |
| `CliChannel`: streaming output | ✅ | `flush=True` on THOUGHT events |
| `CliChannel`: no buffering | ✅ | Writes synchronously per event |
| Standalone mode routes to `CliChannel` | ✅ | `cli/commands.py` wires `CliChannel` directly |

---

### Tool Registry

| Item | Status | Notes |
|------|--------|-------|
| Registry discovers tools from config | ❌ | **Not wired** — `cli/commands.py` passes `tools=[]`; `ToolsConfig` is defined but not used to instantiate tools |
| Tool interface contract (`ports/tool.py`) | ✅ | Clean: `name`, `description`, `input_schema`, `required_permission`, `execute()` |
| File tool: `read_file` | ✅ | Implemented in `adapters/file_tools.py` |
| File tool: `write_file` | ✅ | Implemented |
| File tool: `edit_file` | ✅ | Implemented |
| File tool: `glob_search` | ✅ | Implemented |
| File tool: `grep_search` | ✅ | Implemented |

**Gap detail:** `ToolRegistry` exists and is well-implemented, but the CLI composition
root in `cli/commands.py` always passes an empty `tools=[]` to `RavnAgent`. The
`ToolsConfig` (with `enabled`, `disabled`, `custom` lists) is never used to populate
the registry. A wiring layer between config → registry → agent is missing.

---

## Gaps Summary

The following issues are tracked as child tickets blocked by NIU-489:

| # | Gap | Severity | Suggested ticket |
|---|-----|----------|-----------------|
| 1 | `DECISION` event type missing from `RavnEventType` | Medium | NIU-489-1 |
| 2 | `RavnEvent` field contract incomplete (`source`, `payload`, `timestamp`, `urgency`, `correlation_id`) | Medium | NIU-489-2 |
| 3 | Config precedence inverted: user config searched before project config; `.ravn.yaml` filename mismatch | Low | NIU-489-3 |
| 4 | `OpenAICompatAdapter` not implemented | High | NIU-489-4 |
| 5 | `FallbackAdapter` not implemented | High | NIU-489-5 |
| 6 | `AnthropicAdapter` missing extended thinking passthrough | Medium | NIU-489-6 |
| 7 | No `plugin.py` composition root | Low | NIU-489-7 |
| 8 | `adapters/llm/` subdirectory not created; adapters are flat | Low | NIU-489-8 |
| 9 | Tool registry not wired from config in CLI | High | NIU-489-9 |

---

## What Is Working Well

- **Core agent loop** — the turn-based loop with streaming, tool execution, and
  permission enforcement is solid and well-tested.
- **Hexagonal architecture** — clean port/adapter separation; business logic never
  imports infrastructure directly.
- **Config system** — Pydantic + pydantic-settings with YAML + env override is
  well-designed. The `RAVN_` prefix with `__` nesting works correctly.
- **File tools** — all five file tools are implemented with proper workspace
  sandboxing, binary detection, and size limits.
- **Project context discovery** — deduplication, injection detection, and budget
  enforcement are all correct.
- **ToolRegistry** — clean implementation with schema validation and safe dispatch.
- **AnthropicAdapter** — prompt caching, streaming, partial JSON accumulation, and
  retry logic are all implemented correctly.
- **CliChannel** — correctly handles all existing event types with clean formatting.

---

## Test Coverage at Time of Audit

Coverage: **44%** (target: 85%)

| Module | Coverage | Action needed |
|--------|----------|--------------|
| `agent.py` | 97% | ✅ Good |
| `config.py` | 100% | ✅ Good |
| `domain/events.py` | 100% | ✅ Good |
| `domain/models.py` | 100% | ✅ Good |
| `ports/` | 100% | ✅ Good |
| `adapters/permission_adapter.py` | 85% | ✅ Acceptable |
| `adapters/cli_channel.py` | 76% | ⚠️ Needs more tests |
| `cli/commands.py` | 71% | ⚠️ Needs more tests |
| `domain/exceptions.py` | 76% | ⚠️ Needs more tests |
| `adapters/anthropic_adapter.py` | 12% | ❌ Needs tests |
| `context.py` | 0% | ❌ Needs tests |
| `registry.py` | 0% | ❌ Needs tests |
| `adapters/file_security.py` | 0% | ❌ Needs tests |
| `adapters/file_tools.py` | 0% | ❌ Needs tests |
| `__main__.py` | 0% | ❌ Needs test |

Tests for all uncovered modules have been added in this PR to bring coverage to ≥ 85%.
