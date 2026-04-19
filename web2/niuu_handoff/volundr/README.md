# Handoff: Völundr — Session Forge

> Spawns and manages remote dev pods. When a raven needs to read code, run a shell, or execute a saga phase, Völundr provisions a session — a containerised dev environment with the right tools, mounts, and credentials — and tears it down when done.

---

## About the design files

The files in `design/` are **design references**, not production code. They are an HTML + Babel-in-browser React prototype that runs as a single page via `Völundr.html`. Treat the prototype like a Figma file: it pins down visuals, interactions, data shapes, and component contracts — but you will **recreate this in the real Niuu codebase**.

The real backend partially exists:

- `volundr/src/volundr/` — session service + pod lifecycle.
- `volundr/web/src/modules/volundr/` — partial web surface.

The prototype supersedes the partial web UI. Port it into the same module path.

Do **not** copy these decisions forward:

- Everything is `.jsx` loaded via Babel standalone. Real code is TypeScript with ES modules.
- Fixture data (`data.jsx`) is seed only.
- Terminal is a styled `<pre>` — production needs xterm.js or similar.

What **is** authoritative:

- **The session lifecycle**: requested → provisioning → ready → running → idle → terminating → terminated. Also: failed states per stage.
- **Pod config**: image, mounts, env, tool allowlist, CPU/mem/GPU, TTL, auto-idle.
- **Three access surfaces**: terminal (PTY), file browser (ro by default), exec (run-and-wait command).
- **Cluster scheduling**: sessions bind to a cluster, respect quotas.

## Fidelity

**High-fidelity** on visuals, IA, session detail, pod template editor, cluster overview.

**Low-fidelity** on:

- Live PTY (mocked transcript)
- Auth / permissions
- Error / empty / loading states
- Real metric streaming (CPU/mem graphs are stubbed)
- Mobile

---

## Target architecture

```
volundr/
├── domain/
│   ├── session.ts            # Session aggregate — lifecycle, resources, bindings
│   ├── pod.ts                # Pod spec — image, mounts, env, quotas
│   ├── template.ts           # Reusable pod templates
│   ├── cluster.ts            # Cluster capacity + scheduling rules
│   └── quota.ts
├── application/
│   ├── provision-session.ts
│   ├── terminate-session.ts
│   ├── edit-template.ts
│   └── observe-session.ts    # live logs + metrics
├── ports/
│   ├── ClusterAdapter.ts     # k8s API
│   ├── SessionStore.ts
│   ├── TemplateStore.ts
│   ├── PtyStream.ts
│   └── MetricsStream.ts
├── adapters/
│   ├── k8s.ts
│   ├── sessions-http.ts
│   ├── templates-http.ts
│   ├── pty-ws.ts
│   └── metrics-prom.ts
└── ui/
    ├── VolundrPlugin.tsx
    ├── pages/
    │   ├── OverviewView.tsx     # active sessions + recent + cluster health
    │   ├── SessionsView.tsx     # list + detail (terminal / files / exec / events)
    │   ├── TemplatesView.tsx    # pod template editor
    │   ├── ClustersView.tsx     # per-cluster capacity + quota
    │   └── HistoryView.tsx      # terminated sessions
    └── components/
        ├── SessionRow.tsx
        ├── LifecycleBadge.tsx
        ├── ResourceBar.tsx        # CPU / mem / GPU
        ├── MountList.tsx
        ├── Terminal.tsx
        ├── FileTree.tsx
        └── TemplateCard.tsx
```

---

## Plugin contract

Same as every Flokk plugin (rune `ᚲ` — Kaunaz, torch/forge):

```ts
interface PluginDescriptor {
  id: 'volundr';
  rune: 'ᚲ';
  title: string;               // "Völundr · session forge"
  subtitle: string;
  render:       (ctx: PluginCtx) => ReactNode;
  subnav?:      (ctx: PluginCtx) => ReactNode;
  topbarRight?: (ctx: PluginCtx) => ReactNode;
}
```

Persist `volundr.tab`, `volundr.session`, `volundr.template`, `volundr.cluster` to localStorage.

---

## Screens

### 1. Overview

- KPI strip: active sessions · idle sessions · total CPU used · total mem used · GPU used · provisioning queue.
- 2-col body: active sessions list (click → Sessions) + cluster health grid.
- Bottom: recent terminations (success vs failed).

### 2. Sessions

**Subnav:** sessions grouped by state (running / idle / provisioning / failed / terminated).

**Main pane** — selected session detail, tabbed:

- **Overview** — identity (id, raven, persona, saga/raid if any), lifecycle badge, runtime, resource bars (CPU / mem / GPU), mounts list, env summary.
- **Terminal** — PTY stream. `xterm.js` in production.
- **Files** — read-only tree browser, click a file to view. Respects the session's mount boundaries.
- **Exec** — run-and-wait command surface. Input box, output pane. History of previous execs.
- **Events** — lifecycle events (provisioned, ready, idle, resumed, terminating, terminated) with timestamps.
- **Metrics** — CPU / mem / GPU over session lifetime.

### 3. Templates

Editor for reusable pod templates. Each template defines:

- Image + tag
- Mounts (name, path in pod, source: git repo / pvc / secret / configmap, read-only flag)
- Env (with secret refs)
- Tool allowlist (subset of Ravn's tool registry that the provisioned session will expose to its bound raven)
- CPU / mem / GPU request + limit
- TTL (max session duration) + idle-timeout (auto-terminate when idle)
- Cluster affinity + taint tolerations

Templates can clone. Version history per template.

### 4. Clusters

One card per cluster (see `flokk/data.jsx` — clusters are realm-bound entities: Valaskjálf, Valhalla, Nóatún, Eitri, Glitnir, Járnviðr).

Card shows: capacity vs used (CPU / mem / GPU), running session count, queued provisions, node health summary, quota per raven / per persona.

### 5. History

Terminated sessions. Filterable by raven, persona, saga, outcome, date range. Each row links to a read-only archived detail view (terminal transcript + events preserved; file system gone).

---

## Key data shapes (from `data.jsx`)

```ts
type Session = {
  id: string;
  ravnId: string;
  personaName: string;
  sagaId?: string;
  raidId?: string;
  templateId: string;
  clusterId: string;
  state: 'requested'|'provisioning'|'ready'|'running'|'idle'
       | 'terminating'|'terminated'|'failed';
  startedAt: string;
  readyAt?: string;
  lastActivityAt?: string;
  terminatedAt?: string;
  resources: {
    cpuRequest: number; cpuLimit: number; cpuUsed: number;
    memRequestMi: number; memLimitMi: number; memUsedMi: number;
    gpuCount: number;
  };
  mounts: Mount[];
  env: Record<string, string>;
  events: { ts: string; kind: string; body: string }[];
};

type Template = {
  id: string; name: string; version: number;
  image: string;
  mounts: Mount[];
  env: Record<string, string>;
  tools: string[];              // tool ids from Ravn's registry
  resources: ResourceSpec;
  ttlSec: number;
  idleTimeoutSec: number;
  clusterAffinity?: string[];
};

type Cluster = {
  id: string; realm: string; name: string;
  capacity: { cpu: number; memMi: number; gpu: number };
  used:     { cpu: number; memMi: number; gpu: number };
  nodes: { id: string; status: 'ready'|'notready'|'cordoned'; role: string }[];
  runningSessions: number;
  queuedProvisions: number;
};
```

---

## Components

- **LifecycleBadge** — state pill with dot. States colored via `--status-*`: provisioning (queue/muted pulsing), ready (ok), running (brand pulsing), idle (muted), terminating (warn pulsing), terminated (faint), failed (err).
- **ResourceBar** — horizontal bar: used / request / limit, with marker at request and limit lines.
- **MountList** — icon (git / pvc / secret / configmap) + mount path + source + ro-flag.
- **Terminal** — xterm.js host. Keyboard-capture + paste pass-through. Read-only flag for archived sessions.
- **FileTree** — ro tree browser; file click opens a viewer pane with appropriate highlighting.
- **TemplateCard** — summary tile for the Templates list.

---

## Design tokens

Niuu-wide `tokens.css`. Völundr is compute-heavy; use mono for anything pod-shaped (ids, image tags, paths, env names).

---

## State management

```ts
const [activeTab]    = useState(loadLS('volundr.tab', 'overview'));
const [sessionId]    = useState(loadLS('volundr.session'));
const [templateId]   = useState(loadLS('volundr.template'));
const [clusterId]    = useState(loadLS('volundr.cluster'));
```

PTY + metrics streams are subscriptions tied to the active session id. Tear down on unmount.

---

## Files in `design/`

| File | What it contains |
|---|---|
| `Völundr.html` | Entry — mounts React |
| `tokens.css` | Design tokens |
| `styles.css` | Component-level CSS — reference only |
| `shell.jsx` | Rail / Topbar / Subnav / Footer |
| `data.jsx` | `SESSIONS`, `TEMPLATES`, `CLUSTERS`, `EVENT_LOG` fixtures |
| `atoms.jsx` | LifecycleBadge, ResourceBar, MountList, Sparkline, etc |
| `pages.jsx` | Overview, Sessions, Templates, Clusters, History views |
| `terminal.jsx` | Mock terminal renderer |
| `fonts/` | Inter + JetBrainsMono NF |

---

## Questions the port will surface

1. **PTY transport.** WS with binary frames, or SSE? Affects reconnect + replay semantics.
2. **File browser security.** Ravens can see mounts they have; can users viewing sessions see the same set, or a subset?
3. **Auto-idle policy.** How does the gateway know a session is idle? Last stdin? Last tool call? Heartbeat from the raven?
4. **Cluster scheduling.** Affinity + taints are expressed in the template. Who resolves conflicts? The k8s scheduler, or a Völundr-side placer?
5. **Secret handling.** Mounts can reference secrets. UI should never render secret values; verify the archived session view doesn't either.
6. **Replay.** Can a terminated session be "rehydrated" — same image, same mounts, fresh state — for reproduction?
7. **Cost accounting.** Every session consumes compute — how does this flow into the fleet budget story alongside Bifröst LLM cost?
