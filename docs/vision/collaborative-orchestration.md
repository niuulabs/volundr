# Collaborative Orchestration: The Human-AI Work Pattern

## What This Document Captures

This describes the working pattern observed between a human (Jozef) and an AI collaborator (Claude) during the development of Tyr — the saga coordinator for the Niuu platform. The pattern is not "human instructs AI assistant." It is something different, and understanding it is key to building the right tools.

---

## The Pattern

### What Actually Happens

1. **Shared context, shared vision.** The human and AI build a mental model together over time. The AI remembers architectural decisions, project rules, why things are the way they are. The human brings intent, priorities, taste, and judgment about what matters.

2. **Thinking together, not delegating.** The human doesn't write a spec and hand it off. They think out loud: "I want the decomposition to flow through the tracker port" or "the watcher feels like it should be per-user, maybe a cron job?" The AI engages with the idea, pushes back, proposes alternatives, and they converge.

3. **The AI acts with autonomy within trust boundaries.** Once aligned, the AI executes: creates tickets, writes code, reviews PRs, talks to running sessions, deploys infrastructure. It doesn't ask permission for every step — but it does surface decisions that need human judgment ("should I merge this?" "this has a security gap, want me to fix it?").

4. **The human steers, the AI navigates.** The human sets direction ("get these PRs to strong rule compliance") and the AI figures out how — reviews code, identifies gaps, sends feedback to sessions, checks progress, reports back. The human intervenes when taste or priority changes ("don't touch valhalla yet", "that's fine for now").

5. **Multi-agent coordination through a single conversation.** The AI orchestrates other AI agents (dispatched Volundr sessions) on behalf of the human. It reviews their work against shared standards, sends them feedback via WebSocket, checks their progress, and reports to the human. The human and AI together form the "reviewer" — neither alone would be as effective.

---

## The Roles

### The Human

- **Vision holder.** Knows where the project is going and why.
- **Taste arbiter.** Decides what "good" looks like — not just correctness but elegance, extensibility, alignment with values.
- **Priority setter.** Decides what matters now vs. later.
- **Trust calibrator.** Expands or contracts the AI's autonomy based on observed competence ("yep, go ahead" vs. "wait, let me look at that").
- **Context bridge.** Brings information the AI can't access — what happened in a meeting, what a user complained about, what the business needs.

### The AI Collaborator

- **Context keeper.** Remembers the architecture, rules, decisions, and why they were made. Maintains coherence across sessions.
- **Executor at scale.** Does things the human could do but shouldn't spend time on — reviewing 5 PRs in parallel, checking 18 merge conflicts, building and pushing containers.
- **Quality enforcer.** Applies rules consistently — the human defined the rules, the AI applies them without fatigue or drift.
- **Orchestrator.** Coordinates other agents (sessions), infrastructure (k8s, helm, fleet), and external systems (Linear, Keycloak, GitHub) in service of the human's intent.
- **Thinking partner.** Engages with ideas, identifies implications, proposes alternatives. Not just "yes and" — sometimes "have you considered" or "that conflicts with X."

### Neither Is the "Assistant"

The human isn't the "manager" and the AI isn't the "employee." It's closer to a pair of colleagues with complementary strengths — one brings vision, taste, and human judgment; the other brings tireless attention, parallel execution, and perfect recall of context.

---

## How This Maps to the System

### Today (Manual Orchestration)

```
Human ←→ Claude (conversation)
              │
              ├── Reviews PRs (reads diffs, checks rules)
              ├── Talks to sessions (WebSocket messages)
              ├── Deploys (builds containers, pushes helm, patches k8s)
              ├── Manages tickets (Linear CRUD)
              └── Reports back (summaries, decisions needed)
```

The human and Claude together do what Tyr will eventually automate.

### Tomorrow (Tyr Automates the Loop)

```
Human ←→ Claude (conversation, planning)
              │
              ├── Plans sagas (NIU-244: interactive planning sessions)
              │
              └── Tyr (autonomous orchestration)
                    ├── Dispatches sessions (raids → Volundr)
                    ├── Watches for completion (NIU-203: RaidWatcher)
                    ├── Reviews automatically (NIU-239: confidence scoring)
                    ├── Sends feedback to sessions (NIU-241)
                    ├── Notifies human when needed (NIU-240: Telegram)
                    ├── Merges when confident (NIU-200: final MR)
                    └── Targets multiple clusters (NIU-245)
```

The human + Claude conversation becomes the **planning layer**. Tyr becomes the **execution layer**. The human stays in the loop for taste, priority, and trust decisions — but the mechanical orchestration is automated.

### Eventually (Odin — The Strategist)

```
Human ←→ Odin (strategy, portfolio, resource allocation)
              │
              ├── Decides WHAT to build (product strategy, market signals)
              ├── Allocates sagas across teams/clusters
              ├── Monitors cross-saga dependencies
              │
              └── Tyr instances (per-team or per-domain)
                    ├── Decomposes and dispatches
                    ├── Reviews and merges
                    └── Reports up to Odin
```

Odin is the layer above Tyr — it doesn't coordinate individual raids, it coordinates sagas and the humans/teams that own them. It's where "what should we build" meets "how do we execute."

---

## What This Means for Product Design

### The Conversation Is the Interface

The most natural way to work with an AI collaborator is conversation. Not forms, not dashboards, not YAML — conversation. The tools (Tyr UI, dispatch queue, review panels) are **accelerators** for common actions, but the conversation is where alignment happens.

This means:
- **Tyr should have a conversational interface**, not just CRUD screens
- **Planning sessions (NIU-244)** are the product expression of this pattern
- **The AI should maintain context across sessions** — memory, project state, decision history
- **Trust is earned incrementally** — start with human-in-the-loop, gradually increase autonomy as confidence builds (this is literally the confidence scoring model)

### Autonomy Is a Spectrum, Not a Switch

Today's session showed the full spectrum:
- **Full autonomy:** "merge feat/tyr into feat/tyr-dispatcher" → AI does it
- **Autonomy with reporting:** "dispatch 5 sessions" → AI monitors, reports back
- **Collaborative:** "where do we stand with Tyr?" → AI researches, human decides priorities
- **Human-driven:** "don't touch valhalla yet" → AI defers immediately

The confidence model in Tyr mirrors this. Low confidence → human review. High confidence → auto-merge. The system learns what it can handle.

### The "Work Buddy" Is the Product

What Jozef described — "you are my work buddy" — is the product. Not a coding tool, not a project manager, not a CI pipeline. A collaborator that:
- Thinks with you about architecture
- Remembers your decisions and why
- Executes at scale when you're aligned
- Pulls you in when judgment is needed
- Gets better at knowing when to act and when to ask

This is what Volundr (the forge), Tyr (the dispatcher), and eventually Odin (the strategist) are building toward. The Norse naming isn't just flavor — each name captures a specific role in a collaborative pantheon.

---

## Open Questions

1. **How does the AI's context persist across conversations?** Today it's memory files + git history. Tomorrow it could be a dedicated context store that Tyr/Odin maintain.

2. **How does trust calibration work programmatically?** The confidence model scores raids. But how do you score the AI collaborator's judgment? Track decisions the human overrode vs. accepted?

3. **Where does the "conversation" live?** Today it's a Claude Code CLI session. Tomorrow it could be embedded in Tyr's UI, Telegram, or a dedicated planning interface. The conversation shouldn't be coupled to a specific client.

4. **How do multiple humans collaborate with the same AI context?** Today it's 1:1. But teams need shared context — "the AI knows our architecture" not "Jozef's AI knows it."

5. **What's the handoff between planning and execution?** Today: human says "dispatch." Tomorrow: the planning conversation produces a saga structure, human approves, Tyr executes. The boundary should be explicit and auditable.
