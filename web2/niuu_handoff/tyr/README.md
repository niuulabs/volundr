# Handoff: Týr — Saga Coordinator

> The raid orchestrator. Accepts a human goal, decomposes it into phases + raids (sagas), picks personas per stage, dispatches ravens through Sleipnir, and watches them run. Provides the workflow editor, the dispatch queue, and the saga drill-down.

---

## About the design files

The files in `design/` are **design references**, not production code. They are an HTML + Babel-in-browser React prototype that runs as a single page via `Tyr Saga Coordinator.html`. Treat them the way you would a Figma file: they pin down visuals, interactions, data shapes, and component contracts — but your job is to **recreate this in the real Niuu codebase**, using the codebase's existing patterns (hexagonal architecture, bounded contexts, TypeScript/React module system, real backend, etc).

The real backend already exists at `volundr/src/tyr/` (personas, flock config, sagas, raids, dispatch). There's also a partial web UI at `volundr/web/src/modules/tyr/` (Dashboard, Sagas, Planning, Import, Dispatcher, Sessions). This prototype supersedes the partial web UI and should port into the same module path.

Do **not** copy these decisions forward:

- Everything is `.jsx` loaded via Babel standalone and attached to `window.*`. Your real code is TypeScript with ES modules.
- There is no real data layer. `data.jsx` is seed fixtures. Replace with HTTP/WS adapters over the real Tyr service.
- The drag-and-drop DAG editor (`workflow_builder.jsx`) is SVG-only — no ARIA, no keyboard. Port the visual semantics; build accessible interactions on your real graph component.
- The YAML view is highlighted by hand (`validation.jsx::highlightYAML`). Use a real syntax-highlighter (shiki / prism) in production.

What **is** authoritative:

- **The persona library shape** — see `data.jsx::PERSONAS`. Matches `src/ravn/personas/*.yaml`.
- **The saga / raid / phase vocabulary.** Confirm against your domain objects.
- **The workflow validation rules** — see `validation.jsx::validateWorkflow`. Cycle detection, orphan producers, dangling consumers, fan-in policy, confidence-threshold checks. Port the rule set verbatim, re-implement against your graph types.
- **Visual tokens** — see `tokens.css`. Niuu-wide.
- **The plugin contract** — same as every Flokk plugin (rune / title / subtitle / render / subnav / topbarRight / PluginCtx).

## Fidelity

**High-fidelity** on visuals, IA, the workflow-editor interaction model, the dispatch queue, the plan wizard.

**Low-fidelity** on:

- Real-time updates (no WS; mock fixtures)
- Auth / permissions
- Error / empty / loading states (happy-path only)
- Raid execution logs (stubbed — real logs come from session streams)
- Mobile (desktop-first, 1280px minimum)
- Accessibility for the graph editor

---

## Target architecture

```
tyr/
├── domain/
│   ├── persona.ts              # PersonaConfig + library indexing
│   ├── saga.ts                 # Saga aggregate — phases, raids, members, state
│   ├── workflow.ts             # DAG value object + validation rules
│   ├── dispatch.ts             # Queue rules — threshold, concurrency, retries
│   └── validation.ts           # Pure rule set, see design/validation.jsx
├── application/
│   ├── plan-saga.ts            # Prompt → questions → draft saga → approved
│   ├── dispatch-raid.ts        # Feasibility check + Sleipnir emit
│   ├── edit-workflow.ts        # Mutate the DAG, run validation
│   └── observe-saga.ts         # Subscribe to phase/raid status transitions
├── ports/
│   ├── PersonaRegistry.ts      # Read persona YAMLs
│   ├── SagaStore.ts            # CRUD sagas
│   ├── WorkflowStore.ts        # CRUD workflow templates
│   ├── DispatchBus.ts          # Sleipnir emit adapter
│   └── SessionStream.ts        # Live raid session updates
├── adapters/
│   ├── personas-fs.ts          # Load YAML from disk
│   ├── sagas-http.ts
│   ├── workflow-http.ts
│   ├── dispatch-rabbitmq.ts    # Sleipnir
│   └── sessions-ws.ts
└── ui/
    ├── TyrPlugin.tsx
    ├── pages/
    │   ├── DashboardView.tsx
    │   ├── SagasView.tsx
    │   ├── DispatchView.tsx
    │   ├── PlanView.tsx         # wizard: prompt → questions → raiding → draft → approved
    │   ├── WorkflowsView.tsx    # DAG editor + pipeline view + YAML
    │   └── SettingsView.tsx
    └── components/
        ├── PersonaAvatar.tsx
        ├── StatusBadge.tsx
        ├── Pipe.tsx             # phase-progress cell
        ├── GraphCanvas.tsx      # workflow DAG
        ├── PipelineCanvas.tsx   # workflow vertical
        ├── YamlCanvas.tsx
        ├── Library.tsx          # workflow left panel
        ├── Inspector.tsx        # workflow right panel
        └── ValidationPanel.tsx
```

The rail's "Settings" item is a cross-plugin surface — personas, flock config, global defaults. Decide whether it stays inside Týr or moves to a top-level `niuu/settings/` bounded context. The prototype nests it under Týr because personas are Týr's primary domain object.

---

## Plugin contract

Same as every Flokk plugin:

```ts
interface PluginDescriptor {
  id: 'tyr';
  rune: 'ᛃ';                           // Jera — harvest/cycles
  title: string;                       // "Týr · sagas & dispatch"
  subtitle: string;
  render:       (ctx: PluginCtx) => ReactNode;
  subnav?:      (ctx: PluginCtx) => ReactNode;
  topbarRight?: (ctx: PluginCtx) => ReactNode;
}
```

Persist the active tab id + selected saga / selected template / settings section id to localStorage under `tyr.tab`, `tyr.saga`, `tyr.template`, `tyr.settings`.

---

## Screens

### 1. Dashboard

**Purpose:** At-a-glance fleet-wide health and active-work summary.

**Layout** (see `pages.jsx::DashboardView`):

- KPI strip across the top: active sagas · running raids · blocked raids · throughput (raids/hr) · confidence avg.
- Main grid (2 cols, left wider): Active sagas list (clickable → Sagas) + Recent completions.
- Right column: dispatch queue summary, failed raids, token spend sparkline.

### 2. Sagas

**Purpose:** Browse, filter, and drill into all sagas. Subnav shows sagas grouped by status (active · review · complete · failed).

**Layout** (see `pages.jsx::SagasView`):

- Subnav: saga list grouped by status, with search.
- Main: selected saga detail — header (glyph, title, status, confidence, started-at), phase pipeline (the `Pipe` atom in detail), raid list per phase, each raid showing members and current state.
- Clicking a raid opens the raid panel: members (ravens with persona badges), member status, emitted events, output artefacts, "Open session" action → Völundr.

### 3. Dispatch

**Purpose:** The queue. Which raids are ready-to-dispatch, which are blocked, what's running right now, and what the rules are.

**Layout** (see `pages.jsx::DispatchView`):

- Top: rule summary card — confidence threshold, concurrent cap, auto-continue on/off, retries. Edit button opens `EditRulesModal`.
- Segmented filter: all / ready / blocked / queue.
- Table: each row is a pending or running raid — phase, members, status dots, confidence, threshold bar (`ThresholdModal` to tweak inline).
- Batch dispatch action at the bottom: select multiple, dispatch all.

### 4. Plan — the saga wizard

**Purpose:** Turn a human prompt into an approved saga.

**State machine** (see `pages.jsx::PlanView`):

```
prompt → questions → raiding → draft → approved
```

- **prompt** — textarea, submit button.
- **questions** — Týr returns clarifying questions; user answers inline. "Back to prompt" or "Proceed".
- **raiding** — animated placeholder (`RaidingAnim`) while planning ravens decompose the goal.
- **draft** — full saga preview: phases, raids, members, estimated confidence. Edit buttons per phase. Approve → commit. Reject → back to prompt.
- **approved** — confirmation, "Open in Sagas" link.

`StepDots` shows which step is active across the top. Validation errors on transitions render inline, not as a toast.

### 5. Workflows — the DAG editor

The crown-jewel surface. See `workflow_builder.jsx`.

**Three views** (segmented tabs): `graph | pipeline | yaml`.

**Graph view** (`GraphCanvas`):

- SVG canvas, infinite pan (drag-bg), scroll-zoom.
- Nodes: `stage` (240px, stacked members), `gate` (170px, verdict fusion), `cond` (150px, condition branch). Each has port anchors on left (input) / right (output).
- Edges: bezier curves between ports. Color: `--brand-400` default, `--color-critical` on validation error.
- Drag a persona from the Library panel onto a stage to add a member. Drag a new-stage chip into empty space to create a node.
- Click a node → Inspector (right) opens with Config / Validation tabs.
- Delete key removes the selected node + its edges.

**Pipeline view** (`PipelineCanvas`):

- Vertical stages, top-to-bottom, following the DAG topologically from the trigger node.
- Same data, different rendering — for people who prefer linear reading.

**YAML view** (`YamlCanvas`):

- Read-only pretty-printed YAML generated by `workflowToYAML`. Copy button top-right.

**Validation panel** (`ValidationPanel`):

- Floating pill bottom-left, collapses to a count (`3 errs · 2 warns`).
- Expand → scrollable list of every issue, click to select the offending node.
- Rules enforced (see `validation.jsx::validateWorkflow`):
  - `missing_persona` — stage references a persona that doesn't exist
  - `no_producer` — stage consumes an event no other stage produces
  - `no_consumer` — stage produces an event nothing consumes (warn)
  - `cycle` — cycle in the directed graph (unless via an explicit retry edge)
  - `fan_in_misconfig` — multiple producers but no fan-in strategy declared
  - `dangling_condition` — `cond` node with unreached branches
  - `orphan_node` — not reachable from the trigger
  - `confidence_underset` — gate threshold < 0.5

**Library panel** (`Library`):

- Search box.
- Personas grouped by role: Plan / Build / Verify / Review / Gate / Audit / Ship / Index / Report.
- Each entry draggable.
- Below: new-stage / new-gate / new-cond chips.

**Inspector panel** (`Inspector`):

- Two tabs: `config | validation`.
- Config tab varies per node kind. Stage: members (sortable), name, timeout, retry policy, fan-in strategy (if multi-producer), confidence threshold. Gate: verdict policy. Cond: predicate expression.
- Validation tab: `ValidationDetail` — issues filtered to this node.

### 6. Settings

**Plugin:** Settings is itself a separately-rendered surface (`settings_plugin.jsx`) with its own rail item (`⚙`) and its own subnav (`SettingsRail`) that groups sections by module.

**Sections** (prototype has Týr-specific ones; your real app should also include Ravn persona defaults, Bifröst routing, Observatory density, Mímir ingest, Völundr clusters, Valkyrie rules):

- General — timezone, clock format, theme.
- Personas — full persona library browser + YAML editor + "New persona" wizard.
- Flock — flock config, default persona mapping.
- Dispatch — global defaults for confidence / concurrency / retries.
- Notifications — where to notify on failures.
- Audit — event log, access log.

`SettingsTopbar` replaces the normal plugin topbar when the Settings rail item is active.

---

## Key data shapes (from `data.jsx`)

```ts
type Persona = {
  id: string; name: string; role: string; color: string; letter: string;
  consumes: string[];   // event names
  produces: string[];
  summary: string;
};

type Saga = {
  id: string; name: string; status: 'active'|'review'|'complete'|'failed';
  confidence: number;              // 0-1
  startedAt: string; completedAt?: string;
  phases: Phase[];
};

type Phase = {
  id: string; name: string; status: 'queued'|'running'|'complete'|'blocked'|'failed';
  raids: Raid[];
};

type Raid = {
  id: string; name: string; status: string;
  members: RaidMember[];
  events: { type: string; at: string; body: string }[];
  artefacts: { kind: string; ref: string }[];
};

type RaidMember = {
  ravnId: string; personaId: string; state: string;
};

type Workflow = {
  id: string; name: string; version: number;
  trigger: { event: string };
  nodes: Node[];
  edges: { from: string; fromPort: string; to: string; toPort: string; label?: string }[];
};

type Node =
  | { id: string; kind: 'stage'; name: string; members: {personaId: string}[];
      fanIn?: FanInStrategy; timeout?: number; retry?: RetryPolicy;
      confidenceThreshold?: number; x: number; y: number }
  | { id: string; kind: 'gate'; name: string; verdict: 'all'|'any'|'quorum'; quorum?: number; x: number; y: number }
  | { id: string; kind: 'cond'; name: string; predicate: string; x: number; y: number };
```

---

## Components (design tokens inlined)

### Persona avatar (`atoms.jsx::PersonaAvatar`)

22×22 by default. Role-shape outline (ring / halo / hex / chevron / triangle / ring-dashed) + letter glyph inside. Role → shape mapping is deterministic:

```
plan:    triangle
build:   square
verify:  ring
review:  halo
gate:    hex
audit:   chevron
ship:    ring-dashed
index:   mimir-small
report:  pentagon
```

The prototype's `RoleShape` centralises this — port it as one component.

### Status badge (`atoms.jsx::StatusBadge`)

Pill with dot + label. Classes: `b-run` (running), `b-queue` (queued), `b-ok` (complete), `b-warn` (review), `b-err` (failed), `b-dim` (archived).

### Status dot (`atoms.jsx::StatusDot`)

8px circle. Pulses on `running` / `active`. Colors pull from `--status-*` tokens.

### Pipe (`atoms.jsx::Pipe`)

Compact phase-progress cell for tables: a row of tiny squares, one per phase, color-coded by phase status. 18px wide total.

### Confidence badge (`atoms.jsx::Confidence`)

Mini horizontal bar + percentage. Null/0 renders as `—`.

### Persona letter

Single character, uppercase, mono, inside the RoleShape outline. Color always `var(--brand-300)`.

---

## Design tokens

See `design/tokens.css` — same as every other Niuu module. Relevant slices:

### Theme

Default amber. `[data-theme='spring']` green. `[data-theme='ice']` blue. Týr reads reasonably against all three; the prototype defaults to amber.

### Status tokens

```
--status-running:    var(--brand-400)
--status-queued:     var(--color-text-muted)
--status-complete:   #10b981
--status-review:     var(--brand-500)
--status-blocked:    #f59e0b
--status-failed:     var(--color-critical)
--status-archived:   var(--color-text-faint)
```

Port these through `tokens.css`, not hard-coded.

### Runes

Safe set only. Excluded: ᛟ ᛊ ᛏ ᛉ ᚺ ᚻ. See the RUNES map in `data.jsx` for module glyphs.

---

## State management

Top-level shell state (see `shell.jsx`):

```ts
const [activeTab, setActiveTab]         = useState(loadLS('tyr.tab', 'dashboard'));
const [activeSagaId, setActiveSagaId]   = useState(loadLS('tyr.saga'));
const [activeTemplateId, setTemplateId] = useState(loadLS('tyr.template'));
const [templates, setTemplates]         = useState(MOCK_TEMPLATES);  // REPLACE
const [settingsSel, setSettingsSel]     = useState('general');
const [tweaks, setTweaks]               = useState(loadLS('tyr.tweaks', {}));
```

Workflow editor state is local to `WorkflowsView` — keyed by template id, rehydrated from the store on tab-enter.

## Dispatch feasibility

`DispatchView` enforces feasibility before enabling the Dispatch button:

- All required raid members must resolve to a living raven (not a placeholder).
- Confidence ≥ threshold.
- No blocked phase upstream.
- Target cluster (via persona's default Völundr) must report `healthy`.

Surface each failing rule as a per-row warning chip — never disable silently.

## Files in `design/`

| File | What it contains |
|---|---|
| `Tyr Saga Coordinator.html` | Entry — mounts React, loads scripts in order |
| `tokens.css` | Design tokens (port verbatim) |
| `styles.css` | Component-level CSS (reference — rewrite against your conventions) |
| `shell.jsx` | Rail, Topbar, Subnav, Footer; plugin mount-point |
| `data.jsx` | `PERSONAS`, `RUNES`, `SAGAS`, `WORKFLOW_TEMPLATES`, status metas |
| `atoms.jsx` | Persona avatar, status badge/dot, pipe, confidence, sparkline, switch, seg |
| `pages.jsx` | Dashboard, Sagas, Dispatch, Plan, Settings views + modals |
| `workflow_builder.jsx` | Library · GraphCanvas · PipelineCanvas · YamlCanvas · Inspector · ValidationPanel |
| `validation.jsx` | `validateWorkflow` + `workflowToYAML` + `highlightYAML` |
| `settings_plugin.jsx` | Settings rail, main view, replacement topbar |
| `fonts/` | Inter + JetBrainsMono NF |

---

## Questions the port will surface

1. **Who owns the persona library?** Tyr, Ravn, or a shared settings surface? Personas live in `volundr/src/ravn/personas/*.yaml` but the Týr UI is where they're edited in the prototype.
2. **Live WS for saga status vs polling.** The prototype is static. Real impl needs an `observe-saga` WS stream.
3. **Workflow versioning.** Prototype has a single-version-per-template model. Real impl needs optimistic concurrency and a history view.
4. **Dispatch approval gate.** Prototype auto-dispatches when rules pass. Production likely needs a human-in-the-loop option.
5. **Plan wizard model.** Which model plans? Which runs the clarifying questions? Does it run inside a one-shot Völundr session or a dedicated planner raven?
6. **Settings scope.** Is Settings a Týr tab, a dedicated plugin, or a cross-cutting rail item?
