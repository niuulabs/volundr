# Handoff: Mímir — the knowledge well

> Niuu's persistent memory. A multi-mount knowledge graph of compiled-truth pages, raw sources, and entities. Every long-lived raven reads from it, and every dream-cycle writes into it. This module is the ops console: browse mounts, read/edit pages, run search, tune ingest, fix lint, inspect routing.

---

## About the design files

The files in `design/` are **design references**, not production code. They are an HTML + Babel-in-browser React prototype that runs as a single page via `Flokk Mimir.html`. Treat them like a Figma file: they pin down visuals, interactions, data shapes, and component contracts — you will **recreate this in the real Niuu codebase** using its patterns (hexagonal architecture, TypeScript, real backend).

Real backend does not yet exist for Mímir — this prototype defines the domain + UI surface you should build against.

Do **not** copy these decisions forward:

- Everything is `.jsx` loaded via Babel standalone. Real code is TypeScript with ES modules.
- Fixture data (`data.jsx`) is seed only — replace with adapters over the real Mímir service.
- Page rendering is static Markdown-like templating — production needs a real MD renderer + wikilink resolver.
- Graph view is hand-drawn SVG. Pick a real graph lib (cytoscape, visx, d3-force) for production.

What **is** authoritative:

- **Multi-mount model.** A Mímir is a set of mounts, each a standalone instance. Roles: `local` (operator's own), `shared` (realm-wide), `domain` (prefix-scoped). Each mount has host, URL, priority, embedding model, page/source counts, health, and optional category allowlist.
- **Write routing.** Prefix rules decide which mount(s) a write hits. See `ROUTING_RULES` in `data.jsx`. Fallthrough is `ROUTING_DEFAULT` (`['local']`).
- **Ravn bindings.** Each raven has per-mount access modes (`r`, `w`, `rw`). The UI must respect these — no editing a page on a mount the raven can't write.
- **Page kinds.** `entity`, `topic`, `directive`, `preference`, `decision`. Each has canonical zones (Key facts, Relationships, Assessment, Timeline, Source log). Zones are structured, not freeform — they compile from source fragments.
- **Confidence levels.** `high`, `medium`, `low`. Surface in UI, never compute in UI.
- **Lint rules.** L01–L12 (contradictions, broken wikilinks, stale index, invalid frontmatter, etc). Each has an auto-fix flag and an assignee.
- **Dream cycle.** Idle-time synthesis pass that updates pages, creates entities, applies lint fixes. Each raven has a `last_dream` and a last-run summary.
- **The plugin contract** — same as every Flokk plugin.

## Fidelity

**High-fidelity** on visuals, IA, pages browser, reader, search, routing editor, lint queue, ravn bindings.

**Low-fidelity** on:

- Live updates (mock fixtures, no WS)
- Auth / permissions
- Error / empty / loading states
- Real markdown rendering + wikilink resolution
- Mobile (desktop-first)
- Graph layout (hand-drawn)

---

## Target architecture

```
mimir/
├── domain/
│   ├── mount.ts              # Mount spec + role + categories + priority
│   ├── page.ts               # Page aggregate — path, type, zones, confidence
│   ├── zone.ts               # KeyFacts | Relationships | Assessment | Timeline
│   ├── source.ts             # Raw ingest record
│   ├── entity.ts             # Typed entity pages (person/org/concept/...)
│   ├── routing.ts            # Write-routing rules
│   ├── lint.ts               # L01–L12 rule catalog + auto-fix flags
│   ├── dream.ts              # Dream-cycle run records
│   └── binding.ts            # Ravn × mount × mode
├── application/
│   ├── search.ts             # fts | semantic | hybrid
│   ├── route-write.ts        # resolve write → mount set
│   ├── run-lint.ts
│   ├── run-dream-cycle.ts
│   └── observe-mount.ts      # live stats
├── ports/
│   ├── MountAdapter.ts       # per-mount API (http/file)
│   ├── PageStore.ts
│   ├── SourceStore.ts
│   ├── EmbeddingStore.ts     # vector index per mount
│   ├── LintEngine.ts
│   └── RoutingStore.ts
├── adapters/
│   ├── mount-http.ts
│   ├── mount-fs.ts           # local mount
│   ├── embedding-local.ts    # MiniLM / mpnet
│   ├── lint-engine.ts
│   └── routing-http.ts
└── ui/
    ├── MimirPlugin.tsx
    ├── pages/
    │   ├── OverviewView.tsx    # home — mounts + counts + recent writes
    │   ├── PagesView.tsx       # tree + reader
    │   ├── SearchView.tsx
    │   ├── GraphView.tsx
    │   ├── SourcesView.tsx
    │   ├── EntitiesView.tsx
    │   ├── RavnsView.tsx       # ravn bindings
    │   ├── RoutingView.tsx
    │   ├── LintView.tsx
    │   └── DreamsView.tsx
    └── components/
        ├── MountChip.tsx
        ├── ConfidenceBadge.tsx
        ├── PageTypeGlyph.tsx
        ├── ZoneHeader.tsx
        ├── WikilinkPill.tsx
        ├── RavnAvatar.tsx
        ├── LintBadge.tsx
        └── SearchBar.tsx       # mode toggle: fts | semantic | hybrid
```

---

## Plugin contract

Same as every Flokk plugin (rune `ᛗ` — Mannaz, human/wisdom):

```ts
interface PluginDescriptor {
  id: 'mimir';
  rune: 'ᛗ';
  title: string;                 // "Mímir · the well of knowledge"
  subtitle: string;
  render:       (ctx: PluginCtx) => ReactNode;
  subnav?:      (ctx: PluginCtx) => ReactNode;
  topbarRight?: (ctx: PluginCtx) => ReactNode;
}
```

Persist `mimir.tab`, `mimir.mount`, `mimir.page`, `mimir.query`, `mimir.ravn` to localStorage.

---

## Screens

### 1. Overview

Fleet-wide. KPI strip: total pages · total sources · mounts healthy/degraded/down · lint issues open · last dream-cycle · pending ingest.

Body:
- Mount grid — one card per mount, showing role, host, priority, page/source count, last-write, health.
- Recent writes tail — per-mount, most-recent-first, clickable to open the page in the reader.

### 2. Pages (tree + reader)

**Left:** file-tree over all mounts, union-merged by path. Each leaf annotated with the mount(s) that carry it. Filter strip: by mount, by type, by confidence.

**Center:** reader pane. Renders the page's structured zones in order: **Key facts** → **Relationships** → **Assessment** → **Timeline**. Header: title + type glyph + confidence badge + mount chips + updated-by/at.

**Right:** source log — the raw sources compiled into this page. Each source row: `src_id`, origin, ingested-at, compile contribution (which zones it fed).

Edit mode is zone-by-zone. Saving a zone: runs the route-write, shows destination mount(s), writes with optimistic locking, refreshes the lint badges.

### 3. Search

Mode toggle at the top: `fts | semantic | hybrid`.

- **fts** — trigram/FTS over page text + frontmatter.
- **semantic** — vector search using the mount's embedding model. Multi-mount queries fan out then merge.
- **hybrid** — BM25 + cosine blend, tunable weight.

Results list: title + type glyph + confidence + snippet with highlighted matches + mount chips + score breakdown. Expand a result → preview pane on the right.

Filters: mount, type, confidence, entity-type, updated-range.

### 4. Graph

Page-to-page relationship graph, laid out force-directed. Click a page → focus mode (subgraph n-hops out). Edge kinds: `related`, `supersedes`, `contradicts`, `entity-of`, `source-of`. Legend shows edge colors.

Filter: by type, by mount, by entity-type.

### 5. Sources

Raw ingest records. Filter by origin (web / rss / arxiv / file / mail / chat). Each row: source id, origin, url/path, ingested-at, ingest-agent (ravn), compiled-into (list of pages).

Click → full source preview (the original text), with back-links to compiled pages.

### 6. Entities

Typed entity pages — person, org, concept, project, component, technology, etc. Grouped by entity type. Each tile shows: entity glyph + name + summary + relationship count. Click → opens in the reader.

### 7. Ravns (bindings)

For each raven, show its mount bindings (mount × mode), last-dream-at, dream-last summary (pages updated / entities created / lint fixes), expertise tags, bio. Access shows pulse color: `rw` (brand), `w` (amber), `r` (muted).

Edit a binding inline: change mode, add/remove mount.

### 8. Routing

The write-routing editor.

- Rule list, ordered by priority (prefix match is first-match).
- Each row: prefix (editable) + target mounts (reorderable chips).
- Fallthrough mount shown at the bottom.
- Test pane: type a page path, see which mount(s) a write would hit and why.

### 9. Lint

Queue of open lint issues. Grouped by rule (L01 contradictions, L02 stale source, L05 broken wikilink, L07 orphan, L11 stale index, L12 invalid frontmatter, …). Each issue: page, mount, rule, severity, assignee (ravn), auto-fixable flag, suggested fix.

Bulk actions: auto-fix (for flagged rules), reassign, dismiss.

### 10. Dreams

Dream-cycle history. Table: timestamp, ravn, mounts, pages updated, entities created, lint fixes, duration. Click a run → detail pane with the full changelog.

---

## Key data shapes

See `data.jsx` for full fixtures. Core types:

```ts
type Mount = {
  name: string;
  role: 'local' | 'shared' | 'domain';
  host: string; url: string;
  priority: number;
  categories: string[] | null;     // null = accepts all
  status: 'healthy' | 'degraded' | 'down';
  pages: number; sources: number; lint_issues: number;
  last_write: string;
  embedding: string;               // model id
  size_kb: number;
  desc: string;
};

type RoutingRule = { prefix: string; mounts: string[] };

type Page = {
  path: string; title: string;
  type: 'entity' | 'topic' | 'directive' | 'preference' | 'decision';
  confidence: 'high' | 'medium' | 'low';
  entity_type?: string;
  category: string;
  summary: string;
  mounts: string[];                // which mounts carry it
  updated_at: string;
  updated_by: string;              // ravn id
  source_ids: string[];
  related: string[];               // page slugs
  size: number;
  content?: {
    keyFacts: string[];
    relationships: { slug: string; note: string }[];
    assessment: string;
    timeline: { date: string; note: string; source: string }[];
  };
};

type Ravn = {
  id: string; name: string; rune: string;
  persona: string; role: string;
  state: 'thinking'|'observing'|'working'|'idle'|'dreaming';
  tools: string[];
  bindings: { mount: string; mode: 'r'|'w'|'rw' }[];
  expertise: string[];
  pages_touched: number;
  last_dream: string;
  dream_last: { pages_updated: number; entities_created: number; lint_fixes: number };
  bio: string;
};

type LintIssue = {
  id: string;
  rule: 'L01'|'L02'|'L05'|'L07'|'L11'|'L12'|...;
  severity: 'info'|'warn'|'error';
  page: string; mount: string;
  assignee?: string;               // ravn id
  autoFix: boolean;
  message: string;
  fix?: { description: string; apply: () => void };
};
```

---

## Components

- **MountChip** — rounded rect: role glyph (◉ local / ◎ shared / ◈ domain) + name. Color by role.
- **ConfidenceBadge** — dot + label (high/medium/low). Green / amber / muted.
- **PageTypeGlyph** — small icon per page type. Entity (person silhouette / org block / concept swirl), topic (doc), directive (arrow), preference (star), decision (diamond).
- **ZoneHeader** — section header for reader zones. Monospace label + separator rule.
- **WikilinkPill** — `[[slug]]` resolved to a pill with the target's type glyph + title. Red if broken (L05).
- **SearchBar** — input + mode toggle (fts / semantic / hybrid) + filter popover.
- **LintBadge** — rule code + severity dot.
- **RavnAvatar** — role-shape outline + rune glyph + colored state dot (shared with Ravn module).

---

## Design tokens

Niuu-wide `tokens.css`. Mímir leans heavily on mono — page paths, source ids, timestamps, wikilinks all in JetBrainsMono NF. Body prose stays in Inter.

Mount-role hues should be distinct but quiet:
- local — `--brand-400`
- shared — cool blue (matches Observatory ice theme)
- domain — soft violet

---

## State management

```ts
const [activeTab]    = useState(loadLS('mimir.tab', 'overview'));
const [mountId]      = useState(loadLS('mimir.mount'));
const [pagePath]     = useState(loadLS('mimir.page'));
const [query]        = useState(loadLS('mimir.query', { text: '', mode: 'hybrid' }));
const [ravnId]       = useState(loadLS('mimir.ravn'));
```

Reader state is local to `PagesView` — selection + editing dirty flag.

Search is mount-fanout. Each mount adapter runs independently; UI merges + ranks.

---

## Files in `design/`

| File | What it contains |
|---|---|
| `Flokk Mimir.html` | Entry — mounts React, loads scripts in dependency order |
| `tokens.css` | Design tokens |
| `styles.css` | Component-level CSS — reference only |
| `mimir.css` | Mímir-specific overrides |
| `shell.jsx` | Rail / Topbar / Subnav / Footer |
| `_ds_data.jsx` | Runes + ShapeSvg (shared with Observatory + Ravn) |
| `data.jsx` | `MOUNTS`, `RAVNS`, `PAGES`, `ROUTING_RULES`, `ROUTING_DEFAULT`, lint + dream fixtures |
| `atoms.jsx` | MountChip, ConfidenceBadge, PageTypeGlyph, WikilinkPill, LintBadge, SearchBar, RavnAvatar |
| `icons.jsx` | Lucide wrapper + rune glyphs |
| `app.jsx` | Top-level plugin mount |
| `plugin.jsx` | Plugin descriptor + router |
| `home.jsx` | Overview view |
| `pages.jsx` | Pages (tree + reader), Sources, Entities, Lint, Dreams |
| `views.jsx` | Search, Graph, Routing, Ravns |
| `fonts/` | Inter + JetBrainsMono NF |

---

## Questions the port will surface

1. **Mount federation protocol.** Each mount is standalone — what's the wire contract? REST? gRPC? Do remote mounts need auth per ravn or per operator?
2. **Embedding-model drift.** Mounts with different embedding models can't share vector space. When a semantic query fans out, how do we reconcile scores? (Prototype shows per-mount scores, UI merge.)
3. **Zone compilation pipeline.** Who compiles sources → zones? A dedicated ravn (Fjölnir) only, or any writing raven? Needs a lock model to avoid concurrent recompiles.
4. **Write-routing conflicts.** Prefix rules can overlap. Prototype uses first-match. Real impl should validate no rule shadows another in a confusing way.
5. **Lint engine.** Is it a separate service, an in-process module, or a ravn? Affects how auto-fix runs + how issues are published.
6. **Dream-cycle scheduling.** Who decides when? Time-based, pressure-based (new-source count), idle-based? The UI surfaces `last_dream` but the trigger isn't specified.
7. **Source immutability.** Sources should be append-only. Compiled zones are rewritable. Confirm this invariant at the storage layer.
8. **Wikilink resolution.** Cross-mount? The same `[[slug]]` may exist on multiple mounts — which one does the reader link to?
