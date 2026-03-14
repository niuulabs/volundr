#!/usr/bin/env bash
# Download VS Code Remote Extension Host (REH) binary matching the
# @codingame/monaco-vscode-api npm package version.
#
# Usage: ./download-reh.sh [output-dir]
#
# The commit hash is read from the installed npm package to ensure
# client and server are from the same VS Code build.

set -euo pipefail

OUTPUT_DIR="${1:-/opt/vscode-reh}"
ARCH="${ARCH:-linux-x64}"
PACKAGE_JSON="node_modules/@codingame/monaco-vscode-api/package.json"

if [ ! -f "$PACKAGE_JSON" ]; then
  echo "ERROR: $PACKAGE_JSON not found." >&2
  echo "Run 'npm install' in the web/ directory first." >&2
  exit 1
fi

COMMIT=$(jq -r '.config.vscode.commit // empty' "$PACKAGE_JSON")
if [ -z "$COMMIT" ]; then
  echo "ERROR: Could not read .config.vscode.commit from $PACKAGE_JSON" >&2
  exit 1
fi

echo "VS Code commit: $COMMIT"
echo "Architecture:   $ARCH"
echo "Output:         $OUTPUT_DIR"

mkdir -p "$OUTPUT_DIR"

# Download from Microsoft's official update endpoint
URL="https://update.code.visualstudio.com/commit:${COMMIT}/server-${ARCH}/stable"
echo "Downloading from: $URL"

curl -fsSL "$URL" | tar -xz -C "$OUTPUT_DIR" --strip-components=1

echo "REH server installed to $OUTPUT_DIR"
echo "Start with: $OUTPUT_DIR/bin/code-server-oss --host 0.0.0.0 --port 8445 --without-connection-token"
