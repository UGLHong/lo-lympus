# Task Pool Rework — plan

Everything workable is a **task** in a single, per-project pool. Employees poll the pool, claim what they can work on, and publish state back. No per-phase pools; phase is just metadata on the task.

## Why

- One source of truth the UI, the humans, and the AI all read from.
- Employees work in parallel without waiting on each other unless gating says so.
- Visualisable on disk: one folder per task, markdown content the LLM can read as-is.
- Configurable per employee (poll rate, concurrency, accepted task kinds, model overrides) without touching code.

## Layout on disk

```text
workspaces/<projectId>/.software-house/
  tasks/
    index.ndjson                 # append-only event log (task.created / claimed / ...)
    _open.json                   # derived snapshot of non-terminal tasks, for fast reads
    TSK-0001-orchestrator-intake/
      task.json                  # the "row" (zod validated)
      requirement.md             # free-form content the LLM reads/writes
      spec.md
      architecture.md
      review.md
      notes.md
config/
  employees/
    orchestrator.json            # per-employee config, one per role
    pm.json
    ...
docs/
  task-pool-rework.md            # this document
```

- `task.json` is **structured**: ids, enums, timestamps, payload, refs.
- `.md` siblings are **content** the LLM consumes directly — no DB/JSON parsing.
- `index.ndjson` is authoritative history; `_open.json` is a rebuildable cache.
- Migration to Postgres later = ingest `index.ndjson` into a `task_events` table; keep the markdown folders as blobs / paths.

## Task lifecycle (same pool, transitioned via events)

```text
pending → in-progress → done
               ↘ failed
               ↘ paused-awaiting-human → pending (on human reply)
```

Review is modelled as **new tasks of different kinds** (e.g. `phase-review`, `ticket-review`) rather than as extra statuses, matching the current codebase so we do not rewrite handler logic.

## Events (SSE)

Added to `src/lib/schemas/events.ts`:

- `task.created` — `{ taskId, kind, role, phase }`
- `task.claimed` — `{ taskId, workerId, role }`
- `task.completed` — `{ taskId }`
- `task.failed` — `{ taskId, reason? }`
- `task.paused` — `{ taskId, reason? }` (awaiting human)
- `task.dropped` — `{ taskId }` (pool cleaned up)

## Per-employee JSON config

Each role has `config/employees/<role>.json`:

```json
{
  "role": "orchestrator",
  "enabled": true,
  "pollMs": 5000,
  "concurrency": 1,
  "accepts": ["orchestrator-intake", "orchestrator-clarify"],
  "modelSpec": "tier:reasoning"
}
```

- `pollMs` overrides `OLYMPUS_EMPLOYEE_POLL_MS` (default **5000**) per employee.
- `concurrency` spawns N parallel workers for that role (multiple `frontend-dev`s fan out across tickets).
- `accepts` is a safety net; if omitted, the role picks up whatever is addressed to it.
- `modelSpec` is optional; falls back to role default.

Configs hot-reload on the next supervisor tick; no code change required.

## Modular gates

New `src/lib/gates/` registry. A gate is `(projectId, ctx) => Promise<GateResult>`. Registered by name, then attached to a **target phase** (existing behaviour) **or** a task-eligibility check.

Initial plugins:

- `all-tickets-done` — IMPLEMENT → INTEGRATE. This is the "everyone finishes before manual UI testing" requirement.
- `phase-review-approved` — ensures review of the previous phase is approved.
- `no-open-incidents` — SELF_HEAL → SECURITY.

`validateGate(projectId, targetPhase)` now delegates to the registry instead of hardcoding one phase.

## Parallelism and waits

- Default: **every employee works independently**. Claim is atomic over the in-memory pool; disk is updated afterwards.
- "Wait for all tickets" is expressed via the `all-tickets-done` gate on the phase transition, not by blocking workers. Workers keep polling; the supervisor holds the phase until the gate is green.
- `paused-awaiting-human` is a task status. When a worker raises a `question` block, the handler marks the task paused, emits `task.paused`, and returns. A human reply re-seeds or resumes.

## Office UI

`src/components/office/` gets a new **Task Desk** panel:

- Left: avatars (existing), each labelled with the task they are currently working on (read from `task.claimed` events).
- Right: list of pending / in-progress tasks, grouped by phase, with title, role, age. Clicking a task reveals its markdown content inline.

Driven by `GET /api/projects/[id]/task-pool` for the initial snapshot + the existing SSE stream for deltas.

## Implementation order

1. Filesystem task-pool store (`src/lib/task-pool/`). Persist via write-through, keep in-memory hot cache, hydrate from `_open.json` on cold start.
2. Bridge `src/lib/pipeline/backlog.ts` → new store. Preserve its exported API so every existing handler and seeding path keeps working.
3. Per-employee JSON config loader + multiple workers per role.
4. Modular gate registry + `all-tickets-done` gate.
5. `task.*` events + SSE wiring.
6. `GET /api/projects/[id]/task-pool` + Office Task Desk panel.

## Env

```
OLYMPUS_EMPLOYEE_POLL_MS=5000            # default for every employee
OLYMPUS_EMPLOYEE_CONFIG_DIR=./config/employees
```

(Existing `OLYMPUS_WORKER_POLL_MS` stays for compat and is used if an employee config is missing.)
