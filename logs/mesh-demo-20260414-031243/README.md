# Ravn Mesh Demo Logs (Run 9 - 3-Node Setup)

**Date:** 2026-04-14 03:10-03:12 UTC

## Configuration

3-node mesh with full feedback loop:
- **Node 1 (coder)**: Consumes `review.completed`, produces `code.changed`
- **Node 2 (reviewer)**: Consumes `code.changed`, produces `review.completed`
- **Node 3 (security)**: Consumes `review.completed`, produces `security.completed`

All nodes configured with `permission.workspace_root: /tmp` for file access.

## Event Flow

```
test-publisher ──[code.changed]──► reviewer
                                      │
                              [review.completed]
                                      │
                      ┌───────────────┴───────────────┐
                      ▼                               ▼
                   coder                          security
                      │                               │
              [code.changed]                [security.completed]
                      │
                      ▼
                  reviewer (re-review)
```

## Timeline

| Time | Node | Event |
|------|------|-------|
| 03:10:31 | mesh | All 3 nodes started |
| 03:10:40 | test-publisher | Published initial `code.changed` |
| 03:10:45 | reviewer | Received `code.changed`, started review |
| 03:10:59 | reviewer | **verdict=needs_changes** (5 bugs found) |
| 03:11:11 | reviewer | Published `review.completed` |
| 03:11:11 | coder | Received `review.completed`, started fixing |
| 03:11:11 | security | Received `review.completed`, started analysis |
| 03:11:59 | security | **verdict=vulnerable** (5 findings) |
| 03:12:08 | security | Published `security.completed` |
| 03:12:10 | coder | **files_changed=1** (fixed all issues) |
| 03:12:19 | coder | Published `code.changed` |
| 03:12:19 | reviewer | Received `code.changed`, started re-review |

## Node Outcomes

### Reviewer (First Pass)
```yaml
verdict: needs_changes
comments: |
  1. SQL injection vulnerability on line 8
  2. Missing input validation on line 12
  3. Hardcoded API key on line 15
  4. Bare except clause on lines 18-21
  5. Command injection vulnerability on line 28
```

### Security
```yaml
verdict: vulnerable
findings_count: 5
summary: Multiple security vulnerabilities identified in hello.py including 
         SQL injection, hardcoded secrets, input validation issues, bare 
         exception handling, and command injection vulnerabilities.
```

### Coder
```yaml
files_changed: 1
summary: Fixed multiple security vulnerabilities in hello.py including SQL 
         injection, command injection, hardcoded secrets, bare except clauses, 
         and missing input validation. Used parameterized queries, subprocess 
         instead of os.system, proper exception handling, and input validation.
```

## Summary

The 3-node mesh successfully demonstrates:
- Parallel event consumption (coder + security both receive `review.completed`)
- Independent analysis paths (security scans while coder fixes)
- Feedback loop continuation (reviewer re-reviews after coder publishes)
- Full persona-based tool access (`permission_mode: full_access`)
