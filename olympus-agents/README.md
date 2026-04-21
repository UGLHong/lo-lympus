# @olympus/acp-server

Agent Client Protocol (ACP) server that exposes Olympus's role agents — Tech Lead, Backend Dev, Frontend Dev, Reviewer, DevOps, QA, Security, Release — inside any ACP-compatible editor, starting with **Zed**.

See `implementation_plan.md` §15 for the full design. TL;DR:

- **Shares source of truth with the web app.** Imports `src/lib/agents/roles/*`, `src/lib/agents/prompts.ts`, `src/lib/agents/envelope.ts`, and `src/lib/llm/*` via a `paths` mapping — no prompt or model-routing duplication.
- **Reads `tickets/index.json`** from the workspace as the shared work queue; updates status entries atomically.
- **Mirrors its turns into `.software-house/events.ndjson`** so Olympus's web UI (office scene, chat, mini-map) stays live while the real work runs in the editor.

## Status

Scaffold. `src/main.ts` opens an ACP JSON-RPC session over stdio and speaks a minimal handshake; full tool-wiring (fs/apply_edit, terminal/run, diagnostics/get) lands in the next slice.

## Build

```bash
pnpm --filter @olympus/acp-server install
pnpm --filter @olympus/acp-server build
```

The built CJS entrypoint is `dist/main.cjs`; a thin shim at `bin/olympus-acp-server.cjs` requires it. Olympus's "Open in Zed" action in the web app will copy the shim into `<workspace>/.zed/olympus-acp-server.cjs` and point `agent_servers.Olympus.command` at `node` with that path.

## Env

Expected in `agent_servers.Olympus.env` (populated by the web app):

| Variable | Purpose |
|---|---|
| `OLYMPUS_PROJECT_ID` | Project id (matches the workspace folder name under `workspaces/`). |
| `OLYMPUS_WORKSPACE` | Absolute path to `workspaces/<project-id>/`. |
| `OLYMPUS_API` | Base URL of the running Olympus web app (e.g. `http://localhost:3100/api`). |
| `OPENROUTER_API_KEY`, `MODEL_TIER_*`, `LLM_PROVIDER` | Passed through to the shared router for tier resolution. |
