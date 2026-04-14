# Ravn Mesh Demo Logs (Run 4 - 200 Iteration Budget)

**Date:** 2026-04-14 00:52-00:54 UTC

## Event Flow

```
test-publisher ──[code.changed]──► reviewer (mesh-2) ──[review.completed]──► deployer (mesh-3) ──[deploy.completed]
```

## Configuration

- All personas: iteration_budget: 200

## Timeline

| Time | Actor | Event |
|------|-------|-------|
| 00:52:21 | test-publisher | Started, registered in registry |
| 00:52:36 | ravn-mesh-2 | Received `code.changed`, started review task |
| 00:54:03 | ravn-mesh-2 | Hit 200 iteration limit, published `review.completed` |
| 00:54:03 | ravn-mesh-3 | Received `review.completed`, started deploy task |
| 00:54:20 | ravn-mesh-3 | Hit context length limit (122K tokens), published `deploy.completed` |

## Findings

1. **200 iterations still not enough** - The gemma model ran for 200 iterations without completing the task naturally.

2. **Context length becomes the limit** - After 200 iterations, the accumulated context exceeded the model's 131K token limit, causing the deployer to fail immediately.

3. **Event flow works regardless** - Despite both tasks failing (iteration limit, context limit), outcome events were still published and the chain completed.

## Components

- **Transport:** nng IPC (pynng)
- **LLM:** vLLM (google/gemma-4-26B-A4B-it) - 131K context limit
