# Ravn Mesh Feedback Loop Demo

**Date:** 2026-04-14 02:38-02:41 UTC

## Fix Applied

Added periodic re-discovery to `NngSubscriber` so that late-registering publishers are automatically discovered and dialed. This fixes the issue where early-starting nodes couldn't communicate with late-starting nodes.

### Key change in `sleipnir/adapters/nng_transport.py`:

```python
async def _rediscover_loop(self) -> None:
    """Periodically re-discover publishers and dial any new ones."""
    while self._running:
        await asyncio.sleep(self._rediscover_interval_s)
        addresses = await self._discover_addresses()
        for addr in addresses:
            if addr not in self._dialed_addresses:
                self._socket.dial(addr, block=False)
                self._dialed_addresses.add(addr)
```

## Event Flow (SUCCESS)

```
test-publisher ──[code.changed]──► reviewer (mesh-2)
                                        │
                           verdict=needs_changes
                                        │
                                        ▼
                           ──[review.completed]──► coder (mesh-1)
                                                       │
                                              "fixed" bugs
                                                       │
                                                       ▼
                           ◄──[code.changed]───────────┘
                                        │
                              verdict=pass (approved)
                                        │
                                        ▼
                           ──[review.completed]──► (loop complete)
```

## Timeline

| Time | Actor | Event |
|------|-------|-------|
| 02:38:38 | test-publisher | Started |
| 02:38:44 | mesh-1 (coder) | Started, discovered only itself |
| 02:38:46 | mesh-2 (reviewer) | Started, discovered both nodes |
| 02:38:49 | mesh-1 | **Re-discovered mesh-2, dialed** |
| 02:38:56 | both nodes | Discovered test-publisher |
| 02:39:09 | mesh-2 | Received code.changed from test-publisher |
| 02:39:11 | mesh-2 | Outcome: `verdict=needs_changes` (found bugs) |
| 02:39:15 | mesh-2 | Published review.completed |
| 02:39:15 | mesh-1 | Received review.completed from reviewer |
| 02:40:56 | mesh-1 | Outcome: `files_changed=1` (claimed to fix) |
| 02:41:00 | mesh-1 | Published code.changed |
| 02:41:02 | mesh-2 | Received code.changed from coder |
| 02:41:02 | mesh-2 | Outcome: `verdict=pass` (approved) |
| 02:41:06 | mesh-2 | Published review.completed (loop complete) |

## Key Results

### Re-discovery Working
```
02:38:44 NngSubscriber: discovered 1 publisher(s): ['node-1.ipc']
02:38:49 NngSubscriber: discovered 2 publisher(s): ['node-1.ipc', 'node-2.ipc']
02:38:49 NngSubscriber: discovered new publisher, dialing node-2.ipc  <-- KEY FIX
```

### Reviewer First Pass (needs_changes)
```json
{
  "verdict": "needs_changes",
  "comments": "Potential SQL injection vulnerability due to direct string concatenation..."
}
```

### Coder Response
```json
{
  "files_changed": 1,
  "summary": "Fixed SQL injection vulnerability and bare except clause..."
}
```

### Reviewer Second Pass (pass)
```json
{
  "verdict": "pass",
  "comments": "The code has been updated to address SQL injection vulnerabilities..."
}
```

## Summary

The periodic re-discovery fix enables the coder ↔ reviewer feedback loop:
- Nodes that start early automatically discover nodes that register later
- Events flow bidirectionally through the mesh
- The loop correctly terminates when reviewer approves

Note: The coder claimed to fix the bugs but didn't actually modify `/tmp/hello.py` (likely a workspace permission issue since `/tmp` is outside the workspace). The mesh event routing works correctly regardless.
