import path from 'node:path';
import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import type { RoleKey } from '@/lib/const/roles';
import { emit } from '@/lib/events/bus';
import {
  appendEvent,
  appendMessage,
  readArtifact,
  readState,
  writeArtifact,
  writeState,
} from '@/lib/workspace/fs';
import { softwareHouseDir, sourcePath } from '@/lib/workspace/paths';
import {
  readTicketsIndex,
  updateTicketEntry,
} from '@/lib/workspace/tickets';
import { writeSourceFile } from '@/lib/workspace/sources';
import type { TicketsIndexEntry, TicketStatus } from '@/lib/schemas/tickets';
import { appendReviewArtifactBlock, runAgentTurn, type AgentTurnResult } from '@/lib/agents/run';
import {
  validateDevEnvelope,
  validateReviewerEnvelope,
  type AgentEnvelope,
  type ReviewPayload,
} from '@/lib/agents/envelope';

const DEFAULT_MAX_ATTEMPTS_PER_TICKET = 6;

type SourceSnapshot = { path: string; content: string };

export type TicketOutcome = {
  status: TicketStatus;
  reason?: string;
};

export type ImplementSummary = {
  completed: string[];
  changesRequested: string[];
  blocked: string[];
  paused: boolean;
  reason?: string;
  steps: number;
};

export type ImplementOptions = {
  projectId: string;
  maxSteps?: number;
};

function getMaxAttemptsPerTicketFromEnv(): number {
  const raw = process.env.BUDGET_IMPLEMENT_ATTEMPTS_PER_TICKET;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_MAX_ATTEMPTS_PER_TICKET;
}

export async function resolveMaxAttemptsForProject(projectId: string): Promise<number> {
  try {
    const state = await readState(projectId);
    const fromState = state.limits?.implementAttemptsPerTicket;
    if (typeof fromState === 'number' && fromState > 0) {
      return Math.min(64, Math.floor(fromState));
    }
  } catch {
    // fall back to env default
  }
  return getMaxAttemptsPerTicketFromEnv();
}

const DEV_ROLES: readonly RoleKey[] = ['backend-dev', 'frontend-dev', 'devops'] as const;

export function isDevRole(role: RoleKey | null | undefined): role is 'backend-dev' | 'frontend-dev' | 'devops' {
  return !!role && (DEV_ROLES as readonly string[]).includes(role);
}

export function inferDevRoleFromTitle(title: string): 'backend-dev' | 'frontend-dev' | 'devops' {
  const lowered = title.toLowerCase();
  if (/(infra|docker|ci|pipeline|compose|script)/.test(lowered)) return 'devops';
  if (/(ui|component|page|frontend|screen|layout|style)/.test(lowered)) return 'frontend-dev';
  return 'backend-dev';
}

export function resolveAssigneeForTicket(ticket: TicketsIndexEntry): RoleKey {
  if (isDevRole(ticket.assigneeRole)) return ticket.assigneeRole;
  return inferDevRoleFromTitle(ticket.title);
}

// runs ONE developer turn for a ticket. Used by the software-house ticket-dev
// worker so many devs can be picking up tickets concurrently.
export async function runDevForTicketOnce(
  projectId: string,
  ticket: TicketsIndexEntry,
  maxAttemptsPerTicket: number,
): Promise<TicketOutcome | null> {
  const assignee = resolveAssigneeForTicket(ticket);
  if (!isDevRole(assignee)) {
    return {
      status: 'blocked',
      reason: `unsupported assignee role: ${ticket.assigneeRole ?? 'none'}`,
    };
  }

  const nextAttempt = (ticket.attempts ?? 0) + 1;
  await updateTicketStatus(projectId, ticket.code, 'in-progress', {
    attempts: nextAttempt,
    lastAttemptAt: new Date().toISOString(),
    pendingSourcePaths: null,
  });

  const ticketBody = await readArtifact(projectId, ticket.path);
  const priorFeedback = await readLatestReviewFeedback(projectId, ticket.code);

  const devTurn = await runAgentTurn({
    projectId,
    role: assignee,
    userPrompt: buildDevPrompt(ticket, ticketBody, priorFeedback),
    includeSpec: true,
    includeArchitecture: true,
    contextExtra: buildDevContextExtras(
      ticket,
      ticketBody,
      priorFeedback,
      nextAttempt,
      maxAttemptsPerTicket,
    ),
  });

  const devIssues = validateDevEnvelope(devTurn.envelope, assignee);
  if (devIssues.length > 0) {
    await appendLog(
      projectId,
      'warn',
      `dev envelope from ${assignee} for ${ticket.code} rejected: ${devIssues
        .map((i) => i.message)
        .join('; ')}`,
    );
    return maybeBlock(projectId, ticket, nextAttempt, 'dev envelope invalid', maxAttemptsPerTicket);
  }

  const writtenPaths = await applySourceWrites(projectId, assignee, devTurn.envelope, ticket.code);

  await updateTicketStatus(projectId, ticket.code, 'review', {
    pendingSourcePaths: writtenPaths,
  });

  return null;
}

// runs ONE reviewer turn for a ticket already in `review` status.
export async function runReviewForTicketOnce(
  projectId: string,
  ticket: TicketsIndexEntry,
  maxAttemptsPerTicket: number,
): Promise<TicketOutcome> {
  const paths = ticket.pendingSourcePaths ?? [];
  const sourceSnapshots = await loadPendingSourcesForReview(projectId, paths);
  const ticketBody = await readArtifact(projectId, ticket.path);
  const attempt = ticket.attempts ?? 1;

  const reviewerTurn = await runAgentTurn({
    projectId,
    role: 'reviewer',
    userPrompt: buildReviewerPrompt(ticket, paths, attempt),
    includeSpec: true,
    includeArchitecture: true,
    contextExtra: buildReviewerContextExtrasFromSnapshots(
      ticket,
      ticketBody,
      sourceSnapshots,
      attempt,
      maxAttemptsPerTicket,
    ),
  });

  const reviewerIssues = validateReviewerEnvelope(reviewerTurn.envelope);
  if (reviewerIssues.length > 0) {
    await appendLog(
      projectId,
      'warn',
      `reviewer envelope for ${ticket.code} rejected: ${reviewerIssues
        .map((i) => i.message)
        .join('; ')}`,
    );
    return maybeBlock(
      projectId,
      ticket,
      attempt,
      'reviewer envelope invalid',
      maxAttemptsPerTicket,
    );
  }

  return finalizeReview(projectId, ticket, attempt, reviewerTurn, maxAttemptsPerTicket);
}

async function finalizeReview(
  projectId: string,
  ticket: TicketsIndexEntry,
  attempt: number,
  reviewerTurn: AgentTurnResult,
  maxAttemptsPerTicket: number,
): Promise<TicketOutcome> {
  const review = reviewerTurn.envelope.review as ReviewPayload;
  const reviewPath = await materializeReviewArtifact(projectId, ticket, attempt, review, reviewerTurn.envelope);
  if (reviewPath) {
    await appendReviewArtifactBlock(projectId, reviewerTurn.message.id, reviewPath);
  }

  await appendEvent(
    emit({
      projectId,
      kind: 'review.posted',
      ticketCode: ticket.code,
      decision: review.decision,
      findings: review.findings.length,
      reviewPath: reviewPath ?? undefined,
    }),
  );

  if (review.decision === 'approve') {
    await updateTicketStatus(projectId, ticket.code, 'done', {
      reviewPath,
      pendingSourcePaths: null,
    });
    return { status: 'done' };
  }

  if (attempt >= maxAttemptsPerTicket) {
    await updateTicketStatus(projectId, ticket.code, 'blocked', {
      reviewPath,
      pendingSourcePaths: null,
    });
    return { status: 'blocked', reason: 'review budget exhausted' };
  }

  await updateTicketStatus(projectId, ticket.code, 'changes-requested', {
    reviewPath,
    pendingSourcePaths: null,
  });
  return { status: 'changes-requested' };
}

async function maybeBlock(
  projectId: string,
  ticket: TicketsIndexEntry,
  attempt: number,
  reason: string,
  maxAttemptsPerTicket: number,
): Promise<TicketOutcome> {
  if (attempt >= maxAttemptsPerTicket) {
    await updateTicketStatus(projectId, ticket.code, 'blocked', {
      pendingSourcePaths: null,
    });
    return { status: 'blocked', reason };
  }

  await updateTicketStatus(projectId, ticket.code, 'changes-requested', {
    pendingSourcePaths: null,
  });
  return { status: 'changes-requested', reason };
}

async function updateTicketStatus(
  projectId: string,
  code: string,
  status: TicketStatus,
  extra: Partial<TicketsIndexEntry> = {},
): Promise<void> {
  const updated = await updateTicketEntry(projectId, code, { status, ...extra });
  const attempts = updated?.tickets.find((t) => t.code === code)?.attempts;

  await appendEvent(
    emit({
      projectId,
      kind: 'ticket.status',
      code,
      status,
      attempts,
    }),
  );
}

async function applySourceWrites(
  projectId: string,
  role: RoleKey,
  envelope: AgentEnvelope,
  ticketCode: string,
): Promise<string[]> {
  const written: string[] = [];
  for (const write of envelope.sourceWrites) {
    try {
      const { bytes } = await writeSourceFile(projectId, write.path, write.content);
      await appendEvent(
        emit({
          projectId,
          kind: 'source.written',
          path: write.path,
          role,
          bytes,
          ticketCode,
        }),
      );
      written.push(write.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendLog(projectId, 'error', `source write failed for ${write.path}: ${message}`);
    }
  }
  return written;
}

async function loadPendingSourcesForReview(
  projectId: string,
  paths: string[] | null | undefined,
): Promise<SourceSnapshot[]> {
  if (!paths || paths.length === 0) return [];
  const out: SourceSnapshot[] = [];
  for (const rel of paths) {
    const abs = sourcePath(projectId, rel);
    try {
      const content = await fs.readFile(abs, 'utf8');
      out.push({ path: rel, content });
    } catch {
      out.push({
        path: rel,
        content: `// unreadable or missing on disk: ${rel}\n`,
      });
    }
  }
  return out;
}

async function materializeReviewArtifact(
  projectId: string,
  ticket: TicketsIndexEntry,
  attempt: number,
  review: ReviewPayload,
  envelope: AgentEnvelope,
): Promise<string | null> {
  const attemptedPath = `reviews/PR-${ticket.code}-review-attempt-${attempt}.md`;
  const reviewerWrite = envelope.writes.find((w) =>
    new RegExp(`reviews/PR-${ticket.code}-review`, 'i').test(w.path),
  );

  const narrative = reviewerWrite?.content ?? envelope.text;
  const content = renderReviewMarkdown(ticket, attempt, review, narrative);
  await writeArtifact(projectId, attemptedPath, content);
  return attemptedPath;
}

function renderReviewMarkdown(
  ticket: TicketsIndexEntry,
  attempt: number,
  review: ReviewPayload,
  narrative: string,
): string {
  const now = new Date().toISOString();
  const findings = review.findings
    .map(
      (f) =>
        `- **${f.severity.toUpperCase()}** \`${f.file}${f.line ? `:${f.line}` : ''}\` — ${f.note}`,
    )
    .join('\n');
  const evidence = review.evidence.map((e) => `- ${e}`).join('\n');

  return [
    '---',
    'role: reviewer',
    'phase: REVIEW',
    `ticket: ${ticket.code}`,
    `attempt: ${attempt}`,
    `timestamp: ${now}`,
    `status: ${review.decision}`,
    '---',
    '',
    `# Review for ${ticket.code} — ${ticket.title} (attempt ${attempt})`,
    '',
    narrative ? `${narrative}\n` : '',
    '## Findings',
    findings.length > 0 ? findings : '_(none)_',
    '',
    '## Evidence',
    evidence.length > 0 ? evidence : '_(none)_',
    '',
    '```json',
    JSON.stringify(
      {
        decision: review.decision,
        findings: review.findings,
        rerun: review.rerun,
        evidence: review.evidence,
      },
      null,
      2,
    ),
    '```',
    '',
  ].join('\n');
}

async function readLatestReviewFeedback(
  projectId: string,
  ticketCode: string,
): Promise<string | null> {
  const reviewsDir = path.join(softwareHouseDir(projectId), 'reviews');
  try {
    const entries = await fs.readdir(reviewsDir);
    const match = entries
      .filter((name) => name.includes(ticketCode) && name.endsWith('.md'))
      .sort()
      .at(-1);
    if (!match) return null;
    return await fs.readFile(path.join(reviewsDir, match), 'utf8');
  } catch {
    return null;
  }
}

export async function haltWithHelpNeeded(
  projectId: string,
  ticket: TicketsIndexEntry,
  reason: string,
  maxAttemptsPerTicket: number,
): Promise<void> {
  const now = new Date().toISOString();
  const content = [
    '---',
    'role: orchestrator',
    'phase: IMPLEMENT',
    `ticket: ${ticket.code}`,
    `timestamp: ${now}`,
    'status: help-needed',
    '---',
    '',
    `# Help needed on ${ticket.code} — ${ticket.title}`,
    '',
    `The IMPLEMENT loop exhausted its budget of ${maxAttemptsPerTicket} attempts without an \`approve\` review.`,
    '',
    '## Last known reason',
    '',
    `- ${reason}`,
    '',
    '## Suggested next steps',
    '',
    '- Inspect the latest review under `reviews/PR-<ticket>-review-attempt-N.md`.',
    '- Correct the failing code in-editor, or `@reviewer` in chat with a corrected spec.',
    '- Unpause the project from the chat header once ready.',
    '',
  ].join('\n');

  await writeArtifact(projectId, 'HELP_NEEDED.md', content);

  const state = await readState(projectId);
  await writeState({ ...state, paused: true });

  const chatText = [
    `⚠️ **Help needed — ${ticket.code}: ${ticket.title}**`,
    '',
    `The agent exhausted its budget of **${maxAttemptsPerTicket} attempts** without an approved review.`,
    '',
    `**Last failure:** ${reason}`,
    '',
    'Use the banner at the top of the page to retry, give the agent more attempts, or skip this ticket.',
  ].join('\n');

  const helpMessage = {
    id: nanoid(),
    projectId,
    threadId: 'master',
    author: { kind: 'role' as const, role: 'orchestrator' as const },
    text: chatText,
    blocks: [] as [],
    createdAt: now,
    phase: 'IMPLEMENT',
    meta: { streaming: false },
  };

  await appendMessage(helpMessage);
  await appendEvent(emit({ projectId, kind: 'message.created', message: helpMessage }));

  await appendEvent(
    emit({
      projectId,
      kind: 'pipeline.paused',
      reason,
      ticketCode: ticket.code,
    }),
  );
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

async function appendLog(projectId: string, level: LogLevel, message: string): Promise<void> {
  await appendEvent(emit({ projectId, kind: 'log', level, message }));
}

function buildDevPrompt(
  ticket: TicketsIndexEntry,
  ticketBody: string | null,
  priorFeedback: string | null,
): string {
  const feedbackNote = priorFeedback
    ? 'A prior review requested changes — address each finding before re-submitting.'
    : 'This is the first attempt on this ticket.';

  const devopsNote =
    ticket.assigneeRole === 'devops'
      ? 'You are @devops on this ticket: add or change **server/infra** code the product needs to run (e.g. `scripts/`, Docker, `docker-compose.yml`, `.github/`, env templates). The reviewer will approve or request changes like any other implementation ticket.'
      : '';

  return [
    `You are implementing ticket ${ticket.code}: ${ticket.title}.`,
    feedbackNote,
    devopsNote,
    '',
    'Output:',
    "- `sourceWrites[]`: one entry per source file you create or modify. Paths are relative to the project root and MUST fall inside your role's allow-list (typically `src/**`, `scripts/**`, `tests/**`, or the listed top-level configs).",
    '- `blocks[]`: one `diff` block per file with `before` and `after` so reviewers can see deltas at a glance. Use empty `before` for new files.',
    '- `writes[]`: optional; use only for `reviews/PR-<ticket>-desc.md` or other `.software-house/` artifacts.',
    '- `ticketCode`: set to the ticket you are implementing.',
    '- `text`: 2–4 sentences summarising the approach and any tests added.',
    '- Set `advance: false`.',
    '',
    ticketBody
      ? `## Ticket body\n\n${ticketBody}\n`
      : `Ticket file at ${ticket.path} could not be read.`,
    priorFeedback ? `\n## Latest review\n\n${priorFeedback}\n` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildDevContextExtras(
  ticket: TicketsIndexEntry,
  ticketBody: string | null,
  priorFeedback: string | null,
  attempt: number,
  maxAttemptsPerTicket: number,
): string {
  const parts: string[] = [];
  parts.push(`## Ticket under implementation (attempt ${attempt}/${maxAttemptsPerTicket})`);
  parts.push(
    `- code: ${ticket.code}\n- title: ${ticket.title}\n- assignee: ${ticket.assigneeRole ?? 'unassigned'}\n- dependsOn: ${ticket.dependsOn.join(', ') || '(none)'}`,
  );
  if (ticketBody) {
    parts.push('\n### Ticket body');
    parts.push('```markdown');
    parts.push(ticketBody);
    parts.push('```');
  }
  if (priorFeedback) {
    parts.push('\n### Latest review (address every finding)');
    parts.push('```markdown');
    parts.push(priorFeedback);
    parts.push('```');
  }
  return parts.join('\n');
}

function buildReviewerPrompt(ticket: TicketsIndexEntry, writtenPaths: string[], attempt: number): string {
  return [
    `Review the implementation of ticket ${ticket.code}: ${ticket.title}.`,
    '',
    'Output requirements (strict):',
    '- `review` (top-level): `{ decision: "approve" | "request-changes" | "block", findings: [...], rerun: boolean, evidence: ["files read", "commands run"] }`.',
    '- `review.evidence[]` MUST be non-empty; rubber-stamp approvals are rejected.',
    '- `review.findings[]` MUST cite file:line when requesting changes.',
    `- \`writes[]\`: optional; you may persist the narrative to \`reviews/PR-${ticket.code}-review-attempt-${attempt}.md\`.`,
    '- `ticketCode`: set to the ticket under review.',
    '- `text`: 1–3 sentences summarising the outcome.',
    '- Set `advance: false`.',
    '',
    writtenPaths.length > 0
      ? `Files changed this turn:\n${writtenPaths.map((p) => `- ${p}`).join('\n')}`
      : 'No source writes were applied this turn — investigate why.',
  ].join('\n');
}

function buildReviewerContextExtrasFromSnapshots(
  ticket: TicketsIndexEntry,
  ticketBody: string | null,
  sourceSnapshots: SourceSnapshot[],
  attempt: number,
  maxAttemptsPerTicket: number,
): string {
  const parts: string[] = [];
  parts.push(`## Review context (dev attempt ${attempt}/${maxAttemptsPerTicket})`);
  parts.push(`- ticket: ${ticket.code} — ${ticket.title}`);
  parts.push(
    `- files in scope: ${sourceSnapshots.length > 0 ? sourceSnapshots.map((s) => s.path).join(', ') : '(none)'}`,
  );

  if (ticketBody) {
    parts.push('\n### Ticket body');
    parts.push('```markdown');
    parts.push(ticketBody);
    parts.push('```');
  }

  if (sourceSnapshots.length > 0) {
    parts.push('\n### Current source on disk (latest dev submission)');
    for (const snap of sourceSnapshots) {
      parts.push(`\n#### ${snap.path}`);
      parts.push('```');
      parts.push(snap.content);
      parts.push('```');
    }
  }

  return parts.join('\n');
}

// legacy entry point: kicks the software house in IMPLEMENT mode and waits
// for the phase to settle or stall. Preserved so existing HTTP routes keep
// working without changes. The real parallel work is done by the workers.
export async function runImplementLoop(options: ImplementOptions): Promise<ImplementSummary> {
  const { runSoftwareHouseUntilPhaseLeaves } = await import('./software-house');
  return runSoftwareHouseUntilPhaseLeaves({
    projectId: options.projectId,
    waitForPhase: 'IMPLEMENT',
    reason: 'implement-loop',
  });
}
