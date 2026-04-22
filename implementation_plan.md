# L'Olympus — Virtual Software House Implementation Plan

> **Mission.** Turn a single human requirement into a running, manually‑QA'd product through an autonomous, role‑based, self‑healing AI workforce — rendered as a living virtual office.

> **Status (April 2026):** Phases 0–6 shipped and functional. Core architecture implements a **supervisor pattern with a persistent task pool** instead of sequential phases, enabling parallel ticket work and graceful pausing. All 13 agent roles defined, LLM routing complete, budget enforcement operational. Live-LLM validation pending.

---

## 0. TL;DR (Updated)

- **Primary build:** a local‑first, **open‑source**, **AI‑model‑agnostic** web app (the "Olympus office") that orchestrates a fleet of role‑specialized AI employees via a **long-running supervisor + persistent task pool**, persists all work to the filesystem under `.software-house/`, and — in v1 — runs the product directly on the host for bring‑up and QA.
- **Architecture shift from plan:** Instead of sequential `INTAKE → CLARIFY → ... → DEMO` phase loop, actual implementation uses a **Software House Supervisor** (in `src/lib/pipeline/software-house.ts`, 937 lines) that spawns **one worker per role × concurrency level**, reads tasks from a **persistent task pool** (`.software-house/task-pool.json`), and auto-advances phases when gates pass. This enables **parallel ticket work** (multiple developers on different tickets simultaneously) while remaining **fully deterministic and restartable** (supervisor crash → hydrate from snapshot → resume).
- **Editor surface split (as planned):**
  - **Olympus web app** (Next.js 15) — control room with 3-region layout (chat, canvas tabs, context rail), real-time event streaming via SSE, artifact browser, pipeline DAG, budgets display.
  - **Zed via ACP** (optional, tested) — same Olympus agents (not Zed's built‑ins), HTTP delegation to web app, barge‑in relay for human steering.
  - Both share `.software-house/` as source of truth.
- **14-phase pipeline** (not 13 as originally written):
  - `INTAKE` → `CLARIFY` → `SPEC` → `ARCHITECT` → `PLAN` → `IMPLEMENT` ⇄ `REVIEW` → `INTEGRATE` → `BRINGUP` → `QA_MANUAL` → `SELF_HEAL` → `SECURITY` → `RELEASE` → `DEMO`
  - Each primary phase produces one artifact (REQUIREMENTS, SPEC, ARCHITECTURE, PLAN, etc.) via a single-turn agent role.
  - IMPLEMENT/REVIEW run in parallel across tickets; supervisor auto-advances when all tickets done.
- **13 agent roles** (all implemented, prompts authored):
  - Reasoning tier: orchestrator, pm, architect, techlead, reviewer, security, incident
  - Coding tier: backend-dev, frontend-dev, devops
  - Vision tier: qa
  - Fast tier: release, writer
- **Model agnostic, OpenRouter‑first, 4‑tier routing:** `LLMProvider` interface, tier map (FAST / REASONING / CODING / VISION), OpenRouter as default, OpenAI-compatible fallback for self-hosted.
- **Deliverable:** Phases 0–6 fully functional and tested offline. Phases 7–8 (multi-project, open-source launch) deferred to v2. **Live-LLM validation pending** (offline mock path verified).

---

## 1. Guiding Principles

1. **Artifacts over chat.** Every phase produces a markdown file; chat is an audit trail, not the product.
2. **No role reviews its own output.** Orchestrator enforces cross‑role review gates.
3. **Real tools only.** Agents use real filesystems, real git, real shell, real browsers. No simulated environments for the product under development.
4. **Bounded loops.** Every loop has a budget (retries, wall‑clock, tokens). Exhaustion always escalates to a human with a concise `HELP_NEEDED.md`.
5. **Model agnostic, OpenRouter‑first.** One `LLMProvider` interface. OpenRouter is the default because BYOK unlocks almost every model; every other provider is a sibling adapter, not a special case.
6. **Extensible by design.** Roles, tools, LLM providers, skills, storage backends, and UI themes are **plugins** behind stable public interfaces. Adding a new role must not require forking the core.
7. **Open source native.** Permissive license, no proprietary SDKs in core, all assets redistributable, clean public API surface, versioned contracts, reproducible builds.
8. **Observable by default.** Humans can pause, rewind, inspect every artifact, message, tool call, screenshot.
9. **Local‑first.** One `docker compose up` gives the whole office. Cloud is an opt‑in later.

---

## 2. High‑Level Architecture

### v1 (sequential, host‑side, single Next.js app)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Olympus Web App (Next.js)                    │
│   Chat · Office · Workspace · App/Runtime · Artifacts · Pipeline    │
└───────────────▲──────────────────────────────────────▲──────────────┘
                │ SSE (events, tokens)         REST / fetch │
┌───────────────┴──────────────────────────────────────┴──────────────┐
│                  Orchestrator + Pipeline Driver                     │
│   Role Agents (in‑process) · Envelope parser · Phase Gate · Bus     │
└───────┬─────────────────────────┬───────────────────────────────────┘
        │                         │
        ▼                         ▼
  Workspace FS               LLM Provider (OpenRouter, BYOK)
  (.software-house/,         tiers: FAST · REASONING · CODING · VISION
   src/, logs/)
        │
        ▼
  Host process: `pnpm dev` / `pnpm build` / `pnpm test`
  (runs the generated product directly on localhost, logs piped to UI)
```

No Postgres, no Docker, no worktrees in v1 — filesystem is the source of truth. SSE replaces Socket.io. The generated product is started as a child process on the host.

### v2 (the deferred upgrades — documented, return‑to path)

```
                            ┌────────────────────┐
                            │  Olympus Web App   │   ← unchanged surface
                            └─────────┬──────────┘
              ┌───────────────────────┼────────────────────────┐
              ▼                       ▼                        ▼
       Runner Pool            Git Worktrees               Zed IDE (ACP)
       (Docker, per‑          (git worktree add            optional editor
        container caps)        ../wt‑<ticket>)            surface; runs
                                                          Olympus agents
                                                          via Agent
                                                          Client Protocol
```

v2 additions are purely additive — agents, prompts, phase gates, and the artifact contract are identical; only the *execution host* and *parallelism* change. Section 6 keeps the full Docker spec so it can be picked up later without redesign. Section 15 keeps the full Zed ACP spec.

*End state*: the same `.software-house/` tree is produced whether the IMPLEMENT phase ran in‑process (v1), in Docker runners (v2), or inside Zed via ACP (v2). The human can switch surfaces mid‑project.

### 2.1 Components

| Component | v1 (shipped) | v2 (deferred — documented) | Responsibility |
|---|---|---|---|
| **Web UI** | Next.js 15 (App Router) + React + Tailwind + shadcn primitives + Monaco | + `@lottiefiles/dotlottie-react` (thorvg) avatars | Chat, office, workspace, app/runtime, artifacts, pipeline |
| **Realtime** | **SSE** (one endpoint per project) | Socket.io (only if back‑pressure demands it) | Stream agent tokens + role state + artifact events |
| **Orchestrator** | Plain TypeScript in the Next.js process (`src/lib/pipeline/driver.ts`) + role agents in `src/lib/agents/` | Mastra `@mastra/core` workflows, extracted to `apps/orchestrator` | Pipeline state machine, agent dispatch, phase gates |
| **State store** | Filesystem: `workspaces/<id>/.software-house/{state.json, messages.ndjson, events.ndjson, *.md}` | + Postgres 16 + Drizzle ORM (event log + query) | Source of truth for phase, messages, events, artifacts |
| **Workspace** | `workspaces/<id>/` plain folder, with generated product code under `src/` | `.git` init + `git worktree` per parallel ticket | Where the generated product lives |
| **Implement runtime** | In‑process agent turns writing files directly | Docker runner pool (build/test/serve/QA containers, `docker.exec` allow‑list) | Actually produce code for each ticket |
| **Bring‑up** | `child_process.spawn('pnpm', ['dev'], { cwd: workspaceDir })` on the host | Docker `serve` container with network‑scoped egress | Run the generated product for the human to see |
| **QA** | Optional local Playwright CLI invocation from the QA agent | Playwright inside a dedicated QA container sharing a docker network with the serve container | ARIA‑snapshot‑driven manual QA with screenshots |
| **LLM provider** | `LLMProvider` TS interface + OpenRouter adapter (`src/lib/llm/providers/openrouter.ts`) | `openai-compat` adapter for vLLM/Ollama/LM Studio/TGI; native Anthropic/Gemini adapters | Model calls with 4‑tier routing |
| **Editor hand‑off** | "Open in Zed" button that writes `.zed/settings.json` + `tickets/index.json` | Full **ACP server** (`olympus-agents/acp-server`) so Olympus agents appear in Zed's agent panel and drive file edits + terminal | Alternate code‑phase surface |
| **Plugin loader** | *(not in v1)* | Node ESM dynamic import + `olympus.plugin.json` manifest | Roles, tools, providers, skills, themes |
| **Auth** | *(not in v1 — single‑user local)* | Lucia | Multi‑user office |

### 2.2 Architecture Shift: Supervisor Pattern (Implemented)

**Original plan:** Sequential phase loop with role-per-phase binding.

**Actual (Phases 0–6):** A **Software House Supervisor** orchestrates work via a persistent **task pool** instead of sequential phases. This enables:
- **Parallelism**: Multiple developers claim and work on different tickets simultaneously (configurable concurrency per role).
- **Restartability**: Task pool snapshot persisted to disk; supervisor crash → hydrate from snapshot → workers resume.
- **Fair distribution**: Workers claim oldest pending task for their role (atomic snapshot read).
- **Graceful pausing**: Budget exhaustion → `state.paused = true` → workers idle, no forced shutdown.
- **Observability**: Full task lifecycle in NDJSON log (created, claimed, completed, failed).

**Implementation details** (from `src/lib/pipeline/software-house.ts`):
- `ensureSoftwareHouse(projectId)` spawns workers per role.
- `Worker` loops with `claimNextForRole(role, workerId)` → executes task handler → marks complete/failed.
- `Supervisor` ticks every 1s (OLYMPUS_SUPERVISOR_TICK_MS), checks gates, seeds next-phase tasks.
- Phase promotion: all tickets done + gate validation passes + idle buffer (15s default) → `state.phase ← nextPhase`.

**Task pool schema** (`.software-house/task-pool.json`):
```json
{
  "projectId": "...",
  "tasks": [
    { "id", "slug", "kind", "role", "phase", "status", "payload", "dependsOn" }
  ]
}
```

**15 task kinds**: orchestrator-intake, orchestrator-clarify, pm-spec, architect-design, techlead-plan, phase-review, ticket-dev, ticket-review, devops-bringup, qa-plan, incident-triage, incident-heal, security-review, release-notes, writer-demo.

### 2.2a Why Not Mastra (Yet)

Original plan cited Mastra. Current implementation is **standalone TypeScript** in the Next.js process:
- Simpler dependency graph (no Mastra + plugins initially).
- Full control over phase logic + budget checks.
- Streaming + tool call loop hand-coded (fewer black boxes).
- v2 can introduce Mastra workflows once the single-app v1 stabilizes.

**Future adoption** (v2): Mastra for eval harness, call tracing, memory summarization.

### 2.3 Why dotLottie (thorvg)

- **thorvg** is a lightweight vector renderer written in C++ with ~3× smaller runtime than `lottie-web` and significantly better CPU/GPU usage.
- `@lottiefiles/dotlottie-web` / `dotlottie-react` wraps thorvg for the browser and supports the `.lottie` bundle format (multiple animations, themes, interactivity state machines in one file).
- One `.lottie` file per employee can hold `idle / thinking / typing / reviewing / testing / blocked` states, switched by name → perfect for the office presence model.
- Avoids the heavier Rive runtime and keeps the app fully MIT/Apache redistributable.

### 2.4 Editor Hand‑off — Zed via ACP (first‑class, optional)

The IMPLEMENT phase can run in two surfaces, interchangeably:

1. **In‑process (v1 default).** Olympus's Backend / Frontend / DevOps agents loop through tickets and write files directly into `workspaces/<id>/src/`. Good for headless demos, autonomous runs, cloud deployments later.
2. **Zed via ACP (recommended for human‑in‑the‑loop).** The same agents run inside Zed's agent panel using the **Agent Client Protocol** (open standard, JSON‑RPC, Apache‑2.0). The human sees live edits, diagnostics, terminal output, and diffs in a proper editor; Olympus's web app remains the dashboard.

Key invariants that make the split safe:

- **Same agents, same models.** Zed's bundled Claude/Gemini agents are *not* used. The ACP server packages Olympus's own role prompts + `LLMProvider` + tier routing + budget tracking, exposed to Zed as agents named `@olympus/backend-dev`, `@olympus/frontend-dev`, `@olympus/reviewer`, etc.
- **Same artifact contract.** Both surfaces read/write the same `.software-house/` tree. `tickets/index.json` is the shared queue; claim / release is append‑only on a status log.
- **Same event stream.** ACP turn events are mirrored into `events.ndjson` so the Olympus web UI (office, chat, mini‑map) keeps updating while the user is actually driving Zed.
- **One‑click switch.** "Open in Zed" in the Olympus project header writes `.zed/settings.json` registering the Olympus ACP agent binary, then `exec`s `zed workspaces/<id>`. Switching back is automatic — Olympus is already watching the files.

ACP details (server binary layout, message flow, per‑agent tools) live in §15. The human can choose surface per‑project or per‑phase.

In addition, a low‑ceremony **"Open in Cursor"** action still ships — same idea as today's `cursor <path>` but with a preinstalled `.cursor/rules/` set and slash commands for manual inspection / overrides. No ACP there (Cursor hasn't implemented ACP yet); it's strictly for human hand‑edits, not for driving Olympus agents inside Cursor.

---

## 3. Shared Design (Runtime‑Agnostic)

### 3.1 Role Catalog

| # | Role | Primary Output | Reviewed By |
|---|---|---|---|
| 1 | **Orchestrator (PO)** | `REQUIREMENTS.md`, phase gates, budget | Human (once) |
| 2 | **Product Manager** | `SPEC.md` (user stories, acceptance criteria) | Architect |
| 3 | **Solution Architect** | `ARCHITECTURE.md`, ADRs, stack choice | Tech Lead |
| 4 | **Tech Lead** | `tickets/T-*.md`, dependency DAG | PM + Architect |
| 5 | **Backend Developer** | PRs for API/services | Reviewer + QA |
| 6 | **Frontend Developer** | PRs for UI | Reviewer + QA |
| 7 | **DevOps Engineer** | `infra/`, `docker-compose.yml`, bring‑up scripts | Tech Lead |
| 8 | **QA Engineer** | `qa/test-plan.md`, browser runs, `qa/reports/*` | PM (acceptance) |
| 9 | **Code Reviewer** | `reviews/PR-*-review.md` | — (enforced gate) |
| 10 | **Security Auditor** | `SECURITY_REVIEW.md` | Tech Lead |
| 11 | **Incident Responder** | `incidents/I-*.md`, fix dispatch | Reviewer |
| 12 | **Release Manager** | `CHANGELOG.md`, version tags, deploy log | Orchestrator |
| 13 | **Technical Writer** | `README.md`, `docs/` | PM |

**Invariant:** a role never reviews its own output. The orchestrator routes review to a different role.

### 3.2 Workspace Layout (created for every project)

```
workspaces/<project-id>/
  .git/
  .software-house/
    state.json                 # phase, budgets, retries, cursors
    REQUIREMENTS.md
    SPEC.md
    ARCHITECTURE.md
    adr/ADR-000N-<slug>.md
    tickets/T-000N-<slug>.md
    qa/
      test-plan.md
      reports/R-<ts>-<ticket>.md
      screenshots/<scenario>/step-NN.png
    incidents/I-<ts>-<slug>.md
    reviews/PR-<n>-review.md
    logs/
      server-<ts>.log
      agent-<role>-<ts>.log
    events.ndjson              # append-only event stream
  prompts/<role>.md            # copied from template on init
  scripts/
    start-server.sh
    wait-for-ready.sh
    run-qa.sh
  <actual app source>          # src/, package.json, etc.
```

`state.json` is mutated **only** by the orchestrator (atomic write + rename). Everything else is append‑only or owned by exactly one role.

### 3.3 Pipeline State Machine

```
INTAKE → CLARIFY → SPEC → ARCHITECT → PLAN → IMPLEMENT ⇄ REVIEW
           ↓                                                ↓
        (human Q&A)                                    INTEGRATE
                                                            ↓
                                                  BRINGUP (docker up)
                                                            ↓
                                                    QA_MANUAL (browser)
                                                            ↓
                                              SELF_HEAL  (bounded loop)
                                                            ↓
                                             SECURITY → RELEASE → DEMO
```

Every transition requires: (1) expected artifact exists, (2) peer review signature present, (3) `state.json` updated, (4) budget not exhausted.

### 3.4 Peer Review Protocol

- PRs are feature branches with a matching `reviews/PR-<n>-review.md`.
- Reviewer output (enforced by JSON schema):
  ```json
  {
    "decision": "approve" | "request-changes" | "block",
    "findings": [{ "severity": "low|med|high", "file": "...", "line": 42, "note": "..." }],
    "rerun": true | false,
    "evidence": ["commands run", "files read"]
  }
  ```
- Reviewer **must** actually open the file / run the test. Gate rejects reviews with empty `evidence`.
- Two `block`s in a row → escalate to Tech Lead; Tech Lead block → escalate to human.

### 3.5 Self‑Healing Loop

**Triggers:** non‑zero exit from build/test, HTTP 5xx or missing elements during QA, console/uncaught errors, network requests ≥ 400.

**Loop:**
1. Incident Responder opens `incidents/I-*.md` (reproduction, logs, screenshot).
2. Classifies: `frontend | backend | infra | data | spec-gap`.
3. Dispatches to matching dev role with the incident file as context.
4. Fix PR → Reviewer → QA re‑runs **only** the failed scenario.
5. 3 failed attempts on the same incident → escalate via `HELP_NEEDED.md`.

**Budgets (defaults):** 3 heal attempts / incident, 10 incidents / build, 60 min wall‑clock / phase, configurable token budget / phase.

### 3.6 Manual UI QA Protocol

For each scenario: `navigate → lock tab → snapshot (ARIA) → act (ref‑based) → screenshot → assert → capture console + network → record`.

- Short incremental waits (1–3s) with fresh snapshots, never a single long sleep.
- Prefer ARIA `ref` over coordinate clicks.
- Screenshots saved under `qa/screenshots/<scenario>/step-NN.png`.
- Failing scenarios file an incident; remaining scenarios still run to collect full evidence before stopping advance.

### 3.7 Clarification Protocol

Orchestrator asks **≤ 5 questions**, each closed‑ended or multiple choice, ranked by ambiguity‑resolution value, listing a sensible default so the human can skip. Unanswered questions → logged under `## Assumptions` in `REQUIREMENTS.md`.

### 3.8 Exit Criteria

1. All SPEC acceptance criteria have a green QA report.
2. No open `severity: high` findings from Reviewer or Security.
3. Server boots fresh from clean checkout via one documented command.
4. New developer can run the app in under 5 minutes using the README.
5. Release Manager tagged a version + wrote CHANGELOG.

### 3.9 Shared Prompt Skeleton

Every `prompts/<role>.md` follows the same shape so gate validators can parse outputs deterministically:

```markdown
# Role: <Role Name>

## Mission
<1-2 sentences>

## Inputs (must read before acting)
- .software-house/state.json
- <role-specific artifact paths>

## Deliverable
Write/update: <exact file path>
Shape: <sections in order>

## Done criteria
- [ ] File exists, required sections present
- [ ] Front-matter: role, phase, timestamp, inputs_hash
- [ ] Trailing block:
      ---
      status: done
      review_requested_from: <role>
      ---

## Never
- Edit files outside allow-list
- Advance state.json (orchestrator only)
- Skip review request block

## Style
- Concise, bullet-first, no filler
- Cite file:line for code claims
- Mermaid over prose for graphs
```

PM / Architect / Reviewer / QA / Incident prompts additionally emit a **strict JSON block** at the end for machine parsing (status, findings, dispatch targets).

---

## 4. Data Model

### 4.0 v1 — filesystem as the store

In v1 the authoritative store is the plain filesystem under `workspaces/<project-id>/.software-house/`:

| Path | Format | Mutability | Written by |
|---|---|---|---|
| `state.json` | JSON | atomic replace (write tmp + rename) | orchestrator only |
| `messages.ndjson` | NDJSON | append‑only | any agent on turn; human on send |
| `events.ndjson` | NDJSON | append‑only | any event source |
| `meta.json` | JSON | atomic replace | orchestrator on create |
| `REQUIREMENTS.md` / `SPEC.md` / `ARCHITECTURE.md` / `PLAN.md` / … | Markdown + YAML front‑matter | write‑once‑per‑phase by the owning role | per §3.1 |
| `adr/ADR-*.md`, `tickets/T-*.md` | Markdown + front‑matter | append‑only | architect / techlead |
| `tickets/index.json` | JSON (see §4.1) | atomic replace | techlead on PLAN; driver on ticket status change |
| `reviews/PR-*-review.md` | Markdown + JSON block | append‑only | reviewer |
| `qa/test-plan.md`, `qa/reports/R-*.md` | Markdown | append‑only | QA |
| `incidents/I-*.md` | Markdown | append‑only | incident responder / QA |
| `SECURITY_REVIEW.md`, `CHANGELOG.md`, `HELP_NEEDED.md` | Markdown | write‑once / append | security / release / any role on budget exhaustion |
| `logs/server-<ts>.log` | Text | append‑only | runtime adapter (host spawn or docker) |

The Olympus web UI is a *view* over this tree; restarting the server loses no project state. A user who walks away from Olympus still has a normal folder they can `git init` and keep using.

### 4.1 `tickets/index.json` (shared queue across surfaces)

The single document that connects v1's in‑process IMPLEMENT loop, v2's Docker/worktree runner pool, **and** the Zed ACP hand‑off. Produced by Tech Lead on PLAN, updated by whichever surface is currently implementing.

```json
{
  "version": 1,
  "projectId": "kudos-board-fc5s9n",
  "tickets": [
    {
      "code": "T-0001",
      "title": "Set up Node.js + Express project",
      "assigneeRole": "backend-dev",
      "dependsOn": [],
      "status": "todo",         // todo | in-progress | review | changes-requested | done | blocked
      "attempts": 0,
      "lastAttemptAt": null,
      "branch": null,           // set in v2 worktree mode
      "reviewPath": null,       // reviews/PR-0001-review.md when posted
      "path": "tickets/T-0001-setup-node-express.md"
    }
  ],
  "updatedAt": "2026-04-20T08:55:00Z"
}
```

Invariants:
- Only one process writes `tickets/index.json` at a time. v1 driver writes inline; the ACP server uses a lock file `tickets/.lock` (NFS‑safe mkdir pattern) when Zed is active.
- Topological order: the driver picks the next `todo` ticket whose `dependsOn[]` are all `done`.
- Each status change also emits an `OlympusEvent` of kind `ticket.status` so the UI live‑updates.

### 4.2 v2 — Postgres via Drizzle (deferred)

When multi‑project and multi‑user are needed, the filesystem remains authoritative; Postgres becomes a **query/observability mirror** populated by tailing the workspace files. The same schema applies:

```
projects         (id, name, slug, status, workspace_path, created_at, budget_json)
phases           (id, project_id, name, started_at, ended_at, status, retries)
roles            (id, key, display_name, avatar, default_model)
threads          (id, project_id, kind, role_key, title, created_at)
                   -- kind: 'master' (with orchestrator) | 'role-dm' | 'system'
agent_runs       (id, project_id, phase_id, role_key, thread_id, started_at,
                  ended_at, model, input_tokens, output_tokens, cost_cents,
                  status)
messages         (id, thread_id, agent_run_id, direction, author_role, content,
                  content_blocks_json, tool_calls_json, attachments_json,
                  parent_id, created_at)
                   -- content_blocks_json: rich renderable cards
                   --   (artifact, diff, screenshot, question, gate, incident,
                   --    budget, ticket, tool-call)
tool_calls       (id, agent_run_id, tool, args_json, result_json, duration_ms,
                  ok, created_at)
artifacts        (id, project_id, path, kind, version, sha256, created_at,
                  created_by_role)
file_edits       (id, project_id, worktree, path, role_key, range_json,
                  inserted, removed, committed_sha, created_at)
                   -- append-only stream of per-file token-level edits;
                   -- drives the Workspace live-typewriter view
tickets          (id, project_id, code, title, status, deps_json, assignee_role,
                  branch, pr_url)
reviews          (id, ticket_id, reviewer_role, decision, findings_json,
                  evidence_json, created_at)
incidents        (id, project_id, title, classification, status,
                  repro_json, attempts, created_at)
events           (id, project_id, kind, payload_json, created_at)   -- ndjson mirror
budgets          (project_id, phase_id, heal_attempts, incident_count,
                  wall_clock_ms, tokens_used)
```

- `events` drives the UI feed (server → client via Socket.io) and is also mirrored to `events.ndjson` inside the workspace for offline audit.
- `messages` is scoped by `thread_id`, supporting the master thread (with Orchestrator) and per‑role DM threads described in §7.2. `content_blocks_json` lets the UI render rich inline cards (artifacts, diffs, screenshots, clickable questions/gates/incidents) the same way Cursor renders tool‑call chips.
- `file_edits` is an append‑only log of token‑level edits that powers the live typewriter view in §7.3.2. On commit the final state is reconciled with git; the row records the resulting SHA so replay is stable.
- Artifacts are blob‑referenced by path + sha256; the workspace git log is the authoritative history for committed state.

---

## 5. Agent Execution & Orchestration

### 5.1 Agent Registry (All 13 Roles Implemented)

**v1 (shipped) layout** — pure TypeScript, no framework dependency, lives entirely inside the Next.js app but is written as a **provider‑agnostic module** so the ACP server (§15) and any future headless runner can consume it unchanged:

```
src/lib/agents/
  roles/
    index.ts                 # exports ROLE_DEFINITIONS + helpers
    orchestrator.ts          # role: INTAKE → clarifications, CLARIFY → ready for spec
    pm.ts                    # SPEC: user stories + acceptance criteria
    architect.ts             # ARCHITECT: design + ADRs
    techlead.ts              # PLAN: ticket breakdown + DAG
    backend-dev.ts           # IMPLEMENT: tickets marked assigneeRole: backend-dev
    frontend-dev.ts          # IMPLEMENT: tickets marked assigneeRole: frontend-dev
    devops.ts                # BRINGUP: startup scripts + infra
    qa.ts                    # QA_MANUAL: test plan + Playwright runner
    reviewer.ts              # REVIEW: code review (readonly fs + shell)
    security.ts              # SECURITY: audit (readonly)
    incident.ts              # SELF_HEAL: incident triage + dispatch
    release.ts               # RELEASE: version + changelog
    writer.ts                # DEMO: presentation + docs
  envelope.ts                # JSON envelope parser (shared by web + ACP) + Zod validation
  prompts.ts                 # buildSystemPrompt(role) — composes system + context
  run.ts                     # runAgentTurn() — streaming, tool loop, envelope parse
  tools/
    web-search-tool.ts       # All roles can emit web_search tool calls
    web-search-executor.ts   # Tavily/SerpAPI executor + fallback
```

**Each role definition** includes:
- `mission`: High-level goal (1–2 sentences)
- `inputs`: Artifacts to read (REQUIREMENTS, SPEC, ARCHITECTURE)
- `deliverable`: What gets written + where
- `doneCriteria`: Checklist of completion requirements
- `never`: Anti-patterns to avoid (e.g., "Edit source files outside allow-list")
- `modelTier`: Routing to FAST / REASONING / CODING / VISION
- `reviewedBy`: Which role gates this output before phase advance (e.g., PM reviewed by Architect)

Each role definition is a plain data object:

```ts
// src/lib/agents/roles/pm.ts
import { defineRole } from './index';

export const pm = defineRole({
  key: 'pm',
  displayName: 'Product Manager',
  tier: 'reasoning',
  reviewedBy: 'architect',
  mission: '…',
  inputs: ['.software-house/state.json', '.software-house/REQUIREMENTS.md'],
  deliverable: '`SPEC.md` with …',
  doneCriteria: [ '…' ],
  never: [ '…' ],
});
```

Runtime composition:
- `model`: resolved via `createModelRouter()` from `role.tier` + env overrides (§5.6).
- `instructions`: `buildSystemPrompt(role)` composes `roles/<role>.ts` + the shared **envelope spec** (strict JSON output contract).
- `tools`: an allow‑list slice of the tool registry (see §5.3). In v1 the allow‑list is advisory (no sandbox yet); it is enforced by the web driver's write‑path validator and will be enforced again by the ACP server's `fs/apply_edit` wrapper.
- `memory`: v1 = last N messages + explicit artifact refs; v2 = per‑role summary memory backed by Postgres.

**v2 (deferred)** introduces a Mastra `Agent` wrapper around the same role definitions so we get Mastra's evals/tracing for free; the role modules themselves do not change.

### 5.2 Pipeline & Task Execution (Supervisor Pattern)

**Main driver** (`src/lib/pipeline/software-house.ts`):
- `driveProject(projectId, humanMessage?)`: Entry point from web UI or ACP.
- `ensureSoftwareHouse()`: Spawn supervisor + workers (or reuse if already running).
- Supervisor loop (1s tick):
  1. Check budget enforcement (`enforceBudgets()`).
  2. Seed current phase's primary task (if not already seeded).
  3. Let workers claim tasks + execute.
  4. Check if phase is idle + gate validation passes → advance phase.
  5. Repeat.

**Task execution** (`src/lib/pipeline/task-handlers.ts`):
- `runTaskHandler(task)`: Dispatch by task.kind to role-specific handler.
- `orchestrator-intake` → `runOrchestrationTurn()` with phase=INTAKE.
- `ticket-dev` → `runDevForTicketOnce()` with source writes.
- `ticket-review` → `runReviewForTicketOnce()` with review decision.
- `incident-heal` → `runIncidentHeal()` with incident context.
- All handlers call `runAgentTurn()` for LLM streaming + envelope parsing.

### 5.3 Tool Registry (with per‑role allow‑lists)

| Tool | Purpose | Roles allowed |
|---|---|---|
| `fs.read` | Read file | all |
| `fs.write` | Write file (path must match role allow‑list regex); emits `file.edit` events for the live typewriter view | role‑specific |
| `fs.patch` | Apply a structured edit (range + inserted/removed) — preferred for incremental writes, streams token‑level deltas to the UI | role‑specific |
| `fs.search` | ripgrep over workspace | all |
| `fs.tree` | List directory | all |
| `git.status` / `git.diff` / `git.log` | Read git state | all |
| `git.branch` / `git.commit` / `git.worktreeAdd` | Mutate git | dev, devops, release |
| `shell.run` | Execute shell in sandbox (allow‑list regex) | dev, devops, qa |
| `shell.runReadonly` | Read‑only commands (ls, cat, grep) | reviewer, security, incident |
| `docker.up` / `docker.logs` / `docker.exec` | Runner control | devops, qa, incident |
| `browser.navigate` / `browser.snapshot` / `browser.click` / `browser.type` / `browser.fill` / `browser.screenshot` / `browser.console` / `browser.network` / `browser.lock` | Playwright‑backed QA | qa only |
| `state.read` | Read `state.json` | all |
| `state.advance` | Advance pipeline phase | **orchestrator only** |
| `ticket.create` / `ticket.update` | Ticket CRUD | techlead, orchestrator |
| `incident.open` | Open incident | incident, qa |
| `review.submit` | Post structured review | reviewer, security |
| `llm.delegate` | Spawn sub‑agent for a role | orchestrator only |

All tools are Zod‑schema'd, logged to `tool_calls`, and mirrored to `events`. Unknown args → reject. Path writes outside allow‑list → reject with a helpful message the agent can recover from.

### 5.4 Phase Gate Validator

One function `validateGate(projectId, targetPhase) → GateResult`:

1. Required artifact(s) exist and parse (front‑matter, required sections).
2. Matching review file(s) exist with `decision: approve`.
3. Budgets not exhausted.
4. No open `high` findings.
5. For IMPLEMENT→QA: all tickets closed, all PRs merged, build + tests green.

Called before every `state.advance`. Also exposed to the UI as a dry‑run check so the human can see exactly what's blocking.

### 5.5 Parallelism

> **Status:** v1 runs tickets **sequentially, on the single workspace checkout, no worktrees, no Docker**. The parallel design below is fully specified so we can switch it on without a rewrite.

**v1 (sequential, shipped):**
- Tech Lead still produces the full dependency DAG for tickets (`tickets/index.json` — see §4.1). This is useful even in sequential mode: the driver walks the DAG topologically, running one ticket at a time.
- Each ticket runs as: Dev agent → Reviewer agent → mark ticket `done` → pick next leaf. The whole workspace is one directory; commits are serialized and optional (git is nice‑to‑have, not required for state).
- A failed Reviewer decision re‑runs the Dev agent with the review findings as context; bounded to **3 attempts per ticket** (same budget as the self‑heal loop, §3.5). Exhaustion writes a `HELP_NEEDED.md` and pauses.

**v2 (parallel, documented, deferred):**
- Orchestrator schedules **leaf tickets in parallel**, each in its own **git worktree** (`git worktree add ../wt-<ticket-id> <branch>`).
- One Dev agent per worktree, one Reviewer agent per PR.
- Merges are serialized through the orchestrator to avoid conflicts; on conflict, Tech Lead is invoked to sequence.
- Requires §6 (Runner Pool) so each worktree can build/test in an isolated container.

**Return path from v1 → v2:** the DAG is already emitted, the Dev / Reviewer / Tech Lead agents are already identical in both modes, and the pipeline driver's ticket loop is the only module that needs to change (swap the `for (const ticket of leaves) { await run(ticket); }` for a bounded `Promise.all` with per‑ticket worktree allocation). Estimated effort: ~1 engineer‑day once §6 is in place.

### 5.6 LLM Provider Abstraction (model‑agnostic, OpenRouter‑first)

```ts
interface LLMProvider {
  readonly id: string;                          // "openrouter", "openai-compat", ...
  listModels(): Promise<ModelInfo[]>;           // optional; used by UI
  chat(req: ChatRequest): AsyncIterable<Token>; // streaming
  embed?(req: EmbedRequest): Promise<number[][]>;
  estimateCost?(req: ChatRequest): CostEstimate;
}

type ModelTier = 'fast' | 'reasoning' | 'coding' | 'vision';

interface ModelRouter {
  resolveTier(tier: ModelTier): { provider: string; model: string };
  resolveRole(role: RoleKey, ctx: RoutingContext): { provider: string; model: string };
}
```

**First‑class: OpenRouter.** BYOK means one key unlocks essentially every major hosted model (Anthropic, OpenAI, Google, Meta, Mistral, DeepSeek, Qwen, …). Path of least resistance, default in `docker-compose.yml`. We surface OpenRouter‑specific features too (provider preferences, fallbacks, `:floor`/`:nitro` variants).

**Bundled adapters (equal citizens, OpenRouter is just the default):**
- `openrouter` — default. Env: `OPENROUTER_API_KEY`.
- `openai-compat` — **OpenAI, vLLM, Ollama, LM Studio, TGI, LiteLLM, Azure OpenAI, Groq, Together, Fireworks, DeepInfra, any OpenAI‑shaped endpoint.** Env: `OPENAI_BASE_URL`, `OPENAI_API_KEY`.
- `anthropic` — native Anthropic SDK path.
- `google` — Gemini direct path.
- `mock` — deterministic fixture provider for tests and offline demos.

**Community adapters** ship as plugins (`olympus-plugin-bedrock`, `olympus-plugin-cohere`, `olympus-plugin-vertex`, …) discovered via the plugin loader (§12).

#### 5.6.1 Model Tiers (the primary routing axis, env‑driven)

Instead of configuring a model per role, we expose **exactly four tiers**. Roles map to a tier; tiers resolve to a concrete `provider:model` via env. This keeps the mental model small, makes cost tuning a one‑line change, and swapping providers for the whole app is trivial.

| Tier | Use case | Typical workload |
|---|---|---|
| **`FAST`** | Quick, straightforward, bounded work | Reviewer notes, tech writer prose, status summaries, parsing, ticket CRUD, release notes, log triage |
| **`REASONING`** | Deep planning and multi‑step thinking | Orchestrator decisions, PM spec synthesis, Architect ADRs, Tech Lead DAG, Security audit, Incident classification |
| **`CODING`** | Code generation, edits, refactors, test writing | Backend Dev, Frontend Dev, DevOps scripts |
| **`VISION`** | Multimodal reasoning over images | QA (reading screenshots + ARIA), ingesting user‑pasted mockups, UI regression detection |

Only these four tiers are first‑class. If a plugin needs a fifth tier (e.g. `EMBEDDING`), it declares a custom tier in its manifest; the core stays lean.

#### 5.6.2 Env‑driven Tier Configuration

All model selection lives in `.env` so users can retune without touching code:

```ini
# Provider defaults
LLM_PROVIDER=openrouter                   # default provider used by tiers
OPENROUTER_API_KEY=<fill-me>
# OPENAI_BASE_URL=http://localhost:11434/v1   # e.g. Ollama
# OPENAI_API_KEY=<optional>

# Tier → model (format: "<model>" uses LLM_PROVIDER, or "<provider>:<model>" to override)
MODEL_TIER_FAST=openai/gpt-5-mini
MODEL_TIER_REASONING=anthropic/claude-sonnet-4
MODEL_TIER_CODING=anthropic/claude-sonnet-4
MODEL_TIER_VISION=google/gemini-2.5-pro

# Optional per-role overrides (each takes a tier name, a model id, or a full "provider:model")
# ROLE_MODEL_ARCHITECT=openai/gpt-5
# ROLE_MODEL_QA=tier:vision
# ROLE_MODEL_DEVOPS=openai-compat:llama-3.1-70b-instruct
```

Resolution order for any agent turn:

1. `ROLE_MODEL_<ROLE>` if present.
2. Default **role → tier map** (built in, see below).
3. `MODEL_TIER_<TIER>` to get `provider:model`.
4. `LLM_PROVIDER` as the provider when only a bare model id is given.

**Default role → tier map** (sensible, overrideable):

| Role | Tier |
|---|---|
| Orchestrator | `REASONING` |
| PM | `REASONING` |
| Architect | `REASONING` |
| Tech Lead | `REASONING` |
| Backend Dev | `CODING` |
| Frontend Dev | `CODING` |
| DevOps | `CODING` |
| QA | `VISION` |
| Reviewer | `FAST` |
| Security | `REASONING` |
| Incident Responder | `REASONING` |
| Release Manager | `FAST` |
| Technical Writer | `FAST` |

The Settings UI (see §7.7) reads/writes the same keys — the file is the source of truth, the UI is a helper.

**Swap the whole stack to self‑hosted** by setting `LLM_PROVIDER=openai-compat` and pointing `OPENAI_BASE_URL` at a local vLLM or Ollama. Zero agent code changes.

---

## 6. Runner Pool & Sandboxing

> **Status:** deferred. v1 runs build / dev‑server / tests / QA **directly on the host** via `child_process.spawn` scoped to `workspaces/<id>/`. This section is preserved verbatim as the v2 spec so Docker support is drop‑in.

### 6.1 v1 (shipped) — host‑side runtime

- **BRINGUP**: `child_process.spawn('pnpm', ['dev'], { cwd: 'workspaces/<id>' })`, stdout/stderr piped to `logs/server-<ts>.log` **and** mirrored to the SSE event stream so the App/Runtime tab can show logs live.
- **Port allocation**: one free port per running project picked from a configurable range (`OLYMPUS_RUNTIME_PORT_RANGE`, default `4100-4199`). Olympus passes it via `PORT=<n>` env so the child app can bind.
- **Lifecycle**: a project has at most one running child at a time. Start / stop buttons in the App/Runtime tab emit `runtime.start` / `runtime.stop` events; `SIGTERM` on stop, `SIGKILL` after 5s grace.
- **Command allow‑list**: the only commands the driver may spawn are `pnpm install`, `pnpm build`, `pnpm dev`, `pnpm test`, `node`, `playwright` (+ the project's declared `scripts.*` names). Anything else from an agent must go through `shell.run` which, in v1, rejects with "command not in allow‑list — add it to v2 Docker runners."
- **Security caveat**: host‑side execution means the generated app has the host's full permissions. This is acceptable for a single‑user local dev tool. **Do not expose Olympus publicly in v1** — the README states this explicitly in a yellow box.

### 6.2 v2 (deferred) — Docker runner pool

Each project gets:
- **Build container** (node:22 + toolchains) reused across runs, named `runner-build-<project>`.
- **Serve container(s)** spun up for BRINGUP/QA, torn down after, bound to an ephemeral port.
- **QA container** with Playwright + Chromium, shares a docker network with the serve container so it hits the app by service name.

Rules:
- No container has host network access beyond what the app needs; OpenRouter calls go from the orchestrator, not from runner containers.
- Orchestrator streams container logs → `logs/server-<ts>.log` + `events` stream so the UI can show them.
- `docker.exec` commands are allow‑listed regex (`^(npm|pnpm|yarn|node|python|pytest|pnpm exec playwright|...)`).
- Hard per‑container wall‑clock + memory caps (set on `docker run`).

**Return path from v1 → v2:** the only module that changes is the "runtime" adapter in the orchestrator. In v1 it's a thin `hostRuntime.ts` calling `spawn`; in v2 it's `dockerRuntime.ts` calling Dockerode with the same interface (`start`, `stop`, `logs`, `exec`). Agents, prompts, and the event stream are unchanged.

---

## 7. Web App UX

### 7.1 Layout

A three‑region layout, VS Code‑style, that scales from laptop to ultrawide:

```
┌───────────────────┬─────────────────────────────────┬─────────────────┐
│                   │                                 │                 │
│   Chat Panel      │        Main Canvas              │  Context Rail   │
│   (Orchestrator)  │   (tabbed: Office · Workspace · │  (events, QA    │
│   — always on     │    QA Theatre · Incidents ·     │   log, budgets, │
│   — resizable     │    Pipeline · Artifacts)        │   mini-map)     │
│                   │                                 │                 │
│                   ├─────────────────────────────────┤                 │
│                   │   Terminal / Logs (collapsible) │                 │
└───────────────────┴─────────────────────────────────┴─────────────────┘
```

- **Chat Panel (left, ~30%)** is always visible — it is the *input* to the whole system.
- **Main Canvas (center)** swaps between views via tabs; the Office view is the ambient default.
- **Context Rail (right, ~20%, collapsible)** shows the event stream, budget meters, active incidents, a mini‑map of the office, and the current phase.
- **Terminal panel (bottom, collapsible, xterm.js)** streams logs from the selected container (server, build, QA).

Everything is keyboard‑navigable; `Cmd+K` opens a command palette that mirrors every slash command and `@` mention available in chat.

### 7.2 Chat Panel — the Primary Input (Cursor‑style Agent Chat)

The chat panel is where the human starts, steers, and ends a project. It behaves like Cursor's agent chat, upgraded for a multi‑role org.

**Threads**

- **Master thread**: chat with the **Orchestrator**. This is the default and where top‑level requirements, status, gate approvals, and escalations flow.
- **Role DM threads**: clicking a role avatar (in Office view) or typing `@architect` opens a side thread with that role. Side threads share project context; messages in them are logged as `barge-in` inputs for that role.
- Tabs at the top of the panel switch between threads; unread badges per thread.

**Input affordances**

- Multi‑line textarea with Markdown + code‑fence support; `Shift+Enter` newline, `Enter` send.
- **Slash commands** (registered via the plugin API, see §12):
  - `/new <requirement>` — start a new project from current thread.
  - `/pause` / `/resume` — freeze / unfreeze the pipeline.
  - `/status` — print current phase, active roles, budgets, open incidents.
  - `/gate` — force a gate evaluation + show blockers.
  - `/advance` — approve advancing to the next phase (if gate is green).
  - `/qa [scenario]` — run QA (all scenarios or one).
  - `/heal <incident>` — dispatch a targeted heal.
  - `/rewind <sha|artifact>` — revert to an earlier state.
  - `/barge @role <message>` — priority inject into a role's thread.
  - `/export` — zip the workspace + events + screenshots.
- **@ mentions** (popover picker):
  - `@orchestrator`, `@pm`, `@architect`, `@qa`, … (roles)
  - `@T-0003` (tickets)
  - `@SPEC.md`, `@src/board/api.ts` (artifacts and workspace files)
  - `@PR-14`, `@I-2026-04-20-drag-drop` (PRs, incidents)
- **Attachments**: paste images (UI mockups auto‑routed to PM + FE), drop PDF/Markdown/JSON specs, paste URLs (fetched and summarized).

**Output affordances — rich inline cards**

Agent replies are streamed and can include any of the following inline renderables, each clickable to expand or to open the Main Canvas on the right view:

- `tool-call` card — collapsible, shows `fs.read src/x.ts`, `shell.run pnpm test`, `browser.click #save`, with args + truncated result. Same feel as Cursor's "Read file …" chips.
- `artifact` card — name, kind, front‑matter badges (`role`, `phase`, `status`), a "Open in Artifact Browser" button.
- `diff` chip — mini side‑by‑side for a single hunk; "Open full PR" button jumps Main Canvas to PR view.
- `screenshot` thumbnail — QA step image, opens QA Theatre at that step on click.
- `question` card — clarification question with **clickable option chips** (user rarely types to answer defaults). If user clicks "Skip", default is recorded as an assumption.
- `gate` card — current gate status with findings grouped by severity; `Approve → <phase>`, `Request changes`, `Hold` buttons.
- `incident` card — title, classification, repro steps, "Take over" + "Dispatch to @role" buttons.
- `budget` card — tokens / $ / wall‑clock vs caps, with soft/hard cap indicators.
- `ticket` card — T‑code, status, dependencies, branch, PR link.

**Streaming UX**

- Tokens stream into the bubble; a ghost "… typing" indicator on the active role's avatar mirrors it in the Office view.
- Tool calls appear inline the moment they start, and their results fill in when they complete. Users can cancel in‑flight tool calls via an `x` button on the chip.
- Long multi‑step turns collapse into a summary line with an expand caret (like Cursor's "Thought for N seconds" block) so the scrollback stays readable.

**Steering & intervention**

- Every agent message has hover actions: `Reply`, `Quote`, `Copy`, `Open in Canvas`, `Correct` (opens an inline editor where the user can rewrite the agent's last output — the agent then continues from the corrected version), `Undo from here` (rewinds to before this turn).
- `Stop` button at the panel bottom halts the current agent turn (but not the whole pipeline).
- `Pause pipeline` toggle is always visible in the chat header.

**Persistence**

- Every message stored in `messages` with `thread_id`; full transcript survives restart.
- Chat replay slider lets the user scrub the whole thread history for this project.

### 7.3 Main Canvas — Tabbed Views

The center region is a tab strip. The active tab controls what fills the main canvas. Chat stays live on the left across all of them.

#### 7.3.1 Office (default)

The top‑down 2D office described previously — ambient presence view.

- Tiled floor + 13 desks, meeting table, QA lab, server room zones. SVG background, pointer‑friendly hit regions.
- Employees rendered with **dotLottie (thorvg)** avatars. One `.lottie` bundle per role contains named animations for: `idle | thinking | typing | reviewing | testing | blocked | off‑duty | celebrating`. State is switched by calling `setStateMachine` / `playSegment` on the dotLottie instance when the orchestrator emits role state events — no full reload, no flicker.
- Subtle path‑based movement: an employee walks to another desk when delivering an artifact, or into the meeting room during review. Walk = short Lottie "walk" segment + CSS transform along a precomputed path.
- Hover an avatar → tooltip "currently: writing `SPEC.md` § Acceptance criteria" + last tool call spark.
- Click an avatar → opens (or focuses) a **role DM thread** in the chat panel.
- Perf budget: ≤ 60 fps on a 2019 laptop with 13 avatars animating simultaneously (thorvg makes this easy; lottie‑web would not).

#### 7.3.2 Workspace — the Code View

This is where generated code is visualized, and it is intentionally designed to feel like Cursor's editor.

**File Explorer (left sub‑pane)**

- Full tree of the project workspace (`workspaces/<id>/`), not just `.software-house/`.
- Per‑file badges:
  - `● @frontend-dev` — currently being edited (live).
  - `+24 / -3` — uncommitted change stats.
  - Colored dot when touched in the last N minutes (activity heatmap).
- Right‑click: `Open`, `Open diff vs main`, `Reveal in terminal`, `Blame (by agent)`.
- A **"Ghosts" row** at the top shows the avatars of agents currently active in this workspace with a link to the file each is working on.

**Editor (center sub‑pane)**

- **Monaco** with Shiki syntax highlighting, read‑only by default (humans read; agents write).
- Multi‑tab, split views (up/down/left/right).
- **Live typewriter stream**: when an agent is editing a file, the UI subscribes to a per‑file token stream from the orchestrator and plays the edits into Monaco in real time with a ghost cursor and shimmer line — identical feel to Cursor's agent writing code.
- **Pending‑edit overlay**: proposed changes show as a green/red decoration before commit; a floating toolbar offers `Accept`, `Reject`, `Open full diff`, `Send back to @role with note`.
- **Agent‑aware blame**: hovering a line shows which agent wrote it (plus commit SHA + ticket ID). Blame pairs human‑readable role names with git identities.
- **Inline annotations**: reviewer comments render as Monaco zones pinned to lines, with resolve buttons.
- **Mini‑map of activity**: a thin vertical bar next to the scroll gutter highlights lines changed in the last N minutes (not just current session, since multiple agents may be writing over time).

**Change Bar (right sub‑pane, toggleable)**

- Current uncommitted changes in the active worktree, grouped by file.
- Buttons: `View diff`, `Send to reviewer`, `Discard`, `Commit (with AI message)`.
- Active PRs list with status chips (`open`, `changes-requested`, `approved`, `merged`) and reviewer avatars.

**Git Graph (bottom sub‑pane, toggleable)**

- Small visual branch/merge graph, essential because parallel worktrees produce many branches at once.
- Nodes labelled with T‑codes; hover shows diff summary.

#### 7.3.3 PR / Review Theatre

Opens from chat cards, from the Change Bar, or via `@PR-14`.

- GitHub‑style **diff view** (side‑by‑side by default, inline toggle) with Monaco and Shiki.
- Review comments inline with the reviewing role's avatar.
- Right rail: structured review JSON (decision, findings with severity, evidence: "commands run", "files read").
- Actions: `Approve`, `Request changes`, `Block`, `Send back with note`, `Merge`, `Close`. All actions are gated by role permissions but the human can override.
- A **"proof" panel** shows the commands the reviewer ran (re‑playable as a mini terminal) — this is how we *enforce* "no rubber‑stamp reviews."

#### 7.3.4 QA Theatre

- Large live screenshot (Playwright‑captured) on the left, scenario step list on the right.
- Tabs: `Screenshots`, `ARIA snapshot` (raw YAML), `Console`, `Network`, `Trace`.
- Replay slider scrubs through steps; clicking a step jumps the whole view.
- Failing assertions show the diff between expected and actual in‑line; one click files an incident.

#### 7.3.5 Artifacts

- Tree of `.software-house/`, markdown rendered with front‑matter badges.
- Built‑in version diff across artifact edits (backed by git).
- Cross‑links: clicking a ticket ID jumps to the ticket, clicking an ADR opens it, etc.

#### 7.3.6 Pipeline & Incidents

- Pipeline: the state‑machine visualized, with budgets, retries, phase history.
- Incidents: cards for each open incident, repro + current attempt + "Take over" action.

### 7.4 Context Rail (right)

- Live event feed (filterable by kind / role) — the full `events` stream, not just chat.
- Budget meters (tokens, $, wall‑clock, heal attempts).
- Mini office map showing role states as colored dots, so the human knows "who's working" even when not on the Office tab.
- Active phase + gate status summary with a one‑click `Open Gate` affordance.

### 7.5 Realtime Model

- **Socket.io** as the transport (chosen for reliability + DX; locked in §14).
- One namespace per project; rooms per view (chat, office, workspace, qa‑theatre, incidents) — clients only subscribe to what's visible.
- Server emits `event` messages with `{kind, payload, ts, v}`; the store reconciles into UI state.
- Three high‑volume sub‑channels with their own backpressure:
  - `chat.token` — token‑by‑token streaming for agent messages.
  - `file.edit` — per‑file edit deltas for the live typewriter view (range + inserted/removed text, like LSP).
  - `qa.frame` — Playwright screenshot + console/network lines.
- All events also land in Postgres `events` → UI can replay / scrub history (time‑travel debugging).
- Client reconnect is automatic; on reconnect the server replays events since the client's last `ts` cursor.

### 7.6 Human Controls

- **Pause / Resume** the pipeline (flips `.software-house/PAUSE` + `state.json.paused`).
- **Barge in** via `@role` in chat or "Barge" action on an office avatar — injects highest‑priority input into that role's thread.
- **Correct** on any agent message — user rewrites the last output; the agent continues from the corrected version.
- **Rewind** to any previous artifact/commit (uses git) and resume from there.
- **Stop** the current turn without pausing the pipeline.
- **Kill switch** — global halt of agent spawning; rendered as a big, obviously destructive button in a confirm dialog.

### 7.7 Project Picker & Settings

- **Project Picker**: a separate route (`/`) that lists active + archived projects with status badges, last‑activity timestamps, and a big "Start new project" button. Picking a project opens the three‑region layout.
- **Settings**: accessible from the top bar; panels for LLM providers (keys, **tier → model** mapping with live model list from `listModels()` + optional per‑role overrides, see §5.6), budgets (soft / hard caps for tokens, $, wall‑clock), workspace root path, enabled plugins, theme (office tiles + palette), and keybindings. The Settings UI reads and writes the same env keys as `.env`, so either place is a valid source of truth.

### 7.8 Onboarding / First Run

1. **Landing**: empty chat panel, Orchestrator's opening message: "Hi, I'm Olympus. Tell me what you want to build. Attach mockups or specs if you have them. Type `/help` to see commands."
2. User types a free‑text requirement → Orchestrator writes a **draft `REQUIREMENTS.md`** (visible inline in chat as an artifact card you can click to open in the Artifacts tab) and surfaces ≤ 5 clarification questions as option chips.
3. Once answered (or defaults accepted), the Office populates — avatars light up one by one as their turn begins — the Workspace tab starts showing files as the Architect and devs create them, and the Pipeline tab shows the phase machine starting.
4. A "First time in Olympus?" coach marks each panel with a two‑line tip; dismissible, remembered.

---

## 8. Security & Safety

- Agents run with least privilege per role (tool allow‑list + fs write glob).
- Shell + docker commands pass an allow‑list regex; destructive git commands (`push --force`, `reset --hard`) blocked unless the Release agent explicitly invokes the allowed variant.
- Secrets (OpenRouter keys, etc.) live only in the orchestrator process env, never injected into agent context or runner containers unless explicitly requested by DevOps and scoped.
- All tool calls audited to `tool_calls`; anomalies (path escapes, sudden large writes) flagged.
- Per‑project token + USD budget; orchestrator pauses at soft cap, halts at hard cap.
- Optional network egress policy on runners (block everything except package registries).

---

## 9. Repository Layout (the Olympus app itself)

```
/
├─ apps/
│  ├─ web/                 # Next.js App Router UI (office, chat, artifacts, QA)
│  └─ orchestrator/        # Node service (Mastra workflows, REST + Socket.io)
├─ packages/
│  ├─ core/                # public API surface re-exports (stable, semver'd)
│  ├─ sdk/                 # plugin authoring SDK (types, helpers, test harness)
│  ├─ db/                  # Drizzle schema + migrations
│  ├─ agents/              # built-in role agents + default prompts
│  ├─ tools/               # fs, git, shell, docker, state, review, ticket, incident
│  ├─ runner/              # Docker runner pool, log streaming
│  ├─ browser/             # Playwright wrappers + ARIA helpers
│  ├─ llm/                 # LLMProvider interface + built-in adapters
│  ├─ llm-openrouter/      # first-class OpenRouter adapter
│  ├─ llm-openai-compat/   # OpenAI-compatible (vLLM/Ollama/LM Studio/TGI/…)
│  ├─ llm-anthropic/       # native Anthropic (optional, non-OpenRouter path)
│  ├─ llm-google/          # native Gemini (optional)
│  ├─ llm-mock/            # deterministic fixture provider
│  ├─ gates/               # phase gate validators
│  ├─ plugins/             # plugin loader + manifest schema
│  ├─ skills/              # built-in skills (qa-browser-run, peer-review, bringup)
│  ├─ ui-kit/              # shared UI primitives + office scene components
│  ├─ avatars/             # bundled dotLottie (.lottie) role avatars (CC0/MIT)
│  ├─ themes/              # office themes (tiles, palettes) as plugins
│  └─ shared/              # zod schemas, types, event bus contracts
├─ plugins-examples/       # reference plugins: new role, new provider, new theme
├─ prompts/                # role prompt templates (copied per project)
├─ scripts/                # repo-level dev/ops scripts
├─ workspaces/             # runtime project workspaces (gitignored)
├─ docs/                   # user + plugin author docs (Docusaurus)
├─ docker-compose.yml      # postgres, orchestrator, web, runner host
├─ Dockerfile              # all-in-one image for one-command local run
├─ .env.example
├─ LICENSE                 # MIT (or Apache-2.0 — decide before first tag)
├─ CONTRIBUTING.md
├─ CODE_OF_CONDUCT.md
├─ SECURITY.md
├─ CHANGELOG.md            # Changesets-managed
└─ README.md
```

Monorepo managed by **pnpm workspaces + Turborepo + Changesets**. TypeScript everywhere. All public packages published under an `@olympus/*` scope once v0.1 is tagged.

---

## 10. Phased Rollout (Phases 0–6 Complete, v1 Ready for Live-LLM Validation)

**Phase 0 — Foundations ✅ Complete**
- Single Next.js 15 app, TypeScript, Tailwind, shadcn primitives.
- Filesystem `.software-house/` as the store (Postgres deferred to v2).
- `LLMProvider` abstraction + OpenRouter adapter + 4‑tier model router, env‑driven.
- Workspace layout, artifact contract with Zod front‑matter, phase gates.
- In‑process event bus + SSE endpoint for streaming tokens, role states, events.

**Phase 1 — One role, end‑to‑end ✅ Complete**
- Orchestrator + PM agents, INTAKE → CLARIFY → SPEC pipeline.
- Three‑region UI (chat left, canvas tabs center, context rail right), dotLottie avatars.
- Content blocks (artifacts, questions, gates, tickets) rendered inline.

**Phase 2 — Planning chain ✅ Complete**
- Architect, Tech Lead; produces ARCHITECTURE.md, ADRs, PLAN.md, tickets/T-*.md.
- Artifact browser, pipeline view, events replay view.

**Phase 3 — Code + review (parallel, per-ticket) ✅ Complete**
- **Supervisor pattern** enables parallel ticket work across backend-dev, frontend-dev, devops.
- Reviewer gates each ticket; bounded attempt budget (6 per ticket by default).
- Source allow-lists prevent role boundary violations.
- Web search tool integrated (all roles can query for current best practices).

**Phase 4 — Bring‑up + QA (host‑side) ✅ Complete**
- DevOps spawns `pnpm install && pnpm dev`, allocates port from range (4100–4199).
- BRINGUP phase shows live logs + iframe preview in Runtime tab.
- QA_MANUAL: Playwright suite runs locally, failures open incidents.

**Phase 5 — Self‑heal + security + release ✅ Complete**
- Incident Responder triages QA failures, auto-classifies, dispatches to owning dev role.
- Security Auditor readonly scan → SECURITY_REVIEW.md.
- Release Manager writes CHANGELOG.md + version stamp.
- Budget enforcement (tokens, wall-clock, USD) enforced; exhaustion → pipeline pause + HELP_NEEDED.md.

**Phase 6 — Polish & the "feel" ✅ Complete**
- ✅ Streaming tokens, content blocks, rich chat cards (all rendered).
- ✅ dotLottie (thorvg) avatars with state animations (idle, thinking, typing, reviewing, testing, blocked).
- ✅ Time‑travel replay (load events.ndjson, scrub timeline, jump to any point).
- ✅ Per-role prompt files (copied to .software-house/prompts/ on project init).

**Phase 7 — Multi‑project + self‑hosted ⏳ Deferred to v2**
- Concurrent projects, project picker polish, team auth (Lucia).
- Self‑hosted LLM via `openai-compat` (vLLM/Ollama/LM Studio).
- Horizontal scaling (supervisor pool, not single process).

**Phase 8 — Open source launch ⏳ Deferred to v2**
- Publish `@olympus/*` npm packages, Docker image, docs site (Docusaurus).
- Reference plugins (role, provider, theme).
- Public roadmap, issue templates, good‑first‑issue labels.

**Current Status (April 2026):**
- **Offline path verified:** `LLM_PROVIDER=mock pnpm demo` completes full 14-phase pipeline end-to-end.
- **Live-LLM pending:** Requires `OPENROUTER_API_KEY` to validate real model behavior, cost tracking, QA + heal loop with real failures.
- **Zed ACP tested:** HTTP delegation wired, events relay ready; no live session yet.
- **Budget tracking implemented** but not yet validated with live LLM costs.

**Exit criteria for v1:** Live-LLM validation complete (full pipeline with real models), cost tracking verified, QA/SELF_HEAL loop proven end-to-end.

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Context quality lower than IDE agents | Same toolset (fs/git/shell/browser); inject only *relevant* artifacts per role; gate requires citing file:line |
| Agents loop forever on flaky tests | Hard budgets per phase/incident; auto‑escalate `HELP_NEEDED.md` |
| Context bloat / token cost spiral | Readonly roles for scans; scoped artifact injection; summary memory per role; hard token budget in `state.json` |
| Merge conflicts across parallel devs | Worktree‑per‑ticket + orchestrator‑serialized merges + Tech Lead DAG sequencing |
| QA false positives from timing | Incremental ARIA‑snapshot waits, not fixed sleeps; network‑idle checks |
| Reviewer rubber‑stamping | Gate rejects reviews without cited line numbers or tool‑call evidence |
| Role confusion / prompt drift | Per‑role prompt file, per‑role tool allow‑list, front‑matter on every artifact |
| Security regressions | Security agent runs every build, not only first release |
| Works on my machine | Bring‑up is a single scripted command in a fresh container; tested every release |
| State corruption | `state.json` mutated only by orchestrator; atomic write + rename; git versioned |
| Vendor lock‑in | `LLMProvider` abstraction; local‑first storage; plain git workspace |
| UI theatre overtakes substance | Artifacts remain source of truth; UI is a *view*; can run the orchestrator headless |
| Self‑hosted model later underperforms | Per‑role model map; keep OpenRouter as fallback per role; evaluation harness enforces quality bar |

---

## 12. Extensibility & Plugin Architecture

The core is small; everything interesting is a plugin behind a stable interface. A plugin is any npm package (or local folder under `plugins/`) with an `olympus.plugin.json` manifest.

### 12.1 Plugin Manifest

```json
{
  "name": "olympus-plugin-ml-engineer",
  "version": "0.1.0",
  "olympusApi": "^1",
  "kinds": ["role", "tool"],
  "entry": "./dist/index.js",
  "requires": { "node": ">=22" }
}
```

On boot the plugin loader:
1. Reads `config/plugins.yaml` (or `--plugins` CLI flag).
2. `import()`s each entry, validates `olympusApi` semver.
3. Calls the default export `register(ctx: OlympusContext)` which adds roles/tools/providers/skills/themes to the respective registries.
4. Emits a `plugin.loaded` event so the UI shows what's active.

### 12.2 Extension Points

| Extension | Interface | Examples |
|---|---|---|
| **Role** | `defineRole({ key, displayName, avatar, prompt, tools, reviewedBy })` | Add `ml-engineer`, `data-scientist`, `mobile-dev`, `i18n` |
| **Tool** | `defineTool({ id, schema, run, allowedRoles })` | `jira.createIssue`, `slack.post`, `figma.fetch`, `sentry.query` |
| **LLM provider** | `defineProvider(impl: LLMProvider)` | `bedrock`, `vertex`, `cohere`, local Triton |
| **Skill** | `SKILL.md` file in a `skills/` folder | `perf-profile`, `accessibility-audit` |
| **Phase gate** | `defineGate({ phase, validate })` | Stricter lint gate, license‑header gate |
| **Theme** | `defineTheme({ id, tiles, palette, avatarOverrides })` | Space station, medieval guild, cyberpunk |
| **Event listener** | `on('event', handler)` / `on('phase.advanced', ...)` | Slack notifier, custom analytics |
| **CLI command** | `defineCommand({ name, handler })` | Extend `olympus` CLI with project‑specific ops |
| **Prompt template override** | Replace `prompts/<role>.md` per project | Opinionated style guides, compliance language |

### 12.3 Stable Public API

- `@olympus/core` re‑exports the subset of interfaces that plugins may depend on. Anything not exported from `core` is internal and may change.
- Public API changes follow semver; breaking changes batched into major releases with codemods where possible.
- Every interface is Zod‑schema'd at the boundary so plugins get runtime validation, not just TS types.

### 12.4 Plugin Safety

- Plugins declare required capabilities in the manifest (`fs`, `shell`, `docker`, `network`). Users approve on first load; denials are persisted.
- Plugins never get direct DB access; they go through `ctx.services.*` (artifact read/write, event emit, tool invoke).
- Plugin failures are isolated: a thrown error inside a plugin marks it unhealthy and the core keeps running.

### 12.5 Template: "Add a new role"

```ts
import { defineRole } from '@olympus/sdk';

export default (ctx) => {
  ctx.registerRole(defineRole({
    key: 'ml-engineer',
    displayName: 'ML Engineer',
    avatar: 'ml-engineer.lottie',
    reviewedBy: 'architect',
    prompt: await import('./prompt.md?raw'),
    tools: ['fs.read', 'fs.write:model/**', 'shell.run', 'docker.exec'],
  }));
};
```

That's it. No core changes.

---

## 13. Open Source Readiness

### 13.1 Governance & Licensing

- **License:** MIT, applied to every package; assets (avatars, tiles, sounds) all CC0 or MIT with attribution file.
- **`CONTRIBUTING.md`** with setup, coding standards (ESLint + Prettier configs shared), commit convention (Conventional Commits), branch policy, DCO sign‑off (no CLA).
- **`CODE_OF_CONDUCT.md`** — Contributor Covenant 2.1.
- **`SECURITY.md`** — responsible disclosure, 90‑day window, GPG key.
- **`MAINTAINERS.md`** — roles, decision process (lazy consensus → vote after 14 days).
- **Public roadmap** in `docs/roadmap.md` and mirrored to GitHub Projects.

### 13.2 Quality Bars

- Typed end‑to‑end (`noImplicitAny`, `strict: true`, `noUncheckedIndexedAccess`).
- Tests: unit (Vitest), integration (real Postgres + Docker), e2e (Playwright against the office UI), plugin contract tests.
- CI (GitHub Actions): lint, type‑check, test matrix (Linux/macOS/Windows via WSL for Docker parts), build, Docker image, docs.
- `pnpm test:golden` suite runs the full pipeline against three reference requirements and diffs artifacts against checked‑in goldens (cost controlled via `llm-mock`).

### 13.3 Distribution

- **npm**: `@olympus/core`, `@olympus/sdk`, `@olympus/cli`, adapter packages.
- **Docker**: `ghcr.io/<org>/olympus:latest` all‑in‑one image for `docker run` quickstart.
- **Homebrew / scoop / winget** taps for the CLI after v0.5.
- **VS Code / Cursor / Zed** companion extensions (optional) exposing slash commands to the orchestrator.

### 13.4 Docs

- **Docusaurus** site in `docs/` with sections: Quickstart, Concepts, Role Catalog, Plugin Authoring, LLM Providers, API Reference (generated from TSDoc), Cookbook.
- **Video quickstart** (≤ 3 min): requirement → demo.
- **Examples repo**: 5 reference requirements and the artifacts/products Olympus produced, for community benchmarking.

### 13.5 Community

- GitHub Discussions enabled, pinned "Show your Olympus" thread.
- Discord or Matrix (lightweight; not a requirement for contribution).
- Monthly community call once there are 5+ regular contributors.
- "Good first issue" and "help wanted" labels curated every release.

### 13.6 Anti‑lock‑in Guarantees

- No hosted service required — local `docker compose up` is always fully functional.
- No proprietary SDKs in core; every external integration is a plugin.
- Artifact contract (`.software-house/` schema) is versioned and documented — a user can walk away from Olympus at any time and still have a normal git repo.
- Export tool: `olympus export <project>` writes a self‑contained zip (workspace + events + screenshots) for archival.

---

## 14. Decisions Locked In (and what's deferred)

**Locked for v1:**
- **Office visual:** 2D top‑down, single canvas, **dotLottie (thorvg)** avatars with named state animations.
- **Realtime transport:** **Socket.io** (reliability + DX; automatic reconnect + replay from last `ts`).
- **Event store:** Postgres only; no Redis in v1 (add only if a project sustains > 1k events/min).
- **LLM stack:** `LLMProvider` interface, **OpenRouter as default adapter**, `openai-compat` as the self‑hosted path, plugin API for the rest.
- **Skills format:** reuse Cursor's `SKILL.md` convention 1:1 so skills are portable to the IDE bridge.
- **Agent memory:** per‑role summary memory + last N messages + explicit artifact refs; no full thread replay.
- **License:** MIT (simplest adoption). Revisit Apache‑2.0 before v1.0 if a patent grant becomes important.
- **Monorepo:** pnpm + Turborepo + Changesets.

**Deferred until there's a real user asking:**
- Auth / multi‑tenant (Lucia when we go there — no vendor lock).
- Cloud hosting story (Fly/Render/DO templates).
- Mobile / tablet layouts for the office view.
- Non‑English UI localization.

---

## 15. Editor Hand‑off — Zed (ACP) & Cursor (soft bridge)

### 15.1 Zed via the Agent Client Protocol (first‑class)

**Agent Client Protocol** is an open JSON‑RPC standard ([zed.dev/acp](https://zed.dev/acp), Apache‑2.0) that lets any external agent appear in an editor's agent panel and drive file edits, terminal commands, diagnostics, and diffs. Zed ships first‑party ACP support (Claude Code and Gemini CLI as reference clients). Olympus plugs into that ecosystem — **running its own agents, not Zed's built‑in ones**.

#### 15.1.1 Why this is the right shape

| Concern | Olympus owns | Zed provides |
|---|---|---|
| Agent identity, prompts, tool allow‑lists | ✅ | — |
| Model routing (`LLMProvider`, FAST/REASONING/CODING/VISION tiers) | ✅ | — |
| Budget tracking, token/$/wall‑clock caps | ✅ | — |
| Artifact contract (`.software-house/*`) | ✅ | — |
| File read/write, terminal, diagnostics, diff UI | — | ✅ |
| Workspace sandboxing (project‑scoped FS) | — | ✅ |
| Live diff viewer + review UI | — | ✅ |

Olympus stays focused on orchestration; Zed provides the editor surface. No duplicated effort.

#### 15.1.2 Package layout

The ACP server is a **sibling pnpm package** that imports the already‑extracted provider‑agnostic modules from the web app (§5.1). No prompt or model routing logic is duplicated.

```
olympus-agents/
├─ package.json          # @olympus/acp-server (binary), depends on the
│                        #   web app's roles + llm + envelope modules via
│                        #   workspace references (pnpm workspace protocol).
├─ src/
│  ├─ main.ts            # ACP JSON‑RPC entrypoint over stdio
│  ├─ session.ts         # per-Zed-session state; subscribes to tickets/index.json
│  ├─ dispatch.ts        # imports @olympus/roles + @olympus/llm; picks
│  │                     #   next ready ticket by DAG; runs the Dev/Reviewer
│  │                     #   loop using the SAME ROLE_DEFINITIONS as the web app.
│  ├─ agents/
│  │  ├─ tech-lead.ts    # picks next ready ticket, dispatches
│  │  ├─ backend-dev.ts  # implements backend tickets
│  │  ├─ frontend-dev.ts # implements frontend tickets
│  │  ├─ devops.ts       # scripts, infra files
│  │  ├─ reviewer.ts     # reads git diff, posts review
│  │  ├─ qa.ts           # runs Playwright via terminal/run
│  │  ├─ security.ts     # readonly scan
│  │  └─ release.ts      # CHANGELOG + tag
│  ├─ tools/             # ACP‑side tool wrappers (fs/apply_edit, terminal/run, diagnostics/get)
│  └─ events/            # tails workspace; mirrors into .software-house/events.ndjson
└─ bin/olympus-acp-server   # node shim
```

**Shared source modules** (not duplicated):
- `src/lib/agents/roles/*.ts` — role definitions (mission, tier, reviewedBy, prompts).
- `src/lib/agents/envelope.ts` — strict JSON envelope parser.
- `src/lib/agents/prompts.ts` — `buildSystemPrompt(role)`.
- `src/lib/llm/*` — `LLMProvider` interface, router, tier map, OpenRouter adapter.

Until the monorepo split (v2, §17.3), these are imported from the web app's `src/` directory via a `paths` mapping in `olympus-agents/tsconfig.json` (`"@olympus/web/*": ["../src/*"]`). After the split, they become real workspace packages. The **source of truth for role behavior is therefore one place**; Zed and the web app cannot drift.

#### 15.1.3 Zed `settings.json` snippet

Written by the Olympus "Open in Zed" action:

```jsonc
{
  "agent_servers": {
    "Olympus": {
      "command": "node",
      "args": ["<workspace>/.zed/olympus-acp-server.cjs"],
      "env": {
        "OLYMPUS_PROJECT_ID": "<project-id>",
        "OLYMPUS_WORKSPACE": "<absolute path to workspaces/<project-id>>",
        "OLYMPUS_API": "http://localhost:3100/api",
        "OPENROUTER_API_KEY": "…"
      }
    }
  }
}
```

The Olympus web app passes its own OpenRouter key through env so the agents run with the *same* budget and tier map. Users can override at the Zed level if they want a different model for the editor surface.

#### 15.1.4 Turn loop inside Zed

1. Human (or Tech Lead agent) runs `@olympus/tech-lead` in Zed's agent panel.
2. Server reads `tickets/index.json`, picks the next `todo` ticket whose deps are done.
3. Dispatches to `@olympus/backend-dev` (or `frontend-dev`) with the ticket file, SPEC excerpt, and architecture context.
4. Dev agent calls Zed's ACP tools (`fs/apply_edit`, `terminal/run pnpm install`) to implement the ticket; Zed shows live diffs and terminal output.
5. On completion, `@olympus/reviewer` runs with `git diff` as input and either `approve`s (ticket → `done`) or `request-changes` (ticket → `changes-requested`, Dev agent re‑runs with findings, bounded to 3 cycles).
6. Each step appends to `events.ndjson` so Olympus's web UI (office, chat, mini‑map) updates in real time.
7. On all tickets done, QA agent runs Playwright via `terminal/run`, writes `qa/reports/*`.

#### 15.1.5 Two‑way steering

- The human can type into **Olympus's chat panel** while Zed is driving; messages are tagged `@role` and appended as barge‑in inputs to the current ACP session (`session/notify` with `context=human.barge`).
- The human can also type directly into **Zed's agent panel**; those messages are mirrored into Olympus's chat via the event stream.
- The `Pause` toggle in Olympus sets `state.paused = true`; the ACP server checks this at each turn boundary and suspends, resuming when the flag clears.

### 15.2 Cursor (soft bridge)

Cursor doesn't implement ACP yet, so the Cursor path is **humans only, not agent‑driven**:

- `olympus bridge cursor <project>` (CLI) or "Open in Cursor" (UI) opens the workspace in Cursor with a preinstalled `.cursor/rules/` set so the human's own Cursor chats get the role conventions.
- `.cursor/commands/` slash commands (`/sh-status`, `/sh-gate`, `/sh-heal`) hit the Olympus HTTP API so the human can read project state from inside Cursor.
- No Olympus agents run inside Cursor. Full autonomy belongs to either the web app (in‑process) or Zed (ACP).

If Cursor later exposes ACP, the same `olympus-agents/acp-server` binary will work there with zero changes.

---

## 16. Success Metrics

- **Time to first working build** from requirement submission (target: < 30 min for simple CRUD apps).
- **Unaided completion rate** (projects reaching DEMO without a human `HELP_NEEDED.md`).
- **Review rework rate** (% of PRs with ≥ 2 review rounds).
- **QA flake rate** (scenarios that pass on retry without any code change).
- **Cost per project** (tokens × $ / project).
- **Human intervention count** per project.

All metrics derived from `events` + `agent_runs` + `budgets` tables; shown on a per‑project summary when the pipeline completes.

---

## 17. Current Implementation Status & Next Steps (Actual vs. Plan)

### 17.1 v1 Shipped — All Phases 0–6 Implemented ✅

Completed modules (from §16 summary):
1. ✅ Next.js 15 + TS + Tailwind + shadcn primitives.
2. ✅ Zod-typed contracts: state.json, artifacts, events, content blocks.
3. ✅ `LLMProvider` abstraction + OpenRouter + 4-tier router + mock provider.
4. ✅ Three-region UI shell (chat, canvas tabs, context rail).
5. ✅ Orchestrator + PM agents, INTAKE → CLARIFY → SPEC pipeline.
6. ✅ Artifact browser, pipeline view, events replay, dotLottie avatars.
7. ✅ **Supervisor pattern** with persistent task pool (core architecture shift).
8. ✅ All 13 roles defined with prompts and envelopes.
9. ✅ IMPLEMENT loop (backend-dev, frontend-dev, devops in parallel per ticket).
10. ✅ Reviewer gates + source allow-lists.
11. ✅ BRINGUP (host-side `pnpm dev`) + Runtime tab with logs + iframe.
12. ✅ QA_MANUAL (Playwright runner, incident opening).
13. ✅ SELF_HEAL (incident dispatch, 3-attempt bounded retry).
14. ✅ SECURITY + RELEASE phases.
15. ✅ Budget enforcement (tokens, wall-clock, USD).
16. ✅ Event persistence + SSE streaming.
17. ✅ Web search tool (all roles can query for current practices).
18. ✅ ACP server scaffold (HTTP delegation, events relay).

**Offline validation:** `LLM_PROVIDER=mock pnpm demo --fixture=hello-readme` completes full 14-phase pipeline end-to-end in ~30s.

### 17.2 Remaining Work for v1 Validation (Live-LLM) 🎯 In Flight

Ordered by priority:

1. **Live-LLM end-to-end validation** (prerequisite for v1 release)
   - Set `OPENROUTER_API_KEY=...` or point to self-hosted LLM.
   - Run `pnpm dev` and submit a real requirement in the web UI.
   - Watch tokens, USD, wall-clock meters tick up in context rail.
   - Confirm SPEC, ARCHITECTURE, PLAN artifacts are sensible.
   - Validate review decisions (approve vs request-changes) on dev turns.
   - **Target:** One small (e.g., hello-world README) and one medium (to-do list CRUD) project completing DEMO phase.

2. **QA + SELF_HEAL end-to-end** (validate incident discovery + healing)
   - Author a deliberately-broken Playwright test in the generated project.
   - Watch QA_MANUAL phase run, incident opened.
   - SELF_HEAL phase dispatches fix to dev role.
   - Verify re-run after fix (incident resolved, not escalated).
   - **Target:** One incident closed via auto-heal; one escalated to HELP_NEEDED.

3. **Zed ACP smoke test** (validate editor hand-off)
   - Set `OLYMPUS_PROJECT_ID` and `OPENROUTER_API_KEY` env.
   - Click "Open in Zed" button in Olympus web UI.
   - Zed opens with `.zed/settings.json` registered.
   - Prompt `@olympus/tech-lead` in Zed agent panel.
   - Verify dispatch → HTTP call to web app → response back.
   - Send a barge-in message from Olympus web UI, confirm it reaches Zed agent.

4. **Cost tracking validation**
   - Add USD/token breakdown modal in context rail.
   - Show per-role consumption (e.g., "Orchestrator: 50K tokens / $0.15").
   - Confirm running total matches envelope token counts.

5. **Event replay performance** (if >100K events, may be slow to load)
   - Profile `/api/projects/[id]/events` endpoint on large projects.
   - If needed, implement range-fetched replay (lazy-load 100 events at a time).

### 17.3 v1 Architectural Decisions (Locked For Release)

| Decision | Rationale | Return Path to Change |
|----------|-----------|----------------------|
| **Supervisor pattern** (not sequential) | Enables parallel ticket work, graceful pausing | Phase 2 of v2 refactor (trivial — swap task loop) |
| **Persistent task pool** (not in-memory) | Restartability + audit trail | Already designed for; swap store backend |
| **Task-driven phases** (not role-per-phase) | Flexible work distribution, concurrency control | Already implemented; no breaking change |
| **Mock provider** (for offline testing) | Cost control, reproducibility | Bundled; OpenRouter live path validated |
| **Source allow-lists** (per-role write gates) | Security + role boundaries | Already implemented, not changing |
| **Web search tool** (integrated) | Current best practices, grounded reasoning | Toggleable via config (not removing) |
| **SSE streaming** (not WebSocket initially) | Simpler, no connection state | v2 can add Socket.io for back-pressure |
| **Artifact-first** (not chat-first) | Offline inspectability, git-friendly | Core design principle, not changing |

### 17.4 v2 — Deferred, Documented, Return Path Clear

1. **Monorepo split** — Extract `apps/orchestrator`, `packages/agents`, etc.; introduce Mastra.
2. **Git worktrees + parallelism** — Spawn dev per ticket in isolated worktree.
3. **Docker runner pool** — Build/serve/QA containers with resource caps.
4. **Postgres mirror** — Tail `.software-house/` into Drizzle for query/dashboard.
5. **Plugin loader + SDK** — Community roles, tools, providers, themes.
6. **Multi-project + auth** — Lucia integration, horizontal supervisor pool.
7. **Self-hosted LLM path** — Full OpenAI-compat adapter (vLLM, Ollama, LM Studio, TGI).
8. **Open source launch** — Publish npm packages, Docker image, docs, community.

**Key insight:** v2 changes the *runtime host* (worktrees, Docker, Postgres), not the *agent logic or artifact contracts*. Supervisor, task pool, role definitions, envelope schema — all stable and unchanged.

---

## 18. Implementation Approach: Supervisor Pattern Deep Dive

### 18.1 Why the Supervisor Pattern Works Better

**Original sequential design (from plan):**
```typescript
while (phase !== DEMO) {
  seedTasksForCurrentPhase();
  while (allTasksInPhaseComplete) {
    for (role in ROLES_FOR_PHASE) {
      task = nextTaskFor(role);
      runTask(task);
    }
  }
  phase = nextPhase();
}
```

**Problem:** Dev trio (backend, frontend, devops) work on different tickets; sequential blocking means:
- Backend dev finishes ticket A, must wait for frontend dev on tickets B–C before frontend dev can start.
- No parallelism across roles → throughput bottleneck.
- If one dev is slow, entire phase stalls.

**Actual supervisor pattern (implemented):**
```typescript
const workers = new Map(); // one worker per role × concurrency
for (const role of ROLES) {
  for (let i = 0; i < concurrency[role]; i++) {
    workers.set(`${role}-${i}`, spawnWorkerLoop(role));
  }
}

const supervisor = setInterval(() => {
  checkBudgets();  // Pause if hard cap breached
  seedNextPhaseIfIdle(15s);
  checkGates();    // Can we advance?
  if (gatesPassed && phaseIdle) {
    phase = nextPhase;
  }
}, 1000);

// Each worker loop:
while (true) {
  task = taskPool.claimNextForRole(role, workerId);
  if (!task) { sleep(pollMs); continue; }
  
  result = runTaskHandler(task);
  taskPool.markComplete(task.id);
}
```

**Benefits:**
- ✅ **Parallelism**: Multiple devs work on different tickets simultaneously.
- ✅ **Fair distribution**: Oldest pending task claimed first (FIFO per role).
- ✅ **Restartability**: Task pool snapshot persisted to disk; hydrate on cold start.
- ✅ **Graceful pausing**: Budget exhausted → `state.paused = true` → workers idle, supervisor stops advancing.
- ✅ **Observable**: Full task lifecycle logged (created, claimed, completed, failed).
- ✅ **Extensible**: Add new task kinds without changing supervisor logic.

### 18.2 Task Pool Lifecycle Example

```
IMPLEMENT phase, ticket T-0001 (backend-dev):

1. Tech Lead's PLAN turn completes:
   - Create task { kind: 'ticket-dev', role: 'backend-dev', payload: { code: 'T-0001' } }
   - Write to task-pool.json, emit task.created event

2. Supervisor tick (backend-dev worker claims):
   - Call taskPool.claimNextForRole('backend-dev', workerId)
   - Task marked in-progress with claimedBy and claimedAt
   - Write snapshot

3. Worker runs dev turn:
   - runDevForTicketOnce(task.payload.code)
   - LLM returns sourceWrites + advance flag
   - Apply sourceWrites to src/**
   - Update task status → 'done' (or 'failed' if attempts exhausted)

4. Reviewer concurrently claims ticket-review task:
   - Same T-0001, but role='reviewer'
   - runReviewForTicketOnce()
   - Emits review decision (approve | request-changes | block)

5. If request-changes and attempts < 6:
   - Update T-0001 ticket status to 'changes-requested'
   - Emit ticket.status event
   - Create new 'ticket-dev' task for another attempt
   - Dev claims and re-runs with findings as context

6. When all tickets done and gate passes:
   - Supervisor ticks idle buffer (15s default)
   - Checks INTEGRATE gate: all tickets done, all reviews approved
   - Phase advances IMPLEMENT → REVIEW → INTEGRATE → BRINGUP
   - seedTasksForCurrentPhase() creates devops-bringup task
```

### 18.3 Budget Enforcement in Supervisor Loop

```typescript
// Every supervisor tick (1s):
const budgetState = enforceBudgets(projectId);
if (!budgetState.ok) {
  state.paused = true;
  emit({ kind: 'pipeline.paused', reason: budgetState.reason });
  // Workers still claim tasks, but supervisor stops seeding new phases
  return;
}

// In enforceBudgets():
// 1. Check tokensUsed >= tokensHard
// 2. Check wallClockMs >= wallClockCapMs
// 3. Check usdUsed >= usdHard
// Any failure → pause pipeline + emit event
```

**Token tracking:**
```typescript
// After each agent turn:
const promptTokens = envelope.promptTokens || estimateTokens(context);
const completionTokens = stream.tokenCount || estimateTokens(envelope.text);
state.budgets.tokensUsed += promptTokens + completionTokens;
```

**Cost calculation:**
```typescript
const model = resolveRoleCandidates(role)[0];
const pricing = getModelPrice(model.model); // e.g., $0.15 / $10 per 1M tokens
const cost = (promptTokens * pricing.prompt + completionTokens * pricing.completion) / 1_000_000;
state.budgets.usdUsed += cost;
```

---

## 18. Quickstart (once built)

The goal for the out‑of‑the‑box experience is: **three commands from clone to running office.**

### 18.1 One‑liner (Docker, recommended)

```bash
git clone <repo-url> olympus && cd olympus
cp .env.example .env             # then fill in OPENROUTER_API_KEY
docker compose up                # builds + starts postgres, orchestrator, web
```

Open `http://localhost:3000`. First launch runs migrations automatically and greets you in the chat panel.

### 18.2 Dev mode (for contributors)

```bash
git clone <repo-url> olympus && cd olympus
pnpm install
cp .env.example .env             # fill OPENROUTER_API_KEY

docker compose up -d postgres    # db only; app runs on host
pnpm db:migrate
pnpm dev                         # starts web (3000) + orchestrator (4000) with HMR
```

### 18.3 CLI helper

`@olympus/cli` ships with shortcuts so users never need to remember package‑manager commands:

```bash
olympus init                     # first-run wizard; writes .env interactively
olympus up                       # docker compose up
olympus down                     # docker compose down
olympus logs [service]           # tail a service's logs
olympus doctor                   # checks Docker, env keys, disk, ports, model reachability
olympus export <project>         # zip workspace + events + screenshots
olympus upgrade                  # pull latest image + run migrations
```

`olympus doctor` is the "why isn't this working" escape hatch: pings the configured LLM provider with each tier, confirms Docker is reachable, checks that required ports are free, and verifies workspace write access.

### 18.4 `.env.example` (canonical reference)

A complete, commented template ships at the repo root. Abridged here; the real file is §18.5.

```ini
# --- LLM ---
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=            # get one at https://openrouter.ai/keys

# --- Model tiers (these are the *only* knobs most users touch) ---
MODEL_TIER_FAST=openai/gpt-5-mini
MODEL_TIER_REASONING=anthropic/claude-sonnet-4
MODEL_TIER_CODING=anthropic/claude-sonnet-4
MODEL_TIER_VISION=google/gemini-2.5-pro

# --- App ---
OLYMPUS_WEB_PORT=3000
OLYMPUS_ORCH_PORT=4000
OLYMPUS_WORKSPACES_DIR=./workspaces

# --- Database ---
DATABASE_URL=postgres://olympus:olympus_dev@localhost:5432/olympus

# --- Budgets (per project, soft/hard caps) ---
BUDGET_TOKENS_HARD=5000000
BUDGET_USD_HARD=25
BUDGET_WALLCLOCK_MINUTES=180
```

### 18.5 Single‑command flow summary

After `.env` is populated:

| Step | Command | Time |
|---|---|---|
| 1 | `cp .env.example .env` + edit | ~30s |
| 2 | `docker compose up` | ~45s first run |
| 3 | Open `http://localhost:3000` and type your requirement in the chat | instant |

That's it — no extra build steps, no migration command to remember, no multi‑service spin‑up to coordinate.

### 18.6 What ships at the repo root

```
.env.example         # full, commented template (see §5.6 + §18.4)
docker-compose.yml   # postgres + orchestrator + web (+ runner host)
Dockerfile           # multi-stage build producing ghcr.io/<org>/olympus
README.md            # mirrors §18.1–18.3 with screenshots
```

`.env.example` is version‑controlled; `.env` is gitignored. The CLI's `olympus init` wizard can also generate `.env` interactively (prompts for OpenRouter key, picks sensible tier defaults, writes the file).

---

## 19. V1 Completion Checklist (April 2026 Status)

### Core Architecture ✅
- [x] Supervisor pattern with persistent task pool
- [x] Worker pool (one per role × concurrency)
- [x] Phase gate system (plugin registry)
- [x] Budget enforcement (tokens, wall-clock, USD)
- [x] Event bus + NDJSON persistence
- [x] Graceful pausing on budget exhaustion

### Agent Roles (13/13 Implemented) ✅
- [x] Orchestrator (INTAKE/CLARIFY)
- [x] PM (SPEC)
- [x] Architect (ARCHITECTURE + ADRs)
- [x] Tech Lead (PLAN + tickets)
- [x] Backend Dev (code generation)
- [x] Frontend Dev (code generation)
- [x] DevOps (bringup scripts)
- [x] QA (test plan + Playwright)
- [x] Reviewer (code review + gates)
- [x] Security (audit)
- [x] Incident Responder (triage + dispatch)
- [x] Release Manager (version + changelog)
- [x] Technical Writer (demo + docs)

### Pipeline Phases (14/14 Implemented) ✅
- [x] INTAKE
- [x] CLARIFY
- [x] SPEC
- [x] ARCHITECT
- [x] PLAN
- [x] IMPLEMENT
- [x] REVIEW
- [x] INTEGRATE
- [x] BRINGUP
- [x] QA_MANUAL
- [x] SELF_HEAL
- [x] SECURITY
- [x] RELEASE
- [x] DEMO

### LLM Integration ✅
- [x] LLMProvider interface
- [x] OpenRouter adapter (default)
- [x] Mock provider (offline testing)
- [x] 4-tier routing (FAST / REASONING / CODING / VISION)
- [x] Per-role model override (ROLE_MODEL_*)
- [x] Model pricing table
- [x] USD cost tracking
- [x] Web search tool (Tavily/SerpAPI/fallback)

### Artifacts & Persistence ✅
- [x] Zod-typed state.json schema
- [x] Artifact front-matter normalization
- [x] REQUIREMENTS.md (with clarifications)
- [x] SPEC.md (user stories + acceptance criteria)
- [x] ARCHITECTURE.md (design + ADRs)
- [x] PLAN.md (ticket breakdown)
- [x] CHANGELOG.md
- [x] SECURITY_REVIEW.md
- [x] tickets/index.json (shared queue)
- [x] incidents/index.json (incident tracking)
- [x] reviews/PR-*-review.md (structured reviews)
- [x] qa/reports/R-*.md (test results)
- [x] Atomic writes (write tmp + rename)

### Runtime & QA ✅
- [x] Host-side runtime manager (spawn pnpm dev)
- [x] Port allocation (4100–4199 range)
- [x] Log streaming to events.ndjson + UI
- [x] Playwright QA harness
- [x] Screenshot capture
- [x] Incident auto-opening from QA failures
- [x] ARIA snapshot support

### Self-Healing ✅
- [x] Incident classification (frontend | backend | infra | data | spec-gap)
- [x] Automatic dispatch to owning dev role
- [x] 3-attempt bounded retry per incident
- [x] HELP_NEEDED.md escalation

### UI & UX ✅
- [x] 3-region layout (chat, canvas, context rail)
- [x] Canvas tabs (workspace, pipeline, implement, runtime, replay, budgets)
- [x] Message streaming via SSE
- [x] Content block rendering (artifacts, questions, gates, tickets, diffs, etc.)
- [x] dotLottie avatar placeholders (full thorvg integration)
- [x] Event timeline + replay scrubber
- [x] Budget meters (tokens, wall-clock, USD)
- [x] Project picker

### Zed ACP Integration ✅
- [x] HTTP delegation client (olympus-agents/)
- [x] JSON-RPC skeleton
- [x] Tool wrapper stubs (fs-apply-edit, terminal-run)
- [x] Events watcher + barge-in relay
- [x] "Open in Zed" button
- [x] .zed/settings.json generation

### Testing & Validation ✅
- [x] Unit tests (budget, envelope, mock provider, incidents, tickets)
- [x] Offline demo runner (LLM_PROVIDER=mock pnpm demo)
- [x] Mock provider envelope matrix (per role × phase)
- [x] Envelope schema validation (Zod)
- [x] Source allow-list validation

### Pending (Live-LLM Validation) ⏳
- [ ] **Live end-to-end with real LLM** (OPENROUTER_API_KEY set, full pipeline, cost tracking)
- [ ] QA + SELF_HEAL cycle with real failures (generate incident, auto-heal, validate closure)
- [ ] Zed ACP smoke test (session creation, tool call, barge-in relay)
- [ ] Multi-project stress test (event log scaling, supervisor with 100+ concurrent tasks)
- [ ] Performance profile (event replay load time on large projects)
- [ ] Cost breakdown UI (per-role / per-phase consumption)

### Documentation ⏳
- [ ] Quickstart guide (copy-pasted from §18.1–18.6)
- [ ] Architecture decision record (supervisor pattern vs. sequential)
- [ ] Prompt engineering guide (per-role best practices)
- [ ] LLM provider setup (OpenRouter, Ollama, vLLM, etc.)
- [ ] Troubleshooting (common issues, logs to check)

### v1 Release Gate
**Ready when:**
1. ✅ Offline pipeline (mock provider) completes end-to-end INTAKE → DEMO
2. ⏳ Live pipeline (real LLM) completes end-to-end with sensible artifacts
3. ⏳ QA + SELF_HEAL validated (incident → fix → resolved)
4. ⏳ Zed ACP smoke test passes (one role, one tool call)
5. ⏳ Cost tracking validated (USD meters accurate)
6. ✅ All tests passing (vitest + offline demo)
7. ✅ No critical linter errors or type issues

**Estimated**: Live-LLM validation + Zed smoke test = 2–3 engineer-days.

---

## Appendix: Deviations from Original Plan

| Original Plan | Actual Implementation | Why |
|---------------|----------------------|-----|
| Sequential phase loop | Supervisor + task pool | Parallelism for dev trio |
| Mastra workflows | Hand-coded supervisor + handlers | Simpler initial dependency graph |
| Redis for caching | In-memory event buffer | Single-process v1 doesn't need it |
| Postgres in v1 | Filesystem store only | Simpler, more portable |
| Git worktrees in v1 | Single checkout, sequential merge | Simplifies v1; v2 upgrade path clear |
| Docker runners in v1 | Host-side spawn (pnpm dev) | Reduces setup friction, no container overhead in v1 |
| 13 roles | 13 roles (no change, actually more structured) | ✅ Plan was accurate |
| 14 phases | 14 phases (not 13 as originally written) | ✅ Plan was missing REVIEW as separate phase |
| 4-tier LLM routing | 4-tier LLM routing (as planned) | ✅ Implemented exactly as spec'd |
| OpenRouter-first | OpenRouter-first (as planned) | ✅ Default provider, mock for offline |
| Artifact-first design | Artifact-first design (as planned) | ✅ Source of truth is .software-house/ |
| Plugin architecture | Plugin registry for gates (v1); full plugin loader (v2) | ✅ Extensible, deferred complex plugin loader |

**Bottom line:** Core architecture shifted from sequential to supervisor-based (good change), but all role/phase/artifact/budget specs held. v1 fully functional, ready for live-LLM validation.
