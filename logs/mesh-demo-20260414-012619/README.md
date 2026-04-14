# Ravn Mesh Demo Logs (Run 5 - Security Persona + Debug Logging)

**Date:** 2026-04-14 01:24-01:25 UTC

## Changes in This Run

1. **Security persona**: Replaced deployer with security (consumes `review.completed`, produces `security.completed`)
2. **Debug logging**: Enabled to capture outcome block parsing
3. **Outcome logging**: Added debug logs for outcome block fields and validation errors

## Event Flow (SUCCESS)

```
test-publisher ──[code.changed]──► reviewer (mesh-2) ──[review.completed]──► security (mesh-3) ──[security.completed]
```

## Timeline

| Time | Actor | Event |
|------|-------|-------|
| 01:24:25 | test-publisher | Started, registered in registry |
| 01:24:33 | ravn-mesh-1 | Started (coder) |
| 01:24:35 | ravn-mesh-2 | Started (reviewer), subscribed to `code.changed` |
| 01:24:36 | ravn-mesh-3 | Started (security), subscribed to `review.completed` |
| 01:24:40 | test-publisher | Published `code.changed` event |
| 01:24:40 | ravn-mesh-2 | Received `code.changed`, started review task |
| 01:24:57 | ravn-mesh-2 | **Completed** (~17 seconds), published `review.completed` |
| 01:24:57 | ravn-mesh-3 | Received `review.completed`, started security task |
| 01:25:24 | ravn-mesh-3 | **Completed** (~27 seconds), published `security.completed` |

## Outcome Block Debug Output

### Reviewer Outcome
```
---outcome---
The hello.py file was successfully created and committed to a new branch called 
'feature/hello-function'. The commit has been made with the message 
"feat: Implement hello function as requested". The changes are ready for review and merging.
---
```

**Validation:** `valid=False` - YAML parse error (prose instead of key: value pairs)

### Security Outcome
```
---outcome---
The task "Handle review.completed from reviewer" has been completed successfully. 
The following changes were implemented:

1. Updated LLM model to Qwen3-Coder-30B-A3B-Instruct
2. Enabled Mimir with local and shared instances
3. Changed node role 3 from deployer to security
4. Added stop_on_outcome flag to persona configuration
5. Implemented early termination on outcome block detection
---
```

**Validation:** `valid=False` - YAML parse error (numbered list instead of key: value pairs)

## Key Observations

1. **Event flow works correctly** - All three events propagated successfully
2. **Both personas completed within budget** - No iteration limit errors
3. **Qwen model follows instructions** - Produces outcome blocks and stops
4. **Schema validation fails** - Model outputs prose instead of YAML key: value format

## Issue: Outcome Schema Not Followed

The Qwen model produces `---outcome---` markers but writes prose/lists instead of the expected YAML format:

**Expected:**
```yaml
---outcome---
verdict: pass
comments: Code looks good
---end---
```

**Actual:**
```yaml
---outcome---
The hello.py file was successfully created...
---
```

**Root cause:** System prompt needs stronger examples of the exact YAML format expected.

## Components

- **Transport:** nng IPC (pynng)
- **Discovery:** ServiceRegistry (JSON file)  
- **LLM:** vLLM (Qwen/Qwen3-Coder-30B-A3B-Instruct)
- **Logging:** DEBUG level
