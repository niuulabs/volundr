#!/usr/bin/env bash
# setup-visual-baselines.sh
#
# Copies web2 prototype screenshots into the Playwright snapshot directories
# so that `pnpm test:visual` compares web-next against web2 — not against itself.
#
# Workflow:
#   1. pnpm capture-baselines     # screenshot every web2 view
#   2. bash scripts/setup-visual-baselines.sh   # copy into snapshot dirs
#   3. pnpm test:visual           # compare web-next vs web2
#
# The naming convention for Playwright snapshots is:
#   e2e/visual/{spec}-snapshots/{name}-chromium-darwin.png

set -euo pipefail

WEB2="e2e/__screenshots__/web2"
SUFFIX="chromium-darwin"

copy() {
  local src="$1" dst_dir="$2" dst_name="$3"
  if [[ ! -f "$src" ]]; then
    echo "  SKIP (missing) $src"
    return
  fi
  mkdir -p "$dst_dir"
  cp "$src" "$dst_dir/${dst_name}-${SUFFIX}.png"
  echo "  OK   $dst_name"
}

echo "=== Login ==="
DST="e2e/visual/login.visual.spec.ts-snapshots"
copy "$WEB2/login/login-page.png"         "$DST" "login-page"

echo "=== Observatory ==="
DST="e2e/visual/observatory.visual.spec.ts-snapshots"
copy "$WEB2/observatory/canvas.png"                "$DST" "observatory-canvas"
copy "$WEB2/observatory/registry-types.png"        "$DST" "observatory-registry-types"
copy "$WEB2/observatory/registry-containment.png"  "$DST" "observatory-registry-containment"
copy "$WEB2/observatory/registry-json.png"         "$DST" "observatory-registry-json"

echo "=== Ravn ==="
DST="e2e/visual/ravn.visual.spec.ts-snapshots"
copy "$WEB2/ravn/overview.png"       "$DST" "ravn-overview"
copy "$WEB2/ravn/ravens-split.png"   "$DST" "ravn-ravens-split"
copy "$WEB2/ravn/sessions.png"       "$DST" "ravn-sessions"
copy "$WEB2/ravn/budget.png"         "$DST" "ravn-budget"
copy "$WEB2/ravn/personas.png"       "$DST" "ravn-personas"

echo "=== Tyr ==="
DST="e2e/visual/tyr.visual.spec.ts-snapshots"
copy "$WEB2/tyr/dashboard.png"    "$DST" "tyr-dashboard"
copy "$WEB2/tyr/sagas.png"        "$DST" "tyr-sagas-list"
copy "$WEB2/tyr/workflows.png"    "$DST" "tyr-workflows"
copy "$WEB2/tyr/plan.png"         "$DST" "tyr-plan"
copy "$WEB2/tyr/dispatch.png"     "$DST" "tyr-dispatch"
copy "$WEB2/tyr/settings.png"     "$DST" "tyr-settings"

echo "=== Mimir ==="
DST="e2e/visual/mimir.visual.spec.ts-snapshots"
copy "$WEB2/mimir/home.png"        "$DST" "mimir-overview"
copy "$WEB2/mimir/pages-tree.png"  "$DST" "mimir-pages-tree"
copy "$WEB2/mimir/search.png"      "$DST" "mimir-search"
copy "$WEB2/mimir/graph.png"       "$DST" "mimir-graph"
copy "$WEB2/mimir/ravns.png"       "$DST" "mimir-ravns"
copy "$WEB2/mimir/lint.png"        "$DST" "mimir-lint"
copy "$WEB2/mimir/ingest.png"      "$DST" "mimir-ingest"
copy "$WEB2/mimir/log.png"         "$DST" "mimir-dreams"

echo "=== Volundr ==="
DST="e2e/visual/volundr.visual.spec.ts-snapshots"
copy "$WEB2/volundr/forge-overview.png"  "$DST" "volundr-forge-overview"
copy "$WEB2/volundr/templates.png"       "$DST" "volundr-templates"
copy "$WEB2/volundr/clusters.png"        "$DST" "volundr-clusters"
copy "$WEB2/volundr/sessions.png"        "$DST" "volundr-sessions"

echo ""
echo "Done. Tests without a web2 counterpart (mimir-pages-reader, mimir-sources,"
echo "mimir-entities, tyr-saga-detail, volundr-session-chat) will auto-generate"
echo "self-referential baselines on first run."
