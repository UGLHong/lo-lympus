import type { RoleKey } from '@/lib/const/roles';
import { getRoleDefinition } from './roles';

const ENVELOPE_SPEC = `
# Output format — STRICT

You must reply with a single JSON object (no prose, no markdown fences). The object has the shape:

{
  "text": "concise natural-language message shown to the human (markdown ok, 1-3 short paragraphs)",
  "blocks": [
    // zero or more content blocks. Each block is one of the following shapes.
    { "kind": "artifact", "title": "...", "path": ".software-house/SPEC.md", "artifactKind": "spec",
      "phase": "SPEC", "role": "pm", "status": "review-requested", "excerpt": "one-sentence summary" },
    { "kind": "question", "id": "q1", "question": "Which database?", "options": [
        { "id": "postgres", "label": "PostgreSQL", "isDefault": true },
        { "id": "sqlite", "label": "SQLite (local file)" }
      ], "allowFreeText": true },
    { "kind": "gate", "fromPhase": "SPEC", "toPhase": "ARCHITECT", "decision": "pending",
      "checks": [ { "label": "SPEC.md has acceptance criteria", "ok": true } ] },
    { "kind": "tool-call", "tool": "fs.write", "args": { "path": ".software-house/SPEC.md" },
      "resultSummary": "wrote 3.2KB", "ok": true },
    { "kind": "ticket", "code": "T-0001", "title": "Implement login form", "assigneeRole": "frontend-dev",
      "dependsOn": [], "status": "todo" }
  ],
  "writes": [
    // markdown artifacts to persist to the workspace; path is relative to .software-house/
    { "path": "SPEC.md", "content": "---\\nrole: pm\\nphase: SPEC\\n...\\n---\\n# SPEC\\n..." }
  ],
  "sourceWrites": [
    // DEV ROLES ONLY (backend-dev, frontend-dev, devops, writer).
    // Source files for the generated product; paths relative to the project root,
    // must fall inside the role's allow-list (typically src/**, scripts/**, tests/**).
    { "path": "src/index.ts", "content": "export function main() { /* ... */ }" }
  ],
  "review": {
    // REVIEWER ROLE ONLY. Required on every reviewer turn.
    "decision": "approve" | "request-changes" | "block",
    "findings": [{ "severity": "low"|"med"|"high", "file": "src/x.ts", "line": 42, "note": "..." }],
    "rerun": false,
    "evidence": ["read src/x.ts", "ran pnpm test"]  // MUST be non-empty
  },
  "ticketCode": "T-0001",    // dev + reviewer turns: identify the ticket under work
  "advance": false           // set true only when this turn completes the current phase
}

Rules:
- Output ONLY that JSON object. No prose before or after.
- \`writes[].content\` MUST start with YAML front-matter containing \`role\`, \`phase\`, \`timestamp\`, and \`status\`.
- \`writes[]\` paths are relative to \`.software-house/\` and must NOT contain \`..\` or absolute paths.
- \`sourceWrites[]\` paths are relative to the project root and must NOT start with \`.software-house/\`.
- Reviewer \`review.evidence[]\` MUST be non-empty; rubber-stamp approvals are rejected.
- If you need to ask the human something, emit a \`question\` block instead of asking in \`text\`.
- Cite file:line where appropriate inside \`text\` or artifact bodies.
- Keep \`text\` short — the artifact body is the real deliverable.
`;

export function buildSystemPrompt(role: RoleKey): string {
  const definition = getRoleDefinition(role);
  return [
    `# Role: ${role}`,
    '',
    '## Mission',
    definition.mission,
    '',
    '## Inputs (must read before acting)',
    ...definition.inputs.map((input) => `- ${input}`),
    '',
    '## Deliverable',
    definition.deliverable,
    '',
    '## Done criteria',
    ...definition.doneCriteria.map((criterion) => `- [ ] ${criterion}`),
    '',
    '## Never',
    ...definition.never.map((rule) => `- ${rule}`),
    '',
    '## Style',
    '- Concise, bullet-first, no filler',
    '- Cite file:line for code claims',
    '- Mermaid over prose for graphs',
    '',
    ENVELOPE_SPEC,
  ].join('\n');
}

type ContextParams = {
  state: string;
  requirements?: string | null;
  spec?: string | null;
  architecture?: string | null;
  extra?: string;
};

export function buildContextBlock(params: ContextParams): string {
  const parts: string[] = [];
  parts.push('## Current project state (.software-house/state.json)');
  parts.push('```json');
  parts.push(params.state);
  parts.push('```');

  if (params.requirements) {
    parts.push('\n## REQUIREMENTS.md');
    parts.push('```markdown');
    parts.push(params.requirements);
    parts.push('```');
  }

  if (params.spec) {
    parts.push('\n## SPEC.md');
    parts.push('```markdown');
    parts.push(params.spec);
    parts.push('```');
  }

  if (params.architecture) {
    parts.push('\n## ARCHITECTURE.md');
    parts.push('```markdown');
    parts.push(params.architecture);
    parts.push('```');
  }

  if (params.extra) {
    parts.push('');
    parts.push(params.extra);
  }

  return parts.join('\n');
}
