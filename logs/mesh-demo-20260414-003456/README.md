# Ravn Mesh Demo Logs (Run 2 - Higher Iteration Budgets)

**Date:** 2026-04-14 00:33-00:34 UTC

## Event Flow

```
test-publisher ──[code.changed]──► reviewer (mesh-2) ──[review.completed]──► deployer (mesh-3) ──[deploy.completed]
```

## Configuration Changes

Increased iteration budgets in persona configs:
- coder: 10 → 30
- reviewer: 5 → 20
- deployer: 3 → 15

## Timeline

| Time | Actor | Event |
|------|-------|-------|
| 00:33:32 | test-publisher | Started, registered in registry |
| 00:33:41 | ravn-mesh-1 | Started (coder) |
| 00:33:44 | ravn-mesh-2 | Started (reviewer), subscribed to `code.changed` |
| 00:33:45 | ravn-mesh-3 | Started (deployer), subscribed to `review.completed` |
| 00:33:47 | test-publisher | Published `code.changed` event |
| 00:33:47 | ravn-mesh-2 | Received `code.changed`, started review task |
| 00:34:08 | ravn-mesh-2 | Hit 20 iteration limit, published `review.completed` |
| 00:34:08 | ravn-mesh-3 | Received `review.completed`, started deploy task |
| 00:34:43 | ravn-mesh-3 | Hit context length limit (122K tokens), published `deploy.completed` |

## Observations

1. **Iteration budgets were too low** - Original values (3, 5) caused immediate failures. Increased to 15-20 allowed more iterations but tasks still didn't complete within budget.

2. **Context length limit** - The deployer hit the model's 131K token context limit. This is a model limitation, not a code bug.

3. **Event flow works regardless of task success** - Even when tasks fail (iteration limit or context limit), outcome events are still published. This means the mesh routing works correctly.

## Components

- **Transport:** nng IPC (pynng)
- **Discovery:** ServiceRegistry (JSON file)
- **LLM:** vLLM (google/gemma-4-26B-A4B-it) - 131K context limit
- **Personas:** coder (30 iter), reviewer (20 iter), deployer (15 iter)
