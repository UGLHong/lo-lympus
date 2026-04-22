---
name: commit
description: Create well-formatted commits using emoji conventional-commit messages, with change analysis and atomic-commit splitting
allowed-tools: Bash(git:*), Bash(pnpm:*), Bash(*)
compatibility: Tailored for L'Olympus — pnpm, eslint + tsc, no pre-commit hooks (yet)
---

# /commit

Create well-formatted commits for L'Olympus with conventional-commit messages and emoji.

## Usage

```
/commit
```

With options:

```
/commit --no-verify                # skip pre-commit checks (typecheck + lint)
/commit --message "<preset text>"  # use caller-supplied message verbatim
```

Arguments: `$ARGUMENTS`

---

## What This Skill Does

1. **Pre-commit checks** (unless `--no-verify`):
   - `pnpm typecheck` — runs `react-router typegen && tsc --noEmit`. Must pass.
   - `pnpm lint` — eslint; currently ends with `|| true`, so it won't block the commit, but you MUST read the output and fix any new warning you introduced.
2. **Stage analysis** — `git status` and `git diff --staged`. If nothing is staged, stage all modified + new files with `git add -A`, excluding `workspaces/`, `.react-router/`, `build/`.
3. **Scope analysis** — review the diff to decide whether the changes form one atomic commit or several.
4. **Atomic splitting** — if multiple distinct concerns are present, propose a split and commit each group separately.
5. **Message generation** — for each commit, produce a message in emoji conventional-commit format (see below).

---

## L'Olympus-Specific Commit Guidance

- **Never commit `workspaces/` content.** That directory is agent output. If it somehow got staged, unstage it before the commit.
- **Never commit real secrets.** `.env` is gitignored; `.env.example` is not — only changes to `.env.example` should ever be staged for config changes.
- **Scope suggestions** — pick the smallest accurate scope:

| Area touched | Suggested scope |
| --- | --- |
| Role prompts (`server/mastra/prompts.ts`) | `prompts` |
| Runtime tools (`server/tools/`) | `tools` |
| Role registry / tiers (`server/const/roles.ts`) | `roles` |
| Daemon loop / execute (`server/daemon/`) | `daemon` |
| Drizzle schema / queries (`server/db/`) | `db` |
| API routes (`app/routes/api.*`) | `api` |
| UI routes / pages (`app/routes/*.tsx`) | `ui` |
| Components (`app/components/`) | the component area, e.g. `kanban`, `office`, `editor`, `hitl`, `terminal` |
| Event bus / SSE | `events` |
| Agent rules / skills (`.agent/`) | `agent` |
| Root docs (`README.md` / `AGENTS.md`) | `docs` |
| Build / tsconfig / tailwind / vite config | `tooling` |

---

## Commit Message Format

```
<type>(<scope>): <emoji> <short imperative description>
```

- Present tense, imperative — "add", not "added".
- Under 72 characters on the first line.
- Optional body after a blank line for context (use sparingly — the diff should speak for itself).

### Types

- `feat` — new feature
- `fix` — bug fix
- `docs` — documentation only
- `style` — formatting / whitespace (no logic change)
- `refactor` — code change that neither fixes a bug nor adds a feature
- `perf` — performance improvement
- `test` — add / fix tests
- `chore` — tooling, build, config, dependencies
- `ci` — CI / CD configuration
- `revert` — revert a previous commit

### Type → Emoji Cheat Sheet

| Type | Emoji | Notes |
| --- | --- | --- |
| `feat` | ✨ | new feature |
| `feat` | 🏷️ | add/update types |
| `feat` | 👔 | business logic |
| `feat` | 🦺 | input validation |
| `feat` | 🔊 | add logs |
| `feat` | 💬 | user-facing copy |
| `feat` | 🚩 | feature flags |
| `feat` | 💥 | breaking change |
| `fix` | 🐛 | bug fix |
| `fix` | 🚑️ | critical hotfix |
| `fix` | 🩹 | minor non-critical fix |
| `fix` | 🚨 | fix lint/compiler warnings |
| `fix` | 💚 | fix CI build |
| `fix` | 🔒️ | security |
| `fix` | 🥅 | error handling |
| `fix` | 🔥 | remove code/files |
| `fix` | 🔇 | remove logs |
| `fix` | ✏️ | typo |
| `refactor` | ♻️ | general refactor |
| `refactor` | 🚚 | move / rename |
| `refactor` | 🏗️ | architectural change |
| `refactor` | ⚰️ | remove dead code |
| `perf` | ⚡️ | performance |
| `style` | 💄 | UI formatting |
| `style` | 🎨 | code structure / format |
| `docs` | 📝 | documentation |
| `docs` | 💡 | source comments |
| `chore` | 🔧 | tooling / config |
| `chore` | 📦 | packages / compiled files |
| `chore` | ➕ / ➖ | add / remove dependency |
| `chore` | 📌 | pin dependency |
| `chore` | 🌱 | seed data |
| `chore` | 🔀 | merge branches |
| `chore` | 🎉 | initial commit |
| `chore` | 🔖 | release / version tag |
| `chore` | 🙈 | `.gitignore` changes |
| `ci` | 🚀 | CI/CD improvement |
| `ci` | 👷 | CI build system |
| `db` | 🗃️ | database / schema |
| `assets` | 🍱 | assets |
| `ui` | 💫 | animations / transitions |
| `revert` | ⏪️ | revert |

---

## Splitting Commits

Split the diff into multiple commits when any of these apply:

1. **Different concerns** — e.g. a prompt change + a UI change + a schema change.
2. **Different types** — don't mix feat / fix / refactor in one commit.
3. **File-pattern mismatch** — source vs docs vs config vs agent-rules in one commit.
4. **Logical grouping** — easier to review as separate commits.
5. **Size** — very large diffs benefit from segmentation.

Each resulting commit should be **atomic**: self-contained, buildable, and describable in one sentence.

---

## Examples

Single commit:

```
feat(prompts): ✨ add reviewer JSON contract enforcement
fix(daemon): 🐛 handle EmptyAgentOutputError on retry
refactor(tools): ♻️ extract resolveInsideProject helper
docs: 📝 refactor AGENTS.md and .agent/rules for L'Olympus
chore(deps): ➕ add tailwind-merge for className composition
db: 🗃️ add iteration column to olympus_tasks
```

Split into atomic commits (agent-surface change):

```
1) feat(roles): ✨ add "architect" role registry entries
2) feat(prompts): ✨ add architect role prompt
3) feat(tools): 🔧 wire architect role in buildToolsForRole
4) docs: 📝 document architect role in README layout
```

---

## Pre-Commit Hook Awareness

**This repo does not currently use Husky, lefthook, or `pre-commit`.** There is no automatic enforcement on `git commit`.

That means:

- You are personally responsible for running `pnpm typecheck` before committing.
- You are personally responsible for reading `pnpm lint` output and not introducing new warnings.
- Trailing-newline conventions are not enforced automatically — still add one at EOF (standard Unix convention).

If hooks are added later (Husky + lint-staged is the most likely path), this section will need an update — see `.agent/rules/documentation.md`.

---

## Important Notes

- Pre-commit checks run by default unless `--no-verify` is passed.
- If specific files are already staged, only those files are committed.
- The message is always constructed from the **actual diff**, not assumptions.
- Always review the diff before finalising the message.
- Never `git commit --amend` on a commit you didn't create this session, or one that has been pushed, unless the user explicitly asks.
- Never stage `workspaces/`, `.react-router/`, `build/`, or `node_modules/`.
