---
name: reflect-skills
description: Reflect on session learnings, corrections, and patterns \u2014 then update existing skills/rules or propose new ones
allowed-tools: Bash(*)
compatibility: Requires file-system read/write access to .agent/skills/ and .agent/rules/
---

# /reflect-skills

Use this skill at the end of a session (or after a significant feature) to capture what was learned and feed it back into the project's rules and skills.

## Usage

```
/reflect-skills
```

---

## What This Skill Does

1. **Review session corrections** — what did the user correct, refine, or re-explain?
2. **Identify key learnings** — what new patterns, constraints, or conventions emerged?
3. **Compare against existing rules & skills** — walk `.agent/rules/` and `.agent/skills/`, plus `AGENTS.md`
4. **Propose improvements** — updates to existing rules/skills, or new ones to add
5. **Suggest automation** — any repeatable check that could become a script, hook, or tool

---

## Process

### Before Reviewing or Updating Skills

Refresh your understanding of the Agent Skills specification at <https://agentskills.io/specification> and the Cursor Rules format (front-matter: `description`, `globs`, `alwaysApply`). Make sure anything you add conforms.

### Review Steps

1. **Gather session context** — scroll back through the turn-by-turn corrections
2. **Check existing rules** — list `.agent/rules/` and read any file that overlaps a new learning
3. **Check existing skills** — list `.agent/skills/` and read any skill that could absorb the learning
4. **Check `AGENTS.md`** — decide whether the root instructions need an edit
5. **Identify gaps** — note where learnings don't fit into anything that already exists
6. **Propose updates** — draft the exact edits as a plan before applying them
7. **Suggest automation** — identify any check that could be scripted or hooked

---

## Output Format

Structure your response like this:

### Summary of Learnings

One paragraph. What were the main insights from this session?

### Proposed Rule / Skill Updates

| Target | Change type | Description |
| --- | --- | --- |
| `.agent/rules/general.md` | Update | Add rule about X because Y |
| `.agent/skills/commit/SKILL.md` | Update | Document Z pre-commit behaviour |
| `.agent/rules/new-topic.md` | Add | Capture pattern around … |

### Specific Changes

For each proposed change:

1. **Current state** — what the file says today
2. **Proposed change** — exact addition / edit
3. **Rationale** — why this change improves the workflow

### Automation Opportunities

- Script / hook name and purpose
- How it enforces or accelerates the learning
- Rough implementation approach

---

## Best Practices

- **Be specific** — articulate what was learned and why it matters
- **Build on existing conventions** — prefer updating an existing rule over creating a new one
- **Consider future projects** — if a learning is genuinely generic, express it generically
- **Balance detail and brevity** — enough context to act on, nothing more
- **Validate against the spec** — new skills must have valid front-matter and allowed tools

---

## Examples (L'Olympus flavour)

### Adding a New Rule

**Learning:** during the session, multiple changes to `server/mastra/prompts.ts` forgot to check that the tools referenced in the prompt were actually provided by `server/tools/index.ts`.

**Proposed:** extend `.agent/rules/docs-first.md` with a stricter cross-reference rule ("if you edit a role prompt, re-read `server/tools/index.ts`") — or, if the pattern keeps recurring, add a dedicated `.agent/rules/runtime-agent-surface.md`.

### Updating an Existing Skill

**Learning:** the `commit` skill was proposing scopes that did not match this repo's layout (e.g. `auth` for files under `server/daemon/`).

**Proposed:** update the scope-suggestion table in `.agent/skills/commit/SKILL.md` with any new directory added since the last refresh.

### Automation Opportunity

**Learning:** developers forget to update `.env.example` + `README.md` env-var section when adding a new `process.env.*` read.

**Proposed:** a small script under `scripts/` that diffs env reads in `server/` against `.env.example` and fails if any are missing. Wire it into a future pre-commit hook.

---

## When to Use This Skill

- At the end of a development session
- After completing a significant feature
- When noticing a pattern being corrected more than once
- When onboarding this template into a new project (to seed rules with context)

---

## Integration with Project Rules

This skill works in tandem with `.agent/rules/`:

- New rules live in `.agent/rules/` as their source of truth.
- `AGENTS.md` must reference new rules from the **Quick-Reference Rule TL;DR** section when they are important enough to require top-of-session context.
- The **Read-First Map** in `.agent/rules/docs-first.md` must be extended when a new area of the codebase becomes important to read before editing.
- If another agent surface (Cursor, Claude, Copilot) has its own rules folder, symlink it to `.agent/rules/` so edits propagate everywhere.

---

## Remember

The goal of this skill is continuous improvement:

1. Capture learnings from each session
2. Translate them into actionable rules and skills
3. Add automation where it prevents the next regression
4. Preserve institutional knowledge so the next session starts ahead of this one
