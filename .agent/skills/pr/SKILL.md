---
name: pr
description: Create L'Olympus pull requests with structured What/Why/How descriptions, Added/Modified change tables, and optional Testing sections
allowed-tools: Bash(gh:*), Bash(git:*), Bash(pnpm:*)
compatibility: Requires git and the GitHub CLI (gh). No `.github/CODEOWNERS` or `.github/pull_request_template.md` exist in this repo today.
---

# /pr

Create high-quality pull requests for L'Olympus with structured descriptions derived from the actual diff.

## Usage

```
/pr
/pr --draft
/pr --base <branch>
/pr --reviewers @user1,@user2
```

Arguments: `$ARGUMENTS`

---

## What This Skill Does

1. **Detect the base branch** — `gh repo view --json defaultBranchRef`. Default to that unless `--base` is given.
2. **Change analysis** — run `git status`, `git diff <base>...HEAD`, `git log <base>..HEAD`. Identify modified files, commits since divergence, breaking changes, new dependencies, schema changes, env-var additions.
3. **Local verification gate** — before creating a non-draft PR, confirm `pnpm typecheck` passes against the branch HEAD. If it fails and the user did not pass `--draft`, warn and ask.
4. **Title generation** — conventional-commit-style title (see format below).
5. **Description generation** — render from the template below, filling every section that applies.
6. **Issue linking** — parse the branch name for ticket IDs (`feat/ABC-123-thing`, `fix/#456-thing`) and insert the appropriate closing keyword.
7. **Create the PR** — push the branch (`git push -u origin HEAD`) then `gh pr create` with the generated title, body, and flags.

---

## Title Format

```
<type>(<scope>): <short imperative description>
```

Use the same scope suggestions as `.agent/skills/commit/SKILL.md`. Examples:

```
feat(prompts): tighten reviewer JSON contract
fix(daemon): prevent duplicate workforce spawns under HMR
refactor(tools): extract resolveInsideProject helper
docs: refactor .agent rules for L'Olympus
chore(deps): bump drizzle-orm to 0.37
db: add iteration column to olympus_tasks
```

Scope is optional but encouraged — infer from the dominant touched area.

---

## Description Template

The repo currently has no `.github/pull_request_template.md`. Use this structure:

```markdown
# Description

Short summary of what this PR changes (1–3 sentences).

**What**
- <bullet — what changed, 1–2 lines each>

**Why**
- <bullet — user / product / technical reason, 1–2 lines each>

**How**
- <bullet — high-level approach, 1–2 lines each>

# Changes

**Added**
- `path/to/new/file.ext` — short description
- `path/to/another/new-file.ext` — short description

**Modified**
- `path/to/existing/file.ext` — short description
- `path/to/another/existing.ext` — short description

<!-- omit unused subsections; exclude lockfile bumps unless they are the point of the PR -->

## Testing

<!-- include when reviewers need to reproduce -->
- Page / route to exercise: `/projects/<id>` (or the specific API endpoint)
- Steps:
  1. `pnpm dev`
  2. ...
  3. ...

## Breaking Changes

<!-- include only when applicable -->
- <describe the break and the migration path — DB schema / env var rename / tool removal / role removal>

## Dependencies

<!-- include only when new dependencies were added -->
- `package-name@version` — reason
```

**Keep the entire description short.** Bullets under What / Why / How should be 1–2 lines each. Exclude changeset / auto-generated metadata files from the Changes section.

---

## L'Olympus-Specific Description Guidance

| Change type | Always mention in description |
| --- | --- |
| New runtime role | Modified files: `server/const/roles.ts`, `server/mastra/prompts.ts`, `server/tools/index.ts`, `server/bootstrap.ts`, `README.md` |
| New runtime tool | Added file: `server/tools/<tool>.ts`; Modified: `server/tools/index.ts` + every role prompt that gets it |
| Schema change | Link the generated migration path under `server/db/migrations/`; note whether `pnpm db:push` is required |
| Env var change | Mirror the change in `.env.example` and `README.md` env-var section |
| Event bus change | Include the new event-type name and at least one consumer path |
| Prompt change | Summarise the behavioural intent (what the role will do differently) — reviewers cannot eyeball a prompt diff for impact |

---

## Issue Linking

Detect the ID from the branch name and insert the appropriate line near the top of the description:

| Branch pattern | Inserted line |
| --- | --- |
| `feat/ABC-123-…` | `Closes ABC-123` |
| `fix/#456-…` | `Fixes #456` |
| `hotfix/…` | *(none unless an ID is present)* |

If the project moves to Linear / Jira later, prefer the full URL so the tracker auto-links back.

---

## Reviewer Suggestions

No `.github/CODEOWNERS` exists today — do not auto-assign unless the user passes `--reviewers`. When provided, pass them via `gh pr create --reviewer`.

If CODEOWNERS is added later, GitHub will assign automatically — do not override it.

---

## Draft vs Ready

- Use `--draft` for early feedback, or when local verification has not passed yet.
- Use a ready PR when:
  - `pnpm typecheck` passes.
  - The change has been exercised per `.agent/rules/local-verification.md`.
  - `README.md` / `AGENTS.md` / inline TSDoc updates are in the same PR per `.agent/rules/documentation.md`.

---

## Command Flags

| Flag | Effect |
| --- | --- |
| `--draft` | Create the PR as a draft |
| `--base <branch>` | Override the detected base branch |
| `--reviewers <list>` | Comma-separated GitHub usernames / teams |

---

## Quality Checks Before Creating

Before calling `gh pr create`, verify:

- [ ] Branch is pushed and tracking `origin/<branch>`.
- [ ] Base branch is correct for this change.
- [ ] Title matches conventional-commit format.
- [ ] Description has `# Description` (with What / Why / How) and `# Changes` (Added / Modified) at minimum.
- [ ] Breaking changes documented (if any).
- [ ] New dependencies listed (if any).
- [ ] Documentation updates are in this PR or explicitly not applicable.
- [ ] No secrets or `.env` files staged.
- [ ] `workspaces/`, `.react-router/`, `build/` are not in the diff.

---

## Post-Create

After the PR is created:

1. Print the PR URL so the user can open it.
2. Optionally run `gh pr checks` once (currently not useful — no CI configured — but cheap to attempt).
3. Surface any immediate blockers (stale branch, merge conflicts) so the user can react.

---

## Notes

- Never `git push --force` to `main` / `master` / `develop`; warn the user if they request it.
- Never update `git config` as part of this flow.
- If the PR title / description needs manual tweaking after creation, prefer `gh pr edit` over opening a new PR.
