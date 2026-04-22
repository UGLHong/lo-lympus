# AI Agent Instructions — L'Olympus

> **STOP.** Complete the boot sequence below before any tool call. The rules in `.agent/rules/` are **not optional** and may not auto-load into your context.

L'Olympus is an autonomous virtual software house: 13 AI role daemons claim tasks from Postgres, produce real artifacts on disk under `workspaces/`, and stream progress to a Phaser + Monaco + Kanban control room. **These instructions govern AI agents editing the L'Olympus codebase itself — not the agents that L'Olympus runs at runtime.** Runtime agent prompts live in `server/mastra/prompts.ts`.

---

## Mandatory Agent Boot Sequence

Before reading the user task, writing code, or calling any other tool, run these in order. Skipping is a rule violation, not an optimisation.

1. **Read every file in `.agent/rules/`.** Use your file-read tool on each one — do not infer from filenames.
2. **Read `README.md`** at repo root — it is the canonical description of stack, env vars, boot flow, and layout.
3. **Consult the Read-First Map** in `.agent/rules/docs-first.md` and open the source-of-truth files for the area you are about to touch.
4. **Confirm the user's goal, success criteria, and scope.** If unclear, stop and ask before editing.

### Self-check before the first task tool call

- [ ] I have read every file in `.agent/rules/` in this session
- [ ] I have read `README.md`
- [ ] I have opened every source file flagged by the Read-First Map for my area
- [ ] I understand the user's goal, success criteria, and scope

If any answer is "no", go back and do it now.

---

## Mandatory Task Completion Checklist

Before marking any task complete:

- [ ] Implementation verified per `.agent/rules/local-verification.md` (at minimum: `pnpm typecheck` passes)
- [ ] Documentation surface updated per `.agent/rules/documentation.md` — usually `README.md` and/or inline TSDoc, not a separate docs file
- [ ] File paths mentioned in docs / READMEs are exact
- [ ] No new lint or type errors introduced
- [ ] No unrelated code touched — change is within the user's stated scope
- [ ] `workspaces/`, `.react-router/`, and `build/` were not edited by hand

---

## Quick-Reference Rule TL;DR

Emergency fallback only — not a substitute for reading each rule in full.

### Read-First Map (`.agent/rules/docs-first.md`)

- This repo has no `/docs` folder. Source of truth is the code, the README, and role-specific artifacts.
- Before touching an area, look up the Read-First Map and open the listed files.
- Under-reading causes regressions; over-reading is cheap.

### Documentation (`.agent/rules/documentation.md`)

- Documentation lives in **three places**: `README.md` (stack / env / ops), `AGENTS.md` (layout + boot), and inline TSDoc (non-obvious invariants).
- Update `README.md` on any user-visible or operational change (new env var, new script, new role, new tool, new route).
- No SCREAMING_SNAKE_CASE feature docs required for this project.

### General (`.agent/rules/general.md`)

- Use path aliases from `tsconfig.json`: `@/*` → `./app/*`, `@server/*` → `./server/*`, `@db/*` → `./server/db/*`.
- Follow the established file-layout and naming (routes are `app/routes/*.tsx`, role registry is `server/const/roles.ts`, etc.).
- Reuse existing helpers, components, and tool builders before creating new ones.
- No comments that narrate code; only explain non-obvious intent.

### Local Verification (`.agent/rules/local-verification.md`)

- Every change is exercised locally: `pnpm typecheck`, `pnpm dev`, open `http://localhost:3100`, reproduce the change.
- Watch the dev-server terminal for daemon-loop errors and the browser console for SSE / React errors.
- For prompt or tool changes, seed a task with `pnpm seed:smoke` and verify the role produces what you expect.

### Parallel Subtasks (`.agent/rules/parallel-subtasks.md`)

- Non-trivial work follows Discover → Plan → Execute.
- Parallelise discovery across `app/` (frontend), `server/` (daemon + mastra + tools), and `server/db/` (schema) when the change spans areas.

---

## Project Layout Reference

| Directory | Purpose |
| --- | --- |
| `.agent/rules/` | **Source of truth for agent rules — read at session start** |
| `.agent/skills/` | Skills (`commit`, `pr`, `reflect-skills`) |
| `app/routes/` | React Router v7 routes — pages + `api.*` endpoints |
| `app/components/` | Control Room UI (Kanban, Monaco editor feed, Phaser office, HITL chat, Terminal) |
| `app/lib/` | Event bus, SSE hooks, follow-mode context, UI utilities |
| `app/hooks/` | Client-side React hooks |
| `app/styles/` | Tailwind v3 stylesheets |
| `server/const/` | Role registry, tier mapping, label + colour tables |
| `server/mastra/` | Role prompts, agent factory, Mastra Memory runtime, OpenRouter model binding |
| `server/tools/` | Agent tools (file_system, stream_code, runtime, playwright_browser, request_human_input, ask_clarifying_questions, database_query) |
| `server/daemon/` | Poll loop, claim, dispatcher, execute, clarification-watcher (the workforce engine) |
| `server/db/` | Drizzle schema, queries, migrations, Postgres client |
| `server/lib/` | Settings, kanban payload shaping, tool-log emitter |
| `server/workspace/` | Per-project workspace path resolution |
| `server/bootstrap.ts` | Single-run workforce starter (HMR-guarded) |
| `workspaces/` | **Generated output — do not edit by hand.** One directory per project, produced by the agents |
| `scripts/` | One-off scripts (`seed-smoke.ts`) |
| `.react-router/` | Generated RR types — do not edit |
| `build/` | Production build output — do not edit |

---

## Common Commands

```bash
pnpm dev              # start Vite + react-router dev on :3100, boots the 13 role daemons
pnpm build            # production build
pnpm start            # serve the production build (Node)
pnpm typecheck        # react-router typegen && tsc --noEmit
pnpm lint             # eslint app + server (max-warnings 0, but currently non-blocking)
pnpm db:generate      # generate Drizzle migrations from server/db/schema.ts (use after editing schema)
pnpm db:push          # push current schema to DATABASE_URL (NOT RECOMMENDED — use migrations instead)
pnpm db:studio        # open Drizzle Studio
pnpm seed:smoke       # insert one project + backend-dev ticket end-to-end
```

> **⚠️ Important**: Always use `pnpm db:generate` (aka `npx drizzle-kit generate`) after modifying `server/db/schema.ts`. Never edit migration files by hand. See `MIGRATIONS.md` for the complete workflow.

---

## Tooling Notes

- **Package manager**: pnpm 9+ (do not switch to npm/yarn).
- **Runtime**: Node 20+.
- **Languages**: TypeScript (strict), React 19, React Router v7 (framework mode).
- **ORM / DB**: Drizzle ORM against Postgres (`olympus_*` tables; Mastra owns its own `mastra_*` tables — do not collide).
- **Agent SDK**: `@mastra/core`, `@mastra/memory`, `@mastra/pg`.
- **LLM provider**: OpenRouter (4 tiers: FAST / REASONING / CODING / VISION — see `server/mastra/model.ts`).
- **Realtime**: in-process `EventEmitter` (`app/lib/event-bus.server.ts`) bridged to browsers via SSE (`app/routes/api.events.ts`).
- **Browser automation**: Playwright headful Chromium (toggle via `PLAYWRIGHT_HEADLESS`).
- **Path aliases**: `@/*` → `./app/*`, `@server/*` → `./server/*`, `@db/*` → `./server/db/*`.
- **No pre-commit hooks** are configured — run lint / typecheck yourself.
- **No `.github/` CI** — verification is local-only today.

---

## Do-Not-Touch List

- `workspaces/` — agent output; editing breaks the reviewer audit trail.
- `.react-router/` — regenerated by `react-router typegen`.
- `build/`, `node_modules/` — generated.
- `pnpm-lock.yaml` — only touch via `pnpm install`.
- The placeholder `.env` values — treat them as examples; never commit real secrets.

---

## Editor / Agent Compatibility

`.agent/rules/` is the canonical source. If your editor expects rules elsewhere, symlink rather than duplicate:

- **Cursor** reads `AGENTS.md` + `.cursor/rules/` — symlink `.cursor/rules` → `.agent/rules`.
- **Claude Code** reads `AGENTS.md` + `CLAUDE.md` — symlink `CLAUDE.md` → `AGENTS.md`.
- **GitHub Copilot / Codex** read `AGENTS.md` + `.github/copilot-instructions.md` — mirror as needed.
- **Windsurf / Cline / Continue** read their own rule files — link to `.agent/rules/` where supported.

---

## If You Are Unsure

- Unsure about a role's behaviour → read `server/mastra/prompts.ts` + `server/tools/index.ts`.
- Unsure about the task lifecycle → read `server/daemon/execute.ts` (it is long but authoritative).
- Unsure about a schema field → read `server/db/schema.ts` + recent migrations under `server/db/migrations/`.
- Unsure whether a change needs docs → read `.agent/rules/documentation.md`; when in doubt, update `README.md`.
- Unsure about user intent → stop and ask; do not guess on a system that runs autonomous agents against live data.
