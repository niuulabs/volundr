# Volundr: Rebuild to match web2 prototype

**Priority:** Medium
**Estimate:** 2-3 days
**Reference:** `web2/niuu_handoff/volundr/design/` (pages.jsx, forge.jsx, sessions.jsx, atoms.jsx)
**Target:** `web-next/packages/plugin-volundr/`

---

## Summary

Volundr is missing its primary view (Forge/fleet overview), the launch wizard, and the full session detail with chat/terminal/diffs/files tabs. The Templates and Clusters pages are structurally correct.

---

## 1. Forge View / Fleet Overview (MISSING — must add)

web2 `pages.jsx` ForgeView is the main landing page. web-next jumps straight to Sessions.

### Structure:

```
Metric strip (4 tiles):
  Active pods: count + sparkline
  Tokens today: count + sparkline
  Cost today: $amount
  GPUs: count

Three-column layout:
  LEFT: "In-flight pods"
    Booting pods first:
      StatusDot + name + id/cluster + boot progress bar + CliBadge
    Active pods (capped at 6):
      StatusDot + name + SourceLabel + preview text
      Resource meters: Meter(cpu) + Meter(mem) + Meter(gpu)
      Token/cost stats + CliBadge

  CENTER: "Forge load" (clusters grid)
    Per cluster card:
      name + realm + kind badge + pod count
      Mini meters: Meter(cpu, sm) + Meter(mem, sm) + Meter(gpu, sm)

  RIGHT: "Quick launch" (4 template cards)
    Per card: CliBadge + default badge + name + description + resources + usage count
    Click launches forge wizard

Chronicle tail (full width):
  Recent 8 pods: time + StatusDot + name + sep + preview text

Error strip (if errored pods):
  Error message + retry button per pod
```

### Volundr-specific atoms (from atoms.jsx):

- `StatusDot`/`StatusPill`: active/booting/idle/error with activity detail
- `SourceLabel`: git repo@branch link or mount path
- `ClusterChip`: forge/cluster name + kind badge
- `ModelChip`: LLM alias with tier coloring
- `CliBadge`: CLI tool rune + label (e.g. "claude", "cursor", "windsurf")
- `Meter`: CPU/mem/GPU bar with cool/warm/hot levels (6px height, 3 color tiers)
- `Sparkline`: 120x28 inline chart
- `RelTime`: relative time formatter ("3m ago")
- `Segment`: flat toggle control

---

## 2. Templates View (CORRECT — verify details)

web2 structure:

```
Header: CliBadge + template name + default badge + usage count + description
Action buttons: clone, edit, launch
Tabs: overview | workspace | runtime | mcp | skills | rules

Overview tab: 4 cards (CLI/model, Resources, Workspace sources, Extensions)
Workspace tab: list of repo clones + mount points with icons
Runtime tab: 2 cards (Image, Lifecycle)
MCP tab: enabled servers list with descriptions + transport
Skills/Rules: placeholder cards
```

**Current web-next:** Mostly correct. Verify all tabs render with correct content.

---

## 3. Credentials View (MAY BE MISSING)

web2 has a credentials management page:

```
Header: title + "+new credential" button
Table columns: name, type, keys, scope, used count, updated, actions (rotate/copy/delete)
```

**Verify** web-next has this view. If missing, add it.

---

## 4. Clusters View (CORRECT — verify meters)

web2 structure:

```
Header: kind badge + name + realm + status pill + region/nodes
Action buttons: cordon, drain, forge here
Resource meters: CPU, MEMORY, GPU, DISK (Meter component with %/absolute)
Two sections:
  Pods on this forge: list with StatusDot + name + resource usage + CliBadge
  Nodes: grid of node cards with ready/not-ready dots + mini meters
```

**Current web-next:** Structurally correct. Verify:

- Meter component uses 3 color tiers (cool/warm/hot)
- Node cards show mini CPU/mem bars
- Action buttons present

---

## 5. Launch Wizard (MISSING — must add)

web2 `forge.jsx` is a 4-step modal wizard:

### Step indicator: numbered dots (1-4) with done/active/pending states

### Step 1 — Template:

Grid of template cards (selectable, highlight on select):
CliBadge + name + description + resources

### Step 2 — Source:

Tabs: git | local_mount | blank
Git: repo URL + branch + path inputs
Local mount: path + readonly toggle
Blank: just session name
Session name input (auto-generated default)

### Step 3 — Runtime:

CLI tools row: selectable buttons with brand-colored backgrounds (claude/cursor/windsurf/etc.)
Model dropdown
Permission dropdown (restricted/normal/yolo)
Resource inputs: CPU, Memory, GPU (number inputs)
Forge selector dropdown (cluster list)

### Step 4 — Confirm:

Review table: template, cli, model, forge, source, resources, mcp, permission
All as read-only key-value pairs

### Step 5 — Booting (post-submit):

Animated anvil SVG
Step checklist: creating pod → pulling image → mounting volumes → booting CLI → ready
Progress bar
Auto-transitions to session detail when done

### Footer: Back / Continue / Forge buttons (context-dependent per step)

---

## 6. Session Detail (INCOMPLETE — must add tabs)

web2 `sessions.jsx` has a rich session detail view:

### Header:

```
StatusPill + name + id + issue link + SourceLabel + ClusterChip
Divider
Stats row: uptime + msgs + tokens + cost
Optional resources toggle: mini meters (cpu/mem/gpu/disk) + file changes + commits
```

### Tab bar (6 tabs):

```
chat | terminal | diffs | files | chronicle | logs
```

Count badges on tabs where applicable.

### Chat tab (the crown jewel — 3-column layout):

**Left: Peer rail**

```
Header: title + count + collapse toggle
Peer cards (expanded):
  Avatar + name + persona/status metadata
  Expand toggle for: subscriptions, emits, tools, gateway
Peer mini view (collapsed):
  Small avatars in vertical column
```

**Center: Chat stream**

```
Scrolling messages with grouped turns:
  Regular turns: peer avatar + color bar + message text + timestamp
  Tool runs: grouped execution cards (tool name + args + result)
  Thinking turns: foldable thought cards
```

**Right: Mesh cascade**

```
Header + filter buttons (all/outcomes/delegations/notifications)
Collapsible event list:
  Outcome events: kind + time + peer dot + verdict pill + summary
  Mesh messages: delegate/receive + personas + event type + preview
  Notifications: urgency + peer info + summary + recommendation
```

### Other tabs:

- Terminal: xterm.js PTY (placeholder in web2)
- Diffs: file diff viewer (placeholder)
- Files: file tree browser (placeholder)
- Chronicle: session event log (placeholder)
- Logs: container logs (placeholder)

**Current web-next:** Session detail exists but lacks the 3-column chat layout and the peer rail / mesh cascade panels. The tab structure may exist but verify all 6 tabs render.

---

## 7. Volundr Atoms (VERIFY in @niuulabs/ui)

These web2 atoms must exist as shared components:

| Component     | Status | Notes                                                                       |
| ------------- | ------ | --------------------------------------------------------------------------- |
| `StatusDot`   | Exists | Verify cool/warn/hot states match                                           |
| `StatusPill`  | Check  | May need to add activity-detail variant                                     |
| `SourceLabel` | Check  | git repo@branch link or mount path                                          |
| `ClusterChip` | Check  | forge name + kind badge                                                     |
| `ModelChip`   | Check  | LLM alias with tier coloring                                                |
| `CliBadge`    | Check  | CLI rune + label                                                            |
| `Meter`       | Check  | 6px height, 3 color tiers (cool: brand-200, warm: brand-500, hot: critical) |
| `RelTime`     | Check  | "3m ago" formatter                                                          |
| `Segment`     | Exists | Flat toggle control                                                         |

If any are missing, create them in `@niuulabs/ui` as shared primitives.

---

## Acceptance Criteria

- [ ] Forge/fleet overview page renders as landing page
- [ ] Forge overview has 4 metric tiles + 3-column layout + chronicle tail
- [ ] Meter component renders with cool/warm/hot color tiers
- [ ] CliBadge, SourceLabel, ClusterChip, ModelChip components exist
- [ ] Launch wizard is a 4-step modal (template → source → runtime → confirm → booting)
- [ ] Launch wizard has animated anvil SVG on booting step
- [ ] Templates view has all 6 tabs (overview/workspace/runtime/mcp/skills/rules)
- [ ] Credentials view renders with table layout
- [ ] Clusters view shows meters + pods + nodes grid
- [ ] Session detail has 6-tab bar (chat/terminal/diffs/files/chronicle/logs)
- [ ] Chat tab has 3-column layout (peer rail / messages / mesh cascade)
- [ ] All stories render correctly
- [ ] Tests pass with 85% coverage
