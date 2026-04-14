---
name: mesh-e2e
description: Run end-to-end validation of the Ravn mesh architecture
---

# Ravn Mesh E2E Test

Validates the full mesh event cascade works correctly across all three personas.

## What It Tests (Closed Loop)

```
test-publisher → code.changed ──→ reviewer (node 2) ←──┐
                                       ↓               │
                                review.completed       │
                                   ↓      ↓            │
                                coder   security       │
                               (node 1) (node 3)       │
                                  ↓                    │
                             code.changed (fix) ───────┘
```

The test verifies:
1. Reviewer receives initial `code.changed`
2. Reviewer publishes `review.completed`
3. Coder receives `review.completed`
4. Coder applies fixes and publishes `code.changed`
5. Security receives `review.completed`
6. **Reviewer receives coder's fix (loop closes)**

Additionally checks for:
- ERROR level log entries in all nodes
- Python exceptions/tracebacks

## Quick Start

Run the automated e2e test:

```bash
scripts/ravn-mesh-e2e.sh
```

For a quick startup check (no cascade test):

```bash
scripts/ravn-mesh-e2e.sh --quick
```

## Manual Testing

If you need to run manually or debug:

### 1. Clean Previous Runs

```bash
pkill -f "ravn daemon" 2>/dev/null || true
rm -rf /tmp/ravn-mesh/*
```

### 2. Start the Mesh

```bash
scripts/ravn-mesh.sh start
```

Wait 15-20 seconds for mDNS discovery and nng subscriptions.

### 3. Verify Nodes Running

```bash
scripts/ravn-mesh.sh status
scripts/ravn-mesh.sh peers
```

### 4. Publish Test Event

The test event MUST be in `RavnEventType.OUTCOME` format:

```python
event = SleipnirEvent(
    event_type="ravn.mesh.code.changed",
    source="ravn:test-publisher",
    payload={
        "ravn_event": {
            "event_type": "code.changed",
            "persona": "developer",
            "outcome": {...},  # The actual outcome data
        },
        "ravn_type": "outcome",  # CRITICAL — handler filters on this
        "ravn_source": "ravn:test-publisher",
        "ravn_task_id": "test-001",
    },
    ...
)
```

Key requirements:
- `ravn_type` MUST be `"outcome"` (not `"request"`)
- `ravn_event` MUST contain `event_type`, `persona`, and `outcome` fields
- Publisher must wait 15s after registering for mesh nodes to discover and dial

### 5. Monitor Logs

```bash
scripts/ravn-mesh.sh logs
# Or watch specific node:
tail -f /tmp/ravn-mesh/ravn-mesh-2.log | grep -E "(mesh:|drive_loop:)"
```

### 6. Verify Cascade

Look for these log lines:

```
# Reviewer received event:
mesh: received outcome event_type=code.changed from=developer

# Reviewer processed and published:
drive_loop: publishing outcome event_type=review.completed

# Coder received:
mesh: received outcome event_type=review.completed from=reviewer

# Security received and processed:
mesh: received outcome event_type=review.completed from=reviewer
drive_loop: publishing outcome event_type=security.completed
```

### 7. Stop Mesh

```bash
scripts/ravn-mesh.sh stop
```

## Troubleshooting

### Events Not Received

1. **Wrong event format**: Must use `ravn_type: "outcome"` — the handler at `_handle_outcome_event` filters on this
2. **Publisher not discovered**: Wait 15 seconds after publisher starts — nng discovery polls every 5s
3. **Stale IPC sockets**: Clean with `rm -rf /tmp/ravn-mesh/*` and restart

### AddressInUse Errors

Previous mesh didn't clean up properly:

```bash
rm -rf /tmp/ravn-mesh/*.ipc
pkill -f "ravn daemon"
```

### Discovery Issues

Check if mDNS is working:

```bash
scripts/ravn-mesh.sh peers
```

Check service registry (nng mode):

```bash
cat /tmp/ravn-mesh/sleipnir-registry.json | python -m json.tool
```

## Logs Location

- Runtime logs: `/tmp/ravn-mesh/ravn-mesh-{1,2,3}.log`
- Saved test runs: `logs/mesh-e2e-YYYYMMDD-HHMMSS/`

## Related

- `scripts/ravn-mesh.sh` — mesh lifecycle management
- `docs/testing/mesh-e2e.md` — detailed test documentation
- `docs/site/ravn/advanced/flock.md` — architecture documentation
