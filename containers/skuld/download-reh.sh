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

# Download from Microsoft's official update endpoint
URL="https://update.code.visualstudio.com/commit:${COMMIT}/server-${ARCH}/stable"
echo "Downloading from: $URL"

curl -fsSL "$URL" | tar -xz -C "$OUTPUT_DIR" --strip-components=1

echo "REH server installed to $OUTPUT_DIR"
echo "Start with: $OUTPUT_DIR/bin/code-server-oss --host 0.0.0.0 --port 8445 --without-connection-token"
