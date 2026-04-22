---
description: What to document, where, and when — tailored to L'Olympus
globs:
alwaysApply: true
---

# Documentation Rule

## Where Documentation Lives

L'Olympus does **not** use a `/docs` folder. Documentation is distributed across three surfaces, each with a specific purpose:

| Surface | Purpose |
| --- | --- |
| `README.md` (repo root) | Canonical reference for stack, setup, env vars, scripts, layout, gotchas. Update on any user-visible or operational change. |
| `AGENTS.md` (repo root) | Agent boot sequence + Project Layout Reference + Common Commands. Update when a top-level directory is added, a canonical command changes, or the boot sequence shifts. |
| Inline TSDoc / block comments | Non-obvious invariants, data shapes, and rationale that belong next to the code (why this guard exists, what this constant bounds, etc.). Not a substitute for `README.md`. |

There are **no SCREAMING_SNAKE_CASE feature doc files**. If you feel the urge to create one, update `README.md` or `AGENTS.md` instead.

---

## When to Update What

### Always update `README.md` when:

| Change | Section(s) to update |
| --- | --- |
| New env var added / removed / renamed | "Env vars" list (and mirror in `.env.example`) |
| New `pnpm` script added or a script's behaviour changes | "Scripts" table |
| New top-level directory added | "Layout" block |
| New role added to the workforce | stack description + "Layout" if the role brings new files |
| New runtime tool added | optional mention in the relevant section; always reflect in role-prompt behaviour |
| HITL / Follow Mode / Control Room flow changes | the section describing that flow |
| DB connection / TLS behaviour changes | "Notes & gotchas" |
| Port or workspace-dir default changes | Run section + env-var list |

### Always update `AGENTS.md` when:

| Change | Section(s) to update |
| --- | --- |
| New top-level directory | "Project Layout Reference" table |
| New canonical command | "Common Commands" block |
| New `.agent/rules/` file | "Quick-Reference Rule TL;DR" summary + file list reference |
| New `do-not-touch` path | "Do-Not-Touch List" |
| Boot sequence shifts (e.g. a new rule must be read first) | "Mandatory Agent Boot Sequence" |

### Add inline TSDoc when:

- You add a public helper whose invariants are not obvious from the signature (e.g. a function that mutates global state, caches, or has side effects).
- You introduce a magic constant whose value encodes a product decision (token counts, retry caps, polling intervals).
- You add a guard that exists to protect against a specific upstream failure (leave a one-line `// why` comment on top).

### Does NOT need documentation

- Bug fixes that don't change observable behaviour (typos, crash fixes, off-by-one).
- Style-only changes (CSS, spacing, Tailwind class ordering).
- Refactoring with no behavioural change.
- Changes under `workspaces/` — you should not be editing that directory at all (see `.agent/rules/docs-first.md`).

---

## When to Write the Update

Update documentation **as part of the same task**, before marking it complete. Do not defer to a follow-up.

Correct order:

1. Implement the change.
2. Verify it locally per `local-verification.md`.
3. Update `README.md` / `AGENTS.md` / inline TSDoc — same task, same PR.
4. Mark the task done.

If you genuinely cannot update docs in the same task (rare — usually because the user asked for a pure refactor), call it out explicitly in your final summary.

---

## Writing Style

Docs in this repo are consumed by both humans and downstream AI agents. Write accordingly:

- **Tables over prose** for anything enumerable (env vars, commands, scripts, layouts).
- **Exact file paths** from the repo root — never "the config file" when you mean `server/lib/settings.ts`.
- **State the why** alongside the what when a decision is non-obvious.
- **Define every enum / status string** that appears in the code — silent enums are a trap for the reviewer role.
- **Cross-reference** — if `README.md` mentions a concept fully covered in `AGENTS.md`, link to the section instead of duplicating.
- **Keep it short.** This project prefers terse, structured docs over long narratives.

---

## Role-Specific Reminder: Runtime Agent Prompts

`server/mastra/prompts.ts` is documentation-as-code for the 13 runtime roles. Treat changes there like a contract change:

- A prompt change is a user-visible behaviour change — reflect it in `README.md` if the change affects what artifacts roles produce, what files they write to (e.g. `.software-house/*`), or how they escalate.
- Keep the per-role skeleton consistent (Mission / Inputs / Process / Deliverable / Done-when / Avoid). Downstream agents follow the shape they have seen.
- When you change a tool name or schema in `server/tools/`, every role prompt that mentions that tool must be updated in the same commit.

---

## Self-Check Before Finishing

- [ ] Does this change affect stack, setup, env vars, scripts, layout, or gotchas? → `README.md` updated.
- [ ] Does this change add/move/rename top-level directories or canonical commands? → `AGENTS.md` updated.
- [ ] Does this change introduce a non-obvious invariant or magic number? → inline TSDoc / comment added.
- [ ] Does this change cross a contract (schema / tool / event / prompt)? → every paired file updated in the same change.

If any answer is "no" when it should be "yes", the task is not complete.
