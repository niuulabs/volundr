#!/usr/bin/env bash
# Download VS Code Remote Extension Host (REH) binary matching the
# @codingame/monaco-vscode-api npm package version.
#
# Usage: ./download-reh.sh [output-dir]
#
# The commit hash is read from the installed npm package to ensure
# client and server are from the same VS Code build. If the pinned
# commit's REH binary is unavailable, falls back to the latest stable.

set -euo pipefail

OUTPUT_DIR="${1:-/opt/vscode-reh}"
ARCH="${ARCH:-linux-x64}"
PRODUCT_JS="node_modules/@codingame/monaco-vscode-api/vscode/product.json.js"

if [ ! -f "$PRODUCT_JS" ]; then
  echo "ERROR: $PRODUCT_JS not found." >&2
  echo "Run 'npm install' in the web/ directory first." >&2
  exit 1
fi

# The commit hash is embedded in the webviewContentExternalBaseUrlTemplate URL
# inside the product.json.js file, in the pattern /insider/<commit>/out/
COMMIT=$(grep -oP '(?<=/insider/)[0-9a-f]{40}(?=/)' "$PRODUCT_JS" | head -1)
if [ -z "$COMMIT" ]; then
  echo "ERROR: Could not extract VS Code commit hash from $PRODUCT_JS" >&2
  exit 1
fi

echo "VS Code commit: $COMMIT"
echo "Architecture:   $ARCH"
echo "Output:         $OUTPUT_DIR"

mkdir -p "$OUTPUT_DIR"

# Try the pinned commit first, fall back to latest stable if unavailable.
# The OSS commit embedded in @codingame packages may not have a matching
# REH binary on Microsoft's update server — only official VS Code release
# commits are guaranteed to be available.
COMMIT_URL="https://update.code.visualstudio.com/commit:${COMMIT}/server-${ARCH}/stable"
LATEST_URL="https://update.code.visualstudio.com/latest/server-${ARCH}/stable"

echo "Trying pinned commit: $COMMIT_URL"
if curl -fsSL "$COMMIT_URL" -o /tmp/reh.tar.gz 2>/dev/null; then
  echo "Downloaded REH for pinned commit"
else
  echo "WARN: Pinned commit not available, falling back to latest stable"
  echo "Downloading from: $LATEST_URL"
  curl -fsSL "$LATEST_URL" -o /tmp/reh.tar.gz
fi

tar -xz -C "$OUTPUT_DIR" --strip-components=1 -f /tmp/reh.tar.gz
rm -f /tmp/reh.tar.gz

echo "REH server installed to $OUTPUT_DIR"
echo "Start with: $OUTPUT_DIR/bin/code-server-oss --host 0.0.0.0 --port 8445 --without-connection-token"
