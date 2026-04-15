# Mesh E2E Test Results

**Date:** 2026-04-15T01:30:15+00:00
**Result:** 6/6 steps passed

## Cascade Flow

```
test-publisher → code.changed ──→ reviewer (node 2) ──→ review.passed / review.changes_requested
                       │                                               ↓
                       └──→ security (node 3) ──→ security.passed / security.changes_requested
                                                                       ↓
                                                     coder (node 1) — only on .changes_requested
                                                                       ↓
                                                                  code.changed (fix applied)
```

## Steps

1. Reviewer received code.changed: PASS
2. Reviewer published verdict: PASS
3. Security received code.changed: PASS
4. Security published verdict: PASS

## Settle Status

- Reviewer: changes_requested=2, passed=2
- Security: changes_requested=2, passed=2
- Coder fixes: 2
- Settled: YES

## Error Check

- Node 1 errors: 0
0
- Node 2 errors: 0
0
- Node 3 errors: 1
- Tracebacks: 0
0
