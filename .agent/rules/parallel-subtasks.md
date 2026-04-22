---
description: Orchestrator pattern for non-trivial L'Olympus tasks — Discover, Plan, Execute
globs:
alwaysApply: true
---

# Agent Orchestrator Pattern

## Core Principle

Every non-trivial task follows **Discover → Plan → Execute**. Each phase may spawn parallel sub-agents. The orchestrator coordinates, synthesises, and verifies — it does not do all the work itself. Never skip or collapse phases.

This pattern applies to **agents editing the L'Olympus codebase**, not to the runtime agents L'Olympus orchestrates at runtime (those are governed by `server/mastra/prompts.ts`).

---

## Phase 1 — Discover

Build a complete picture of the current state before deciding anything.

- Consult `.agent/rules/docs-first.md` (the Read-First Map) and open every file listed for the area(s) you are touching.
- Read the relevant section of `README.md`.
- Map data flow end-to-end. Identify existing patterns, constraints, and contracts.
- Resolve every unknown that would block planning.

**Spawn parallel Discover sub-agents** when the change spans multiple isolated areas. Useful splits for this repo:

| Sub-agent | Reads |
| --- | --- |
| frontend | `app/routes/`, `app/components/`, `app/lib/`, `app/hooks/` |
| server-daemon | `server/daemon/`, `server/bootstrap.ts` |
| server-mastra | `server/mastra/`, `server/tools/`, `server/const/roles.ts` |
| server-db | `server/db/schema.ts`, `server/db/queries.ts`, `server/db/migrations/` |
| event-bus | `app/lib/event-bus.server.ts`, `app/routes/api.events*.ts`, consumers in `app/components/` |

Each sub-agent returns a summary: files read, key types, patterns to follow, constraints found. **Not raw file contents.**

**Discover is complete when** no open questions remain and the plan can be written without reading more files.

---

## Phase 2 — Plan

Produce a concrete, dependency-ordered execution plan.

- List every deliverable (file to create / modify / delete, migration, README update, prompt update, tool wiring change).
- Map dependencies — which are free-standing, which depend on others.
- Group free deliverables into parallel stages.
- Define shared contracts upfront: event-type shapes, tool input/output schemas, prompt skeletons, DB row shapes.
- Write a handoff spec for each execution sub-agent.

### Plan output shape

```
Deliverables: # | File | Action | Depends on
Execution stages:
  Stage 1 (parallel): #1, #2
  Stage 2 (parallel, after Stage 1): #3, #4
Shared contracts: type definitions / payloads every agent must conform to
```

**Spawn parallel Plan sub-agents** for large requests — e.g. one plans the backend daemon change, one plans the UI changes that consume its events, one plans the DB migration. The orchestrator merges their outputs and resolves cross-agent dependencies (shared types, coordinated env-var defaults).

**Plan is complete when** every deliverable is listed, every dependency is explicit, and no execution agent will need to make a design decision on its own.

---

## Phase 3 — Execute

Implement the plan with maximum safe parallelism.

- One execution sub-agent per stage batch.
- Agents in the same stage must not write to overlapping files.
- Orchestrator waits for each stage before starting the next.

### Execution handoff template

```
PHASE: Execute
GOAL: [one sentence]
SCOPE (only touch these): [full file paths with create | modify | delete]
SHARED CONTRACTS: [types / event payloads / tool schemas the agent must conform to]
DO NOT TOUCH: [files outside scope; always includes workspaces/, .react-router/, build/]
CONSTRAINTS: [follow .agent/rules/general.md; use path aliases; reuse helpers]
RETURN: files created/modified, type errors hit, plan deviations with justification
```

**After all stages**, the orchestrator:

1. Spot-checks key output files.
2. Verifies integration points (event consumers, role-prompt ↔ tool wiring, DB query ↔ schema).
3. Runs verification per `.agent/rules/local-verification.md` — at minimum `pnpm typecheck`.
4. Updates documentation per `.agent/rules/documentation.md` (`README.md`, `AGENTS.md`, inline TSDoc).

---

## When to Use This Pattern

| Situation | Action |
| --- | --- |
| Single file, < 10 lines | Inline — no sub-agents |
| 2–3 files, same area | Inline sequential tool calls |
| 4+ files across 2+ areas (frontend / daemon / mastra / db) | Orchestrator pattern — Plan + Execute minimum |
| Ambiguous request, unknown area, or a contract change (new event type, new tool, new role) | All three phases — Discover is mandatory |
| 3+ independent deliverables | Parallel execution sub-agents mandatory |
| More than 10 files read before any write | Stop — spawn sub-agents for the rest |

---

## Context Budget

- Discover sub-agents return summaries, not raw file contents — protect the orchestrator's context.
- Execution sub-agents return outcomes, not diffs.
- Orchestrator context holds: the plan, shared contracts, coordination state, final verification.
- When planning for the runtime workforce (`server/mastra/prompts.ts`), remember that tokens cost **per agent turn** — verbose prompts degrade success rate, not just cost.

---

## Related Rules

- `.agent/rules/docs-first.md` — Discover phase always starts with the Read-First Map.
- `.agent/rules/general.md` — every execution sub-agent must follow the coding conventions.
- `.agent/rules/local-verification.md` — orchestrator runs final verification after Execute completes.
- `.agent/rules/documentation.md` — executed changes must propagate to `README.md` / `AGENTS.md` / inline TSDoc.
