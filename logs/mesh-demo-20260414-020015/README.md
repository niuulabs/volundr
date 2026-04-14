# Ravn Mesh Demo Logs (Run 7 - All Fixes Applied)

**Date:** 2026-04-14 01:57-02:00 UTC

## Fixes Applied

1. **Prompt builder identity fix** - System prompt now passed to PromptBuilder
2. **Outcome end marker** - Accepts `---` as well as `---end---`
3. **Reflection model** - Uses Qwen instead of unavailable haiku
4. **Stronger outcome instruction** - Explicit YAML format requirements

## Event Flow (SUCCESS)

```
test-publisher ──[code.changed]──► reviewer (mesh-2) ──[review.completed]──► security (mesh-3) ──[security.completed]
```

## Timeline

| Time | Actor | Event |
|------|-------|-------|
| 01:57:51 | test-publisher | Started |
| 01:57:58-59 | mesh nodes | Started and subscribed |
| 01:58:06 | mesh-2 | Received `code.changed`, started task |
| 01:59:14 | mesh-2 | **Outcome parsed: valid=True** |
| 01:59:28 | mesh-2 | Published `review.completed` |
| 01:59:28 | mesh-3 | Received `review.completed`, started task |
| 02:00:04 | mesh-3 | **Outcome parsed: valid=True** |

## Key Results

### System Prompt Fix Verified
```
system_prompt_blocks: 1 blocks  (was 0 blocks before fix)
```

### Reviewer Outcome (valid=True)
```json
{
  "verdict": "pass",
  "comments": "Hello function was successfully created as part of the code change..."
}
```

### Security Outcome (valid=True)
```json
{
  "verdict": "secure",
  "findings_count": 0,
  "summary": "Successfully handled review.completed event with security checks..."
}
```

## Summary

All fixes working:
- Persona system prompt with outcome instruction reaches the LLM
- Model follows YAML format for outcome blocks
- Outcome parsing succeeds with correct field extraction
- Event routing propagates correctly through mesh
