# Handoff: Ravn

> Every agent in Niuu is a Ravn. This module is the fleet console: see what's deployed, edit personas, watch live sessions, set triggers, read the event-wiring graph, and keep an eye on daily spend.

---

## About the design files

The files in `design/` are **design references**, not production code. They are an HTML + Babel-in-browser React prototype that runs as a single page via `Ravn.html`. Treat the prototype the way you would a Figma file: it pins down visuals, interactions, data shapes, and component contracts — but you will **recreate this in the real Niuu codebase**.

The real backend already owns most of the domain:

- `volundr/src/ravn/` — `RavnProfile`, `PersonaConfig`, budget, tools, events, runtime.
- `volundr/src/ravn/personas/*.yaml` — the canonical persona library.
- `volundr/web/src/modules/ravn/` — partial web surface (api client, types, mock data, PersonaCard, PersonaForm, ChatView).

The prototype supersedes the partial web UI. Port it into the same `web/src/modules/ravn/` module.

Do **not** copy these decisions forward:

- Everything is `.jsx` loaded via Babel standalone, attached to `window.RAVN_DATA`, `window.RAVN_ATOMS`, etc. Your real app is TypeScript with ES modules.
- `data.jsx` is seed fixtures — replace with HTTP/WS adapters that call the real Ravn service.
- Persona YAML is hand-highlighted (`personas.jsx::highlightYaml`). Use a real syntax highlighter.
- The Tweaks panel (layout selector etc) is a design-tool protocol. Drop it. Wire any user preferences through your real settings system.

What **is** authoritative:

- **The persona schema** — `data.jsx` shows every field you need to expose: `produces`, `consumes`, `fanIn`, `allowed/forbidden` tools, `permission_mode`, `llm` (alias + thinking + maxTokens), `mimir_write_routing`, description, summary. Matches `src/ravn/domain/persona.py`.
- **The fan-in strategies** — see `FAN_IN_STRATEGIES` in `data.jsx`. Port this catalog verbatim — each strategy specifies its own config fields.
- **The tool registry + destructive-flag model** — see `TOOL_REGISTRY`. Gates the permission UI.
- **The inject catalog** — contextual snippets a persona can request be injected on consumed events.
- **The event catalog** — every produceable event name + its schema.
- **The plugin contract** — same shape as every Flokk plugin.

## Fidelity

**High-fidelity** on visuals, IA, persona editor, sessions transcript, triggers inline-add, budget drill-down.

**Low-fidelity** on:

- Live updates (mock fixtures, no WS)
- Auth / permissions
- Error / empty / loading states (happy-path only)
- Mobile (desktop-first)
- Accessibility on the event-graph view and drag interactions

---

## Target architecture

```
ravn/
├── domain/
│   ├── persona.ts           # PersonaConfig (see design/data.jsx PERSONAS)
│   ├── raven.ts             # RavnProfile (deployed node)
│   ├── session.ts           # Live interaction thread
│   ├── trigger.ts           # Initiative subscriptions
│   ├── budget.ts            # Daily USD cap + spend
│   ├── event-catalog.ts     # Event names + schemas
│   └── tools.ts             # Tool registry + destructive flags
├── application/
│   ├── edit-persona.ts
│   ├── observe-fleet.ts     # Live raven status
│   ├── observe-session.ts   # Live transcript
│   └── dispatch-trigger.ts
├── ports/
│   ├── PersonaStore.ts
│   ├── RavenStream.ts
│   ├── SessionStream.ts
│   ├── TriggerStore.ts
│   └── BudgetStream.ts
├── adapters/
│   ├── personas-fs.ts       # YAML file adapter
│   ├── ravens-ws.ts
│   ├── sessions-ws.ts
│   ├── triggers-http.ts
│   └── budget-http.ts
└── ui/
    ├── RavnPlugin.tsx
    ├── pages/
    │   ├── OverviewView.tsx
    │   ├── RavensView.tsx          # split | table | cards — tweak-selectable
    │   ├── PersonasView.tsx        # form + YAML + subs graph
    │   ├── SessionsView.tsx        # transcript + timeline
    │   ├── TriggersView.tsx        # fleet-wide — per-ravn inline-add lives in RavnDetail
    │   ├── EventsView.tsx          # produces/consumes graph
    │   ├── BudgetView.tsx
    │   └── LogView.tsx
    └── components/
        ├── PersonaAvatar.tsx
        ├── PersonaShape.tsx         # role → shape
        ├── StateDot.tsx / StateBadge.tsx
        ├── BudgetBar.tsx / BudgetRunwayBar.tsx
        ├── MountChip.tsx / DeployBadge.tsx
        ├── EventPicker.tsx
        ├── ToolPicker.tsx
        ├── FanInConfigurator.tsx
        └── Sparkline.tsx
```

---

## Plugin contract

Same shape as every Flokk plugin (rune `ᚱ` — Raidho, journey):

```ts
interface PluginDescriptor {
  id: 'ravn';
  rune: 'ᚱ';
  title: string;       // "Ravn · the flock"
  subtitle: string;
  render:       (ctx: PluginCtx) => ReactNode;
  subnav?:      (ctx: PluginCtx) => ReactNode;
  topbarRight?: (ctx: PluginCtx) => ReactNode;
}

interface PluginCtx {
  registry: TypeRegistry;
  setRegistry: (r) => void;
  tweaks: Record<string, unknown>;
  setTweak: (k, v) => void;
  // Ravn-specific additions the prototype threads:
  activeTab: string; setTab: (s: string) => void;
  selectedRavnId?: string; selectRaven: (id: string) => void;
  selectedPersona?: string; selectPersona: (name: string) => void;
  selectedSessionId?: string; selectSession: (id: string) => void;
}
```

Persist `ravn.tab`, `ravn.ravn`, `ravn.persona`, `ravn.session`, `ravn.tweaks` to localStorage.

---

## Screens

All tabs share the shell's rail / topbar / subnav / footer. Subnav is tab-specific.

### 1. Overview

**Purpose:** Fleet health at-a-glance. Answers "what's happening right now?"

**Layout** (see `overview.jsx::OverviewView`):

- KPI strip: total ravens · active · suspended · triggers today · budget burn · session count.
- 2-column body:
  - **Left:** Active ravens list — one row per running raven, with persona avatar, state dot, location, running-session excerpt.
  - **Right:** "Burning now" — top 5 budget spenders today (with BudgetBar) + Sparkline of fleet hourly cost.
- Bottom: Recent log tail (filterable).

### 2. Ravens

**Purpose:** Catalog of every deployed raven. Three layout variants — user chooses via Tweaks.

**Layouts** (see `pages.jsx::RavensView`):

- **split** — list on left (grouped by location / persona / state / none), detail pane on right.
- **table** — flat sortable table, one row per raven.
- **cards** — 2–3 col grid of raven cards.

**RavnDetail** (right pane) has six sections, each collapsible:

1. **Overview** — identity (name, rune, persona, location, deployment), runtime (uptime, last tick, LLM alias), Mímir mounts, compact budget line (BudgetBar inline).
2. **Triggers** — list of this raven's triggers, with inline "Add trigger" row at the bottom (cron / event / webhook / manual kinds). Adding writes immediately — no modal.
3. **Activity** — this raven's log tail, filterable by kind (iter / tool / emit / wait / budget / trigger / done / idle / suspend).
4. **Sessions** — this raven's open + recent sessions, click → jump to Sessions tab with it selected.
5. **Connectivity** — this raven's event edges (what it consumes, what it produces). Clicking an event → Events tab focused on that event.
6. **Delete / Suspend** actions at the bottom.

**Grouping logic for split view:**

- `location` — asgard / midgard / jotunheim / svartalfheim / desk / phone / etc.
- `persona` — by bound persona id.
- `state` — active / idle / suspended / failed.
- `none` — flat alphabetical.

### 3. Personas

**Purpose:** Edit the persona library. Each persona is a YAML template that any number of ravens can bind to.

**Subnav:** list of personas grouped by role (Plan / Build / Verify / Review / Gate / Audit / Ship / Index / Report).

**Main pane** (see `personas.jsx::PersonasView`):

- Header: persona avatar + name + role + description.
- Tabs: `Form | YAML | Subs`.

**Form tab** (`PersonaForm`) — full editor with sections:

- **Identity** — name, role, letter, color, summary, description.
- **LLM** — model alias dropdown, thinking toggle, max tokens, temperature.
- **Tool access** (`ToolAccessSection`):
  - Allow list (chips) + Deny list (chips).
  - Destructive tools flagged red.
  - `ToolPicker` modal grouped by provider.
  - Permission mode: default / safe / loose.
- **Produces** (`ProducesSection`):
  - Single event this persona emits.
  - `EventPicker` with allow-new.
  - Schema editor (`SchemaEditor`) — key/type pairs for the event payload.
- **Consumes** (`ConsumesSection`):
  - Multiple events this persona subscribes to.
  - Per-event: injects (what to slot into the prompt), producer-trust threshold.
  - `EventPicker` for each row.
- **Fan-in** (`FanInSection`):
  - Strategy dropdown (see `FAN_IN_STRATEGIES`).
  - Strategy-specific config fields.
- **Mímir write routing** — which mount the persona writes to (local / shared / domain).
- **Validation** (`validatePersona`) — checks produces.event exists, role is valid, tool allow/deny are disjoint, etc.

**YAML tab** (`PersonaYaml`) — read-only highlighted YAML.

**Subs tab** (`PersonaSubs`) — subscription graph: upstream producers → this persona → downstream consumers. Each edge labelled with the event name.

**New Persona wizard** (`NewPersonaModal`) — `start → blank | clone`. Clone pulls from an existing persona.

### 4. Sessions

**Purpose:** Live transcript + timeline across all ravens.

**Layout** (see `sessions.jsx::SessionsView`):

- Subnav: session list sorted by recency, each row with persona avatar, raven name, session title, last-activity time.
- Main: transcript (center) + timeline (right).

**Transcript** renders message kinds: `user | asst | system | tool_call | tool_result | emit | think`. Each kind gets its own idiom — do not collapse them into "sender: body" rows.

**Timeline** (`Timeline`): compact vertical list of events in order, each with a synthesised label (`session init`, `tool · read`, `emit · code.changed`, etc).

**ActiveCursor** (`sessions.jsx::ActiveCursor`): shows a blinking persona cursor at the bottom of an in-progress session.

### 5. Triggers (fleet-wide)

**Purpose:** See every trigger across the fleet.

**Note:** Per-raven triggers are edited inline in `RavnDetail` (see Ravens tab). This view is read-only fleet summary.

**Layout:** table grouped by kind (cron / event / webhook / manual), columns: raven, schedule-or-topic, last-fire, next-fire (for cron), success-rate.

### 6. Events

**Purpose:** The produces/consumes graph. "What happens when raven X emits event Y?"

**Layout** (see `pages.jsx::EventsView`):

- SVG graph: producers (left col) → events (center col) → consumers (right col). Edges connect each producer to its events and each event to its subscribers.
- Select an event → focus mode, fades everything not on its path.
- Selecting a persona dims all others — highlights just that persona's producers + consumers.

### 7. Budget

**Purpose:** Fleet-wide daily spend. Answers "who's burning too fast?" "who's near cap?" "should I change anything?"

**Layout** (see `pages.jsx::BudgetView`):

- Hero card: total spent today + total cap + fleet runway bar (`BudgetRunwayBar` — shows spent-so-far, projected end-of-day, and cap).
- Attention columns: **Burning fast** (above projection) · **Near cap** (>80% used) · **Idle** (<10% used). Each column is a stack of `AttnRow` rows with a right-label (projected cost / pct / last-active).
- Full fleet table (collapsible via `FullFleetBudgetTable`) — every raven, sortable by pct.

### 8. Log

**Purpose:** Fleet-wide event stream, filterable.

**Layout:** monospace table, columns `time · raven · kind · body`. Filter strip at top (by kind, by raven, by search). Auto-tail toggle.

---

## Key data shapes (from `data.jsx`)

```ts
type Persona = {
  name: string; role: string; color: string; letter: string; summary: string; description: string;
  llm: { alias: string; thinking: boolean; maxTokens: number; temperature?: number };
  permissionMode: 'default'|'safe'|'loose';
  allowed: string[];        // tool ids
  forbidden: string[];
  produces: {
    event: string;
    schema: Record<string, string>;  // field → type
  };
  consumes: {
    events: { name: string; injects?: string[]; trust?: number }[];
  };
  fanIn?: { strategy: string; params: Record<string, unknown> };
  mimirWriteRouting?: 'local'|'shared'|'domain';
};

type Raven = {
  id: string; name: string; rune: string;
  persona: string;                           // persona.name
  location: string; deployment: string;
  state: 'active'|'idle'|'suspended'|'failed';
  uptime: number; lastTick: string;
  budget: { spentUsd: number; capUsd: number; warnAt: number };
  mounts: { name: string; role: 'primary'|'archive'|'ro'; priority: number }[];
};

type Session = {
  id: string; ravnId: string; title: string;
  triggerId?: string;
  state: 'active'|'idle'|'suspended'|'failed'|'completed';
  startedAt: string; lastAt?: string;
  messages: Message[];
};

type Trigger =
  | { id: string; ravnId: string; kind: 'cron';    schedule: string; description: string }
  | { id: string; ravnId: string; kind: 'event';   topic: string;    producesEvent?: string }
  | { id: string; ravnId: string; kind: 'webhook'; path: string }
  | { id: string; ravnId: string; kind: 'manual' };
```

---

## Tool registry + destructive model

Every tool in `TOOL_REGISTRY` has:

- `id` — unique token (`read`, `write`, `bash`, `git.checkout`, `mimir.write`, etc).
- `group` — provider (fs / shell / git / mimir / observe / security / bus).
- `destructive: bool` — flagged in UI with a red dot.
- `desc` — one-liner for the tooltip.

Destructive tools in the allow list render with a warning stripe; in the deny list they render normally.

## Fan-in strategies (from `data.jsx::FAN_IN_STRATEGIES`)

- `all_must_pass` — every declared producer must report success.
- `any_passes` — accept on first success (race).
- `quorum` — N-of-M with a time window.
- `merge` — concatenate / union payloads.
- `first_wins` — first producer wins, rest discarded.
- `weighted_score` — each producer returns a numeric score, arbiter averages weighted by persona.

Each has its own config fields — the `FanInSection` renders them dynamically from the strategy definition.

---

## Components (design tokens inlined)

### PersonaAvatar

Role-shape outline (halo / triangle / square / ring / hex / chevron / ring-dashed / mimir-small / pentagon) + single-letter glyph inside. Role → shape is the same mapping used in Týr.

### StateDot / StateBadge

`ok` (green, pulses on active), `mute` (neutral), `warn` (amber), `err` (red). Badge adds a label pill. Always pulls from `--status-*` tokens.

### BudgetBar

Horizontal bar. Green < `warnAt`, amber above. Label renders inline percentage if `showLabel`. Size `sm | md`.

### BudgetRunwayBar

The Budget view's custom viz: shows `spent` filled, `projected` (spent + extrapolated remaining day) hatched, `cap` as the bar length. Elapsed-day fraction marks a tick. Use this visual everywhere fleet-wide budget is shown.

### MountChip

Pill: icon + mount name + role. Role classes: `prim` (primary), `arch` (archive), `ro` (read-only). Order by `priority` when listing.

### DeployBadge

Glyph + label for deployment kind: `k8s ◇`, `systemd ◈`, `pi ◆`, `mobile ▲`, `ephemeral ◌`.

### Sparkline

SVG polyline + filled area. 120×28 default. Stroke `var(--brand-300)`, fill `color-mix(in srgb, var(--brand-300) 15%, transparent)`.

### Seg

Segmented control. `sm | md`. Active segment gets `color: var(--brand-300)` + `background: color-mix(in srgb, var(--brand-500) 18%, transparent)`.

### EventPicker

Combobox over `EVENT_NAMES`. Supports: `allowNew` (create a new event name), `allowEmpty` (clearable), `asChip` (renders as a clickable chip that opens the picker).

### ToolPicker

Modal grouped by tool-group (fs / shell / git / mimir / observe / security / bus), searchable. Excludes already-picked tools via `excluded` prop.

### SchemaEditor

Key-type grid. Types: `string | number | boolean | object | array | any`. Read-only when `!editing`.

---

## Design tokens

See `tokens.css` — Niuu-wide.

### Theme

Prototype defaults to amber. Works fine on spring-green and ice-blue.

### Status tokens

```
--state-ok:  #10b981
--state-mute: var(--color-text-muted)
--state-warn: #f59e0b
--state-err:  var(--color-critical)
```

### Runes

See `RUNES` in `_ds_data.jsx`. Safe subset only.

---

## State management

```ts
// shell.jsx
const [activeTab]   = useState(loadLS('ravn.tab', 'overview'));
const [ravnId]      = useState(loadLS('ravn.ravn'));
const [personaName] = useState(loadLS('ravn.persona'));
const [sessionId]   = useState(loadLS('ravn.session'));
const [tweaks]      = useState(loadLS('ravn.tweaks', { ravensLayout: 'split' }));
```

`ctx` is passed down as `{ activeTab, setTab, selectedRavnId, selectRaven, ...tweaks, setTweak }`.

Persona edit state is local to `PersonaForm` with a `dirty` flag — commit on explicit Save.

---

## Files in `design/`

| File | What it contains |
|---|---|
| `Ravn.html` | Entry — mounts React, loads scripts in dependency order |
| `tokens.css` | Design tokens — port verbatim |
| `styles.css` | Component-level CSS — reference only |
| `personas-editor.css` | Form-specific rules for the persona editor |
| `shell.jsx` | RavnShell, Rail, Topbar, Subnav, Footer, PageRouter, TweaksPanel |
| `_ds_data.jsx` | Runes, shapes, `ShapeSvg` — shared with Observatory |
| `data.jsx` | `PERSONAS`, `RAVENS`, `SESSIONS`, `SESSION_MESSAGES`, `TRIGGERS`, `LOG`, `BUDGET_HOURLY`, `TOOL_REGISTRY`, `FAN_IN_STRATEGIES`, `EVENT_CATALOG`, `INJECT_CATALOG`, `PERSONA_YAML` |
| `atoms.jsx` | PersonaAvatar, PersonaShape, StateDot/Badge, BudgetBar, Sparkline, MountChip, DeployBadge, Metric, Seg, Kbd |
| `icons.jsx` | Lucide-static wrapper + Rune glyph |
| `overview.jsx` | Overview tab |
| `pages.jsx` | Ravens (split / table / cards), RavnDetail, Budget, Triggers (fleet-wide), Events, Log |
| `personas.jsx` | PersonasView, PersonaForm, ToolPicker, EventPicker, FanInSection, SchemaEditor, NewPersonaModal |
| `sessions.jsx` | SessionsView, Message, ActiveCursor, Timeline |
| `fonts/` | Inter + JetBrainsMono NF |

---

## Questions the port will surface

1. **Persona edit conflicts.** Prototype assumes single-writer. Real backend needs optimistic concurrency + a revision history.
2. **Live session transport.** WS? SSE? Polling? Affects `SessionStream` adapter.
3. **Trigger execution semantics.** Cron triggers — where's the cron daemon? Event triggers — Skuld? Webhook triggers — who terminates TLS?
4. **Budget enforcement.** Soft-cap (warn) vs hard-cap (refuse to dispatch)? Prototype visualises but doesn't enforce.
5. **Tool permissions.** Destructive tools in production probably need an approval step per-invocation, not just per-persona.
6. **Persona YAML source of truth.** File system (`src/ravn/personas/*.yaml`), a config store, or both? Editing in the UI needs a clean write-back path.
7. **Ravens list filtering.** Prototype groups by location / persona / state / none. Real fleet might need realm / cluster / host / tag filters too.
