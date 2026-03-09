#!/bin/bash
# Hook: Run tests and lint before Claude stops
# This ensures code quality before ending the session

set -e

cd "$CLAUDE_PROJECT_DIR"

echo "========================================"
echo "Running pre-stop quality checks..."
echo "========================================"

# Track failures
LINT_PASSED=true
TEST_PASSED=true

# Run linter via tox
echo ""
echo "Running linter (tox -e linters)..."
echo "----------------------------------------"
if command -v tox &> /dev/null; then
    if tox -e linters 2>&1; then
        echo "Linter: PASSED"
    else
        echo "Linter: FAILED"
        LINT_PASSED=false
    fi
else
    echo "tox not found, trying make lint..."
    if make lint 2>&1; then
        echo "Linter: PASSED"
    else
        echo "Linter: FAILED"
        LINT_PASSED=false
    fi
fi

# Run quick tests
echo ""
echo "Running tests (tox -e py310)..."
echo "----------------------------------------"
if command -v tox &> /dev/null; then
    if tox -e py310 2>&1; then
        echo "Tests: PASSED"
    else
        echo "Tests: FAILED"
        TEST_PASSED=false
    fi
else
    echo "tox not found, trying pytest..."
    if command -v pytest &> /dev/null; then
        if pytest --tb=short 2>&1; then
            echo "Tests: PASSED"
        else
            echo "Tests: FAILED"
            TEST_PASSED=false
        fi
    else
        echo "No test runner found, skipping tests"
    fi
fi

# Summary
echo ""
echo "========================================"
if [ "$LINT_PASSED" = true ] && [ "$TEST_PASSED" = true ]; then
    echo "All quality checks PASSED"
else
    echo "Some quality checks FAILED:"
    [ "$LINT_PASSED" = false ] && echo "  - Linter failed"
    [ "$TEST_PASSED" = false ] && echo "  - Tests failed"
    echo ""
    echo "Please review and fix before committing."
fi
echo "========================================"

# Exit 0 to not block stopping (warnings only)
exit 0
