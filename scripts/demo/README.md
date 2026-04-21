# Demo / validation scripts

Reproducible end-to-end dry-runs for the Olympus pipeline. Every API route the UI calls can be driven from here, so validation is just `pnpm demo` away.

## Prerequisites

1. The Next.js dev server is running: `pnpm dev` (port 3100 by default).
2. Pick an LLM provider:
   - **Offline smoke** — `LLM_PROVIDER=mock pnpm dev`. The mock emits canned, schema-valid envelopes per (role, phase) so `pnpm demo --fixture=hello-readme` walks INTAKE → DEMO without an API key. No real code is written; the mock stubs a Next.js landing page and a README.
   - **Live LLM** — set `OPENROUTER_API_KEY` (or the provider of your choice) in `.env.local` and leave `LLM_PROVIDER` unset (defaults to `openrouter`).
3. Optional: override budgets for short demos with `BUDGET_TOKENS_HARD=200000`, `BUDGET_WALLCLOCK_MINUTES=30`, or `BUDGET_USD_HARD=5`.

## Usage

```bash
pnpm demo                         # seed "hello-readme" and watch the pipeline
pnpm demo --fixture=todo-list     # larger fixture exercising the IMPLEMENT loop
pnpm demo --project=<id>          # resume an existing project
pnpm demo --stage=implement --project=<id>
pnpm demo --stage=qa --project=<id>
pnpm demo --stage=self-heal --project=<id>
pnpm demo --answer="no auth, localStorage only" --fixture=todo-list
pnpm demo --trace                 # print the last 5 events after each step
```

## Stages

- `full` (default) — seed → watch phase transitions → optionally answer clarifications → implement → qa → self-heal.
- `seed` — only `POST /api/projects`. The driver auto-drives INTAKE → PLAN in the background; use `--stage=seed --trace` and re-run with `--project=<id>` to inspect.
- `implement` — `POST /api/projects/<id>/implement` with the standard 12-step budget and `resume: true`.
- `qa` — `POST /api/projects/<id>/qa` (host-side Playwright).
- `self-heal` — `POST /api/projects/<id>/self-heal`.

## Fixtures

Defined in `scripts/demo/fixtures.ts`:

- `hello-readme` — minimal single-page static site, 1 ticket.
- `todo-list` — two-ticket React + Vite localStorage todo app.

Add more by appending to `demoFixtures`; anything in there is immediately selectable via `--fixture=<slug>`.

## What to verify

| Artifact                                     | Meaning                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `workspaces/<id>/.software-house/SPEC.md`    | PM wrote SPEC, gate passed.                                             |
| `.../ARCHITECTURE.md` + `adr/ADR-0001-*.md`  | Architect produced architecture + ADR.                                  |
| `.../PLAN.md` + `tickets/T-*.md`             | Tech lead produced plan.                                                |
| `workspaces/<id>/src/**`                     | Dev role actually wrote source.                                         |
| `.../reviews/PR-<ticket>-review.md`          | Reviewer left feedback; path is canonical regardless of `writes[]` target. |
| `.../qa/reports/R-*.md`                      | Playwright JSON was parsed into a report.                               |
| `.../incidents/I-*.md`                       | QA failure opened an incident (front-matter: `status: open`).           |
| `.../incidents/I-*.md` after self-heal        | Front-matter flips to `status: resolved` with a `resolutionNote`.       |
| `.../HELP_NEEDED.md`                         | Budget / heal exhausted; human required.                                |
| `.../events.ndjson`                          | Append-only trace — replay via the Replay tab in the UI.                |

## Troubleshooting

- _"project is paused"_ — the budget guard tripped or a ticket hit its 3-attempt budget. Check `events.ndjson` for the most recent `pipeline.paused` event; clear with `POST /api/projects/<id>/implement` body `{ "resume": true }`.
- _"no ready ticket"_ — PLAN didn't land, or every ticket blocks on another. Check `tickets/index.json`.
- _"OPENROUTER_API_KEY not set"_ — the OpenRouter provider will throw on first turn. Add the key to `.env.local` or switch `LLM_PROVIDER=mock` for plumbing-only smoke tests.
