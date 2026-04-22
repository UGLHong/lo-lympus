---
description: General coding conventions that apply to every task in the L'Olympus repository
globs:
alwaysApply: true
---

# General Coding Rules

Applies to every edit in this repository. L'Olympus-specific conventions sit alongside the stack-agnostic ones — both are required.

---

## Rule Maintenance

When the user says "remember this rule", "add a rule", or equivalent, create or update a markdown file in `.agent/rules/`. `.agent/rules/` is the single source of truth — other editor surfaces (`.cursor/rules/`, `.github/copilot-instructions.md`) should symlink or mirror it.

Each rule file starts with this front-matter:

```yaml
---
description: One-line summary of what the rule enforces
globs:            # optional glob(s) to scope the rule
alwaysApply: true # set true for rules that must always be in context
---
```

---

## Code Style & Naming

- Write clean, self-documenting code. Avoid comments that restate the obvious ("increment counter").
- When a comment is needed, keep it **short, on top of the code**, focused on intent — not explanation.
- Do not capitalise comments; they are not sentences.
- File and folder names use `kebab-case` (matches the rest of `app/` and `server/`). React component exports are `PascalCase`.
- Do not prefix TypeScript interfaces/types with `I` (use `User`, not `IUser`).
- Do not export types/interfaces that are only consumed within a single file — keep them local.
- Remove unused imports, variables, and dead code as part of the change that orphaned them.
- Do not use single- or two-letter identifiers (no `const n`, `const x`) — names must be descriptive.
- Prefer `dropdownItems` over `itemsForDropdown` — noun before qualifier.
- Do not reassign a variable to a new name without a solid reason (original ambiguous or very long).
- Do not use negated conditions when the inverse is clearer — prefer `a === 1 ? 'c' : 'b'` over `a !== 1 ? 'b' : 'c'`.

---

## Imports & Path Aliases

L'Olympus has three aliases defined in `tsconfig.json`:

| Alias | Resolves to |
| --- | --- |
| `@/*` | `./app/*` |
| `@server/*` | `./server/*` |
| `@db/*` | `./server/db/*` |

- Always use aliases instead of long relative paths. `import { emit } from '@/lib/event-bus.server'` is preferred over `import { emit } from '../../app/lib/event-bus.server'`.
- Prefer named imports (`import { useState } from 'react'`).
- Server-only code must stay under `server/` or be loaded through a `.server.ts` route module to avoid leaking into the client bundle.

---

## L'Olympus Conventions

### Runtime-agent surface

When touching anything that influences what the 13 runtime daemons do, read and update the paired files together:

| Change | Files that must move as a set |
| --- | --- |
| Add a new role | `server/const/roles.ts` (`ROLES`, `ROLE_TIER`, `ROLE_LABEL`, `ROLE_COLOR`, optionally `PLANNING_ROLES`) + `server/mastra/prompts.ts` (`PROMPTS`) + `server/tools/index.ts` (`buildToolsForRole`) + `server/daemon/execute.ts` (`REVIEWABLE_ROLES` / `ARTIFACT_PRODUCING_ROLES` if applicable) + `README.md` |
| Add a new tool | new file in `server/tools/` (export `buildXxxTool`) + register in `server/tools/index.ts` + reference it in every role prompt that gets it (`server/mastra/prompts.ts`) |
| Add a new env var | `.env.example` + `README.md` env-var section + wherever it is read (typically `server/lib/settings.ts` or `server/mastra/model.ts`) |
| Add a new daemon loop | `server/daemon/` + register in `server/bootstrap.ts` + `README.md` layout |

### React Router v7 (framework mode)

- Routes live in `app/routes/`. File naming follows RR v7's flat convention (`projects.$id.tsx`, `api.events.ts`).
- Prefer the loader/action API for data — not `useEffect` + `fetch`.
- `api.*.ts` routes are server-only endpoints; they export `loader` / `action` and MUST return `Response` objects.

### Drizzle + Postgres

- Schema in `server/db/schema.ts`. Every table is prefixed `olympus_` to stay clear of Mastra's `mastra_*` tables.
- Query helpers centralise in `server/db/queries.ts` — prefer extending an existing helper over writing raw Drizzle in routes.
- Schema changes: edit `schema.ts` → `pnpm db:generate` → review the diff under `server/db/migrations/` → `pnpm db:push` (or let the user push if the DB is shared).

### Event bus & SSE

- Server-side events flow through `emit()` from `app/lib/event-bus.server.ts`. Never `console.log` as a substitute.
- Every new event type goes in the union in that file; consumers in `app/components/` and `app/hooks/` pick it up via `useLiveEvents`.
- `emitToolLog` wraps the event bus for tool-level telemetry — use it for any new tool so logs show up in the Terminal pane.

### Runtime-agent prompts (`server/mastra/prompts.ts`)

- Prompts are consumed by real LLM runs. Treat them like code: small changes can shift behaviour system-wide.
- Keep the per-role skeleton consistent (Mission / Inputs / Process / Deliverable / Done-when / Avoid) — agents follow templates they have seen.
- Never promise a tool the role does not have (`buildToolsForRole` is the source of truth for availability).

---

## Reuse Before You Create

Before adding anything new, search the codebase first:

| Looking for | Check |
| --- | --- |
| UI component | `app/components/` (`kanban/`, `office/`, `editor/`, `terminal/`, `hitl/`) |
| UI helper / hook | `app/lib/`, `app/hooks/` |
| Server utility | `server/lib/` |
| DB query | `server/db/queries.ts` |
| Tool builder | `server/tools/` |
| Constants / enums | `server/const/` |
| Icons | `lucide-react` (already a dependency) — do not hand-roll SVGs |

If something truly does not exist:

- New constant → extend `server/const/` (create a new file if the domain does not fit existing ones).
- New server utility → `server/lib/`.
- New UI utility → `app/lib/`.
- New tool → `server/tools/<tool-name>.ts`, wire via `server/tools/index.ts`.

---

## Styling

- Tailwind v3 is the default. Prefer Tailwind utility classes on `className` over inline styles or ad-hoc CSS.
- Class merging uses `twMerge` from `tailwind-merge` (already a dependency) and the `cn()` helper in `app/lib/cn.ts`. Do not introduce a competing utility.
- When editing an existing file, keep its current class-merge pattern.

---

## React Rules

- Do not create inline render functions inside JSX that are immediately executed — extract them to a named component in the same file.
- JSX attribute values should not contain functions created in the same scope unless the function is a single short line. Extract handlers with `useCallback` and pass the reference.
- Use `useCallback`, `useMemo`, `useState` when identity stability or recomputation cost matters — not reflexively.
- Follow standard HTML event naming: `onChange`, `onClick`, `onSubmit` — mirror the closest HTML equivalent on custom components (`onChange`, not `onValueChange`) when semantics match.
- Name props for what they are (`isLoading`, `dropdownItems`) — not how they are used.
- When a component legitimately needs the `undefined` literal, add `// eslint-disable-next-line no-undefined` above that line.

---

## i18n & Copy

This project currently has no i18n layer. When introducing user-facing strings, keep them readable and short; if an i18n layer is added later, the same strings will be extracted.

---

## Secrets & Environment

- `.env` holds real values and is gitignored; `.env.example` is the canonical list and must stay in sync with `README.md`.
- Never hard-code API keys, database URLs, or OpenRouter tokens into source.
- When reading env vars, funnel through `server/lib/settings.ts` when one exists for that variable; otherwise read via `process.env` in a server-only module.

---

## Development Workflow

- Follow `.agent/rules/local-verification.md` after every behavioural change.
- Do not stage or commit unless explicitly asked.
- Do not change code unrelated to the request.
- Understand the user's goal before editing; irrelevant out-of-scope changes are rejected.

---

## Linting & Typing

- `pnpm typecheck` must pass before a task is marked complete.
- `pnpm lint` currently ends with `|| true` so warnings do not fail the command — still, do not introduce new warnings. Fix any warning you cause within 3 attempts; if you cannot, flag it explicitly to the user.
- Always check TypeScript typings before generating code; run `pnpm typecheck` after substantive edits.
- Do not suppress a lint rule to silence a warning — fix the underlying issue.
