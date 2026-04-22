# L'Olympus Architecture Visual (April 2026)

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Olympus Web App (Next.js 15)                          │
│                                                                              │
│  ┌──────────────────────────────┬───────────────────────────────────────┐  │
│  │         Chat Panel (Left)    │       Main Canvas (Center)            │  │
│  │  • Messages                  │  • Workspace (Monaco + Files)         │  │
│  │  • Content blocks            │  • Pipeline (DAG)                     │  │
│  │  • Streaming SSE             │  • Implement (Ticket controls)        │  │
│  │  • Barge-in (human steer)    │  • Runtime (Dev server + preview)     │  │
│  │                              │  • Replay (Event timeline scrubber)   │  │
│  │                              │  • Budgets (Token/wall-clock/USD)     │  │
│  ├──────────────────────────────┴───────────────────────────────────────┤  │
│  │                                                                         │  │
│  │                    3-Region Layout (always responsive)                │  │
│  │                                                                         │  │
│  │    Context Rail (Right)                                              │  │
│  │    • Phase indicator                                                 │  │
│  │    • Role avatars (dotLottie)                                        │  │
│  │    • Budget meters                                                   │  │
│  │    • Event feed                                                      │  │
│  │    • Gate status                                                     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ SSE (events, tokens)
                                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│                   Software House Supervisor (Core)                          │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Supervisor Loop (1s tick)                                            │  │
│  │  1. Check budgets (tokens/wall-clock/USD)                           │  │
│  │  2. Seed current phase's primary task (if not already)              │  │
│  │  3. Let workers claim and execute tasks                             │  │
│  │  4. Check idle buffer + gate validation → advance phase             │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    ▲                                        │
│                    ┌───────────────┴────────────────┐                      │
│  ┌────────────────┴──┐                  ┌──────────┴─────────────┐        │
│  │ Worker Loop 1      │                  │ Worker Loop N           │        │
│  │ (role: backend-dev)│                  │ (role: qa)              │        │
│  │                    │                  │                         │        │
│  │ 1. Claim next task │  ···  Task ···   │ 1. Claim next task      │        │
│  │    (atomic read)   │  Pool  Queue     │    (atomic read)        │        │
│  │ 2. Execute handler │                  │ 2. Execute handler      │        │
│  │ 3. Mark complete   │                  │ 3. Mark complete        │        │
│  │    (update snap)   │                  │    (update snap)        │        │
│  └────────────────────┘                  └─────────────────────────┘        │
│                                                                              │
│  Persistent Task Pool (.software-house/task-pool.json)                    │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Task Schema:                                                         │  │
│  │  { id, slug, kind, role, phase, status, payload, dependsOn,        │  │
│  │    claimedBy, claimedAt, finishedAt, ... }                         │  │
│  │                                                                      │  │
│  │ 15 Task Kinds:                                                     │  │
│  │  • orchestrator-intake, orchestrator-clarify                       │  │
│  │  • pm-spec, architect-design, techlead-plan                       │  │
│  │  • phase-review (gates)                                            │  │
│  │  • ticket-dev, ticket-review (parallel work)                      │  │
│  │  • devops-bringup, qa-plan, incident-*, security-review, etc.     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                    ┌───────────────┴────────────────┐
                    │                                │
                    ▼                                ▼
    ┌───────────────────────────┐      ┌────────────────────────────┐
    │  LLM Provider + Router     │      │  Workspace Filesystem      │
    │                            │      │  (.software-house/)        │
    │ • OpenRouter (default)     │      │                            │
    │ • Mock (offline)           │      │ • state.json               │
    │ • OpenAI-compat (future)   │      │ • REQUIREMENTS.md          │
    │                            │      │ • SPEC.md                  │
    │ 4-Tier Routing:            │      │ • ARCHITECTURE.md          │
    │ • FAST (release, writer)   │      │ • PLAN.md + ADRs           │
    │ • REASONING (orchestrator, │      │ • tickets/T-*.md + index   │
    │   pm, architect, etc.)     │      │ • incidents/I-*.md + index │
    │ • CODING (dev trio)        │      │ • reviews/PR-*-review.md   │
    │ • VISION (qa)              │      │ • qa/reports/R-*.md        │
    │                            │      │ • CHANGELOG.md             │
    │ Model Pricing:             │      │ • SECURITY_REVIEW.md       │
    │ • Track tokens → USD       │      │ • events.ndjson            │
    │ • Enforce budgets          │      │ • messages.ndjson          │
    │ • Emit cost events         │      │ • task-pool.json           │
    └───────────────────────────┘      └────────────────────────────┘
```

## 14-Phase Pipeline State Machine

```
                         Human Input
                              │
                              ▼
                    ┌─────────────────┐
                    │     INTAKE      │  Orchestrator: gather requirement
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │    CLARIFY      │  Orchestrator: ask crucial questions
                    └────────┬────────┘       (human-gated)
                             │
                             ▼
                    ┌─────────────────┐
                    │      SPEC       │  PM: user stories + acceptance criteria
                    └────────┬────────┘       (reviewer gates advance)
                             │
                             ▼
                    ┌─────────────────┐
                    │   ARCHITECT     │  Architect: design + ADRs
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │      PLAN       │  Tech Lead: ticket breakdown + DAG
                    └────────┬────────┘       (seeds ticket-dev tasks)
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
    ┌─────────────────┐         ┌─────────────────┐
    │   IMPLEMENT     │◄────────┤    REVIEW       │  Parallel:
    │ (dev trio work) │         │ (reviewer gates)│  • Dev claims ticket-dev
    └────────┬────────┘         └────────┬────────┘  • Reviewer claims ticket-review
             │                           │           • Attempt budget: 6 per ticket
             └───────────┬───────────────┘           • If request-changes: retry
                         │
                         ▼
                    ┌─────────────────┐
                    │  INTEGRATE      │  Orchestrator: all tickets done, PRs merged
                    └────────┬────────┘       (gate: allTicketsDone)
                             │
                             ▼
                    ┌─────────────────┐
                    │    BRINGUP      │  DevOps: spawn `pnpm dev`, allocate port
                    └────────┬────────┘       (host-side, no Docker in v1)
                             │
                             ▼
                    ┌─────────────────┐
                    │  QA_MANUAL      │  QA: write test plan, run Playwright
                    └────────┬────────┘       (test failures → incidents)
                             │
                             ▼
                    ┌─────────────────┐
                    │  SELF_HEAL      │  Incident: triage + dispatch to dev role
                    └────────┬────────┘       (bounded 3 attempts per incident)
                             │
                             ▼
                    ┌─────────────────┐
                    │  SECURITY       │  Security: readonly audit
                    └────────┬────────┘       (no blocking findings enforced yet)
                             │
                             ▼
                    ┌─────────────────┐
                    │    RELEASE      │  Release: version + CHANGELOG
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │      DEMO       │  Writer: final presentation (terminal)
                    └─────────────────┘

Key Invariants:
• Each phase produces at least one artifact
• No role reviews its own output (cross-role gates)
• Budget enforcement at each supervisor tick
• Graceful pausing on budget exhaustion
• All state persisted to .software-house/ (offline-safe)
• Events logged to NDJSON (observable, replayable)
```

## 13 Agent Roles (by Tier)

```
REASONING Tier (Deep thinking, multi-step reasoning)
├─ Orchestrator      (INTAKE/CLARIFY: gather + clarify requirements)
├─ PM                (SPEC: write user stories + acceptance criteria)
├─ Architect         (ARCHITECT: design + ADRs)
├─ Tech Lead         (PLAN: ticket breakdown + DAG)
├─ Reviewer          (REVIEW: code review with gate enforcement)
├─ Security          (SECURITY: audit for vulns + bad practices)
└─ Incident          (SELF_HEAL: triage + classify failures)

CODING Tier (Code generation, edits, refactors)
├─ Backend Dev       (IMPLEMENT: API/services)
├─ Frontend Dev      (IMPLEMENT: UI)
└─ DevOps            (BRINGUP: startup scripts + infra)

VISION Tier (Multimodal, screenshots + ARIA snapshots)
└─ QA                (QA_MANUAL: test plan + Playwright runner)

FAST Tier (Quick, straightforward)
├─ Release           (RELEASE: version + changelog)
└─ Writer            (DEMO: presentation)

Concurrency & Routing:
├─ Configurable via config/employees/{role}.json
├─ Default: 1 worker per role
├─ Devs can run in parallel: backend-dev × 2, frontend-dev × 2
├─ Per-role model override: ROLE_MODEL_{ORCHESTRATOR}=...
└─ Tier → model fallback: MODEL_TIER_REASONING=openai/gpt-4-mini
```

## Budget System (Three Caps)

```
┌─────────────────────────────────────────────────────────────────┐
│                       Budget Enforcement                         │
│                                                                   │
│  At every supervisor tick:                                       │
│    1. Check tokensUsed >= tokensHard (default 5M)               │
│    2. Check wallClockMs >= wallClockCapMs (default 3h)          │
│    3. Check usdUsed >= usdHard (default disabled)               │
│                                                                   │
│    If ANY breach:                                                │
│      • Set state.paused = true                                  │
│      • Emit pipeline.paused event                               │
│      • Workers idle, supervisor stops seeding new tasks         │
│      • Human can resume once cap is increased or task done      │
│                                                                   │
│  Token Tracking:                                                 │
│    ├─ Prompt tokens: from LLM response (or estimated)           │
│    ├─ Completion tokens: from stream or estimated               │
│    └─ Total += promptTokens + completionTokens                 │
│                                                                   │
│  Cost Calculation:                                               │
│    ├─ Model pricing: getModelPrice(model) → (prompt, compl)    │
│    ├─ Cost = (promptTokens × pricing.prompt +                  │
│    │           completionTokens × pricing.completion) / 1M      │
│    └─ usdUsed += cost                                           │
│                                                                   │
│  Wall-Clock Tracking:                                            │
│    └─ wallClockMs += Date.now() - turnStart (per agent turn)   │
│                                                                   │
│  UI Visualization:                                               │
│    ├─ Progress bars in context rail (right side)               │
│    ├─ Color coding: green (safe), amber (soft cap), red (hard) │
│    └─ Budget breakdown modal (per-role, per-phase consumption) │
└─────────────────────────────────────────────────────────────────┘
```

## Artifact Generation Flow

```
PHASE                   ROLE              ARTIFACT               INDEX
───────────────────────────────────────────────────────────────────────
INTAKE/CLARIFY    → Orchestrator    → REQUIREMENTS.md        (n/a)
CLARIFY           → Human (gate)    → .software-house/
                                     clarifications[] update
SPEC              → PM              → SPEC.md                (n/a)
                  → Reviewer (gate)
ARCHITECT         → Architect       → ARCHITECTURE.md        (n/a)
                                   → adr/ADR-*.md
                  → Reviewer (gate)
PLAN              → Tech Lead       → PLAN.md                (tickets/)
                                   → tickets/T-*.md
                                   → tickets/index.json
                  → Reviewer (gate)
IMPLEMENT/REVIEW  → Dev trio        → src/**/*.{ts,tsx}      (tickets/
                                                             index.json)
                  → Reviewer (parallel)
INTEGRATE         → Orchestrator    → (git merge)            (tickets/)
                  → (gate check)
BRINGUP           → DevOps          → (spawn pnpm dev)       (logs/)
                                   → logs/server-*.log
QA_MANUAL         → QA              → qa/test-plan.md        (incidents/)
                                   → qa/reports/R-*.md
                                   → qa/screenshots/
                  → (incident auto-open)
SELF_HEAL         → Incident        → incidents/I-*.md       (incidents/)
                  → Dev (dispatch)  → src/**/* (fixes)
                  → (attempt budget: 3)
SECURITY          → Security        → SECURITY_REVIEW.md     (n/a)
RELEASE           → Release         → CHANGELOG.md           (n/a)
                                   → version tag
DEMO              → Writer          → (final presentation)   (n/a)

Key Points:
• Artifacts in .software-house/ are source of truth
• Indexes (.md files in tickets/, incidents/) are materialized views
• All artifact writes are atomic (write tmp, rename)
• Front-matter includes: role, phase, timestamp, status
• Events logged for every artifact change
```

## Event Flow

```
User Action (chat, barge-in, pause, resume)
    │
    ▼
Next.js API endpoint
    │
    ├─► driveProject(projectId, humanMessage?)
    │
    ├─► emit event (e.g., 'barge.in', 'message.created')
    │
    ├─► persisted to .software-house/events.ndjson
    │
    ├─► in-memory event bus (subscribers notified)
    │
    └─► SSE stream to web UI (real-time updates)

Example flow:
1. User types requirement in chat
2. POST /api/projects → driveProject(projectId, requirement)
3. Orchestrator agent spawned (INTAKE phase)
4. Token stream emitted (message.token events every N tokens)
5. Tool calls emitted (fs.read, web_search, etc.)
6. Agent turn complete: message.done event
7. Artifact written: artifact.written event
8. UI updates in real-time via SSE

Event Types:
├─ message.created / message.done      (agent turns)
├─ message.token                        (streaming updates)
├─ artifact.written                     (file persisted)
├─ source.written                       (code file written)
├─ review.posted                        (reviewer decision)
├─ ticket.created / ticket.status       (ticket lifecycle)
├─ incident.opened / incident.dispatched / incident.status
├─ phase.advanced                       (phase transition)
├─ pipeline.paused / pipeline.resumed   (budget, human)
├─ runtime.start / runtime.stop / runtime.log
├─ qa.run                               (QA test execution)
├─ budget.update                        (tokens/USD/wallclock)
├─ barge.in                             (human steering)
└─ log                                  (system logs)

Persistence:
.software-house/events.ndjson
├─ One JSON object per line
├─ Append-only (never mutated)
├─ Used for replay, audit, time-travel scrubbing
└─ Mirrored to Postgres in v2
```

---

**Diagram generated:** April 2026
**Status:** v1 Architecture Complete, Ready for Live-LLM Validation
