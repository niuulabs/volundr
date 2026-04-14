# Ravn Mesh Demo Logs (Run 3)

**Date:** 2026-04-14 00:47-00:48 UTC

## Event Flow (Successful)

```
test-publisher ──[code.changed]──► reviewer (mesh-2) ──[review.completed]──► deployer (mesh-3) ──[deploy.completed]
```

## Persona Iteration Budgets

- coder: 30
- reviewer: 20
- deployer: 15

## Timeline

| Time | Actor | Event |
|------|-------|-------|
| 00:47:06 | test-publisher | Started, registered in registry |
| 00:47:10 | ravn-mesh-1 | Started (coder) |
| 00:47:12 | ravn-mesh-2 | Started (reviewer), subscribed to `code.changed` |
| 00:47:16 | ravn-mesh-3 | Started (deployer), subscribed to `review.completed` |
| 00:47:21 | test-publisher | Published `code.changed` event |
| 00:47:21 | ravn-mesh-2 | Received `code.changed`, started review task |
| 00:47:38 | ravn-mesh-2 | Hit 20 iteration limit, published `review.completed` |
| 00:47:38 | ravn-mesh-3 | Received `review.completed`, started deploy task |
| 00:48:23 | ravn-mesh-3 | Hit 15 iteration limit, published `deploy.completed` |

## Summary

The mesh event flow works correctly:
1. Events propagate between nodes via nng IPC transport
2. Persona `consumes` config triggers task execution on matching events
3. Persona `produces` config publishes outcome events after task completion
4. **Events are published regardless of whether tasks succeed or fail**

The iteration limits are hit because the gemma model doesn't efficiently complete
the review/deploy tasks within the budget. This is expected behavior - the mesh
routing works correctly.

## Components

- **Transport:** nng IPC (pynng)
- **Discovery:** ServiceRegistry (JSON file)
- **LLM:** vLLM (google/gemma-4-26B-A4B-it)
