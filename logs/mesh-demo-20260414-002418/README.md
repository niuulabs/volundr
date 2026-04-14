# Ravn Mesh Demo Logs

**Date:** 2026-04-14 00:23-00:24 UTC

## Event Flow

```
test-publisher ──[code.changed]──► reviewer (mesh-2) ──[review.completed]──► deployer (mesh-3) ──[deploy.completed]
```

## Timeline

| Time | Actor | Event |
|------|-------|-------|
| 00:23:28 | test-publisher | Started, registered in registry |
| 00:23:37 | ravn-mesh-1 | Started (coder) |
| 00:23:38 | ravn-mesh-2 | Started (reviewer), subscribed to `code.changed` |
| 00:23:41 | ravn-mesh-3 | Started (deployer), subscribed to `review.completed` |
| 00:23:43 | test-publisher | Published `code.changed` event |
| 00:23:43 | ravn-mesh-2 | Received `code.changed`, started review task |
| 00:23:47 | ravn-mesh-2 | Completed review, published `review.completed` |
| 00:23:47 | ravn-mesh-3 | Received `review.completed`, started deploy task |
| 00:24:09 | ravn-mesh-3 | Completed deploy, published `deploy.completed` |

## Components

- **Transport:** nng IPC (pynng)
- **Discovery:** ServiceRegistry (JSON file)
- **LLM:** vLLM (google/gemma-4-26B-A4B-it)
- **Personas:** coder, reviewer, deployer

## Files

- `test-publisher.log` - Test client that initiated the flow
- `ravn-mesh-1.log` - Coder node (no events consumed)
- `ravn-mesh-2.log` - Reviewer node (consumed code.changed)
- `ravn-mesh-3.log` - Deployer node (consumed review.completed)
- `ravn-mesh-*.yaml` - Node configurations
- `sleipnir-registry.json` - Service discovery registry
