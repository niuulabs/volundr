# Observatory: Rebuild to match web2 prototype

**Priority:** High
**Estimate:** 3-5 days
**Reference:** `web2/niuu_handoff/flokk_observatory/design/` (app.jsx, observatory.jsx, registry.jsx, data.jsx)
**Target:** `web-next/packages/plugin-observatory/`

---

## Summary

The Observatory plugin in web-next is ~40% complete and architecturally divergent from the web2 prototype. The canvas rendering, data model, overlays, subnav, and entity drawer all need significant rework to match the reference.

---

## 1. Subnav (MISSING — must add)

web2 `app.jsx` renders a subnav with 3 sections. web-next has **no subnav at all**.

### Section 1: Filter

5 filter rows, each with colored dot + label + count:

- `all` — total entity count — `var(--brand-300)`
- `agents` — agent count — `var(--brand-200)`
- `raids` — raid count — `var(--brand-500)`
- `services` — service count — `var(--brand-300)`
- `devices` — device count — `var(--color-text-muted)`

Click highlights with `color-mix(in srgb, var(--color-brand) 10%, transparent)`.

### Section 2: Realms

Each realm row: dot (`var(--brand-300)`) + label + `vlan {N}`.
Clickable — opens RealmDrawer.

### Section 3: Clusters + Active Raids

Clusters: dot (`var(--brand-500)`) + label + `⎔`.
Active raids (capped at 6): dot (color by state) + purpose (mono, truncated) + state abbreviation.

CSS classes: `.subnav-section`, `.subnav-label`, `.subnav-row`, `.subnav-dot`, `.subnav-name`, `.subnav-count`.

---

## 2. Topbar Stats (MISSING — must add)

web2 `app.jsx` renders `topbarRight` with 3 stat chips:

```
realms: {count} | ravens: {count} (accent) | raids: {count} (accent)
```

CSS: `.stats`, `.stat`, `.stat-label`, `.stat.emph.accent`.

---

## 3. Entity Data Model (INCOMPATIBLE — must extend)

web2 entities have rich kind-specific fields. web-next nodes are generic (`id, label, typeId, parentId, status`).

**Required node fields per kind:**

| Kind        | Fields                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `tyr`       | `mode`, `activeSagas`, `pendingRaids`                                                                                       |
| `bifrost`   | `providers[]`, `reqPerMin`, `cacheHitRate`                                                                                  |
| `volundr`   | `activeSessions`, `maxSessions`                                                                                             |
| `ravn_long` | `persona`, `specialty`, `tokens`                                                                                            |
| `valkyrie`  | `specialty`, `autonomy`                                                                                                     |
| `host`      | `hw`, `os`, `cores`, `ram`, `gpu`                                                                                           |
| `model`     | `provider`, `location`                                                                                                      |
| `service`   | `svcType`                                                                                                                   |
| All         | `activity` (`idle`/`thinking`/`tooling`/`waiting`/`delegating`/`writing`/`reading`), `zone`, `cluster`, `hostId`, `flockId` |

**Activity color map:**

```
idle: var(--color-text-muted)
thinking: var(--brand-300)
tooling: var(--brand-400)
waiting: var(--color-text-muted)
delegating: var(--brand-200)
writing: var(--brand-200)
reading: var(--brand-300)
```

---

## 4. Entity Drawer (INCOMPLETE — must rebuild)

web2 `app.jsx` has 3 drawer variants: EntityDrawer, RealmDrawer, ClusterDrawer.

### EntityDrawer structure:

```
.drawer
  .drawer-head
    button.drawer-close (x)
    .drawer-eyebrow > .drawer-rune + kind label
    h3.drawer-title > name + .id-chip
    .drawer-sub > first sentence of description
  .drawer-body
    .status-row > ActivityDot + state label + timestamp
    section "Identity" > dl.prop-grid (id, kind, realm, cluster, host, flock)
    section "Properties" > dl.prop-grid (KIND-SPECIFIC fields — see table above)
    section "Coordinator" (if role=coord) > confidence bar
    section "Token throughput" (if ravn_long or bifrost) > sparkline SVG
    section "Actions" > .btn-row (Open chat, Inspect in registry, Quarantine)
```

**Current web-next:** Only shows generic fields from EntityType. Missing all kind-specific property renderers, the coordinator confidence bar, token throughput sparkline, and action buttons.

### RealmDrawer structure:

```
.drawer-head > rune + "Realm · VLAN zone" + name + vlan chip + dns
.drawer-body > About text + prop-grid (vlan, dns, residents count) + Residents list (subnav-row items, capped at 20)
```

### ClusterDrawer structure:

Similar to RealmDrawer with cluster-specific fields.

---

## 5. Canvas Rendering (INCOMPLETE — must match web2)

web2 `observatory.jsx` has a unified rendering pipeline:

### Draw order:

1. Background gradient + starfield
2. Camera transform (pan + zoom)
3. Zone circles (realms with glow gradient + animated stroke, clusters with dashed stroke)
4. Infrastructure topology edges (Tyr→Volundr solid, Tyr⇝raid-coord dashed-anim, Bifrost→model dashed-long)
5. Entity edges (ravn→Mimir soft, raid cohesion)
6. Raid halos (state-dependent: forming expands, working pulses, dissolving radiates)
7. Animated particles (type-colored dots traveling along edges)
8. Host boxes (rounded rect with label)
9. Entity nodes (kind-specific shapes with activity glow)
10. Mimir special (nebula gradient, dual orbit rings, rune orbit)

### Kind-specific node shapes:

- `tyr`, `volundr`: filled square
- `bifrost`: 5-pointed star
- `ravn_long`: diamond
- `ravn_raid`: triangle
- `skuld`: hexagon (outline)
- `valkyrie`: chevron
- `host`: rounded rect with HW label
- `service`, `model`: circles

### World constants:

```
WORLD_W = 4200, WORLD_H = 3600
KIND_R = { ravn_long:9, ravn_raid:6, skuld:7, tyr:11, bifrost:10, mimir:42, volundr:13, model:6, valkyrie:10, printer:8, vaettir:7, beacon:4, service:3, host:8, mimir_sub:18 }
```

---

## 6. Layout Engine (MUST MATCH — physics simulation)

web2 uses zone-based positioning + physics simulation:

- Entities anchored to realm/cluster centers with radial offsets
- Hosts on realm perimeters (collision-aware, 36 angle attempts)
- Models positioned relative to Bifrost
- Physics: velocity damping (0.86), attractive springs, repulsive forces (d<160px)

---

## 7. Minimap (MUST REBUILD — currently inaccurate)

web2: Canvas2D rendering using WORLD_W/H coordinate mapping. Shows realm circles, entity dots (colored by activity), viewport rectangle.

web-next: SVG with circular layout. **Does not reflect actual topology positions.** Must be rewritten to use the same coordinate system as the main canvas.

---

## 8. Event Log (DATA MODEL MISMATCH)

web2 events: `{ id, time, type: 'RAID'|'RAVN'|'TYR'|'MIMIR'|'BIFROST', subject, body }`
web-next events: `{ id, timestamp, severity, sourceId, message }`

Must align to web2 shape. Event log renders as:

```
.eventlog (position: fixed, bottom, center, pointer-events: none)
  .eventlog-inner (pointer-events: auto)
    .eventlog-head > "event stream" + rate/s + "tailing last {N}"
    .eventlog-body (4-column grid: time, type, subject, body)
```

---

## 9. Connection Legend (LABEL MISMATCH)

web2 labels:

- solid: "Tyr → Volundr"
- dashed-anim: "Tyr ⇝ raid coord"
- dashed-long: "Bifrost → ext. model"
- soft: "ravn → Mimir"
- raid: "raid cohesion"

web-next labels: "Direct", "Active", "Async", "Cache", "Coord" — **wrong, must match web2.**

---

## 10. Hit Testing (PLACEHOLDER — ticket NIU-664)

web2: Integrated `hit()` function checks mouse position against entity positions.
web-next: 1px invisible buttons stacked at (0,0) as a placeholder.

Must implement proper canvas hit-testing.

---

## 11. Registry Editor (MOSTLY CORRECT)

The RegistryEditor is structurally close to web2. Verify:

- Type grid with ShapeSvg + rune + description
- Right-side TypeInspector with shape/color/icon selectors
- Containment tab with drag-drop reparenting
- JSON tab with stringify view

---

## Acceptance Criteria

- [ ] Subnav renders filter section, realms, clusters, active raids
- [ ] Topbar shows realm/raven/raid stat chips
- [ ] Entity data model includes kind-specific fields
- [ ] EntityDrawer shows kind-specific properties (all 10+ kinds)
- [ ] RealmDrawer and ClusterDrawer render correctly
- [ ] Canvas draws zones, edges, halos, particles, Mimir special
- [ ] Node shapes match web2 (per-kind)
- [ ] Physics layout engine matches web2
- [ ] Minimap reflects actual canvas coordinates
- [ ] Event log uses web2 data shape (type-based, not severity-based)
- [ ] Connection legend labels match web2
- [ ] Canvas hit-testing works (click entity to select)
- [ ] All stories render correctly in Storybook
- [ ] Tests pass with 85% coverage
