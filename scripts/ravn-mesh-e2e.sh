#!/usr/bin/env bash
# End-to-end test for the Ravn mesh architecture.
#
# Tests the full event cascade:
#   test-publisher → code.changed → reviewer
#                                     ↓
#                              review.completed
#                                  ↓      ↓
#                               coder  security
#                                          ↓
#                              security.completed
#
# Usage:
#   scripts/ravn-mesh-e2e.sh          — run full e2e test
#   scripts/ravn-mesh-e2e.sh --quick  — just verify mesh starts and discovers
#
# Prerequisites:
#   - Python 3.12+ with ravn installed (or PYTHONPATH set)
#   - No other ravn processes running on the mesh ports

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

LOG_DIR="/tmp/ravn-mesh"
SAVE_DIR="${REPO_ROOT}/logs/mesh-e2e-$(date +%Y%m%d-%H%M%S)"
TIMEOUT_DISCOVERY=20
TIMEOUT_CASCADE=90
QUICK_MODE=false

# Parse args
[[ "${1:-}" == "--quick" ]] && QUICK_MODE=true

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

cleanup() {
    log_info "Cleaning up..."
    "${SCRIPT_DIR}/ravn-mesh.sh" stop 2>/dev/null || true
    # Kill any lingering test publisher
    pkill -f "test-mesh-publisher" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

log_info "=== Ravn Mesh E2E Test ==="
echo ""

# 1. Clean slate
log_info "Cleaning up previous runs..."
rm -rf /tmp/ravn-mesh/* 2>/dev/null || true
pkill -f "ravn daemon" 2>/dev/null || true
sleep 1

# 2. Start mesh
log_info "Starting 3-node mesh (coder, reviewer, security)..."
"${SCRIPT_DIR}/ravn-mesh.sh" start
echo ""

# 3. Wait for discovery
log_info "Waiting ${TIMEOUT_DISCOVERY}s for mesh discovery..."
sleep "${TIMEOUT_DISCOVERY}"

# 4. Verify all nodes running
log_info "Verifying nodes are running..."
node_count=$(pgrep -f "ravn daemon" | wc -l)
if [[ "${node_count}" -lt 3 ]]; then
    log_error "Expected 3 nodes, found ${node_count}"
    exit 1
fi
log_info "All 3 nodes running"

# 5. Check registry has all publishers
log_info "Checking service registry..."
if [[ -f "${LOG_DIR}/sleipnir-registry.json" ]]; then
    pub_count=$(grep -c '"pub_address"' "${LOG_DIR}/sleipnir-registry.json" 2>/dev/null || echo 0)
    log_info "Registry has ${pub_count} publishers"
else
    log_warn "Registry file not found (may be using mDNS only)"
fi

if $QUICK_MODE; then
    log_info "Quick mode — skipping cascade test"
    "${SCRIPT_DIR}/ravn-mesh.sh" stop
    log_info "=== QUICK TEST PASSED ==="
    exit 0
fi

# 6. Create and publish test event
log_info "Publishing test event (code.changed)..."

# Write test publisher inline
TEST_PUBLISHER=$(mktemp /tmp/test-mesh-publisher.XXXXXX.py)
cat > "${TEST_PUBLISHER}" << 'PYEOF'
#!/usr/bin/env python3
"""Test publisher for mesh e2e — publishes code.changed outcome event."""

import asyncio
import sys
from pathlib import Path
from datetime import datetime, UTC

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sleipnir.adapters.discovery import ServiceRegistry
from sleipnir.adapters.nng_transport import NngTransport
from sleipnir.domain.events import SleipnirEvent


async def main():
    print("Creating test publisher...")

    registry_path = Path("/tmp/ravn-mesh/sleipnir-registry.json")
    registry = ServiceRegistry(registry_path)

    transport = NngTransport(
        address="ipc:///tmp/ravn-mesh/test-pub.ipc",
        service_id="test-publisher",
        registry=registry,
    )

    await transport.start()
    print("Test publisher started and registered")

    print("Waiting 15 seconds for mesh nodes to discover and dial...")
    await asyncio.sleep(15)

    print("=== Publishing code.changed event ===")

    # IMPORTANT: Must be RavnEventType.OUTCOME format with proper payload structure
    event = SleipnirEvent(
        event_type="ravn.mesh.code.changed",
        source="ravn:test-publisher",
        payload={
            "ravn_event": {
                "event_type": "code.changed",
                "persona": "developer",
                "outcome": {
                    "file": "/tmp/hello.py",
                    "summary": "Test file with intentional bugs for review",
                    "changes": "Added initial code",
                },
            },
            "ravn_type": "outcome",  # MUST be "outcome" — handler filters on this
            "ravn_source": "ravn:test-publisher",
            "ravn_urgency": 0.8,
            "ravn_session_id": "",
            "ravn_task_id": "e2e-test-001",
        },
        summary="Code changed: /tmp/hello.py needs review",
        urgency=0.8,
        domain="code",
        timestamp=datetime.now(UTC),
        correlation_id="e2e-test-run",
    )

    await transport.publish(event)
    print("Event published!")

    print("Keeping alive for 60 seconds to observe event flow...")
    await asyncio.sleep(60)

    await transport.stop()
    print("Done")


if __name__ == "__main__":
    asyncio.run(main())
PYEOF

# Create test file for reviewer to inspect
cat > /tmp/hello.py << 'PYCODE'
import subprocess
import sqlite3

def get_user(user_id):
    conn = sqlite3.connect("users.db")
    query = f"SELECT * FROM users WHERE id = {user_id}"  # SQL injection
    return conn.execute(query).fetchone()

def run_command(cmd):
    subprocess.call(cmd, shell=True)  # Command injection

API_KEY = "sk-secret-12345"  # Hardcoded secret

def process():
    try:
        return get_user(1)
    except:  # Bare except
        pass
PYCODE

# Run test publisher
PYTHONPATH="${REPO_ROOT}/src" python "${TEST_PUBLISHER}" &
PUB_PID=$!

# 7. Wait and monitor cascade
log_info "Monitoring cascade (timeout: ${TIMEOUT_CASCADE}s)..."

cascade_complete=false
start_time=$(date +%s)

while true; do
    elapsed=$(($(date +%s) - start_time))

    if [[ $elapsed -gt $TIMEOUT_CASCADE ]]; then
        log_error "Cascade timeout after ${TIMEOUT_CASCADE}s"
        break
    fi

    # Check for review.completed in reviewer log
    if grep -q "publishing outcome event_type=review.completed" "${LOG_DIR}/ravn-mesh-2.log" 2>/dev/null; then
        log_info "Reviewer published review.completed"

        # Check for security.completed
        if grep -q "publishing outcome event_type=security.completed" "${LOG_DIR}/ravn-mesh-3.log" 2>/dev/null; then
            log_info "Security published security.completed"
            cascade_complete=true
            break
        fi
    fi

    sleep 2
done

# Kill test publisher
kill $PUB_PID 2>/dev/null || true

# 8. Verify cascade
echo ""
log_info "=== Cascade Results ==="

# Check each step
steps_passed=0
steps_total=4

# Step 1: Reviewer received code.changed
if grep -q "mesh: received outcome event_type=code.changed" "${LOG_DIR}/ravn-mesh-2.log" 2>/dev/null; then
    log_info "1. Reviewer received code.changed"
    steps_passed=$((steps_passed + 1))
else
    log_error "1. Reviewer did NOT receive code.changed"
fi

# Step 2: Reviewer published review.completed
if grep -q "publishing outcome event_type=review.completed" "${LOG_DIR}/ravn-mesh-2.log" 2>/dev/null; then
    log_info "2. Reviewer published review.completed"
    steps_passed=$((steps_passed + 1))
else
    log_error "2. Reviewer did NOT publish review.completed"
fi

# Step 3: Coder received review.completed
if grep -q "mesh: received outcome event_type=review.completed" "${LOG_DIR}/ravn-mesh-1.log" 2>/dev/null; then
    log_info "3. Coder received review.completed"
    steps_passed=$((steps_passed + 1))
else
    log_error "3. Coder did NOT receive review.completed"
fi

# Step 4: Security received and processed
if grep -q "mesh: received outcome event_type=review.completed" "${LOG_DIR}/ravn-mesh-3.log" 2>/dev/null; then
    log_info "4. Security received review.completed"
    steps_passed=$((steps_passed + 1))
else
    log_error "4. Security did NOT receive review.completed"
fi

echo ""

# 9. Save logs
log_info "Saving logs to ${SAVE_DIR}..."
mkdir -p "${SAVE_DIR}"
cp "${LOG_DIR}"/*.log "${SAVE_DIR}/" 2>/dev/null || true
cp "${LOG_DIR}"/*.yaml "${SAVE_DIR}/" 2>/dev/null || true

# Write summary
cat > "${SAVE_DIR}/README.md" << EOF
# Mesh E2E Test Results

**Date:** $(date -Iseconds)
**Result:** ${steps_passed}/${steps_total} steps passed

## Cascade Flow

\`\`\`
test-publisher → code.changed → reviewer (node 2)
                                    ↓
                             review.completed
                                ↓      ↓
                             coder   security
                            (node 1) (node 3)
\`\`\`

## Steps

1. Reviewer received code.changed: $(grep -q "mesh: received outcome event_type=code.changed" "${LOG_DIR}/ravn-mesh-2.log" 2>/dev/null && echo "PASS" || echo "FAIL")
2. Reviewer published review.completed: $(grep -q "publishing outcome event_type=review.completed" "${LOG_DIR}/ravn-mesh-2.log" 2>/dev/null && echo "PASS" || echo "FAIL")
3. Coder received review.completed: $(grep -q "mesh: received outcome event_type=review.completed" "${LOG_DIR}/ravn-mesh-1.log" 2>/dev/null && echo "PASS" || echo "FAIL")
4. Security received review.completed: $(grep -q "mesh: received outcome event_type=review.completed" "${LOG_DIR}/ravn-mesh-3.log" 2>/dev/null && echo "PASS" || echo "FAIL")
EOF

echo ""

# 10. Final result
if [[ $steps_passed -eq $steps_total ]]; then
    log_info "=== E2E TEST PASSED (${steps_passed}/${steps_total}) ==="
    exit 0
else
    log_error "=== E2E TEST FAILED (${steps_passed}/${steps_total}) ==="
    exit 1
fi
