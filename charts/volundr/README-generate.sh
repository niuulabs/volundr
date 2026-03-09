#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────
# README-generate.sh  –  Regenerate the Volundr Helm chart README
#
# This script extracts values from values.yaml and produces a
# comprehensive README.md with a full values table.
#
# Prerequisites:
#   - helm-docs (https://github.com/norwoodj/helm-docs)
#     brew install norwoodj/tap/helm-docs   # macOS
#     go install github.com/norwoodj/helm-docs/cmd/helm-docs@latest
#
# Usage:
#   cd charts/volundr
#   ./README-generate.sh
#
# How it works:
#   1. Checks for helm-docs binary
#   2. Runs helm-docs with the README.md.gotmpl template
#   3. Falls back to a yq-based extractor if helm-docs is unavailable
#
# The values.yaml file uses `# -- <description>` comments (the
# helm-docs convention) for every key. helm-docs reads these and
# populates the {{ .Values }} table in the template.
#
# To add a new value:
#   1. Add the key to values.yaml with a `# -- description` comment
#   2. Re-run this script
# ────────────────────────────────────────────────────────────────────
set -euo pipefail

CHART_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Option 1: helm-docs (preferred) ────────────────────────────────
if command -v helm-docs &>/dev/null; then
  echo "Using helm-docs to generate README.md ..."
  helm-docs \
    --chart-search-root="$CHART_DIR" \
    --template-files="README.md.gotmpl" \
    --output-file="README.md" \
    --sort-values-order=file
  echo "Done. README.md updated at $CHART_DIR/README.md"
  exit 0
fi

# ── Option 2: yq-based extraction ─────────────────────────────────
if command -v yq &>/dev/null; then
  echo "helm-docs not found. Falling back to yq-based extraction ..."
  echo ""
  echo "Extracting top-level keys and descriptions from values.yaml:"
  echo ""

  # Extract all "# -- " comments paired with their YAML keys
  awk '
    /^[[:space:]]*# -- / {
      desc = $0
      sub(/^[[:space:]]*# -- /, "", desc)
      getline
      if ($0 ~ /^[[:space:]]*[a-zA-Z]/) {
        key = $0
        sub(/:.*/, "", key)
        gsub(/^[[:space:]]+/, "", key)
        printf "| `%s` | %s |\n", key, desc
      }
    }
  ' "$CHART_DIR/values.yaml"

  echo ""
  echo "NOTE: For full README generation with tables, install helm-docs:"
  echo "  brew install norwoodj/tap/helm-docs"
  exit 0
fi

echo "ERROR: Neither helm-docs nor yq found."
echo ""
echo "Install helm-docs (recommended):"
echo "  brew install norwoodj/tap/helm-docs"
echo "  # or"
echo "  go install github.com/norwoodj/helm-docs/cmd/helm-docs@latest"
echo ""
echo "Install yq (fallback):"
echo "  brew install yq"
exit 1
