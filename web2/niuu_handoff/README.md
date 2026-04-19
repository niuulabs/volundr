# Handoff: Flokk Observatory

> A live topology view + type-registry editor for the Niuu stack. The "map" of your agentic infrastructure — realms, clusters, hosts, Mímir at the center, ravens (agents) orbiting, Bifröst fanning out to models, Týr dispatching raids, Valkyries guarding clusters.

---

## About the design files

The files in `design/` are **design references**, not production code. They are an HTML + Babel-in-browser React prototype that runs as a single page via `Flokk Observatory.html`. Treat them the way you would a Figma file: they pin down visuals, interactions, data shapes, and component contracts — but your job is to **recreate this in the real Niuu codebase**, using the codebase's existing patterns (hexagonal architecture, bounded contexts, actual TypeScript/React module system, real backend, etc).

Specifically, do **not** copy these decisions forward:

- Everything is plain `.jsx` loaded via Babel standalone and attached to `window.*`. Your real code is TypeScript with ES modules. Re-export properly.
- Components reach into global helpers (`window.ShapeSvg`, `window.FlokkShell`). In the real app, use imports and dependency injection — the plugin contract below is the right boundary.
- There is no real data layer. `data.jsx::DEFAULT_REGISTRY` is a seed; `useMockFlokkState` is a simulation loop. Replace both with adapters over your real registry service + live state source (websocket, SSE, whatever the stack uses).
- The subscription store in `app.jsx::getObservatoryStore` is a prototype hack to share state between three render slots (content / subnav / topbar). In real code, lift that into proper context or your state library.

What **is** authoritative and should port across verbatim (or as close as possible):

- **Visual tokens** — colors, spacing, type, runes. See `design/tokens.css`. Niuu already has these; this file is the snapshot I worked against.
- **The entity-type schema** — see `design/data.jsx::DEFAULT_REGISTRY.types[]`. This matches what the prototype calls "SDD §4.1". Confirm against your actual SDD before shipping.
- **The plugin contract** — see `design/shell.jsx::Shell` and how `ObservatoryPluginDescriptor` / `RegistryPlugin` implement it. This is the shape other Niuu plugins (Týr, Bifröst, Völundr, Mímir, Valkyrie) should adopt.
- **Interaction patterns** — drag-to-reparent in the registry, scroll-zoom + pan on the canvas, drawer-opens-on-select, connection-line taxonomy (solid / dashed-anim / dashed-long / soft / raid).

## Fidelity

**High-fidelity** on visuals, type scale, color tokens, motion, and the IA of every screen. The prototype is a pixel-level reference.

**Low-fidelity** on:

- Data layer (mock only)
- Auth / permissions (none)
- Error / empty / loading states (happy-path only — you need to add these)
- Responsive / mobile (desktop-first, 1280px minimum)
- Accessibility (keyboard nav on the canvas is not implemented; drag-drop is mouse-only; color-only status signaling in a few places)

## Target architecture

The prototype does not implement hexagonal boundaries. When porting, I'd suggest this split:

```
observatory/
├── domain/                          # Pure, no framework
│   ├── entity-type.ts              # Type registry schema (see `design/data.jsx`)
│   ├── topology.ts                 # Realm / Cluster / Host / Agent value objects
│   └── connections.ts              # Edge taxonomy
├── application/                     # Use cases (orchestrate domain + ports)
│   ├── observe-topology.ts         # Subscribe to live state
│   ├── edit-registry.ts            # Reparent, rename, add field, etc
│   └── dispatch-raid.ts            # (Týr-facing — may live in Týr's bounded context)
├── ports/                           # Interfaces
│   ├── RegistryRepository.ts       # load / save / watch the type registry
│   ├── LiveTopologyStream.ts       # subscribe() → entity updates
│   └── EventStream.ts              # the event log feed
├── adapters/
│   ├── registry-http.ts            # Real HTTP/gRPC impl of RegistryRepository
│   ├── topology-ws.ts              # WebSocket impl of LiveTopologyStream
│   └── events-sse.ts               # SSE impl of EventStream
└── ui/                              # React, imports from application + domain only
    ├── ObservatoryPlugin.tsx       # see design/app.jsx::ObservatoryPluginDescriptor
    ├── RegistryPlugin.tsx          # see design/registry.jsx
    ├── components/
    │   ├── Canvas.tsx              # SVG topology (design/observatory.jsx)
    │   ├── EntityDrawer.tsx
    │   ├── EventLog.tsx
    │   ├── ConnectionLegend.tsx
    │   ├── RegistryTree.tsx        # with drag-drop reparenting
    │   └── ShapeSvg.tsx            # 12 shape primitives, see design/data.jsx
    └── hooks/
        ├── useTopology.ts          # wraps observe-topology use case
        └── useRegistry.ts
```

The shell itself (`design/shell.jsx::Shell`) is a **host-agnostic plugin mount** — it should live outside observatory, probably in a `@niuu/shell` package that Týr, Bifröst, Völundr, Mímir, and Valkyrie also mount into.

---

## Plugin contract

Every plugin is a descriptor object of this shape (copy directly from `design/shell.jsx` and `design/app.jsx`):

```ts
interface PluginDescriptor {
  id: string;                             // 'observatory' | 'tyr' | ...
  rune: string;                           // single-char identity glyph
  title: string;                          // "Flokk · Observatory"
  subtitle: string;                       // "live topology & entity registry"

  // Three render slots mounted by the shell:
  render:       (ctx: PluginCtx) => ReactNode;  // main content area
  subnav?:      (ctx: PluginCtx) => ReactNode;  // left column, if any
  topbarRight?: (ctx: PluginCtx) => ReactNode;  // status / stats chips
}

interface PluginCtx {
  registry: TypeRegistry;                 // shared across plugins
  setRegistry: (r: TypeRegistry | ((r: TypeRegistry) => TypeRegistry)) => void;
  tweaks: Record<string, unknown>;
  setTweak: (key: string, value: unknown) => void;
}
```

Observatory itself uses all three slots. Registry uses `render` + `topbarRight`. The placeholder plugins (Týr, Bifröst, Völundr, Mímir, Valkyrie) only use `render`.

Persist the active plugin id to localStorage under `flokk.active` so reload lands on the same tab.

---

## Screens

### 1. Observatory (main canvas)

**Purpose:** At-a-glance live view of the whole agentic infrastructure.

**Layout:** (see `design/observatory.jsx`)

- Full-viewport SVG canvas (position: absolute, fills between rail + topbar + footer).
- Origin is screen center. Pan via drag. Zoom via scroll wheel (clamped 0.3× – 3×).
- Mímir is the visual anchor at (0, 0). Long-lived ravens orbit it in concentric rings.
- Realms are large rings (radius proportional to `size`), arranged around the origin in a stable layout driven by realm id hash — **not** force-directed, so things don't wobble between frames.
- Clusters are dashed rings *inside* their realm.
- Hosts sit inside realms as rounded-rects.
- Services sit as small dots inside their host or cluster.
- Raids render as dashed halos around their constituent ravens, with cohesion lines between members.
- Bifröst sits adjacent to Mímir; models hang off it as dots connected by "dashed-long" edges (external) or solid edges (internal).
- Týr sits in its cluster; connected to each Völundr it dispatches to.

**Overlays (z-ordered on top of the canvas):**

- `ConnectionLegend` — top-left, explains the five edge styles.
- `EventLog` — bottom, ~30 most recent events, auto-scrolls. Reserved-space tailing terminal aesthetic.
- `EntityDrawer` — right side, slides in when anything is clicked. Different content per entity kind (see the `EntityDrawer`, `RealmDrawer`, `ClusterDrawer` functions in `app.jsx`).
- Minimap — bottom-right, 160×120, scaled view of the whole canvas.

**Interactions:**

- Click any entity → drawer opens with its details.
- Hover → entity highlights, its edges emphasize, others dim.
- Realm or cluster click → drawer shows residents/members, each clickable to drill in.
- Drawer "Inspect in registry" button navigates to the Registry plugin with the type preselected.

### 2. Registry (type editor)

**Purpose:** Edit the entity-type schema. Anything you change here re-renders the canvas.

**Layout:** (see `design/registry.jsx`)

- Main column: tabs `Types | Containment | JSON`.
- Drawer on the right: selected type's full detail.

**Tab — Types:**

- Search box at top.
- Types grouped by category: topology / hardware / agent / coordinator / knowledge / infrastructure / device / composite.
- Each row: shape swatch · rune · label · id · description preview.
- Click a row → preview in the drawer.

**Tab — Containment:**

- Tree view of `parentTypes → canContain` relationships.
- Roots are types with no parents.
- **Drag any type onto another to reparent it.**
  - Adds child to the new parent's `canContain`.
  - Removes child from previous parent's `canContain`.
  - Rewrites child's `parentTypes` to `[newParentId]` (single-parent model).
  - Bumps `registry.version` and `updatedAt`.
  - Cycle protection: if the target is a descendant of the dragged type, the drop is refused (red invalid state).
- Orphans section at the bottom catches types whose parents are missing.

**Tab — JSON:**

- Read-only monospace pretty-print of the full registry object.
- Copy button top-right.

---

## Components (design tokens inlined)

### Shell chrome

| Region | Dimensions | Background | Border | Notes |
|---|---|---|---|---|
| Rail (left) | 56px wide, full height | `var(--color-bg-secondary)` | right: 1px `--color-border-subtle` | Plugin icons + brand rune top, version foot |
| Topbar | 56px tall | `var(--color-bg-secondary)` | bottom: 1px `--color-border-subtle` | Title left, stats/clock right |
| Subnav (optional) | 240px wide | `var(--color-bg-primary)` | right: 1px `--color-border-subtle` | Only mounts if plugin supplies `subnav` |
| Content | flex | `var(--color-bg-primary)` | — | Overflow hidden; plugin owns internal scroll |
| Footer | 24px tall | `var(--color-bg-secondary)` | top: 1px `--color-border-subtle` | Status chips, monospace, 11px |

Rail items are 40×40 buttons, `var(--radius-md)`, show rune glyph at 18px. Active item gets `background: var(--color-bg-tertiary)`, `color: var(--color-brand)`, and a 2px left accent bar.

### Connection-line taxonomy (SVG strokes)

These five styles are the visual grammar of the canvas. Keep them consistent everywhere:

| Kind | Stroke | Dash | Width | Meaning |
|---|---|---|---|---|
| `solid` | `rgba(147,197,253,0.8)` | — | 1.4 | Týr → Völundr (control) |
| `dashed-anim` | `rgba(125,211,252,0.9)` | `3 3` + animation | 1.4 | Týr ⇝ raid coord (active dispatch) |
| `dashed-long` | `rgba(147,197,253,0.7)` | `6 4` | 1.2 | Bifröst → external model |
| `soft` | `rgba(224,242,254,0.55)` | — | 0.9 | ravn → Mímir (reads) |
| `raid` | dot-line-dot | — | 1.0 | raid cohesion |

On realms with `data-theme='ice'` (the prototype's default canvas theme), these pull from `--brand-*` — but in the prototype I hardcoded the ice-blue RGBA for readability. When porting, thread them through tokens.

### Shape primitives

12 shapes, all SVG, 20×20 viewBox centered at origin. Full implementation in `design/data.jsx::ShapeSvg`. Shapes are:

`ring · ring-dashed · rounded-rect · diamond · triangle · hex · chevron · square · square-sm · pentagon · halo · mimir · mimir-small · dot`

Every entity type specifies one shape + one color token. The canvas and the registry editor both use `ShapeSvg` — **do not re-implement per surface.**

### Entity drawer

Right-side slide-in, 360px wide, full height, `var(--color-bg-secondary)`, 1px left border.

Structure:

- **Head** (padding `--space-4`, bottom border `--color-border-subtle`):
  - Close button (×, top-right, 24×24 hit area)
  - Eyebrow: rune + kind label + "entity" (font-mono, 10px, caps, `--color-text-muted`)
  - Title: entity name (20px, 600, `--color-text-primary`) + id chip (monospace, tiny, pill)
  - Sub: first sentence of type description (13px, `--color-text-secondary`)
- **Body** (overflow-y auto, padding `--space-4`):
  - Status row (activity dot + state + right-aligned last-tick timestamp)
  - Sections, each prefaced by a `.section-head` label: Identity · Properties · Coordinator (if role=coord) · Token throughput (for ravn_long and bifrost) · Actions
  - Property grids use `<dl class="prop-grid">` with `grid-template-columns: 100px 1fr`.
  - Sparkline: 24 samples, 240×32 viewBox, polyline + filled area, seeded by entity id so it's stable across renders.
  - Actions: 3 buttons — primary ("Open chat"), normal ("Inspect in registry"), ghost ("Quarantine").

Realm and Cluster drawers follow the same head/body structure but show residents/members as a clickable list.

### Registry tree node

`.tree-node` — flex row, gap 8px, padding 4px 8px, border-radius `--radius-sm`, cursor grab.

Drop states (add to the node element during drag):

- `.drop-ok` — dashed brand outline at 30% alpha (this node could be a valid drop target)
- `.drop-target` — solid brand outline + 20% brand fill (currently hovered, valid)
- `.drop-invalid` — solid critical-red outline + 15% red fill, cursor not-allowed (hovered, but would create a cycle)
- `.dragging` — opacity 0.4 on the node currently being dragged

### Event log strip

Fixed to bottom of canvas, 12px from edges, pointer-events pass-through on wrapper (so clicks go to canvas underneath), pointer-events auto on inner.

Width: 480px, height: 200px. `var(--color-bg-secondary)` at 0.92 alpha, 1px `--color-border-subtle`, `--radius-md`, backdrop-filter blur.

Head: "event stream" left, "N/s · tailing last M" right, both monospace 10px.

Body: monospace 11px rows: `HH:MM:SS | TYPE | subject | body`. Newest at bottom, scroll pinned to bottom on new events.

---

## Design tokens

All tokens live in `design/tokens.css`. Key ones:

### Colors — dark mode only in this design

```
--color-bg-primary:   #09090b  /* canvas */
--color-bg-secondary: #18181b  /* panels, rail, drawer */
--color-bg-tertiary:  #27272a  /* hover, raised rows */
--color-bg-elevated:  #3f3f46  /* tooltips */

--color-text-primary:   #fafafa
--color-text-secondary: #a1a1aa
--color-text-muted:     #71717a
--color-text-faint:     #52525b

--color-border:        #3f3f46
--color-border-subtle: #27272a
```

### Brand ramp (themeable)

Default is amber; `[data-theme='spring']` is green; `[data-theme='ice']` is blue. The canvas itself reads fine against any of them. See `tokens.css` for the three full 100–900 ramps.

### Critical (reserved — red only)

```
--color-critical:    #ef4444
--color-critical-fg: #fca5a5  /* softer red for text */
```

Red is **only** for failures, errors, destructive actions, and cycle-detection errors in the registry. Never a brand/theme color.

### Status (semantic, all pull from brand ramp)

`healthy · running · observing · merged · attention · review · queued · processing · deciding · failed · degraded · unknown · idle · archived`

### Typography

- Sans: **Inter** (local TTF fallback to system-ui). Weights 400, 500, 600, 700.
- Mono: **JetBrainsMono NF** (Nerd Font variant — powerline glyphs). Fallback: JetBrains Mono, Fira Code, ui-monospace.

Scale: `--text-xs (12)` → `--text-4xl (36px)`. Semantic roles (`h1`–`h6`, `.body`, `.label`, `.rune`, `.mono`) are defined in `tokens.css`; use those, not raw sizes.

### Spacing, radii, elevation, motion

Full scales in `tokens.css`. Notables:

- Spacing: `--space-1` (4px) → `--space-12` (48px)
- Radii: sm (6px) → 2xl (24px) → full (9999px)
- Motion: `--transition-fast: 150ms ease`, `normal: 200ms`, `slow: 300ms`

### Runes

Single-character identity glyphs per plugin / entity kind. See `design/data.jsx::DS_RUNES` and the `rune` field on each entity type.

**Avoid these — they have been appropriated as hate symbols per ADL:** ᛟ (Othala), ᛊ (Sowilo), ᛏ (Tiwaz), ᛉ (Algiz / "Life rune"), ᚺ/ᚻ (Hagalaz, by association). I already stripped them from the prototype. Do not reintroduce.

---

## State management

The prototype's shared state looks like this (simplified):

```ts
// lives in Shell root
const [registry, setRegistry] = useState<TypeRegistry>(DEFAULT_REGISTRY);
const [activeId, setActiveId] = useState<string>(loadFromLS('flokk.active', 'observatory'));
const [tweaks, setTweaks] = useState<Tweaks>(loadFromLS('flokk.tweaks', {}));

// lives inside ObservatoryContent
const rawState = useMockFlokkState(pushEvent);  // ← REPLACE with real subscription
const [events, pushEvent] = useEventLog();       // ← capped at 80 entries
```

Observatory also uses a module-level subscription store to let the subnav and topbar slots read the same state the content slot owns. In a real app, don't do that — use your existing state container (Zustand, Jotai, Redux, whatever).

Registry state is the `registry` object itself; `setRegistry` immutably replaces it on every edit and bumps `version` + `updatedAt`. Port this 1:1.

## Events

`EventLog` expects events of shape:

```ts
{ id: string; time: string; type: 'RAVN'|'TYR'|'MIMIR'|'BIFROST'|'RAID';
  subject: string; body: ReactNode }
```

The decoration (pretty-printing raw simulator ticks into human lines) happens in `app.jsx::decorateEvent`. In production, the backend should emit events of the right shape directly; drop the decoration step.

## Tweaks

The shell implements the Tweaks protocol (postMessage `__edit_mode_available` / `__activate_edit_mode` / `__edit_mode_set_keys`). This is a design-tool protocol, not a production feature — **drop it when porting**. If you want user-configurable view settings (event log on/off, minimap on/off, density cozy/normal/dense), wire them through your real settings system.

## Assets

- **Fonts** in `design/fonts/` — Inter (4 weights) + JetBrainsMonoNerdFont (2 weights). TTF, locally hosted. Your repo presumably already ships these.
- **Icons** — `design/icons.jsx` is a tiny inline-SVG icon set (globe, layers, server, bird, shield, git-branch, waves, hammer, book-open, book-marked, box, cpu, printer, mic, wifi, users, radio). In the real app, switch to your icon library (Lucide / Phosphor / whatever). Match the 16px stroked style.
- **No bitmaps, no external CDNs.**

## Files in `design/`

| File | What it contains |
|---|---|
| `Flokk Observatory.html` | Entry point — mounts React, loads all the scripts |
| `tokens.css` | All design tokens (colors, type, space, radii, motion, themes). **Port verbatim.** |
| `styles.css` | Component-level CSS (shell, drawer, tree, event log, tweaks panel, etc). **Reference — rewrite against your CSS conventions.** |
| `shell.jsx` | `Shell` component + plugin contract. **Port the contract, rewrite the impl.** |
| `app.jsx` | Plugin descriptors (Observatory + Registry + placeholder stubs) + drawers + event log + legend. Read to understand structure. |
| `observatory.jsx` | Canvas renderer — layout, SVG draw calls, pan/zoom, minimap, Mímir orbit, event simulation (`useMockFlokkState`). **Replace the simulator with real data, keep the renderer.** |
| `registry.jsx` | Registry tab UI — types grid, containment tree (with drag-drop reparenting + cycle protection), JSON view, drawer. |
| `data.jsx` | `DEFAULT_REGISTRY` seed + `ShapeSvg`. **Registry schema is authoritative; `ShapeSvg` ports directly.** |
| `icons.jsx` | Inline icon set (replace with your icon library). |
| `fonts/` | Inter + JetBrainsMono NF TTFs. |

---

## Questions the port will surface (flag for product/design before building)

1. **Is the registry editable by end users, or only by admins?** The prototype lets anyone drag-reparent. In production, this probably needs a permission check and an audit trail.
2. **Single-parent or multi-parent?** The prototype assumes single-parent (drag-drop rewrites `parentTypes: [newId]`). The SDD schema allows an array. Confirm intent.
3. **Registry revisions — versioned or latest-wins?** Prototype bumps `version` locally. Real backend probably needs optimistic concurrency or a revision history.
4. **Live topology transport.** Is it a WebSocket frame firehose, SSE, periodic poll? Affects the `LiveTopologyStream` adapter design.
5. **Raid visualisation.** Today raids render as dashed halos over their members. If raids get large (>20 ravens), this needs a different treatment.
6. **Dark-only?** Tokens support theme flex but not light mode.
