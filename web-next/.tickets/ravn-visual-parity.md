# Ravn: Rebuild to match web2 prototype

**Priority:** High
**Estimate:** 2-3 days
**Reference:** `web2/niuu_handoff/ravn/design/` (shell.jsx, overview.jsx, pages.jsx, personas.jsx, sessions.jsx, atoms.jsx)
**Target:** `web-next/packages/plugin-ravn/`

---

## Summary

Ravn has 5 structural mismatches vs web2: tab count (8 vs 5), missing subnav for personas/sessions, personas page uses wrong layout pattern, sessions page missing context sidebar, and budget page stripped down.

---

## 1. Tabs: Reduce from 8 to 5

web2 tabs (defined in `shell.jsx` line 6-12):

```
Overview | Ravens | Personas | Sessions | Budget
```

web-next currently has 8 tabs (Triggers, Events, Log promoted to top-level):

```
Overview | Ravens | Personas | Sessions | Triggers | Events | Budget | Log
```

**Fix:** Remove Triggers, Events, and Log as top-level tabs. Triggers belongs inside the RavnDetail panel (section tab). Events and Log are not separate pages in web2 — they're embedded in the overview activity tail and the detail activity section.

---

## 2. Topbar Stats (MUST ADD)

web2 `shell.jsx` renders `topbarRight` with stat chips:

```jsx
<TopbarChip kind="ok" icon="●" label={`${activeRavens} active`} />;
{
  failedRavens > 0 && <TopbarChip kind="err" icon="●" label={`${failedRavens} failed`} />;
}
<TopbarChip kind="dim" icon="◷" label={`${openSessions} sessions`} />;
```

CSS: `.topbar-chip`, `.chip-dot`, variants `ok`/`err`/`dim`.

web-next: topbarRight is not implemented for Ravn. Must add via the `topbarRight` callback in the plugin descriptor.

---

## 3. Subnav (MUST ADD for Personas and Sessions tabs)

web2 renders different subnav content per tab:

- Overview, Ravens, Budget: **no subnav** (subnav column collapses)
- Personas: persona list grouped by role
- Sessions: session list split into active/closed

### Personas subnav:

```
.subnav
  .subnav-section
    .subnav-head: "Personas {count}"
    .subnav-hint: "cognitive templates"
  {roles.map(role =>
    .subnav-group
      .subnav-group-head: role name + count
      {personas.map(p =>
        button.subnav-item (.active if selected)
          PersonaAvatar(name, size=18)
          span.mono: p.name
          {!p.builtin && span.badge-tiny: "usr"}
          {p.hasOverride && span.badge-tiny.warn: "ovr"}
      )}
  }
```

### Sessions subnav:

```
.subnav
  .subnav-section
    .subnav-head: "Sessions"
    .subnav-hint: "{active.length} active · {other.length} closed"
  .subnav-group (active)
    .subnav-group-head: "active" + count
    {active.map(s =>
      button.subnav-item.sn-session (.active if selected)
        PersonaAvatar(persona, size=18)
        .sn-s-body
          .sn-s-title: s.title
          .sn-s-meta.mono: "{ravnId} · {msgCount}m · ${cost}"
    )}
  .subnav-group (closed)
    // same but faded (opacity 0.5/0.7)
```

**Current web-next:** No subnav. Personas page uses an internal split-pane (left sidebar + right detail). Must change to: personas list in **subnav** (shell-owned), full-width editor in **content area**.

---

## 4. Overview Page (CLOSE — minor fixes)

web2 `overview.jsx` structure:

```
.ov-root
  .ov-kpis (4 cards):
    Ravens: total + active/idle/failed/suspended breakdown
    Open sessions: count + msgs + tokens
    Spend today: $spent (accent) + of $cap + %
    Active triggers: count + paused count
  .ov-body (2 columns):
    LEFT:
      "Active ravens" section + "open directory →" link
        .ov-active-list > .ov-active-row per raven:
          StateDot + PersonaAvatar(20) + name + persona + location + sessions + BudgetBar(sm) + lastActivity
      "By location" section
        .ov-loc-bars > per location: name + bar + count
    RIGHT:
      "Fleet spend · 24h" section
        Sparkline(w=520, h=100) + axis labels (-24h · -12h · now)
      "Top burners" section + "budget page →" link
        .ov-burner-row per burner: PersonaAvatar(18) + name + BudgetBar(sm) + % + $spent
      "Recent activity" section
        .ov-log > .ov-log-row: time + kind badge + ravnId + message body
```

### Current web-next gaps:

- KPI cards: 6 instead of 4. Consolidate back to 4 matching web2 labels.
- "By location" section: **MISSING**. Must add.
- Fleet sparkline: should be `w=520, h=100` (much larger than default).
- Top burners: missing percentage display.
- Activity log: web-next uses HTML table; web2 uses div grid. Match web2 class names.

---

## 5. Ravens Page (CLOSE — fix detail sections)

web2 `pages.jsx` RavensSplit structure:

### Left panel (list): 420px wide

- Header: "Fleet" + counts + search input + groupBy segment (loc/persona/state/flat)
- Group headers with counts
- Rows: StateDot + PersonaAvatar(22) + name/persona col + location/deployment col + sessions col + BudgetBar/spend col

### Right panel (detail): RavnDetail with section tabs

Section tabs: `overview | triggers {count} | activity {count} | sessions {count} | connectivity`

**Current web-next:** Uses collapsible sections instead of tabs. Must change to **tab-based switching** matching web2.

### Section: Overview

Two-panel grid:

- Identity panel: id, persona, role, specialisations
- Runtime panel: state, cascade, checkpoints, output, lastActivity, sessions, spend with percent pill
- Wide panel: Mimir mounts (MountChip per mount) + write routing table

### Section: Triggers

List of triggers with kind/schedule/spec + enable toggle.
"Add trigger" form with kind selector (cron/event/gateway) and conditional fields.

### Section: Activity

Filter bar (Seg: all/iter/tool/emit/wait/budget/trigger/done/idle/suspend).
Rows: timestamp + kind badge + message + optional cost.

### Section: Sessions

Filtered session list for this raven.

### Section: Connectivity

Three panels: MCP servers (chip list), Gateway channels (chip list), Event subscriptions (chip list).

---

## 6. Personas Page (WRONG LAYOUT — must rebuild)

**web2:** Full-width editor. Persona list is in the **subnav** (see section 3 above). Content area shows the selected persona editor at full width.

**web-next:** Internal split-pane (left PersonaList sidebar + right detail). This is wrong.

### web2 persona editor structure:

```
.pr-root
  .pr-head
    .pr-head-l: PersonaAvatar(40) + name + role/builtin/override badges + source path
    .pr-head-r: mode Seg (form/yaml/subs) + revert/new/clone/save buttons
  {validation bar if issues}
  .pr-body
    mode=form: PersonaForm
    mode=yaml: PersonaYaml (syntax-highlighted YAML)
    mode=subs: PersonaSubs (upstream/self/downstream 3-column graph)
```

### PersonaForm sections:

1. **Identity**: name (readonly), role, description (wide textarea)
2. **Runtime**: iteration_budget, permission_mode, llm.alias, llm.thinking, llm.max_tokens (3-column grid)
3. **Tool access**: allowed tools (chip list + ToolPicker) + forbidden tools (chip list). Destructive tools show `⚠` risk indicator.
4. **Produces**: EventPicker + event metadata + SchemaEditor (inline key/type rows)
5. **Consumes**: event_types (chip list + EventPicker) + injects (chip list + InjectPicker from INJECT_CATALOG)
6. **Fan-in**: strategy card selector (6 strategies) + per-strategy parameter fields + contributes_to EventPicker + peer personas preview

### Shared components needed:

- `EventPicker`: dropdown with search, event catalog lookup, allows new events
- `ToolPicker`: grouped tool list with search, destructive flag display
- `SchemaEditor`: inline key/type editor rows with add/delete
- `PersonaYaml`: syntax-highlighted YAML display
- `PersonaSubs`: 3-column upstream/self/downstream subscription graph

---

## 7. Sessions Page (MISSING CONTEXT SIDEBAR)

web2 `sessions.jsx` has a 2-column layout:

### Left column: Chat transcript

```
.ss-chat
  .ss-chat-toolbar: filter Seg (all/chat/+tools/+system) + jump keys + follow indicator
  .ss-scroll: messages list
  .ss-composer (active) or .ss-composer.closed (read-only)
```

### Right column: Context sidebar (MISSING in web-next)

```
.ss-aside
  Summary section: session.summary text
  Timeline section: ordered list of message events with dots + timestamps
  Injects section: list of loaded context bundles (chip per inject)
  Emissions section: produced event chip + schema + emitted/pending status
  Raven section: card with name, location, deployment, budget
```

### Message types (5 kinds):

1. `user`: rail "you" + body + timestamp
2. `assistant`: rail PersonaAvatar(22) + author name + prose body + timestamp
3. `thought`: rail glyph "∴" + foldable thought text
4. `tool`: rail glyph "⌁" + tool name + args + "→" + result
5. `emit`: rail glyph "↗" + event chip + attributes
6. `system`: rail "sys" + body

### ActiveCursor: animated thinking indicator (pulsing dots).

---

## 8. Budget Page (STRIPPED DOWN — must restore)

web2 `pages.jsx` BudgetView has 5 sections. web-next has 3.

### Missing sections to add:

1. **Attention rail**: 4 columns (not 3): Over cap (⊘), Will exceed (⚠), Near cap (◐), Accelerating (↗)
2. **Top drivers**: table with PersonaAvatar + name + share bar + sparkline + percentage
3. **Recommended changes**: cap adjustment suggestions + under-utilized ravens

### Existing sections to verify:

4. Hero: daily spend/cap/projection/runway bar
5. Fleet burn chart: 24h sparkline
6. Fleet table: collapsible, all ravens with budget comparison

---

## Acceptance Criteria

- [ ] 5 tabs only: Overview, Ravens, Personas, Sessions, Budget
- [ ] Topbar shows active/failed/sessions stat chips
- [ ] Personas tab has subnav (role-grouped persona list)
- [ ] Sessions tab has subnav (active/closed session list)
- [ ] Overview has 4 KPI cards matching web2 labels
- [ ] Overview has "By location" bars section
- [ ] Overview sparkline is 520x100
- [ ] Ravens detail uses tab-based sections (not collapsible)
- [ ] Ravens detail has all 5 sections: overview, triggers, activity, sessions, connectivity
- [ ] Personas page is full-width editor (no internal split pane)
- [ ] Persona form has all 6 sections (identity, runtime, tools, produces, consumes, fan-in)
- [ ] EventPicker, ToolPicker, SchemaEditor components exist
- [ ] Sessions page has right-side context sidebar (summary, timeline, injects, emissions, raven)
- [ ] 5 message types render correctly
- [ ] Budget page has 4-column attention rail
- [ ] Budget page has top drivers table
- [ ] All stories render correctly
- [ ] Tests pass with 85% coverage
