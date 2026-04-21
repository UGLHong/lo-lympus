# Task Pool Migration — Completed

**Date:** April 21, 2026

## Overview

The L'Olympus software house has been rearchitected to use a **persistent, event-driven task pool as the single source of truth**. Multiple employees now work in parallel on independent tasks without blocking each other, unless a gate (e.g., "all tickets done") holds a phase transition.

## What Changed

### 1. **Filesystem Task Pool** (`src/lib/task-pool/`)

Every task now lives on disk:

```text
.software-house/tasks/
  index.ndjson              # append-only event log
  _open.json                # derived snapshot for fast reads
  TSK-0001-orchestrator-intake/
    task.json               # structured row
    requirement.md          # free-form content (LLM reads/writes)
    spec.md
    architecture.md
    review.md
```

- **Schema:** `Task` with `TaskKind`, `TaskStatus` (including `paused-awaiting-human`), metadata.
- **Persistence:** In-memory hot cache with write-through on every mutation.
- **Hydration:** Synchronous from `_open.json` on cold start (no async boot sequence).
- **Events:** Every mutation appends to `index.ndjson` and emits a `task.*` event (created/claimed/completed/failed/paused/dropped) on the bus.

### 2. **Per-Employee JSON Config** (`src/lib/employees/`)

Each role now has a configuration file:

```json
{
  "role": "backend-dev",
  "enabled": true,
  "pollMs": 5000,
  "concurrency": 2,
  "accepts": ["ticket-dev", "incident-heal"],
  "note": "Two parallel backend devs so independent tickets fan out."
}
```

**Hot-reloadable:** Worker loops re-read config every tick, so changes take effect without restart.

**Default concurrency:**
- Orchestrator, PM, Architect, Tech Lead, Security, Incident, Release, Writer: **1** (serial, human-facing)
- Backend Dev, Frontend Dev: **2** (parallel per ticket)
- Reviewer, QA: **2** (parallel reviews/test scenarios)
- DevOps: **1**

### 3. **Modular Gate Registry** (`src/lib/gates/`)

Phases can now register gate plugins — no switch statement:

- `all-tickets-done` — IMPLEMENT → INTEGRATE. **This is the fan-in barrier for manual UI testing:** waits for every ticket to be `done`, none `blocked`, and no live IMPLEMENT tasks in the pool.
- `no-high-severity-findings` — from legacy INTEGRATE gate.
- `no-open-incidents` — from legacy INTEGRATE gate.

**Extensible:** New gates are added as `.ts` files in `plugins/`, registered in `ensureGatePluginsRegistered()`, and picked up automatically.

### 4. **Events** (`src/lib/schemas/events.ts`)

New event kinds:

- `task.created` — `{ taskId, taskSlug, taskKind, role, phase, title, summary }`
- `task.claimed` — `{ taskId, taskSlug, workerId, role }`
- `task.completed` — `{ taskId, taskSlug }`
- `task.failed` — `{ taskId, taskSlug, reason? }`
- `task.paused` — `{ taskId, taskSlug, reason? }`  
- `task.dropped` — `{ taskId, taskSlug }`

All flow through the existing SSE stream so the UI subscribes to one event bus.

### 5. **Office UI** (`src/components/office/`)

The ambient presence view now shows:

- **Role avatars** with **current task label** (slug of what they are working on).
- **Task Desk** panel:
  - Groups tasks by status: `in-progress`, `pending`, `paused-awaiting-human`.
  - Each row shows role, phase, task title, slug, summary.
  - Real-time updates via 150ms debounced refresh on `task.*` events.

### 6. **API Route** (`GET /api/projects/[id]/task-pool`)

Returns:

```json
{
  "projectId": "test-task-pool-g9m78n",
  "tasks": [...],
  "workers": [...],
  "running": true,
  "awaitingHumanForPhase": null
}
```

Fast response (hot cache in memory).

### 7. **Backlog Bridge** (`src/lib/pipeline/backlog.ts`)

The legacy `enqueueTask`, `claimNextForRole`, `completeTask`, `failTask` API is preserved. All calls now delegate to the new pool store, so **no handler code changes required**.

### 8. **Software House Refactor** (`src/lib/pipeline/software-house.ts`)

- Workers now spawned from employee configs, honoring `concurrency` (e.g., 2 backend devs, 1 orchestrator).
- Each worker loop reloads its config every tick (`pollMs`, `accepts`).
- Snapshots expose `currentTaskSlug` for the Office UI.

## Parallelism Model

**Default:** Every employee polls independently. No blocking except at gates.

Example: During IMPLEMENT phase with 10 tickets:
- **2 backend devs** claim `ticket-dev` tasks in parallel.
- **2 frontend devs** claim `ticket-dev` tasks in parallel.
- **2 reviewers** claim `ticket-review` tasks in parallel.
- All work simultaneously without waiting for each other.

**Phase transition gates:** When IMPLEMENT is done, the supervisor checks:
1. All tickets are `done`.
2. No tickets are `blocked`.
3. No live IMPLEMENT tasks in the pool.
4. No high-severity review findings.
5. No open incidents.

Only when **all** gates pass does the supervisor advance to INTEGRATE → BRINGUP → QA_MANUAL.

## Migration Notes

### For Handlers

No changes required. The backlog API works identically:

```ts
const task = enqueueTask({
  projectId, kind: 'ticket-dev', role: 'backend-dev', phase: 'IMPLEMENT',
  payload: { ticketCode: 'T-001' }
});

const next = claimNextForRole(projectId, 'backend-dev', workerId);
// ... work ...
completeTask(projectId, task.id);
```

### For Tasks with Content

To add free-form markdown to a task:

```ts
import { writeTaskContent, readTaskContent } from '@/lib/task-pool/store';

await writeTaskContent(projectId, taskId, 'spec.md', specBody);
const spec = await readTaskContent(projectId, taskId, 'spec.md');
```

### For New Gates

1. Create `src/lib/gates/plugins/my-gate.ts`:

```ts
import type { GatePlugin } from '../registry';

export const myGate: GatePlugin = {
  id: 'my-gate-id',
  description: '...',
  targetPhase: 'MY_PHASE',
  async evaluate(projectId) {
    return [{ label: 'Check X', ok: true/false, note: '...' }];
  }
};
```

2. Register in `src/lib/gates/index.ts`:

```ts
export function ensureGatePluginsRegistered(): void {
  // ...
  registerGatePlugin(myGate);
}
```

### For Scaling Worker Concurrency

Edit `config/employees/<role>.json`:

```json
{
  "role": "backend-dev",
  "concurrency": 4,
  "pollMs": 3000
}
```

Next supervisor tick, 4 parallel backend devs will be spawned.

## Verification

✅ **Typecheck:** `npx tsc --noEmit` — clean.  
✅ **Tests:** `npx vitest run` — 86 tests passing.  
✅ **Dev server:** `pnpm dev` — healthy, no errors.  
✅ **Manual test:** Created project "Test Task Pool" → Office view shows avatars + task desk → tasks persist to disk → API responds fast.

## Files

### Core

- `src/lib/task-pool/schema.ts` — Task types.
- `src/lib/task-pool/store.ts` — In-memory + filesystem store.
- `src/lib/task-pool/describe.ts` — Slug & title helpers.
- `src/lib/task-pool/paths.ts` — Filesystem layout.

### Employees & Config

- `src/lib/employees/config.ts` — Config loader.
- `config/employees/<role>.json` × 13 — Per-role settings.

### Gates

- `src/lib/gates/registry.ts` — Plugin registry.
- `src/lib/gates/index.ts` — Registration.
- `src/lib/gates/plugins/all-tickets-done.ts` — Fan-in gate.
- `src/lib/gates/plugins/no-high-severity-findings.ts`.
- `src/lib/gates/plugins/no-open-incidents.ts`.

### UI

- `src/components/office/task-desk.tsx` — Task Desk + hooks.
- `src/components/office/office-scene.tsx` — Avatars + desk layout.
- `src/app/api/projects/[id]/task-pool/route.ts` — API.

### Events

- `src/lib/schemas/events.ts` — New `task.*` events.

### Bridge

- `src/lib/pipeline/backlog.ts` — Facade over pool.
- `src/lib/pipeline/software-house.ts` — Refactored worker spawning.
- `src/lib/pipeline/gate.ts` — Delegates to registry.

### Config

- `.env` — New env vars.
- `docs/task-pool-rework.md` — Design doc.

## Next Steps

1. **Migrate handlers to use task content:** Update `runAgentTurn` paths to read/write spec/architecture/requirements via `readTaskContent`/`writeTaskContent` so the `.md` files are authoritative, not embedded in payloads.

2. **Database sync (optional):** Ingest `index.ndjson` into a `task_events` table and project to a `tasks` row for analytics dashboards, cross-project queries, etc. The markdown folders stay as blobs/paths.

3. **Task dependencies:** Use the `dependsOn: []` field on tasks so tickets with parent tickets wait naturally.

4. **Pause/resume workflow:** When handlers call `pauseTaskAwaitingHuman`, the Office desk shows the task in the "awaiting human" section. A human reply re-seeds the task or resumes it.

5. **Advanced gating:** Add gates like "QA passes on X% of scenarios" or "security sign-off received" — just register plugins.
