---
description: Verify every implementation locally using the L'Olympus dev stack before marking work complete
globs:
alwaysApply: true
---

# Local Verification Rules

## Mandatory Verification

**Every change MUST be exercised locally before the task is marked complete.** No exceptions. Pick the verification path that matches what you touched — more than one may apply.

| Change type | Verification path |
| --- | --- |
| Any TypeScript change | `pnpm typecheck` must pass |
| UI change (routes, components, styles) | `pnpm dev` → open `http://localhost:3100` → interact |
| API route (`app/routes/api.*.ts`) | `pnpm dev` → `curl` the endpoint → verify status + body |
| Role prompt change (`server/mastra/prompts.ts`) | `pnpm dev` → `pnpm seed:smoke` (or create a project via the UI) → watch the daemon log + Kanban for the affected role |
| Tool change (`server/tools/*`) | trigger a task that uses the tool (seed or UI) → verify the tool log entries in the Terminal pane + the resulting artifact in `workspaces/` |
| Daemon lifecycle change (`server/daemon/*`) | `pnpm dev` → confirm the 13 workforce boot log lines → seed or create a task → watch it claim → done |
| Schema change (`server/db/schema.ts`) | `pnpm db:generate` → review generated migration → `pnpm db:push` (or ask the user first if the DB is shared) → restart `pnpm dev` |
| Env-var change | update `.env.example` + `README.md` → `pnpm dev` with the new var set → confirm consumer reads it |
| Event-bus change (`app/lib/event-bus.server.ts`) | `pnpm dev` → open DevTools Network tab → inspect the `/api/events` SSE stream for the new event type |

---

## Verification Process

### 1. Type-check first

```bash
pnpm typecheck
```

Run this before any UI-level verification. It is fast and catches most regressions before you touch the browser.

### 2. Start the dev server (when applicable)

```bash
pnpm dev
```

- Default port: **3100** (override via `OLYMPUS_WEB_PORT`).
- Watch for the workforce boot log: each of the 13 role loops should print its startup line. A missing role usually means `bootstrap.ts` was not updated when the role was added.
- If `DATABASE_URL` is the placeholder `show-password`, expect auth failures in the logs — ask the user for the real value before proceeding.

### 3. UI changes — open the Control Room

1. Navigate to `http://localhost:3100` → you land on `/projects`.
2. Create a project or open an existing one (`/projects/<id>`).
3. For role / tool changes, seed a ticket via `pnpm seed:smoke` or `POST /api/tasks`.
4. Watch:
   - Kanban card transitions (`todo → in-progress → pending-review → done`).
   - Phaser sprite walking to the task board.
   - Monaco editor streaming code chunks.
   - Terminal pane for tool-log entries.
   - HITL chat sidebar for any `request_human_input` bubble.
5. Take a screenshot of each non-trivial state if you will report back to the user.

### 4. API changes — hit the endpoint

```bash
curl -X POST http://localhost:3100/api/tasks \
  -H "Content-Type: application/json" \
  -d '{ "projectId": "<id>", "role": "backend-dev", "title": "...", "description": "..." }'
```

Confirm status and body. For endpoints that mutate state, verify the corresponding row in Postgres (`pnpm db:studio`).

### 5. Role prompt / tool changes — end-to-end drive

1. `pnpm dev`.
2. `pnpm seed:smoke` (inserts a project + a `backend-dev` ticket) OR create a project through the UI with a brief that exercises the role you changed.
3. Watch the daemon log and the Terminal pane for:
   - `generate.start` → `generate.end` for the role's agent call.
   - Tool-log entries for every tool the role invoked (`fs.read`, `stream.end`, `runtime.start`, etc.).
   - No `EmptyAgentOutputError` — that flag means the role returned nothing productive and is being retried.
4. Open `workspaces/<project-slug>/` and spot-check the artifacts produced. For the PM / Architect / TechLead roles the artifacts live under `.software-house/`.

### 6. Monitor logs

**Dev-server terminal**:

- Watch for unhandled rejections, Drizzle errors, OpenRouter rate-limits.
- `[runtime] exited <code>` from the generated product's child process is expected when tester / devops tasks stop a dev server.

**Browser console**:

- SSE disconnects are common during HMR — a single reconnect is fine, repeated flaps are not.
- React hydration warnings indicate a server/client render mismatch — fix before marking done.

**Postgres**:

- `pnpm db:studio` to inspect `olympus_tasks`, `olympus_projects`, `olympus_events`.
- Stuck tasks (`status = 'in-progress'` with an old `claimedAt`) usually indicate a crashed agent run — surface to the user.

### 7. Exercise every affected route / entry point

If you changed shared utilities (`app/lib/`, `server/lib/`, `server/db/queries.ts`), re-run any route or tool that depends on them — not just the one you originally targeted. Grep for callers before claiming done.

---

## Error Handling

When something fails during verification:

1. **Identify the root cause** from the dev-server log, browser console, or DB row.
2. **Fix the issue** in code.
3. **Re-verify** the fix end-to-end.
4. **Repeat** until clean.

**Give up after 3 failed attempts on the same error.** Stop retrying, fall back to a code review of the change, and report clearly:

- What you attempted.
- What failed (with log excerpts).
- Your best hypothesis.

Do not silently mark the task complete.

### Common L'Olympus failure modes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Dev server boots but no role loops log | `server/bootstrap.ts` missing the new role OR `OLYMPUS_DISABLE_WORKFORCE=true` set | Register role in `bootstrap.ts`; unset the env flag |
| Agent returns empty text → retry loop | Rate-limit / upstream truncation / invalid OpenRouter model id | Check `server/mastra/model.ts` tier mapping and the `MODEL_TIER_*` env vars |
| `authentication failed` in logs | Placeholder `DATABASE_URL` | Ask user for the real URL |
| Tool call returns `ok: false` with path error | Path escapes workspace root | Verify `resolveInsideProject` usage in the tool |
| SSE stream disconnects repeatedly | Persisted event type not in the union | Add the type in `app/lib/event-bus.server.ts` |
| `pending-review` tasks stuck | Reviewer agent returning malformed JSON | Inspect the last reviewer run's chat log; tighten the reviewer prompt if needed |
| Duplicate daemon spawns under HMR | `globalThis.__olympusBootstrap` guard regressed | Restore HMR guard in `app/entry.server.tsx` / `server/bootstrap.ts` |

---

## User Intervention

Pause and ask the user to step in when:

- **`DATABASE_URL` is the placeholder** — you cannot push a schema or query a real DB without it.
- **`OPENROUTER_API_KEY` is missing or invalid** — every role call will fail.
- **Shared DB** — `pnpm db:push` would affect others; ask before running.
- **Destructive actions** — clearing `workspaces/`, dropping tables, killing a live run.
- **Ambiguous behaviour** — unclear whether observed agent output is correct.

When requesting intervention, state the exact action, the command / URL, and wait for confirmation.

---

## Verification Checklist

Before marking any implementation complete:

- [ ] `pnpm typecheck` passes.
- [ ] For UI/tool/role changes: `pnpm dev` booted cleanly and you interacted with the affected area.
- [ ] Dev-server log shows no new errors / stack traces.
- [ ] Browser console shows no new errors (for UI changes).
- [ ] For role/tool changes: you observed the real agent output in `workspaces/` or the Terminal pane.
- [ ] For schema changes: migration generated + applied + dev restarted.
- [ ] Documentation updated per `.agent/rules/documentation.md`.
- [ ] No unrelated code touched.

---

## Notes

- Prefer short polling waits (2–3s) over long blocking waits when watching async agent output.
- HMR in Vite reloads routes reliably; server-module changes (under `server/`) may require a full dev-server restart.
- The workforce reads `OLYMPUS_EMPLOYEE_POLL_MS` (default 5000ms) — if you are iterating fast, drop it to ~1000ms for the session.
- Capture screenshots or terminal excerpts for anything you report back — the user benefits from concrete evidence.
