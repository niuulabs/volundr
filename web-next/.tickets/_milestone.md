# Milestone: Visual Parity — web-next matches web2 prototypes

**Project:** Niuu Web — Composable Plugin UI
**Tracking:** 33 tickets across 6 plugins
**Validation:** `pnpm test:visual` — currently 11/33 pass (≤5% pixel diff)
**Target:** all 33 pass

---

## How to run

```bash
cd web-next

# 1. Capture web2 baselines (only needed after web2 changes)
pnpm capture-baselines

# 2. Copy baselines into Playwright snapshot dirs
bash scripts/setup-visual-baselines.sh

# 3. Run visual comparison
pnpm test:visual

# 4. View diff report
pnpm exec playwright show-report
```

---

## Ticket inventory

### Login (1 ticket)

| Page       | File                  | Status              | Gaps                            |
| ---------- | --------------------- | ------------------- | ------------------------------- |
| Login page | `login/login-page.md` | PASS but incomplete | OAuth buttons + footer required |

### Observatory (4 tickets)

| Page                 | File                                  | Status  | Gaps                                     |
| -------------------- | ------------------------------------- | ------- | ---------------------------------------- |
| Canvas               | `observatory/canvas.md`               | FAIL 6% | Unprefixed Tailwind, overlay positioning |
| Registry Types       | `observatory/registry-types.md`       | FAIL 6% | List→cards layout, inspector width       |
| Registry Containment | `observatory/registry-containment.md` | FAIL 6% | Hint box styling, tree indentation       |
| Registry JSON        | `observatory/registry-json.md`        | PASS    | Background color, height constraints     |

### Ravn (5 tickets)

| Page     | File               | Status | Gaps                                         |
| -------- | ------------------ | ------ | -------------------------------------------- |
| Overview | `ravn/overview.md` | PASS   | Grid proportions, missing activity log       |
| Ravens   | `ravn/ravens.md`   | PASS   | 5-tab detail pane mostly missing             |
| Sessions | `ravn/sessions.md` | PASS   | Header, toolbar, composer, injects/emissions |
| Budget   | `ravn/budget.md`   | PASS   | Runway bar, fleet sparkline, projections     |
| Personas | `ravn/personas.md` | PASS   | Largely unimplemented (119 vs 873 lines)     |

### Tyr (7 tickets)

| Page        | File                 | Status  | Gaps                                        |
| ----------- | -------------------- | ------- | ------------------------------------------- |
| Dashboard   | `tyr/dashboard.md`   | FAIL 7% | Topbar stats, toast system                  |
| Sagas list  | `tyr/sagas-list.md`  | FAIL 7% | Workflow card, stage rail, confidence drift |
| Saga detail | `tyr/saga-detail.md` | FAIL    | Raid identifiers, cards, new-saga modal     |
| Dispatch    | `tyr/dispatch.md`    | FAIL    | 3 modals (workflow/threshold/rules)         |
| Workflows   | `tyr/workflows.md`   | FAIL    | Inline styles → Tailwind migration          |
| Plan        | `tyr/plan.md`        | FAIL    | Hint chips, workflow picker, risk badges    |
| Settings    | `tyr/settings.md`    | FAIL    | 4 missing sections                          |

### Mimir (11 tickets)

| Page         | File                    | Status   | Gaps                                  |
| ------------ | ----------------------- | -------- | ------------------------------------- |
| Overview     | `mimir/overview.md`     | FAIL 7%  | Mount detail, ravn bio, pages-touched |
| Pages tree   | `mimir/pages-tree.md`   | FAIL 6%  | Split pane, action bar, wikilinks     |
| Pages reader | `mimir/pages-reader.md` | FAIL     | Timeline zone, action buttons         |
| Sources      | `mimir/sources.md`      | FAIL     | Ingest form UI                        |
| Search       | `mimir/search.md`       | FAIL 6%  | Score display, mount chips            |
| Graph        | `mimir/graph.md`        | FAIL     | Radial layout, hover glow             |
| Entities     | `mimir/entities.md`     | PASS     | New page (self-referential baseline)  |
| Ravns        | `mimir/ravns.md`        | FAIL 6%  | Bio, expertise, tools, pages-touched  |
| Lint         | `mimir/lint.md`         | FAIL 10% | Rule description box                  |
| Routing      | `mimir/routing.md`      | FAIL 7%  | Ingest form cross-link                |
| Dreams       | `mimir/dreams.md`       | FAIL 6%  | Activity log section, kind filters    |

### Volundr (5 tickets)

| Page           | File                        | Status | Gaps                                        |
| -------------- | --------------------------- | ------ | ------------------------------------------- |
| Forge overview | `volundr/forge-overview.md` | FAIL   | Boot progress, sparklines, CLI badges       |
| Templates      | `volundr/templates.md`      | PASS   | Description, usage count, clone/edit        |
| Clusters       | `volundr/clusters.md`       | PASS   | Cluster detail header, disk meter           |
| Sessions       | `volundr/sessions.md`       | FAIL   | Left subnav tree, search filter             |
| Session chat   | `volundr/session-chat.md`   | FAIL   | Gateway, file changes, diffs/chronicle/logs |

---

## Shared components to promote to `@niuulabs/ui`

These components appear in 2+ plugins and should live in the shared UI package
(CLAUDE.md rule 9: promote on second use).

| Component              | Used by                                 | Current location | Action                                                        |
| ---------------------- | --------------------------------------- | ---------------- | ------------------------------------------------------------- |
| `BudgetBar`            | Ravn, Volundr                           | `@niuulabs/ui`   | Already shared                                                |
| `Sparkline`            | Ravn, Tyr, Volundr, Mimir               | `@niuulabs/ui`   | Already shared                                                |
| `KpiStrip` / `KpiCard` | Ravn, Tyr, Mimir, Volundr               | `@niuulabs/ui`   | Already shared                                                |
| `StateDot`             | All plugins                             | `@niuulabs/ui`   | Already shared                                                |
| `MountChip`            | Mimir, Observatory                      | `@niuulabs/ui`   | Already shared                                                |
| `RavnAvatar`           | Mimir, Ravn                             | `@niuulabs/ui`   | Already shared                                                |
| `PersonaAvatar`        | Ravn, Tyr                               | Ravn-local       | **Promote** — Tyr sagas + Ravn detail both use it             |
| `ConfidenceBadge`      | Tyr, Mimir                              | Tyr-local        | **Promote** — Mimir lint + Tyr sagas both show confidence     |
| `StatusBadge`          | Tyr, Ravn, Volundr                      | `@niuulabs/ui`   | Already shared                                                |
| `Toast` / notification | Tyr, Ravn                               | Not implemented  | **Create** in `@niuulabs/ui`                                  |
| `Modal`                | Tyr (dispatch), Volundr (launch wizard) | Not implemented  | **Create** in `@niuulabs/ui`                                  |
| `SegmentedFilter`      | Tyr (dispatch), Ravn (sessions)         | Tyr-local        | **Promote**                                                   |
| `Meter` (resource bar) | Volundr, Observatory                    | Volundr-local    | **Promote** — Observatory entity drawer uses resource display |

---

## Shell layout gaps

| Gap                | Affects     | Description                                                                               |
| ------------------ | ----------- | ----------------------------------------------------------------------------------------- |
| Topbar stats slot  | Tyr, Ravn   | Shell topbar-right should render plugin KPI chips (dispatcher status, active count, etc.) |
| Footer status line | Tyr         | Web2 shows api/sleipnir/mimir connection status in footer                                 |
| Tab count badges   | Tyr         | Tab labels should show counts (e.g., "Sagas 4", "Dispatch 3")                             |
| Subnav collapse    | Ravn, Mimir | Shell subnav should collapse when not needed (Overview tab has no subnav)                 |

---

## Design token gaps

| Token                | Used in web2                        | Missing from `tokens.css`         | Notes                             |
| -------------------- | ----------------------------------- | --------------------------------- | --------------------------------- |
| `--color-text-faint` | Login divider, Mimir                | Check if exists                   | Lighter than `--color-text-muted` |
| `--ice-panel`        | Observatory overlays                | Check if exists                   | Semi-transparent panel background |
| `--color-danger`     | Registry containment (invalid drop) | Check — may be `--color-critical` | Red for destructive states        |

---

## Recommended implementation order

### Phase 1: Shared infrastructure (do first)

1. `Toast` component in `@niuulabs/ui`
2. `Modal` component in `@niuulabs/ui`
3. Promote `PersonaAvatar`, `ConfidenceBadge`, `SegmentedFilter`, `Meter` to `@niuulabs/ui`
4. Fix shell topbar stats slot
5. Fix shell tab count badges

### Phase 2: Quick wins (pages closest to parity)

6. Login — add OAuth buttons + footer
7. Observatory Registry JSON — background color + height fix
8. Observatory Registry Containment — hint box styling
9. Observatory Canvas — fix Tailwind prefixes
10. Mimir Lint — rule description box

### Phase 3: Dashboard pages (high visibility)

11. Tyr Dashboard — topbar stats, toast
12. Ravn Overview — grid proportions, activity log
13. Volundr Forge — boot progress, sparklines
14. Mimir Overview — mount detail, ravn bio

### Phase 4: Detail pages (deep functionality)

15–33. Remaining pages in any order — each is independent once shared components exist

---

## Non-negotiable rules (from CLAUDE.md)

Every ticket implementation MUST follow:

- **Tailwind with `niuu-` prefix** for all styling (rule 6) — no CSS modules, no inline styles, no hard-coded hex
- **Design tokens** for all colors/spacing/typography — never `bg-[#09090b]`, use `bg-bg-primary`
- **Hexagonal architecture** — UI imports from ports only, never from adapters (rule 2)
- **DI via `useService<T>(key)`** — never import concrete services (rule 3)
- **85% test coverage** — unit tests for every new component
- **Playwright e2e** — visual test must pass with ≤5% pixel diff
