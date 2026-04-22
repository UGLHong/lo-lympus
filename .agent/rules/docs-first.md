---
description: Read-first map — the source-of-truth files to open before editing any area of L'Olympus
globs:
alwaysApply: true
---

# Read-First Map

## Why This Rule Exists

L'Olympus has **no `/docs` folder**. The source of truth for "what does feature X do?" is the code itself — specifically a small set of authoritative files per domain. Reading them first prevents:

- Re-implementing helpers that already exist (`server/db/queries.ts`, `server/lib/`, `app/lib/`).
- Breaking a contract that other parts of the system silently depend on (role registry, tool wiring, event payloads).
- Mis-routing runtime-agent behaviour — the LLM prompts encode invariants you cannot see from a single route file.

---

## Hard Requirement

Before implementing, refactoring, or fixing anything in this repository:

1. **Identify the area you are touching** (role / tool / daemon / schema / route / component / event bus).
2. **Open every file listed for that area in the table below.** Over-read — the cost is trivial compared to getting it wrong.
3. **Follow cross-references.** If a file imports from another area, read that area too.

This is a precondition, not a suggestion.

---

## Read-First Map (by area)

### Runtime-agent behaviour (the workforce)

| Touching | Read these first |
| --- | --- |
| A role's prompt or adding/removing a role | `server/mastra/prompts.ts`, `server/const/roles.ts`, `server/tools/index.ts` (tool availability per role) |
| Tool contracts (file_system, stream_code, runtime, playwright_browser, HITL, ask_clarifying_questions, database_query) | the specific file under `server/tools/` + every role prompt that references it (`server/mastra/prompts.ts`) |
| Agent model binding / tier mapping | `server/mastra/model.ts` + `server/const/roles.ts` (`ROLE_TIER`) + env-var section of `README.md` |
| Agent memory (Mastra threads) | `server/mastra/runtime.ts` + `server/mastra/agent-factory.ts` |
| Reviewer gate or self-healing fix loop | `server/daemon/execute.ts` (`REVIEWABLE_ROLES`, `scheduleReviewOf`, `handleReviewerOutcome`, `buildReviewBrief`, `buildFixBrief`) + reviewer prompt in `server/mastra/prompts.ts` |
| Clarification / HITL flow | `server/daemon/clarification-watcher.ts` + `server/tools/ask-clarifying-questions.ts` + `server/tools/request-human-input.ts` + `app/routes/api.chat.ts` |

### Daemon lifecycle

| Touching | Read these first |
| --- | --- |
| Claim / dispatch / poll loop | `server/daemon/loop.ts`, `server/daemon/claim.ts`, `server/daemon/dispatcher.ts` |
| Task execution state machine | `server/daemon/execute.ts` (full file — it is long but authoritative) |
| Workforce bootstrap | `server/bootstrap.ts` + `app/entry.server.tsx` (HMR guard) |
| Per-role polling interval / env overrides | `server/daemon/loop.ts` + `README.md` env-var section |

### Data model

| Touching | Read these first |
| --- | --- |
| Any DB column or table | `server/db/schema.ts` + the most recent file in `server/db/migrations/` |
| Task / project queries | `server/db/queries.ts` (prefer extending existing helpers) |
| Postgres client configuration | `server/db/client.ts` + `drizzle.config.ts` |

### UI + routing

| Touching | Read these first |
| --- | --- |
| Adding a page | `app/routes.ts`, existing examples in `app/routes/` (`projects.$id.tsx` is the largest) |
| Adding an API endpoint | existing `app/routes/api.*.ts` siblings — they export `loader` / `action` and return `Response` |
| Control Room component | `app/components/<subdir>/` — `kanban/`, `office/`, `editor/`, `hitl/`, `terminal/` |
| Event-driven UI state | `app/lib/event-bus.server.ts` (server emitter) + `app/lib/live-events.tsx` + `app/hooks/` |
| Follow-mode (per-role SSE subscription) | `app/lib/follow-mode.tsx` |

### Event bus & SSE

| Touching | Read these first |
| --- | --- |
| New event type | `app/lib/event-bus.server.ts` (union type) + every consumer that switches on `event.type` |
| SSE transport | `app/routes/api.events.ts` + `app/routes/api.events.history.ts` |
| Event persistence (history replay) | `app/lib/event-persistence.server.ts` |
| Tool-level telemetry | `server/lib/tool-log.ts` |

### Workspace output (generated projects)

| Touching | Read these first |
| --- | --- |
| Per-project paths | `server/workspace/paths.ts` |
| How generated code is displayed | `app/routes/api.workspace.ts` + `app/components/editor/` |
| What agents are writing (reference only) | `workspaces/<project-slug>/` — **read-only**; do not edit by hand |

### Configuration & environment

| Touching | Read these first |
| --- | --- |
| Env var added/removed | `.env.example` + `README.md` env-var section + the file that reads it (`server/lib/settings.ts` for runtime toggles, `server/mastra/model.ts` for LLM tiers) |
| Settings UI | `app/routes/settings.tsx` + `app/routes/api.settings.ts` + `server/lib/settings.ts` |

---

## Cross-Reference Rules

- If you edit a role prompt, re-read `server/tools/index.ts` to confirm every tool the prompt references is actually provided to that role.
- If you add a new event type, read every `switch (event.type)` / equivalent in `app/components/` and `app/hooks/` — silent type failures are easy to miss.
- If you change the task schema, grep for every `getTaskById`, `updateTask`, `markTaskFailed`, etc. caller — there are many.
- If you change the daemon loop, re-read `server/bootstrap.ts` and `app/entry.server.tsx` to confirm boot semantics still hold.

---

## Fallback: When the Area Is Not in the Map

1. Start at `README.md` — it lists the layout.
2. `ls` the top-level `app/` and `server/` subdirectories and open index files.
3. Grep for an obvious keyword of what you are changing.
4. If you spent more than a few minutes searching and still have no anchor, stop and ask the user.

---

## Self-Check

Before your first edit on a task, verify:

- [ ] I identified the area(s) my change touches.
- [ ] I opened every file listed for those areas in the map above.
- [ ] I followed cross-references to adjacent areas.
- [ ] I know which contracts (schema, event types, tool interfaces, prompts) I am crossing.

If any answer is "no", stop and fix it now.
