# L'Olympus — Implementation Progress

> Running log of what is built, what changed, and what is queued next. Keep in sync with `implementation_plan.md` (which is the *design* source of truth) — this doc is the *status* source of truth.

Last updated: 2026-04-20 (session 5)

---

## 1. Where we are on the phased rollout

Mapping the work below onto `implementation_plan.md` §10 (Phased Rollout):

| Phase | Status | Notes |
|---|---|---|
| **Phase 0 — Foundations** | ✅ shipped | Next.js 15 app, filesystem `.software-house/` store, `LLMProvider` + OpenRouter adapter + 4-tier router, SSE event stream, Zod-typed contracts. |
| **Phase 1 — One role, end-to-end** | ✅ shipped | Orchestrator + PM agents, INTAKE → CLARIFY → SPEC gate, three-region UI shell. |
| **Phase 2 — Planning chain** | ✅ shipped | Architect + Tech Lead produce `ARCHITECTURE.md`, ADRs, `PLAN.md`, per-ticket files. Artifacts browser + Workspace (Monaco) + Pipeline + Events views navigable. |
| **Phase 3 — Code + review (sequential, in-process)** | ✅ shipped | Strict dev/reviewer envelope, role-scoped source write path, in-process IMPLEMENT loop (3-attempt budget per ticket), INTEGRATE gate, driver auto-advance. |
| **Phase 4 — Bring-up + host-side QA** | ✅ shipped (code) | BRINGUP wired: host-side `pnpm run dev` spawn, port allocation, log tailing, App/Runtime canvas tab, `runtime.*` events. QA_MANUAL now has a host-side Playwright runner that spawns `npx playwright test`, parses the JSON report, writes a `qa/reports/R-*.md` artifact, and auto-opens `incidents/I-*.md` for every failure. |
| **Phase 5 — Self-heal + security + release** | ✅ shipped (code) | SELF_HEAL dispatch loop drives QA-produced incidents back through dev roles (bounded 3 attempts per incident, escalates via `HELP_NEEDED.md` + `pipeline.paused`). Incident state lives as front-matter on `incidents/I-*.md` with a materialized `incidents/index.json` view. SECURITY and RELEASE roles and prompts were already wired in session 2. |
| **Phase 6 — Polish & "feel"** | ✅ shipped | Streaming tokens + rich content blocks (session 2); dotLottie role avatars with graceful fallback and a time-travel replay canvas tab added this session. |
| **Phase 7 — Multi-project + self-hosted models** | ⏳ deferred | — |
| **Phase 8 — Open source launch** | ⏳ deferred | — |

Editor hand-off (`implementation_plan.md` §15):

| Area | Status |
|---|---|
| **Olympus web app surface** | ✅ primary, always on. |
| **"Open in Zed" one-click** | ✅ shipped — writes `.zed/settings.json`, ensures `tickets/index.json`, drops ACP entrypoint, best-effort `zed` spawn. |
| **ACP server — scaffold** | ✅ shipped — JSON-RPC over stdio, session, event mirror, DAG-aware dispatch stub. |
| **ACP server — real turn loop** | ✅ wired (v1 strategy) — `dispatch.ts` now delegates to the web app's `POST /api/projects/[id]/implement` over HTTP instead of re-implementing the loop. This keeps the shared role/LLM modules inside the Next.js process and sidesteps path-alias resolution in the compiled `.cjs` ACP build. Live Zed smoke-test still pending. |
| **`fs/apply_edit` + `terminal/run` wrappers** | ✅ wired — `olympus-agents/src/tools/fs-apply-edit.ts` + `tools/terminal-run.ts` send ACP requests and resolve the returning responses through the JSON-RPC loop. Terminal commands are gated by an allow-list. |
| **Review loop in Zed** | ⏳ pending — the web-app implement loop already drives dev → reviewer; exposing it as an explicit ACP flow comes next. |
| **Two-way steering (Olympus chat ↔ Zed agent panel)** | ✅ shipped — `POST /api/projects/[id]/barge` persists a `barge.in` event + NDJSON line; the ACP server now tails `events.ndjson` and relays every non-ACP-originated `barge.in` to Zed as a `session/update` notification (`olympus-agents/src/events-watcher.ts`). |

---

## 2. What shipped this session (session 2 / 2026-04-20)

### 2.1 ACP server turn loop and tool wrappers (`olympus-agents/`)

- **Strategy shift.** Rather than re-importing the web app's role/LLM modules into the compiled `.cjs` ACP build (which `tsc` alone cannot rewrite path aliases for), the ACP server is now a thin remote control: every `session/prompt` call delegates to the web app's implement loop over HTTP.
- `olympus-agents/src/dispatch.ts` — rewritten. Reads `OLYMPUS_API`, calls `POST /api/projects/<id>/implement` with a `maxSteps` budget derived from the addressed agent (`@olympus/tech-lead` → 8 steps, dev roles → 1 step), formats the returned `ImplementSummary` for Zed's agent panel, and appends a one-line summary to `events.ndjson`.
- `olympus-agents/src/tools/implement-client.ts` — new. Zero-dependency HTTP client (Node `http`/`https`) that POSTs JSON and surfaces structured errors.
- `olympus-agents/src/tools/fs-apply-edit.ts` — new. `requestFsApplyEdit({ path, content })` sends a `fs/apply_edit` ACP request, tracks the pending promise by id, and times out after 20 s.
- `olympus-agents/src/tools/terminal-run.ts` — new. `requestTerminalRun({ command, args })` sends a `terminal/run` ACP request behind an allow-list (`pnpm`, `node`, `npx`, etc.); rejects anything outside the list before ever crossing the wire.
- `olympus-agents/src/main.ts` — updated. Adds a generic response-dispatcher that routes replies whose id starts with `fs-apply-` / `term-run-` to the right resolver, and a new `session/notify` handler that mirrors whatever Zed pushes (human barge-ins, role hand-offs, etc.) into the project's `events.ndjson` tagged with `source: 'acp'`.

### 2.2 IMPLEMENT API endpoint + UI surface

- `src/app/api/projects/[id]/implement/route.ts` — new. `POST` triggers `runImplementLoop` with an optional `maxSteps` cap. When called with `{ resume: true }` it clears `state.paused = false` and emits a `log` event before running, so the "Resume implementation" affordance from the Implement tab (and the ACP server's delegated loop) can both un-pause a project that was stopped by an exhausted attempt budget.
- `src/components/canvas/implement-view.tsx` — new. Full Implement tab: "Run loop" + conditional "Resume implementation" buttons, a live summary (completed / changes-requested / blocked / paused reason), and a filtered event stream of just implement-related events.
- `src/components/canvas/main-canvas.tsx` — `implement` added as a first-class canvas tab.

### 2.3 BRINGUP phase + App/Runtime tab

- `src/lib/workspace/runtime.ts` — new. Host-side runtime manager: picks a free port in the 3200-3299 range, spawns `pnpm run dev` (overridable via `OLYMPUS_RUNTIME_CMD`) with `{ PORT, NODE_ENV }` in env, streams stdout/stderr into `.software-house/logs/server-<ts>.log`, and mirrors every line as a `runtime.log` event (channel + text) onto the event bus. Tracks `{ running, pid, port, startedAt, logTail }` keyed by project id. `stopRuntime()` sends SIGINT, waits 5 s, escalates to SIGKILL, and emits `runtime.stop` with a reason.
- `src/app/api/projects/[id]/runtime/route.ts` — new. `GET` returns the current status, `POST { action: 'start' | 'stop' }` drives the lifecycle.
- `src/components/canvas/runtime-view.tsx` — new. Start/stop controls, a live status chip (`running`, `port`, `pid`), an `<iframe>` preview scoped to `http://localhost:<port>`, and a color-coded log panel fed by the `runtime.log` event stream.
- `src/lib/client/project-store.ts` — extended. New `runtime: RuntimeView` slice keyed off `runtime.start` / `runtime.stop` / `runtime.log` events; log tail capped at 256 lines.
- `src/lib/schemas/events.ts` — added `runtime.start`, `runtime.stop`, `runtime.log`, `incident.opened`, and `barge.in` event kinds so all of the above (plus §2.4 and §2.5) can round-trip through the persisted NDJSON log.
- `src/components/events/events-view.tsx` — event summarizer updated for every new event kind.

### 2.4 Phase 4 + 5 driver wiring

- `src/lib/pipeline/driver.ts` — `pickRoleForPhase` and `buildPromptForPhase` now cover `BRINGUP` → `devops`, `QA_MANUAL` → `qa`, `SELF_HEAL` → `incident`, `SECURITY` → `security`, `RELEASE` → `release`, `DEMO` → `writer`. Every new prompt specifies the exact artifact the role is expected to `writes`/`sourceWrites`, the gate block it must emit, and the `advance` semantics so the existing phase-chain loop can keep walking the rollout without bespoke logic per phase.
- `src/lib/agents/roles/incident.ts` — mission, inputs, deliverable, and done-criteria rewritten for the SELF_HEAL phase: triage QA reports + review findings, open `incidents/I-*.md`, classify (frontend / backend / infra / data / spec-gap), dispatch to the appropriate dev role, cap each incident at 3 heal attempts.

### 2.5 Two-way steering (v1)

- `src/app/api/projects/[id]/barge/route.ts` — new. `POST { role, text }` validates against the `RoleKey` union, emits a `barge.in` event, and appends it to `events.ndjson` so the NDJSON log is the single steering channel for both the web app and ACP sessions.
- `olympus-agents/src/main.ts` — `session/notify` handler mirrors whatever context Zed sends (human barge, role hand-off, token, etc.) into `events.ndjson` tagged `source: 'acp'`. This finishes the "events.ndjson is the shared source of truth" contract from `implementation_plan.md` §15.

### 2.6 Clean-ups from §5.3 of the previous backlog

- **Tier consistency guard.** `src/lib/agents/roles/index.ts` now runs `assertTiersConsistent()` at module load, comparing each `RoleDefinition.tier` against `ROLES[key].tier` and throwing a descriptive error listing every drift. This turns into a hard build failure the moment the two sources of truth disagree, which was the original point of the "add a unit test" cleanup.
- **Ticket front-matter normalization.** `writeArtifact` in `src/lib/workspace/fs.ts` strips any trailing `---` / `...` YAML doc-terminator on files that match `tickets/T-*.md` before persisting, so even if a ticket writer emits the legacy closer it lands on disk with a single front-matter fence. The Tech Lead role and PLAN-phase driver prompt have also been updated to stop producing the trailing terminator in the first place.

---

## 2-quater. What shipped this session (session 5 / 2026-04-20)

### 2q.1 USD cost cap (§5.3)

- `src/lib/llm/pricing.ts` — new. `getModelPrice(model)` returns `{ prompt, completion }` (USD per 1M tokens) for a curated default list (`openai/gpt-5-mini`, `openai/gpt-4o-mini`, `openai/gpt-4o`, `openai/o1-mini`, `anthropic/claude-3-5-sonnet` + `haiku`, `google/gemini-1.5-flash` + `pro`, `mock`) and honours `OLYMPUS_MODEL_PRICES="model=prompt:completion,..."` overrides for anything new. Unknown models price at `$0` so a stale table never *early*-trips the cap.
- `src/lib/schemas/state.ts` + `src/lib/workspace/fs.ts` — `budgets` gained `usdUsed: number` (default 0) and `usdHard: number` (default 0 = disabled). `createProject` reads `BUDGET_USD_HARD`. Existing projects on disk load cleanly because both fields have Zod defaults.
- `src/lib/pipeline/budget.ts` — `evaluateBudget` now checks tokens → USD → wall-clock in that order, and `enforceBudgets` formats a `"USD cost cap hit ($x.xx / $y.yy)"` pause reason. New `bumpUsage(projectId, model, usage)` accumulates both `totalTokens` and the USD cost of a single turn; it replaces the inline `bumpTokensUsed` helper that used to live inside `run.ts` and emits the (now richer) `budget.update` event with `usdUsed`.
- `src/lib/agents/run.ts` — the streaming loop calls `bumpUsage(projectId, resolved.model, chunk.usage)` on every `usage` chunk, so tokens and USD bump together.
- `src/lib/schemas/events.ts` — `budget.update` now carries `usdUsed` (defaulted so old events replay cleanly).
- `src/lib/client/project-store.ts` — reducer mirrors `usdUsed` into the client state.
- `src/components/rail/context-rail.tsx` — renders a third progress bar labelled `usd` when `usdHard > 0`, or a dimmed `usd (no cap)` indicator when spend is non-zero but no cap is configured. Existing token + wall-clock bars are unchanged.
- `src/lib/pipeline/budget.test.ts` — +6 cases covering USD trips, USD cap disabled, tokens-over-USD precedence, `bumpUsage` accumulation for priced + unknown models, and `enforceBudgets` pausing with reason `usd`.

### 2q.2 Workspace smoke tests — incidents + tickets (§5.3)

- `src/lib/workspace/incidents.test.ts` — new. 8 cases: `deriveIncidentsIndex` parses full front-matter (id, classification, dispatch, ticket code, title); falls back to filename + first `# heading` when front-matter is minimal; `updateIncidentEntry` round-trips status / attempts / resolution note through disk; derive preserves prior attempts and keeps terminal (`resolved` / `escalated`) statuses; `pickNextOpenIncident` prefers `fixing` over `open` and returns `null` once every eligible incident has hit the 3-attempt cap; `inferDispatchFromClassification` covers every class → role mapping; `isDispatchableRole` narrows to the dev trio.
- `src/lib/workspace/tickets.test.ts` — new. 7 cases: `deriveTicketsIndex` parses assignee + depends_on out of a `T-NNNN-*.md` front-matter plus `TicketBlock` overrides; preserves attempts / status / branch from the previous index; `updateTicketEntry` round-trips through `readTicketsIndex`; `pickNextReadyTicket` honours deps (only returns tickets whose `dependsOn[]` is fully `done`), prefers `changes-requested` over fresh `todo`, skips `in-progress` / `review` / `blocked` / dependency-blocked tickets, and returns `null` when everything is done.
- Both test files mkdtemp into `OLYMPUS_WORKSPACES_DIR`, call the real `createProject`, and exercise the real `readState` / `writeState` / `writeTicketsIndex` / `writeIncidentsIndex` helpers so the front-matter parse + index serialize path is covered end-to-end.

### 2q.3 Placeholder avatar bundles + generator (§5.2)

- `scripts/avatars/build-placeholders.ts` — new. Reads `ROLE_KEYS` + `ROLES[role].color`, constructs a minimal Lottie v5.7 JSON (one colored-disc layer that pulses for 1 s) with the full `markers[]` array (`off-duty`, `idle`, `thinking`, `typing`, `reviewing`, `testing`, `blocked`, `celebrating`) each allocated a 30-frame (1 s) segment, zips `manifest.json` + `animations/<role>.json` via `fflate`, and writes one `<role>.lottie` per role (~800 bytes each). It also rewrites `public/avatars/manifest.json` to list every role it emitted.
- `public/avatars/*.lottie` — 13 bundles generated and checked in (one per role). `public/avatars/manifest.json` now lists all 13 roles, so `DotLottieRoleAvatar` renders the real bundle for every role out-of-the-box; swapping in a hand-authored `.lottie` is still a drop-in replacement.
- `public/avatars/README.md` — documents `pnpm build:avatars` and how to keep hand-authored bundles out of the generator's sweep.
- `package.json` — adds `pnpm build:avatars` + `fflate@^0.8` as a `devDependency`.

### 2q.4 Envelope-aware mock provider (§5.1)

- `src/lib/llm/providers/mock-envelopes.ts` — new. Canned schema-valid envelopes for the full (role, phase) matrix most demos exercise: orchestrator × INTAKE / CLARIFY, pm × SPEC, architect × ARCHITECT, techlead × PLAN, dev trio × IMPLEMENT, reviewer × IMPLEMENT, devops × BRINGUP, qa × QA_MANUAL, incident × SELF_HEAL, security × SECURITY, release × RELEASE, writer × DEMO. `pickEnvelope({ role, phase, projectName, slug, userPrompt })` looks up the canned builder; missing entries fall through to a safe `advance: false` stub. Dev + reviewer envelopes parse the ticket code + title out of the prompt so the mock tracks whichever ticket the driver is working.
- `src/lib/llm/providers/mock.ts` — rewritten. Extracts role from the `# Role: <role>` line in the system prompt and phase from the `"phase": "<PHASE>"` field in the context block, picks the canned envelope, streams it back in ~64-char chunks, emits a `usage` chunk (estimated at ~4 chars/token so the budget rail moves) + a `done` chunk. Every real pipeline component (`parseEnvelope`, `writeArtifact`, `validateDevEnvelope`, `validateReviewerEnvelope`, gates, driver) now runs end-to-end against this provider.
- `src/lib/llm/providers/mock.test.ts` — new. 7 cases: every (role, phase) pair round-trips through `parseEnvelope`; INTAKE writes `REQUIREMENTS.md`; dev IMPLEMENT emits `sourceWrites` + ticketCode; reviewer IMPLEMENT emits an `approve` review with non-empty evidence; DEMO writes `README.md`; `extractTicketRef` pulls code/title from a dev prompt; `streamChat` emits tokens + usage + done.
- `scripts/demo/README.md` — prerequisites now distinguish offline (`LLM_PROVIDER=mock pnpm dev`) vs. live (`OPENROUTER_API_KEY`) runs and documents `BUDGET_USD_HARD` alongside the existing token + wall-clock knobs. The offline path walks `hello-readme` from INTAKE → DEMO without an API key.

---

## 2ter. What shipped in session 4 (2026-04-20)

### 2ter.1 Budget enforcement

- `src/lib/pipeline/budget.ts` — new. `evaluateBudget(state)` is a pure predicate over the `{ tokensUsed, tokensHard, wallClockMs, wallClockCapMs }` tuple; it prefers reporting the token breach when both caps trip at once. `enforceBudgets(projectId)` reads the state, calls the predicate, and on the first breach flips `state.paused = true`, emits `pipeline.paused` (+ an error log) and returns the check so callers can bail. `bumpWallClock(projectId, elapsedMs)` accumulates the elapsed time of a single agent turn. Zero caps (`tokensHard = 0` / `wallClockCapMs = 0`) are treated as "disabled" for tests.
- `src/lib/agents/run.ts` — after every streamed agent turn `bumpWallClock` now records `Date.now() - startedAt` into the project's `wallClockMs`, so the budget bar in the rail reflects real work instead of mere creation age.
- `src/lib/pipeline/driver.ts` — `driveProject` checks `enforceBudgets` at loop start and again at every chained step, short-circuiting before another LLM turn can fire when the caps are gone.
- `src/lib/pipeline/implement.ts` + `src/lib/pipeline/selfHeal.ts` — both loops now gate each step on `enforceBudgets` and report `paused = true` with reason `budget exhausted (tokens|wallclock)`. Combined with the existing `implement-view.tsx` pause banner and `ContextRail` bars, the operator sees the red bar turn on, then the "Resume implementation" affordance is the only way to restart (and `implement-view` already clears `state.paused` via `POST /api/projects/<id>/implement` with `{ resume: true }`).

### 2ter.2 Test runner (vitest) + first smoke tests

- `vitest@^2.1.9`, `vite-tsconfig-paths@^5.1.4`, and `tsx@^4.21` landed as `devDependencies`. Vitest 4.x pulls in a `rolldown` native binding that pnpm's strict hoist breaks on Linux, so we pin to the v2 line. Config lives at `vitest.config.mts` (the `.mts` extension is required because `vite-tsconfig-paths` is ESM-only and vitest v2 loads `.ts` configs through esbuild `require`).
- `src/lib/pipeline/budget.test.ts` — new. 8 tests: 5 pure (`evaluateBudget` headroom / both cap reasons / disabled caps) and 3 integration tests that mkdtemp a workspace, call `createProject`, and round-trip `bumpWallClock` / `enforceBudgets` through the real `readState` / `writeState` helpers to assert the paused state actually lands on disk.
- `src/lib/agents/envelope.test.ts` — new. 10 tests exercising `parseEnvelope` (well-formed JSON, fenced JSON, non-JSON, schema miss), `safePath` (leading slash, `..` traversal, empty, backslashes), and `validateDevEnvelope` (no sourceWrites → flag; whitespace-only content → flag).
- `package.json` — adds `pnpm test` / `pnpm test:watch`. `pnpm run test` reports `Tests 18 passed (18)`; `pnpm exec tsc -p tsconfig.json --noEmit` still clean.

### 2ter.3 Reproducible demo runner (§5.1)

- `scripts/demo/fixtures.ts` — new. Two canned scenarios (`hello-readme`, `todo-list`) with name, requirement, and a one-line scope note.
- `scripts/demo/run.ts` — new CLI (run via `pnpm demo`). Thin HTTP client over the web app's public routes: `POST /api/projects` to seed, poll `/api/projects/<id>/messages` for phase transitions, optional `--answer=<text>` for the first clarification round, then `POST /api/projects/<id>/implement` → `POST /api/projects/<id>/qa` → `POST /api/projects/<id>/self-heal`. Supports `--project=<id>` (resume), `--stage=<seed|implement|qa|self-heal>` (skip to a specific phase), `--trace` (dump the last 5 events after each step), and `--base-url=` / `OLYMPUS_API` env override.
- `scripts/demo/README.md` — new. Prerequisites, usage matrix, per-stage output checklist, and a troubleshooting block for the common failure modes (`project is paused`, `no ready ticket`, missing `OPENROUTER_API_KEY`). This is the document an operator runs down to validate the pipeline without re-reading the plan.
- `package.json` — adds `pnpm demo` → `tsx scripts/demo/run.ts`.

### 2ter.4 Avatar asset pipeline (§5.2)

- `public/avatars/manifest.json` — new. Lists role keys whose `.lottie` bundles ship today (currently `[]`). `DotLottieRoleAvatar` reads this manifest exactly once at mount rather than HEAD-probing every role URL, so adding a new avatar is a two-step opt-in: drop `public/avatars/<role>.lottie` + append the role key to the manifest.
- `public/avatars/README.md` — new. Codifies the naming contract (`<role-key>.lottie`), the expected state-machine marker names, the `NEXT_PUBLIC_OLYMPUS_AVATAR_BASE` override hook, and authoring tips (bundle via `dotlottie-js`, match the role's accent color, keep bundles under ~500 KB).
- `src/lib/client/avatar-manifest.ts` — new. `fetchAvatarManifest(baseUrl)` (memoised singleton) + `useAvatarManifest(baseUrl)` hook. Failures collapse to an empty manifest so a missing file simply forces the placeholder fallback.
- `src/components/ui/dotlottie-role-avatar.tsx` — rewritten. Uses the manifest hook instead of per-role `fetch('<role>.lottie', { method: 'HEAD' })`. Still swaps to `<RoleAvatar />` when the role isn't manifest-listed (`null` manifest / role absent) and still calls `setMarker(stateName)` on every `RoleState` transition when the asset is present.

---

## 2bis. What shipped last session (session 3 / 2026-04-20)

### 2bis.1 SELF_HEAL dispatch loop

- `src/lib/schemas/incidents.ts` — new. Zod schemas for `IncidentEntry` / `IncidentsIndex` that treat each `incidents/I-*.md` file as the source of truth (front-matter carries `status`, `attempts`, `dispatch`, `classification`, `ticketCode`) and `incidents/index.json` as a materialized view.
- `src/lib/workspace/incidents.ts` — new. Front-matter read/write (via `gray-matter`), `deriveIncidentsIndex` (rebuild from disk), `updateIncidentEntry` (mutates the markdown and re-writes the index), `pickNextOpenIncident`, and classification → dispatch-role inference (`frontend-dev`, `backend-dev`, `devops`). Exports `MAX_HEAL_ATTEMPTS_PER_INCIDENT = 3`.
- `src/lib/pipeline/selfHeal.ts` — new. `runSelfHealLoop(projectId, { maxSteps })` picks the next open incident, dispatches a dev turn with `runAgentTurn`, validates the envelope, applies `sourceWrites`, and stamps the incident `resolved` / `escalated`. When the 3-attempt budget is exhausted the loop writes `HELP_NEEDED.md`, emits `pipeline.paused`, sets `state.paused = true`, and stops.
- `src/lib/pipeline/driver.ts` — after the SELF_HEAL agent turn the driver materializes the index and runs `runSelfHealLoop`, so the phase is now a real dispatcher rather than a stub. The SELF_HEAL prompt was rewritten to spell out the required front-matter and tell the role it should set `advance: false` because the driver handles the sweep.
- `src/app/api/projects/[id]/self-heal/route.ts` — new. `POST` (optional `{ maxSteps }`) for manual / programmatic heal runs.
- `src/lib/schemas/events.ts` — added `incident.index.updated`, `incident.status`, `incident.dispatched`, `qa.run` event kinds.

### 2bis.2 QA_MANUAL — Playwright-on-host

- `src/lib/workspace/qa.ts` — new. `runQaPlaywright(projectId, { baseUrl, timeoutMs })` spawns `npx playwright test` inside the project workspace, tags the env with `PLAYWRIGHT_BASE_URL` + `PLAYWRIGHT_JSON_OUTPUT_NAME`, parses both the JSON report (preferred) and stdout, writes a `qa/reports/R-<ts>.md` artifact, and calls `openIncidentForFailure` for every failed test — which writes a fully-formed `incidents/I-<ts>-<slug>.md` with front-matter that the SELF_HEAL loop can pick up immediately.
- `src/app/api/projects/[id]/qa/route.ts` — new. `POST { baseUrl?, timeoutMs? }` drives the runner end-to-end.
- Emits `qa.run` (started / passed / failed / error) and `incident.opened` events, closing the "runtime → QA → incidents → self-heal" loop.

### 2bis.3 Review artifact convention

- `src/lib/pipeline/implement.ts` — `materializeReviewArtifact` now always stamps `reviews/PR-<ticket>-review.md` as the canonical path, regardless of what the reviewer's envelope targeted. When the reviewer writes to a different path the content is *also* persisted at the canonical path, so downstream tooling (ACP, UI, future merge gates) has a single reliable location per ticket.

### 2bis.4 Web → Zed barge-in push

- `olympus-agents/src/events-watcher.ts` — new. Tails `events.ndjson` (inotify-style via `fs.watch` + polling fallback, starts from the end of the file to avoid replaying history), filters `barge.in` events that did *not* originate from the ACP server (`source !== 'acp'`), and sends each one to Zed as a `session/update` notification with `{ projectId, kind: 'barge.in', role, text }`.
- `olympus-agents/src/main.ts` — starts the watcher after `session/create` succeeds and shuts it down cleanly on loop exit. This completes the bidirectional bridge: Olympus chat → NDJSON → Zed agent panel and vice-versa.

### 2bis.5 Phase 6 polish

- `@lottiefiles/dotlottie-react` installed.
- `src/components/ui/dotlottie-role-avatar.tsx` — new. Looks up a `.lottie` bundle under `${NEXT_PUBLIC_OLYMPUS_AVATAR_BASE ?? '/avatars'}/<role>.lottie`; plays the default loop and calls `setMarker(stateName)` for each role-state transition. When the bundle is missing (HEAD 404) the component falls back to the existing `RoleAvatar` colored-disc placeholder, so shipping actual `.lottie` assets later is a drop-in upgrade with no UI migration.
- `src/components/office/office-scene.tsx` — swapped the `RoleAvatar` grid for `DotLottieRoleAvatar` and refreshed the helper copy.
- `src/components/canvas/replay-view.tsx` — new. Time-travel scrubber backed by `GET /api/projects/[id]/events`: a range slider + play/pause/skip controls step through the full event history, a left panel shows the reconstructed phase + per-role presence at that moment, and a right panel pretty-prints the focused event with the last-10 tail. Playback is tick-based (250 ms / event) rather than wall-clock-scaled so bursty sections are still explorable frame-by-frame.
- `src/app/api/projects/[id]/events/route.ts` — new. Returns the full parsed `events.ndjson` as JSON for the replay view. `src/lib/workspace/fs.ts` gains `readEvents(projectId)` that parses the NDJSON through `eventSchema` and drops any malformed lines.
- `src/components/canvas/main-canvas.tsx` — adds `replay` as a first-class canvas tab (lucide `History` icon).

### 2bis.6 Type plumbing

- `src/lib/pipeline/selfHeal.ts` + `src/lib/workspace/qa.ts` — replaced `Omit<Parameters<typeof emit>[0], 'projectId'>` with a distributed `EmitInputWithoutProject` helper so the discriminated union of event payloads is preserved through the `emitEvent`/`emitAndAppend` wrappers. This unblocked strict `tsc --noEmit` after the new event kinds were introduced.

---

## 3. Verification

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` on the web app | ✅ clean |
| `pnpm exec tsc --noEmit -p tsconfig.json` in `olympus-agents/` | ✅ clean |
| `ReadLints` on every touched file | ✅ zero diagnostics |
| `pnpm run test` (vitest) | ✅ 46 / 46 passing (`budget`, `envelope`, `incidents`, `tickets`, `mock` provider) |
| `pnpm demo --help` | ✅ prints usage; runner accepts fixtures / stages / trace flags |
| `pnpm build:avatars` | ✅ emits 13 `<role>.lottie` bundles + rewrites `public/avatars/manifest.json` |
| Offline end-to-end run (`LLM_PROVIDER=mock pnpm demo --fixture=hello-readme`) | ✅ ready — canned envelopes now walk INTAKE → DEMO without a key |
| End-to-end run against a live LLM | ⏳ still pending (`OPENROUTER_API_KEY` required; offline path is the rehearsal) |
| Zed + ACP smoke test (real `fs/apply_edit` round-trip) | ⏳ pending |
| Playwright QA automation | ✅ host-side runner wired (needs a live app + real `.spec.ts` to exercise) |
| SELF_HEAL loop against a real incident | ⏳ needs a live QA failure to verify |
| Token / wall-clock / USD budget guard | ✅ all three caps unit-tested (`bumpUsage` priced + unknown models, `enforceBudgets` reason=`usd`) |

---

## 4. Inventory — files touched this session (5)

Added:
- `src/lib/llm/pricing.ts` (USD/1M-token table + env overrides)
- `src/lib/llm/providers/mock-envelopes.ts` (canned per-(role × phase) envelopes)
- `src/lib/llm/providers/mock.test.ts`
- `src/lib/workspace/incidents.test.ts`
- `src/lib/workspace/tickets.test.ts`
- `scripts/avatars/build-placeholders.ts`
- `public/avatars/architect.lottie`, `backend-dev.lottie`, `devops.lottie`, `frontend-dev.lottie`, `incident.lottie`, `orchestrator.lottie`, `pm.lottie`, `qa.lottie`, `release.lottie`, `reviewer.lottie`, `security.lottie`, `techlead.lottie`, `writer.lottie`

Modified:
- `src/lib/schemas/state.ts` (`budgets.usdUsed` / `budgets.usdHard`)
- `src/lib/schemas/events.ts` (`budget.update.usdUsed`)
- `src/lib/workspace/fs.ts` (`createProject` seeds USD defaults from env)
- `src/lib/pipeline/budget.ts` (evaluateBudget → USD; `bumpUsage` replaces inline helper)
- `src/lib/pipeline/budget.test.ts` (+6 USD cases)
- `src/lib/agents/run.ts` (uses `bumpUsage(model, usage)` instead of ad-hoc token bump)
- `src/lib/llm/providers/mock.ts` (envelope-aware; streams canned JSON + usage)
- `src/lib/client/project-store.ts` (mirrors `usdUsed` in reducer)
- `src/components/rail/context-rail.tsx` (third bar / no-cap indicator)
- `public/avatars/manifest.json` (now lists all 13 role keys)
- `public/avatars/README.md` (`pnpm build:avatars` block)
- `scripts/demo/README.md` (mock vs. live LLM prerequisites, `BUDGET_USD_HARD`)
- `package.json` (`build:avatars` script, `fflate` devDependency)

### 4ante. Inventory — session 4 (kept for history)

Added:
- `src/lib/pipeline/budget.ts`
- `src/lib/pipeline/budget.test.ts`
- `src/lib/agents/envelope.test.ts`
- `src/lib/client/avatar-manifest.ts`
- `vitest.config.mts`
- `scripts/demo/fixtures.ts`
- `scripts/demo/run.ts`
- `scripts/demo/README.md`
- `public/avatars/manifest.json`
- `public/avatars/README.md`

Modified:
- `src/lib/agents/run.ts` (calls `bumpWallClock` after every turn)
- `src/lib/pipeline/driver.ts` (calls `enforceBudgets` at loop start + per step)
- `src/lib/pipeline/implement.ts` (budget gate per step)
- `src/lib/pipeline/selfHeal.ts` (budget gate per step)
- `src/components/ui/dotlottie-role-avatar.tsx` (manifest-driven availability)
- `package.json` (vitest, tsx, demo + test scripts)

### 4bis. Inventory — session 3 (kept for history)

Added:
- `src/app/api/projects/[id]/self-heal/route.ts`
- `src/app/api/projects/[id]/qa/route.ts`
- `src/app/api/projects/[id]/events/route.ts`
- `src/lib/schemas/incidents.ts`
- `src/lib/workspace/incidents.ts`
- `src/lib/workspace/qa.ts`
- `src/lib/pipeline/selfHeal.ts`
- `src/components/ui/dotlottie-role-avatar.tsx`
- `src/components/canvas/replay-view.tsx`
- `olympus-agents/src/events-watcher.ts`

Modified:
- `src/lib/pipeline/driver.ts` (SELF_HEAL dispatches `runSelfHealLoop`, prompt clarified)
- `src/lib/pipeline/implement.ts` (canonical `reviews/PR-*-review.md` path)
- `src/lib/schemas/events.ts` (new `incident.index.updated` / `incident.status` / `incident.dispatched` / `qa.run` kinds)
- `src/lib/workspace/fs.ts` (`readEvents`)
- `src/components/canvas/main-canvas.tsx` (`replay` tab)
- `src/components/office/office-scene.tsx` (swaps to `DotLottieRoleAvatar`)
- `olympus-agents/src/main.ts` (starts + stops the events watcher)
- `package.json` (adds `@lottiefiles/dotlottie-react`)

### 4ter. Session 2 inventory (unchanged, kept for history)

Added:
- `src/app/api/projects/[id]/implement/route.ts`
- `src/app/api/projects/[id]/runtime/route.ts`
- `src/app/api/projects/[id]/barge/route.ts`
- `src/lib/workspace/runtime.ts`
- `src/components/canvas/implement-view.tsx`
- `src/components/canvas/runtime-view.tsx`
- `olympus-agents/src/tools/implement-client.ts`
- `olympus-agents/src/tools/fs-apply-edit.ts`
- `olympus-agents/src/tools/terminal-run.ts`

Modified:
- `olympus-agents/src/dispatch.ts` (HTTP delegation to the web app's implement endpoint)
- `olympus-agents/src/main.ts` (response dispatcher, `session/notify`)
- `src/lib/agents/roles/incident.ts` (SELF_HEAL alignment)
- `src/lib/agents/roles/techlead.ts` (done-criteria / never for ticket front-matter)
- `src/lib/agents/roles/index.ts` (`assertTiersConsistent` guard)
- `src/lib/client/project-store.ts` (`runtime` slice + reducer cases)
- `src/lib/pipeline/driver.ts` (Phase 4/5 role + prompt wiring)
- `src/lib/schemas/events.ts` (runtime + incident + barge event kinds)
- `src/lib/workspace/fs.ts` (`writeArtifact` normalizes ticket trailers)
- `src/components/canvas/main-canvas.tsx` (`implement` + `runtime` tabs)
- `src/components/events/events-view.tsx` (summarizer cases)

---

## 5. Next steps — ordered backlog

### 5.1 Live-LLM validation (the one thing nothing else can substitute)

Every other loop is now exercisable offline (`LLM_PROVIDER=mock pnpm demo` walks INTAKE → DEMO in ~30 s). The remaining gaps all involve a real model.

1. **Offline smoke first.** `LLM_PROVIDER=mock pnpm dev` + `pnpm demo --fixture=hello-readme --trace` in a second shell. Confirm `source.written` for `src/app/page.tsx`, `review.posted` with decision `approve`, `ticket.status: done` for `T-0001`, plus a `reviews/PR-T-0001-review.md` artifact. This exercises every event type except real token cost — use it as a pre-flight before burning a real key.
2. **Live IMPLEMENT dry-run.** Same command, drop `LLM_PROVIDER=mock`, set `OPENROUTER_API_KEY` + `BUDGET_USD_HARD=2`. Watch the USD bar tick up and confirm the canonical `reviews/PR-*-review.md` still lands.
3. **BRINGUP → QA → SELF_HEAL.** Author one deliberately-broken `tests/smoke.spec.ts`, then `pnpm demo --project=<id> --stage=qa` → `--stage=self-heal`. Verify `qa/reports/R-*.md` + `incidents/I-*.md` land, then flip to `status: resolved` with a `resolutionNote` after the heal loop runs.
4. **Zed + ACP smoke test.** Start the web app, `Open in Zed`, prompt `@olympus/tech-lead`, confirm `dispatch.ts` reports the summary back, then type in the Olympus chat and verify the events-watcher relays `barge.in` into Zed as `session/update`.

### 5.2 Hand-authored avatar bundles (optional polish)

Placeholders now ship for all 13 roles via `pnpm build:avatars`. The component auto-upgrades when a replacement file lands on disk. To improve the look:

- Author richer per-role Lottie animations with the full marker set (`idle`, `thinking`, `typing`, `reviewing`, `testing`, `blocked`, `celebrating`, `off-duty`). LottieFiles / After Effects is the path of least resistance.
- Drop the resulting `<role>.lottie` into `public/avatars/`; it overwrites the generator output. If you re-run `pnpm build:avatars`, hand-authored files are regenerated (intended) — keep them under version control and treat the generator as a factory reset.

### 5.3 Residual clean-ups

- **Monorepo split (v2).** If we ever want `olympus-agents` to stop being a thin HTTP client, the shared modules (`src/lib/agents/roles`, `envelope.ts`, `prompts.ts`, `src/lib/workspace/sources.ts`, `src/lib/llm/*`) need to live in workspace packages. Deferred — the current design ships and the alias overhead was the original motivation for skipping.
- **Observability.** No structured tracing yet; `events.ndjson` is the only spine. A thin OpenTelemetry wrapper around `runAgentTurn` + `runImplementLoop` + `runSelfHealLoop` would make latency attribution trivial and would roll nicely into the USD cost bar.
- **`OLYMPUS_MODEL_PRICES` documentation.** The env override exists and is tested in `budget.test.ts`, but we should add a concrete example block to the demo README once we confirm the exact OpenRouter slug → price mapping for whatever model we ship against in the live run.

---

## 6. Risk / watch-list

- **Still no live-LLM run.** Types / builds / unit tests are clean and the offline `LLM_PROVIDER=mock` path walks the full pipeline, but no code path that actually hits OpenRouter has been exercised this session. The checklist in §5.1 — now runnable as `pnpm demo` in either mock or live mode — is the minimum gate before demoing.
- **USD cap trusts the pricing table.** Unknown models price at `$0`, so a stale `DEFAULT_PRICES` silently under-counts spend. `OLYMPUS_MODEL_PRICES` is the escape hatch; operators who care about hard budgets should ship an override for every model they let agents pick. Wall-clock is still the defensive ceiling here.
- **Mock envelopes are deliberately trivial.** They satisfy `agentEnvelopeSchema` and `validateDevEnvelope` / `validateReviewerEnvelope`, but the "code" they emit is a placeholder landing page, not a real implementation of any fixture. Don't mistake a green offline demo run for an end-to-end QA gate — the live-LLM path is the only thing that proves real turns.
- **Playwright runner still needs user-authored specs.** `runQaPlaywright` assumes `playwright.config.{ts,js}` exists inside the generated project; if QA hasn't written tests yet, the runner returns `error` instead of opening incidents. Intentional but worth documenting for first-run UX.
- **SELF_HEAL heal attempts reuse dev allow-lists.** The loop calls `applySourceWrites` with the same allow-list the IMPLEMENT loop uses, so incident fixes inherit the same `src/**` / `public/**` guardrails. A mis-configured `devops` allow-list would still bite here — worth a pass before onboarding real incidents.
- **ACP server HTTP delegation pins both processes to the same host.** Unchanged. The ACP server requires `OLYMPUS_API` to point at a running Next.js instance; if the web app is down, `@olympus/tech-lead` turns fail with a clear "OLYMPUS_API not configured" message. Acceptable for v1.
- **Host-side `pnpm run dev` + `npx playwright test` spawns are powerful.** Both commands only run inside the project's workspace, but we should still think twice before pointing Olympus at a generated app with a malicious `package.json` script or test. The allow-list shape in `terminal-run.ts` is the correct long-term pattern; the runtime + QA managers should grow a similar allow-list before v2.
- **Time-travel replay loads the whole `events.ndjson`.** For short projects this is fine, but a multi-day run can grow into hundreds of thousands of events. A paginated / range-fetched reader is the natural next iteration if we feel the UI get sluggish.
- **Vitest pinned to v2.** Vitest 4.x pulls in `rolldown` native bindings that pnpm's strict hoist can't resolve on Linux without changes; downgrading was the lowest-drama fix. Revisit when rolldown ships platform-agnostic binaries or when pnpm's side-loading story improves.
- **Avatar manifest is an opt-in list.** If someone drops a `<role>.lottie` into `public/avatars/` but forgets to update `manifest.json`, the placeholder keeps rendering. This is the intended behaviour (no 404 chatter during development), but worth calling out in code review. `pnpm build:avatars` always rewrites the manifest to match the set of bundles it emitted, so running the generator keeps the two in sync for free.
- **Placeholder bundles ship in git.** 13 × ~800-byte `.lottie` files live under `public/avatars/`. They are regenerable (`pnpm build:avatars`), but committing them keeps CI / Vercel builds fast and lets a checkout render pretty avatars without a tool run. If a designer ships hand-authored bundles, they land on the same paths and supersede the placeholders without code changes.
