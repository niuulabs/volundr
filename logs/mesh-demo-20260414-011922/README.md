# Ravn Mesh Demo Logs (Run 4 - Qwen + stop_on_outcome)

**Date:** 2026-04-14 01:17-01:18 UTC

## Changes in This Run

1. **Model**: Switched from gemma to `Qwen/Qwen3-Coder-30B-A3B-Instruct`
2. **stop_on_outcome**: Enabled for reviewer and deployer personas
3. **Tool filtering**: Fixed cascade tools leak (filtered by persona's allowed_tools)
4. **Mimir**: Added local + shared instance config

## Event Flow

```
test-publisher ──[code.changed]──► reviewer (mesh-2) ──[review.completed]──► deployer (mesh-3) ──[deploy.completed]
```

## Timeline

| Time | Actor | Event |
|------|-------|-------|
| 01:17:13 | test-publisher | Started, registered in registry |
| 01:17:21-23 | ravn-mesh-1 | Started (coder) |
| 01:17:24 | ravn-mesh-2 | Started (reviewer), subscribed to `code.changed` |
| 01:17:25 | ravn-mesh-3 | Started (deployer), subscribed to `review.completed` |
| 01:17:28 | test-publisher | Published `code.changed` event |
| 01:17:28 | ravn-mesh-2 | Received `code.changed`, started review task |
| 01:17:47 | ravn-mesh-2 | **Completed review** (19 seconds), published `review.completed` |
| 01:17:47 | ravn-mesh-3 | Received `review.completed`, started deploy task |
| 01:18:06 | ravn-mesh-3 | Hit 10 iteration limit, published `deploy.completed` |

## Key Observations

### Reviewer (SUCCESS)
- Completed task in ~19 seconds (7 LLM calls)
- Qwen model followed instructions better than gemma
- Output shows outcome block was produced

### Deployer (HIT LIMIT)
- Hit 10 iteration limit (too low for Qwen's verbosity)
- Still published `deploy.completed` event (flow continued)
- Note: Reflection failed due to claude-haiku not available on vLLM

## Issues Found

1. **Reflection model misconfigured**: `claude-haiku-4-5-20251001` not available on vLLM
2. **Deployer iteration budget too low**: 10 iterations insufficient

## Components

- **Transport:** nng IPC (pynng)
- **Discovery:** ServiceRegistry (JSON file)
- **LLM:** vLLM (Qwen/Qwen3-Coder-30B-A3B-Instruct)
- **Mimir:** Local + shared instances configured
