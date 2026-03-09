#!/bin/bash
# Hook: Check file after edit/write
# Runs formatting checks on the edited file

set -e

# Read the hook input from stdin
INPUT=$(cat)

# Extract the file path from the tool input
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty')

# If no file path, exit successfully (nothing to check)
if [ -z "$FILE_PATH" ]; then
    exit 0
fi

# Only check Python files
if [[ ! "$FILE_PATH" =~ \.py$ ]]; then
    exit 0
fi

# Check if the file exists
if [ ! -f "$FILE_PATH" ]; then
    exit 0
fi

# Change to project directory
cd "$CLAUDE_PROJECT_DIR"

# Run checks if tools are available
ERRORS=""

# Check with black if available
if command -v black &> /dev/null; then
    if ! black --check --quiet "$FILE_PATH" 2>&1; then
        ERRORS="${ERRORS}Black format check failed for $FILE_PATH\n"
    fi
fi

# Check with isort if available
if command -v isort &> /dev/null; then
    if ! isort --check-only --quiet "$FILE_PATH" 2>&1; then
        ERRORS="${ERRORS}Isort import order check failed for $FILE_PATH\n"
    fi
fi

# Check with flake8 if available
if command -v flake8 &> /dev/null; then
    if ! flake8 "$FILE_PATH" 2>&1; then
        ERRORS="${ERRORS}Flake8 check failed for $FILE_PATH\n"
    fi
fi

# Report any errors (don't block, just warn)
if [ -n "$ERRORS" ]; then
    echo -e "$ERRORS" >&2
fi

exit 0
