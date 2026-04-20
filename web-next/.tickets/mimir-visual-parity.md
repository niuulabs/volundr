# Mimir: Rebuild to match web2 prototype

**Priority:** Medium
**Estimate:** 2 days
**Reference:** `web2/niuu_handoff/mimir/design/` (plugin.jsx, home.jsx, pages.jsx, views.jsx, atoms.jsx)
**Target:** `web-next/packages/plugin-mimir/`

---

## Summary

Mimir is structurally closer to web2 than the other plugins but has subnav gaps, missing views, and CSS sizing issues. The page structure is correct but specific sections are incomplete.

---

## 1. Subnav (MUST MATCH web2)

web2 `plugin.jsx` renders a rich subnav:

### Mount picker (top section):

```
.subnav-section
  .subnav-label: "mounts"
  button.subnav-row (.active if 'all'):
    span.subnav-dot (brand-300)
    span.subnav-name: "all mounts"
    span.subnav-count: {totalPages}
  {MOUNTS.map(m =>
    button.subnav-row (.active if focused, .muted if status !== 'ok'):
      span.subnav-dot (color by status: ok=brand-300, degraded=brand-500, offline=critical)
      span.subnav-name: m.name
      span.subnav-count: {m.pages}
  )}
```

### Navigation items (bottom section):

```
.subnav-section (flex:1, overflow:auto)
  {NAV_ITEMS.map(n =>
    button.subnav-row (.active if current tab):
      span.subnav-name: n.label
      {n.count && span.subnav-count: n.count}
  )}
```

NAV_ITEMS:

```
home (Overview), pages (Pages, count=totalPages), search (Search),
graph (Graph), ravns (Wardens, count=wardenCount), ingest (Ingest),
lint (Lint, count=lintCount with red color if > 0), log (Log)
```

### Quick filters:

```
.subnav-label: "quick"
button.subnav-row: span.subnav-dot(err) + "Errors" + count
button.subnav-row: span.subnav-dot(warn) + "Flagged pages" + count
button.subnav-row: span.subnav-dot(dim) + "Low confidence" + count
```

### Wardens roster:

```
.subnav-label: "wardens"
{ravns.slice(0,6).map(r =>
  .subnav-row:
    RavnGlyph(r.name, r.persona, size=18)
    span.subnav-name: r.name
    StateDot(r.state)
)}
```

**Current web-next:** Verify subnav matches this structure. If Mimir doesn't provide a `subnav` callback to the shell, add one.

---

## 2. Topbar Stats (MUST MATCH)

web2 topbar right:

```jsx
<div className="stats">
  <span className="stat mono">{focusedMount || 'all mounts'}</span>
  <span className="stat">
    <span className="stat-label">pages</span>
    <strong>{pages}</strong>
  </span>
  <span className="stat">
    <span className="stat-label">wardens</span>
    <strong>{wardens}</strong>
  </span>
  <span className="stat" style={{ color: lintCount > 0 ? 'var(--color-critical-fg)' : undefined }}>
    <span className="stat-label">lint</span>
    <strong>{lintCount}</strong>
  </span>
</div>
```

---

## 3. Home/Overview Page (VERIFY layout)

web2 `home.jsx` structure:

```
KPI strip (5 tiles): pages, sources, wardens, lint issues, last write

.mm-home-cols (grid: 1.2fr 1fr, border-right separator):
  LEFT:
    Mount cards grid (repeat(auto-fill, minmax(300px, 1fr))):
      Per card: status dot + name + role badge + priority + host + metrics (pages/sources/lint/size) + categories
    Wardens section:
      Grid of ravn cards (repeat(auto-fill, minmax(300px, 1fr))):
        Per card: RavnGlyph initials + name + state dot + persona + bio + binding MountChips
  RIGHT:
    Activity feed:
      .mm-feed-row grid (58px 60px 66px 1fr):
        timestamp + kind badge + mount name + message with clickable page links
```

**Verify:** The 2-column split should be `1.2fr 1fr` with a right border separator on the left column. Current web-next may not have this exact layout.

---

## 4. Pages View (VERIFY triple-pane)

web2 `pages.jsx` structure:

```
LEFT: Pages tree (hierarchical, folders collapse, leaf pages show confidence dot + flag)
CENTER: Page reader
  Breadcrumb path
  Title + summary
  Action bar (edit, flag, promote confidence)
  Chip bar: type, entity, confidence, mounts, updated, ravn, flags
  Compiled Truth zone: Key facts (bullet list) + Relationships (wikilink pills + notes) + Assessment
  Timeline zone: dated entries (date + note + source attribution)
RIGHT: Page meta panel
  Size, provenance (source log, mounts list), backlinks, recent activity
```

**Verify:** All three panes render. Check that the chip bar uses `.mm-chip` styling (10px uppercase, letter-spacing 0.05em — already fixed in CSS).

---

## 5. Search View (VERIFY)

web2 `views.jsx` SearchView:

```
Search head: query input + mode toggle Seg (fts/semantic/hybrid) + result count
Results list per result:
  Title + path (breadcrumb-style)
  Snippet with highlighted matches
  Chip row: confidence + type + mount chips + score
```

---

## 6. Graph View (VERIFY)

web2 `views.jsx` GraphView:

- SVG force-directed layout with category-based radial clusters
- Nodes colored by category, sized by page type
- Edges: solid (source sharing) + dashed (wikilinks)
- Legend card (categories + edge types)
- Hover: title tooltip + glow
- Top-right stats: nodes + edges + mount scope

---

## 7. Wardens/Ravns View (VERIFY)

web2 has 2 states:

### Directory (no ravn selected):

Grid of ravn cards: initials glyph + name + state dot + persona + role chip + bio + binding chips + metrics.

### Profile (ravn selected):

Hero: large initials + name + role + persona + state pill + tools list + bio.
2-panel grid: Mimir bindings + expertise chips + last dream cycle stats + recent activity.
Bottom: pages table (pages last written by this ravn).

---

## 8. Lint View (VERIFY layout)

web2: 2-column grid (220px left, 1fr right):

- Left: checks summary (per-check rows with severity dot, id, name, count, autofix badge)
- Right: issues list filtered by selected check

**Verify:** web-next lint page matches this grid.

---

## 9. Ingest View (VERIFY)

web2: 2-column layout:

- Left: ingest form (title, path, content textarea, action buttons)
- Right: write routing rules table + recent sources

---

## 10. Log View (VERIFY)

Append-only activity log with columns: time, kind, mount, warden, message.

---

## Acceptance Criteria

- [ ] Subnav has mount picker + nav items + quick filters + wardens roster
- [ ] Topbar shows mount name + pages/wardens/lint stat chips
- [ ] Home page has `1.2fr 1fr` grid layout with border separator
- [ ] Mount cards grid uses minmax(300px, 1fr) _(already fixed)_
- [ ] Feed row grid uses 58px/60px/66px/1fr _(already fixed)_
- [ ] Chip styling is 10px uppercase with 0.05em letter-spacing _(already fixed)_
- [ ] Pages view has triple-pane (tree / reader / meta)
- [ ] Search view has mode toggle and result snippets
- [ ] Graph view renders force layout
- [ ] Wardens view has directory and profile states
- [ ] Lint view has 220px/1fr grid
- [ ] All stories render correctly
- [ ] Tests pass with 85% coverage
