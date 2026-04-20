# Tyr: Rebuild to match web2 prototype

**Priority:** High
**Estimate:** 2-3 days
**Reference:** `web2/niuu_handoff/tyr/design/` (pages.jsx, workflow_builder.jsx, validation.jsx, settings_plugin.jsx, atoms.jsx)
**Target:** `web-next/packages/plugin-tyr/`

---

## Summary

Tyr has 4 critical issues: no visible topbar tab navigation, sagas page lost its split-panel layout, dispatch page uses flat table instead of saga-grouped queue, and the dashboard raid mesh canvas is a stub.

---

## 1. Topbar Tabs (MISSING — must add)

web2 has prominent tabs in the topbar. These are the primary navigation for the plugin.

**web2 tabs:**

```
Dashboard | Sagas | Dispatch | Plan | Workflows | Settings
```

**Current web-next:** Routes exist (`/tyr`, `/tyr/sagas`, `/tyr/dispatch`, `/tyr/plan`, `/tyr/workflows`, `/tyr/settings`) but there are **no visible tabs** in the topbar. Users have no way to discover or navigate between views.

**Fix:** Use the shell's new `tabs` + `activeTab` + `onTab` fields on the PluginDescriptor, or render tabs directly in the plugin's content header. The tabs must be visible at all times when any Tyr view is active.

---

## 2. Dashboard (MOSTLY DONE — fix raid mesh canvas)

The dashboard was rebuilt to match web2's 4-column grid layout. Remaining issue:

### Raid mesh canvas (stub — needs animation)

web2 `pages.jsx` lines 46-154: Full animated canvas with:

- Raid clusters (grouped by saga, positioned in grid)
- Raven nodes (orbiting cluster centers at 46px radius)
- Edges between ravens in same raid (soft frost lines)
- Animated pulse particles riding along edges (spawn every 260ms)
- Cluster halos (radial gradient glow, r+28px)
- Cluster labels (raid identifier + phase name, mono 10px)
- Hover tooltip (persona name, raid identifier + phase)
- Click navigates to saga detail

**Current web-next:** Canvas element exists but has no rendering code. Must implement the animation loop.

---

## 3. Sagas Page (WRONG LAYOUT — must add split panel)

### web2 structure:

```
.page
  .page-head
    h2 "Sagas"
    input.input (search/filter)
    button "Export" (downloads JSON)
    button.btn-primary "+ New Saga" (opens Plan wizard)

  .page-body (2 columns):
    LEFT (.saga-list, 420px):
      {visible.map(saga =>
        .saga-row (.active if selected):
          .saga-glyph: deterministic Elder Futhark rune per saga ID
          .saga-main:
            .saga-name: saga.name
            .saga-meta: id-chip + StatusBadge + Confidence + repo + time
          .saga-pipe: Pipe component (phase/raid status cells)
          .saga-counts: merged/total raids count
      )}

    RIGHT (.saga-detail):
      .saga-detail-head:
        saga glyph + name + identifier + StatusBadge + Confidence
        repo link + branch + created time

      Phases section:
        {phases.map(phase =>
          .stage-header: name + StatusBadge + Confidence + raid count
          {phase.raids.map(raid =>
            .raid-row: StatusDot + identifier + name + PersonaAvatar + StatusBadge + Confidence
          )}
        )}

      Workflow card:
        .workflow-card: name + version + description
        .wf-flock: PersonaAvatar per persona in the flock

      Stage progress rail:
        .stage-rail: numbered dots (24x24, circular, brand glow on active) + connecting bars

      Confidence drift:
        Sparkline + stats (start → now, scope_adherence, tests_passed)
```

### Current web-next:

- **Single list view** (no split panel — detail moved to `/tyr/sagas/$sagaId` route)
- Missing: saga glyph, inline pipe visualization, merged/total counts
- SagaDetailPage exists but is a separate route, not inline

**Fix:** Restore the split-panel layout within the sagas page. List on left (420px), detail on right. Detail should render inline, not as a separate route.

---

## 4. Dispatch Page (WRONG STRUCTURE — must group by saga)

### web2 structure:

```
.dispatch
  .dispatch-head:
    queue count + ready count
    threshold chip + concurrent chip
    bulk action bar (when items selected):
      "{N} selected" + "Apply workflow" + "Override threshold" + "Dispatch now"

  .dispatch-body (2 columns):
    LEFT (.dispatch-queue):
      .q-filters: All | Ready | Blocked | Queued (with counts)

      {grouped by saga:
        .q-saga-head:
          identifier + saga name + branch
          workflow chip + override badge (if overridden)

        {saga.raids.map(raid =>
          .q-item:
            input[checkbox]
            .q-item-main:
              .q-name: raid name
              .q-sub: raid identifier + estimate hours
            ready/blocked badge + reason (if blocked)
            Confidence bar
            wait time ("3m", "12m", etc.)
        )}
      }

    RIGHT (.dispatch-side):
      "Dispatch rules" card:
        threshold, max_concurrent, auto_continue, retries, quiet_hours, escalation
      "Recent dispatches" list:
        6 items with timestamp + workflow name
```

### Current web-next:

- **Flat table** (no saga grouping)
- Missing: right-side rules panel
- Missing: bulk action bar
- Missing: saga group headers

**Fix:** Group raids by saga. Add right-side panel with dispatch rules. Add bulk action bar.

---

## 5. Plan Wizard (MINOR — add right rail)

web2 has a 2-column layout for the plan wizard:

### Left column: Step content (already implemented in web-next)

Steps: prompt → questions → raiding → draft → approved

### Right column: Guidance rail (MISSING)

```
"How Plan works" card:
  Step descriptions with numbered badges
"What a planning raid produces" card:
  - Phased plan with raids
  - Acceptance criteria per raid
  - File-level estimates
  - Dependency graph
  - Risk assessment
```

**Fix:** Add the right-side guidance column.

---

## 6. Workflow Builder (VERIFY — likely close)

web2 `workflow_builder.jsx` has a 3-panel layout:

- Left: Library panel (persona blocks grouped by role, draggable)
- Center: Canvas (Graph/Pipeline/YAML view toggle)
- Right: Inspector (node config, members, validation)

web-next has WorkflowBuilder with similar structure. Verify:

- [ ] Library panel shows personas grouped by role
- [ ] Graph view renders DAG with proper node shapes
- [ ] Pipeline view shows vertical stages
- [ ] YAML view shows read-only YAML
- [ ] Inspector has Config/Flock/Validate tabs
- [ ] Toolbar: name input, version chip, view toggle, undo/redo, save, test, dispatch
- [ ] ValidationPanel: collapsible pill with error/warning counts, expandable list

---

## 7. Settings (VERIFY — may need sidebar consolidation)

web2 has settings as a single page with a left sidebar rail:

```
Settings rail groups:
  Niuu: Workspace, Appearance
  Tyr: General, Dispatch rules, Integrations, Persona overrides, Gates & reviewers, Notifications, Advanced
  (Stub sections for Observatory, Volundr, Bifrost, Mimir, Valkyrie)
```

web-next has settings split across sub-routes (`/tyr/settings/personas`, `/tyr/settings/flock`, etc.). This fragmentation is acceptable but verify the settings rail matches web2 visually.

---

## Acceptance Criteria

- [ ] Topbar tabs visible: Dashboard, Sagas, Dispatch, Plan, Workflows, Settings
- [ ] Dashboard raid mesh canvas is animated (clusters, ravens, pulses, labels)
- [ ] Dashboard raid mesh supports hover tooltips and click-to-navigate
- [ ] Sagas page has split panel: 420px list (left) + detail (right)
- [ ] Saga list rows show: glyph + name + meta (id, status, confidence, repo) + Pipe + counts
- [ ] Saga detail shows: phases with raids, workflow card, stage rail, confidence drift
- [ ] Dispatch page groups raids by saga with saga headers
- [ ] Dispatch page has right-side rules panel
- [ ] Dispatch page has bulk action bar (appears on selection)
- [ ] Plan wizard has right-side guidance rail
- [ ] Workflow builder 3-panel layout verified
- [ ] Settings rail verified
- [ ] All stories render correctly
- [ ] Tests pass with 85% coverage
