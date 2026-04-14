# Ravn Mesh Demo - Feedback Loop Attempt

**Date:** 2026-04-14 02:28 UTC

## Goal
Create coder ↔ reviewer feedback loop where:
1. Reviewer finds bugs, returns needs_changes
2. Coder fixes bugs, produces code.changed
3. Loop until reviewer passes

## Result: Partial Success

### What Worked
- Reviewer correctly identified bugs in /tmp/hello.py
- Outcome: `verdict: needs_changes` with detailed comments about SQL injection, hardcoded secrets, bare except

### Issue Found: Mesh Discovery Race Condition
- Node 1 (coder) started first, discovered only 2 publishers
- Node 2 (reviewer) started later, discovered all 3 publishers
- When reviewer published review.completed, coder didn't receive it
- Coder wasn't subscribed to node-2's socket

### Reviewer's Findings
```json
{
  "verdict": "needs_changes",
  "comments": "File contains hardcoded credentials... SQL injection risk... bare except clause..."
}
```

## Fix Needed
Mesh needs to re-discover publishers after all nodes start, or use a broker pattern.
