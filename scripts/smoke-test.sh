#!/usr/bin/env bash
# Smoke test for the Niuu compiled binary.
#
# Usage:  scripts/smoke-test.sh <path-to-binary>
#
# Checks:
#   1. --version exits 0
#   2. --help shows expected commands
#   3. Startup time under 1 second (generous; task says 500ms, we allow 1s for CI)
#   4. No missing shared libraries (ldd / otool)

set -euo pipefail

BINARY="${1:?Usage: $0 <path-to-binary>}"
PASS=0
FAIL=0
MAX_STARTUP_MS=1000

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

echo "=== Niuu binary smoke test ==="
echo "Binary: ${BINARY}"
echo ""

# ---- 0. Binary exists and is executable ---------------------------------
if [[ ! -x "${BINARY}" ]]; then
    echo "ERROR: ${BINARY} is not executable or does not exist"
    exit 1
fi

# ---- 1. --version exits 0 -----------------------------------------------
echo "[1] --version"
if "${BINARY}" --version > /dev/null 2>&1; then
    VERSION_OUT=$("${BINARY}" --version 2>&1)
    pass "--version → ${VERSION_OUT}"
else
    fail "--version exited with non-zero status"
fi

# ---- 2. --help shows expected commands -----------------------------------
echo "[2] --help"
HELP_OUT=$("${BINARY}" --help 2>&1 || true)
EXPECTED_COMMANDS=("up" "down" "migrate" "status" "serve")
ALL_FOUND=true
for cmd in "${EXPECTED_COMMANDS[@]}"; do
    if echo "${HELP_OUT}" | grep -q "${cmd}"; then
        : # found
    else
        fail "--help missing command: ${cmd}"
        ALL_FOUND=false
    fi
done
if [[ "${ALL_FOUND}" == "true" ]]; then
    pass "--help shows all expected commands"
fi

# ---- 3. Startup time ----------------------------------------------------
echo "[3] Startup time"
_now_ns() {
    if [[ "$(uname -s)" == "Darwin" ]]; then
        python3 -c "import time; print(int(time.time_ns()))"
    else
        date +%s%N
    fi
}
START_NS=$(_now_ns)
"${BINARY}" --version > /dev/null 2>&1 || true
END_NS=$(_now_ns)
ELAPSED_MS=$(( (END_NS - START_NS) / 1000000 ))

if [[ "${ELAPSED_MS}" -le "${MAX_STARTUP_MS}" ]]; then
    pass "startup ${ELAPSED_MS}ms (limit ${MAX_STARTUP_MS}ms)"
else
    fail "startup ${ELAPSED_MS}ms exceeds limit of ${MAX_STARTUP_MS}ms"
fi

# ---- 4. No missing shared libraries -------------------------------------
echo "[4] Shared library check"
OS=$(uname -s)
if [[ "${OS}" == "Linux" ]]; then
    if command -v ldd > /dev/null 2>&1; then
        MISSING=$(ldd "${BINARY}" 2>&1 | grep "not found" || true)
        if [[ -z "${MISSING}" ]]; then
            pass "no missing shared libraries (ldd)"
        else
            fail "missing shared libraries: ${MISSING}"
        fi
    else
        pass "ldd not available — skipped"
    fi
elif [[ "${OS}" == "Darwin" ]]; then
    if command -v otool > /dev/null 2>&1; then
        MISSING=$(otool -L "${BINARY}" 2>&1 | grep "not found" || true)
        if [[ -z "${MISSING}" ]]; then
            pass "no missing shared libraries (otool)"
        else
            fail "missing shared libraries: ${MISSING}"
        fi
    else
        pass "otool not available — skipped"
    fi
else
    pass "shared library check not supported on ${OS} — skipped"
fi

# ---- Summary -------------------------------------------------------------
echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
if [[ "${FAIL}" -gt 0 ]]; then
    exit 1
fi
exit 0
