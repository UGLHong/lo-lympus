import type { RoleKey } from '@/lib/const/roles';
import type { Phase } from '@/lib/const/phases';
import { PHASE_REVIEW_ATTEMPTS_BUDGET } from '@/lib/const/phase-roles';
import { emit } from '@/lib/events/bus';
import {
  appendEvent,
  readArtifact,
  readState,
  writeArtifact,
  writeState,
} from '@/lib/workspace/fs';
import { runAgentTurn } from '@/lib/agents/run';
import {
  deriveTicketsIndex,
  readTicketsIndex,
  writeTicketsIndex,
} from '@/lib/workspace/tickets';
import type { TicketBlock } from '@/lib/schemas/content-blocks';
import { runBringupRuntimeStage } from '@/lib/workspace/bringup-runtime';
import { runQaPlaywrightBundledHarness } from '@/lib/workspace/qa';
import {
  resolveMaxAttemptsForProject,
  runDevForTicketOnce,
  runReviewForTicketOnce,
  haltWithHelpNeeded,
} from './implement';
import {
  materializeIncidentsIndex,
  runOneIncidentHeal,
  resolveDispatchRole,
  escalateIncidentToHuman,
  isDispatchableRole,
} from './selfHeal';
import {
  readIncidentsIndex,
  updateIncidentEntry,
} from '@/lib/workspace/incidents';
import { enqueueTask, type BacklogTask, type TaskKind } from './backlog';
import {
  markPhaseApproved,
  shouldPhaseBeReviewed,
} from './phase-approvals';

// outcome returned to the worker runtime. `advancedPhase` tells the
// supervisor to try promoting to the next phase immediately rather than
// waiting for the idle buffer (e.g. PM turn with advance: true).
export type TaskHandlerOutcome = {
  advanceRequest: boolean;
  awaitingHuman: boolean;
  parseError: boolean;
};

const NEUTRAL_OUTCOME: TaskHandlerOutcome = {
  advanceRequest: false,
  awaitingHuman: false,
  parseError: false,
};

type HandlerContext = {
  task: BacklogTask;
};

type Handler = (ctx: HandlerContext) => Promise<TaskHandlerOutcome>;

export async function runTaskHandler(task: BacklogTask): Promise<TaskHandlerOutcome> {
  const handler = HANDLERS[task.kind];
  if (!handler) {
    await appendEvent(
      emit({
        projectId: task.projectId,
        kind: 'log',
        level: 'error',
        message: `no handler for task kind ${task.kind}`,
      }),
    );
    return NEUTRAL_OUTCOME;
  }
  return handler({ task });
}

const HANDLERS: Record<BacklogTask['kind'], Handler> = {
  'orchestrator-intake': handleOrchestratorIntake,
  'orchestrator-clarify': (ctx) =>
    runSinglePhaseTurn(ctx, 'CLARIFY', 'orchestrator'),
  'pm-spec': (ctx) => runSinglePhaseTurn(ctx, 'SPEC', 'pm', { includeSpec: true }),
  'architect-design': (ctx) =>
    runSinglePhaseTurn(ctx, 'ARCHITECT', 'architect', { includeSpec: true }),
  'techlead-plan': handleTechleadPlan,
  'phase-review': handlePhaseReview,
  'ticket-dev': handleTicketDev,
  'ticket-review': handleTicketReview,
  'devops-bringup': handleDevopsBringup,
  'qa-plan': handleQaPlan,
  'incident-triage': handleIncidentTriage,
  'incident-heal': handleIncidentHeal,
  'security-review': (ctx) =>
    runSinglePhaseTurn(ctx, 'SECURITY', 'security', { includeSpec: true, includeArchitecture: true }),
  'release-notes': (ctx) =>
    runSinglePhaseTurn(ctx, 'RELEASE', 'release', { includeSpec: true }),
  'writer-demo': (ctx) =>
    runSinglePhaseTurn(ctx, 'DEMO', 'writer', { includeSpec: true }),
};

type SingleTurnOptions = {
  includeSpec?: boolean;
  includeArchitecture?: boolean;
  extraContext?: string;
};

async function runSinglePhaseTurn(
  ctx: HandlerContext,
  phase: Phase,
  role: RoleKey,
  options: SingleTurnOptions = {},
): Promise<TaskHandlerOutcome> {
  const { task } = ctx;
  const feedback = extractReviewFeedback(task);
  const extraContext = composeExtraContext(options.extraContext, feedback);

  const turn = await runAgentTurn({
    projectId: task.projectId,
    role,
    userPrompt: buildPromptForPhase(phase, task.humanMessage ?? undefined, feedback),
    includeSpec: options.includeSpec,
    includeArchitecture: options.includeArchitecture,
    contextExtra: extraContext,
  });

  const awaitingHuman = turn.message.blocks.some((block) => block.kind === 'question');
  return finalizeRoleTurn({
    task,
    phase,
    role,
    turnAdvance: turn.advance,
    awaitingHuman,
    parseError: Boolean(turn.envelope.parseError),
  });
}

// INTAKE is a one-shot phase: the orchestrator captures the raw requirement
// and asks clarifications, then we immediately promote to CLARIFY where the
// human reply flows in. No review gate here — CLARIFY is where the final
// REQUIREMENTS.md gets a reviewer pass.
async function handleOrchestratorIntake(ctx: HandlerContext): Promise<TaskHandlerOutcome> {
  const { task } = ctx;
  const turn = await runAgentTurn({
    projectId: task.projectId,
    role: 'orchestrator',
    userPrompt: buildPromptForPhase('INTAKE', task.humanMessage ?? undefined),
  });

  return {
    advanceRequest: true,
    awaitingHuman: false,
    parseError: Boolean(turn.envelope.parseError),
  };
}

async function handleTechleadPlan(ctx: HandlerContext): Promise<TaskHandlerOutcome> {
  const { task } = ctx;
  const feedback = extractReviewFeedback(task);

  const turn = await runAgentTurn({
    projectId: task.projectId,
    role: 'techlead',
    userPrompt: buildPromptForPhase('PLAN', task.humanMessage ?? undefined, feedback),
    includeSpec: true,
    includeArchitecture: true,
    contextExtra: composeExtraContext(undefined, feedback),
  });

  const ticketBlocks = turn.message.blocks.filter(
    (block): block is TicketBlock => block.kind === 'ticket',
  );

  if (ticketBlocks.length > 0) {
    const previous = await readTicketsIndex(task.projectId);
    const index = await deriveTicketsIndex(task.projectId, {
      ticketBlocks,
      previous,
    });
    if (index.tickets.length > 0) {
      await writeTicketsIndex(index);
      await appendEvent(
        emit({
          projectId: task.projectId,
          kind: 'ticket.index.updated',
          count: index.tickets.length,
        }),
      );
    }
  }

  const awaitingHuman = turn.message.blocks.some((block) => block.kind === 'question');
  return finalizeRoleTurn({
    task,
    phase: 'PLAN',
    role: 'techlead',
    turnAdvance: turn.advance,
    awaitingHuman,
    parseError: Boolean(turn.envelope.parseError),
  });
}

// decides what happens after a role turn on a review-gated phase:
// - awaitingHuman → wait for human, no advance
// - advance + no questions → enqueue phase-review instead of advancing
// - no advance → hold position, supervisor decides based on idle buffer
function finalizeRoleTurn(input: {
  task: BacklogTask;
  phase: Phase;
  role: RoleKey;
  turnAdvance: boolean;
  awaitingHuman: boolean;
  parseError: boolean;
}): TaskHandlerOutcome {
  const { task, phase, turnAdvance, awaitingHuman, parseError } = input;

  if (awaitingHuman) {
    return { advanceRequest: false, awaitingHuman: true, parseError };
  }

  if (!turnAdvance) {
    return { advanceRequest: false, awaitingHuman: false, parseError };
  }

  if (!shouldPhaseBeReviewed(phase)) {
    return { advanceRequest: true, awaitingHuman: false, parseError };
  }

  const attempt = Number(task.payload.attempt ?? 1);
  enqueueTask({
    projectId: task.projectId,
    kind: 'phase-review',
    role: 'reviewer',
    phase,
    payload: { targetPhase: phase, attempt },
  });
  return { advanceRequest: false, awaitingHuman: false, parseError };
}

async function handlePhaseReview(ctx: HandlerContext): Promise<TaskHandlerOutcome> {
  const { task } = ctx;
  const targetPhase = (task.payload.targetPhase as Phase | undefined) ?? task.phase;
  const attempt = Number(task.payload.attempt ?? 1);

  const artifactsContext = await loadPhaseArtifactsForReview(task.projectId, targetPhase);
  const reviewPrompt = buildPhaseReviewPrompt(targetPhase, attempt);

  const turn = await runAgentTurn({
    projectId: task.projectId,
    role: 'reviewer',
    userPrompt: reviewPrompt,
    includeSpec: targetPhase !== 'CLARIFY',
    includeArchitecture: targetPhase === 'PLAN',
    contextExtra: artifactsContext,
  });

  const review = turn.envelope.review;
  const decision = review?.decision ?? 'request-changes';
  const findings = Array.isArray(review?.findings) ? review.findings : [];

  await writePhaseReviewArtifact(task.projectId, targetPhase, attempt, decision, findings);

  await appendEvent(
    emit({
      projectId: task.projectId,
      kind: 'review.posted',
      ticketCode: `PHASE:${targetPhase}`,
      decision: decision === 'block' ? 'request-changes' : decision,
      findings: findings.length,
    }),
  );

  if (decision === 'approve') {
    markPhaseApproved(task.projectId, targetPhase);
    return { advanceRequest: true, awaitingHuman: false, parseError: false };
  }

  if (attempt >= PHASE_REVIEW_ATTEMPTS_BUDGET) {
    await haltPhaseForHelp(task.projectId, targetPhase, attempt, findings);
    return { advanceRequest: false, awaitingHuman: true, parseError: false };
  }

  const nextAttempt = attempt + 1;
  const primary = primaryTaskForPhase(targetPhase);
  if (primary) {
    enqueueTask({
      projectId: task.projectId,
      kind: primary.kind,
      role: primary.role,
      phase: targetPhase,
      payload: {
        attempt: nextAttempt,
        reviewFeedback: renderFindingsForRole(findings),
      },
    });
  }
  return { advanceRequest: false, awaitingHuman: false, parseError: false };
}

function primaryTaskForPhase(
  phase: Phase,
): { kind: TaskKind; role: RoleKey } | null {
  switch (phase) {
    case 'CLARIFY':
      return { kind: 'orchestrator-clarify', role: 'orchestrator' };
    case 'SPEC':
      return { kind: 'pm-spec', role: 'pm' };
    case 'ARCHITECT':
      return { kind: 'architect-design', role: 'architect' };
    case 'PLAN':
      return { kind: 'techlead-plan', role: 'techlead' };
    default:
      return null;
  }
}

function extractReviewFeedback(task: BacklogTask): string | undefined {
  const raw = task.payload.reviewFeedback;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function composeExtraContext(
  base: string | undefined,
  feedback: string | undefined,
): string | undefined {
  if (!base && !feedback) return undefined;
  const sections: string[] = [];
  if (feedback) {
    sections.push(
      `## Reviewer feedback to address\n\n${feedback}\n\nRespond by revising the artifact so every finding is resolved, then set \`advance: true\` so the reviewer can re-check.`,
    );
  }
  if (base) sections.push(base);
  return sections.join('\n\n');
}

function renderFindingsForRole(findings: readonly unknown[]): string {
  if (findings.length === 0) {
    return 'Reviewer requested changes but provided no structured findings. Ask the reviewer for more detail or emit a `question` block to the human.';
  }
  return findings
    .map((entry, index) => {
      if (typeof entry === 'string') return `${index + 1}. ${entry}`;
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        const severity = record.severity ? `[${String(record.severity)}] ` : '';
        const location = record.file
          ? ` (${String(record.file)}${record.line ? `:${String(record.line)}` : ''})`
          : '';
        const note = String(
          record.note ?? record.summary ?? record.message ?? 'finding',
        );
        const evidence = record.evidence ? `\n   evidence: ${String(record.evidence)}` : '';
        return `${index + 1}. ${severity}${note}${location}${evidence}`;
      }
      return `${index + 1}. ${String(entry)}`;
    })
    .join('\n');
}

const PHASE_ARTIFACT_MAP: Record<string, readonly string[]> = {
  CLARIFY: ['REQUIREMENTS.md'],
  SPEC: ['SPEC.md'],
  ARCHITECT: ['ARCHITECTURE.md'],
  PLAN: ['PLAN.md'],
};

async function loadPhaseArtifactsForReview(
  projectId: string,
  phase: Phase,
): Promise<string> {
  const primaryPaths = PHASE_ARTIFACT_MAP[phase] ?? [];
  const sections: string[] = [];

  for (const relative of primaryPaths) {
    const body = await readArtifact(projectId, relative);
    sections.push(formatArtifactSection(relative, body));
  }

  if (phase === 'ARCHITECT') {
    const adrFiles = await listArtifactFiles(projectId, 'adr');
    for (const file of adrFiles) {
      const body = await readArtifact(projectId, file);
      sections.push(formatArtifactSection(file, body));
    }
  }

  if (phase === 'PLAN') {
    const ticketFiles = await listArtifactFiles(projectId, 'tickets');
    for (const file of ticketFiles) {
      const body = await readArtifact(projectId, file);
      sections.push(formatArtifactSection(file, body));
    }
  }

  if (sections.length === 0) {
    return `No artifacts found on disk for phase ${phase}.`;
  }

  return [
    `## Artifacts produced in phase ${phase}`,
    'Review each file below. Approve only when the content is complete, internally consistent, and ready for the next phase. Cite specific sections when requesting changes.',
    '',
    sections.join('\n\n'),
  ].join('\n');
}

async function listArtifactFiles(
  projectId: string,
  directory: string,
): Promise<string[]> {
  const { readArtifactTree } = await import('@/lib/workspace/fs');
  const tree = await readArtifactTree(projectId);
  const folder = tree.find((entry) => entry.isDir && entry.name === directory);
  if (!folder?.children) return [];
  return folder.children
    .filter((entry) => !entry.isDir && entry.name.endsWith('.md'))
    .map((entry) => entry.relativePath);
}

function formatArtifactSection(relativePath: string, body: string | null): string {
  if (!body) return `### ${relativePath}\n\n(missing on disk)`;
  return `### ${relativePath}\n\n\`\`\`markdown\n${body}\n\`\`\``;
}

function buildPhaseReviewPrompt(phase: Phase, attempt: number): string {
  const roleLabel = reviewRoleLabelForPhase(phase);
  return [
    `You are the Reviewer. Attempt #${attempt} for phase ${phase}.`,
    `The ${roleLabel} just produced the artifacts listed in context. Read them carefully.`,
    'Output:',
    '- Emit a single `review` envelope with fields `{ decision, findings, evidence?, rerun }`.',
    '  - `decision: "approve"` only when the artifact is complete, coherent, and ready for the next phase. No TODOs, no open questions left unanswered, no obvious gaps vs. the upstream artifacts.',
    '  - `decision: "request-changes"` otherwise. Populate `findings[]` with concrete, actionable bullet points the producer can address on the next iteration. Cite file paths and section names.',
    '- Do NOT rewrite the artifact yourself. Your job is to audit.',
    '- Set `advance: false`. Phase advancement is handled by the supervisor based on your decision.',
  ].join('\n');
}

function reviewRoleLabelForPhase(phase: Phase): string {
  switch (phase) {
    case 'CLARIFY':
      return 'Orchestrator (requirement gathering)';
    case 'SPEC':
      return 'Product Manager';
    case 'ARCHITECT':
      return 'Architect';
    case 'PLAN':
      return 'Tech Lead';
    default:
      return String(phase);
  }
}

async function writePhaseReviewArtifact(
  projectId: string,
  phase: Phase,
  attempt: number,
  decision: string,
  findings: readonly unknown[],
): Promise<void> {
  const timestamp = new Date().toISOString();
  const body = [
    '---',
    'role: reviewer',
    `phase: ${phase}`,
    `attempt: ${attempt}`,
    `decision: ${decision}`,
    `timestamp: ${timestamp}`,
    '---',
    '',
    `# Phase review — ${phase} (attempt ${attempt})`,
    '',
    `**Decision:** ${decision}`,
    '',
    '## Findings',
    '',
    findings.length > 0
      ? renderFindingsForRole(findings)
      : '_no findings_',
    '',
  ].join('\n');

  await writeArtifact(
    projectId,
    `reviews/PHASE-${phase}-attempt-${attempt}-review.md`,
    body,
  );
}

async function haltPhaseForHelp(
  projectId: string,
  phase: Phase,
  attempts: number,
  findings: readonly unknown[],
): Promise<void> {
  const state = await readState(projectId);
  if (state.paused) return;

  await writeState({ ...state, paused: true });

  await writeArtifact(
    projectId,
    'HELP_NEEDED.md',
    [
      '---',
      'role: reviewer',
      `phase: ${phase}`,
      `attempts: ${attempts}`,
      '---',
      '',
      `# Help needed — ${phase} phase review stuck`,
      '',
      `Reviewer requested changes on ${attempts} successive attempts. Human intervention required to unblock.`,
      '',
      '## Latest findings',
      '',
      findings.length > 0 ? renderFindingsForRole(findings) : '_no findings_',
      '',
    ].join('\n'),
  );

  await appendEvent(
    emit({
      projectId,
      kind: 'log',
      level: 'warn',
      message: `phase ${phase} paused — reviewer blocked after ${attempts} attempts`,
    }),
  );
}

async function handleTicketDev(ctx: HandlerContext): Promise<TaskHandlerOutcome> {
  const { task } = ctx;
  const ticketCode = String(task.payload.ticketCode ?? '');
  if (!ticketCode) return NEUTRAL_OUTCOME;

  const index = await readTicketsIndex(task.projectId);
  const ticket = index?.tickets.find((t) => t.code === ticketCode);
  if (!ticket) return NEUTRAL_OUTCOME;

  const maxAttempts = await resolveMaxAttemptsForProject(task.projectId);
  const outcome = await runDevForTicketOnce(task.projectId, ticket, maxAttempts);

  if (outcome?.status === 'blocked') {
    await haltWithHelpNeeded(
      task.projectId,
      ticket,
      outcome.reason ?? 'unknown',
      maxAttempts,
    );
  }
  return NEUTRAL_OUTCOME;
}

async function handleTicketReview(ctx: HandlerContext): Promise<TaskHandlerOutcome> {
  const { task } = ctx;
  const ticketCode = String(task.payload.ticketCode ?? '');
  if (!ticketCode) return NEUTRAL_OUTCOME;

  const index = await readTicketsIndex(task.projectId);
  const ticket = index?.tickets.find((t) => t.code === ticketCode);
  if (!ticket || ticket.status !== 'review') return NEUTRAL_OUTCOME;

  const maxAttempts = await resolveMaxAttemptsForProject(task.projectId);
  const outcome = await runReviewForTicketOnce(task.projectId, ticket, maxAttempts);

  if (outcome.status === 'blocked') {
    await haltWithHelpNeeded(
      task.projectId,
      ticket,
      outcome.reason ?? 'unknown',
      maxAttempts,
    );
  }
  return NEUTRAL_OUTCOME;
}

async function handleDevopsBringup(ctx: HandlerContext): Promise<TaskHandlerOutcome> {
  const { task } = ctx;
  const turn = await runAgentTurn({
    projectId: task.projectId,
    role: 'devops',
    userPrompt: buildPromptForPhase('BRINGUP', task.humanMessage ?? undefined),
    includeSpec: true,
    includeArchitecture: true,
  });

  const awaitingHuman = turn.message.blocks.some((block) => block.kind === 'question');
  if (!turn.advance || awaitingHuman) {
    return {
      advanceRequest: false,
      awaitingHuman,
      parseError: Boolean(turn.envelope.parseError),
    };
  }

  const bringup = await runBringupRuntimeStage(task.projectId);
  if (!bringup.ok) {
    await appendEvent(
      emit({
        projectId: task.projectId,
        kind: 'log',
        level: 'error',
        message: `bringup failed: ${bringup.detail}`,
      }),
    );
    return { advanceRequest: false, awaitingHuman: false, parseError: false };
  }

  return { advanceRequest: true, awaitingHuman: false, parseError: false };
}

async function handleQaPlan(ctx: HandlerContext): Promise<TaskHandlerOutcome> {
  const { task } = ctx;
  const turn = await runAgentTurn({
    projectId: task.projectId,
    role: 'qa',
    userPrompt: buildPromptForPhase('QA_MANUAL', task.humanMessage ?? undefined),
    includeSpec: true,
    includeArchitecture: true,
  });

  const awaitingHuman = turn.message.blocks.some((block) => block.kind === 'question');
  if (!turn.advance || awaitingHuman) {
    return {
      advanceRequest: false,
      awaitingHuman,
      parseError: Boolean(turn.envelope.parseError),
    };
  }

  await runQaPlaywrightBundledHarness({ projectId: task.projectId });
  return { advanceRequest: true, awaitingHuman: false, parseError: false };
}

async function handleIncidentTriage(ctx: HandlerContext): Promise<TaskHandlerOutcome> {
  const { task } = ctx;
  const turn = await runAgentTurn({
    projectId: task.projectId,
    role: 'incident',
    userPrompt: buildPromptForPhase('SELF_HEAL', task.humanMessage ?? undefined),
    includeSpec: true,
    includeArchitecture: true,
  });

  await materializeIncidentsIndex(task.projectId);

  const awaitingHuman = turn.message.blocks.some((block) => block.kind === 'question');
  return {
    advanceRequest: turn.advance && !awaitingHuman,
    awaitingHuman,
    parseError: Boolean(turn.envelope.parseError),
  };
}

async function handleIncidentHeal(ctx: HandlerContext): Promise<TaskHandlerOutcome> {
  const { task } = ctx;
  const incidentId = String(task.payload.incidentId ?? '');
  if (!incidentId) return NEUTRAL_OUTCOME;

  const index = await readIncidentsIndex(task.projectId);
  const incident = index?.incidents.find((entry) => entry.id === incidentId);
  if (!incident) return NEUTRAL_OUTCOME;

  const dispatchRole = resolveDispatchRole(incident);
  if (!isDispatchableRole(dispatchRole)) {
    await updateIncidentEntry(task.projectId, incident.id, { status: 'escalated' });
    await appendEvent(
      emit({
        projectId: task.projectId,
        kind: 'incident.status',
        incidentId: incident.id,
        status: 'escalated',
        attempts: incident.attempts,
      }),
    );
    return NEUTRAL_OUTCOME;
  }

  const outcome = await runOneIncidentHeal(task.projectId, incident, dispatchRole);
  if (outcome.status === 'escalated') {
    await escalateIncidentToHuman(
      task.projectId,
      incident,
      outcome.reason ?? 'heal budget exhausted',
    );
  }
  return NEUTRAL_OUTCOME;
}

// phase prompts: preserve the existing prompt bodies from the legacy driver
// so the agents behave identically once they pull tasks off the backlog.
function buildPromptForPhase(
  phase: Phase,
  humanMessage: string | undefined,
  reviewFeedback?: string | undefined,
): string {
  const humanSuffix = humanMessage ? `\n\nLatest human message:\n> ${humanMessage}` : '';
  const reviewSuffix = reviewFeedback
    ? `\n\nReviewer asked for revisions — the full finding list is in the context block above. Address every point, then set \`advance: true\` to request re-review.`
    : '';
  const suffix = `${humanSuffix}${reviewSuffix}`;

  switch (phase) {
    case 'INTAKE':
      return [
        'We are in INTAKE. The human just submitted the raw requirement (see REQUIREMENTS.md).',
        'Output:',
        '- Write an updated REQUIREMENTS.md that keeps the raw requirement and fills the Clarifications section with up to 5 focused, closed-ended questions (no answers yet).',
        '- Emit one `question` content block per question. Each must have 2-4 option chips, one flagged `isDefault: true`.',
        '- Emit an `artifact` block for REQUIREMENTS.md.',
        '- Set `advance: false`. Do NOT write SPEC.md. Do NOT include all 5 questions unless genuinely needed.',
        suffix,
      ].join('\n');
    case 'CLARIFY':
      return [
        'We are in CLARIFY. The human just answered (or skipped) one or more clarification questions.',
        'Output:',
        '- Update REQUIREMENTS.md: move answered questions to a "Clarifications" bullet list, move skipped ones to "Assumptions" with a sensible default.',
        '- If and only if critical ambiguity remains, emit at most 2 new `question` blocks and set `advance: false`.',
        '- Otherwise emit a `gate` block CLARIFY → SPEC (all checks ok) and set `advance: true`.',
        suffix,
      ].join('\n');
    case 'SPEC':
      return [
        'We are in SPEC. You are the Product Manager.',
        'Output:',
        '- `writes`: create `SPEC.md` with sections: Overview, Personas, User Stories (each story a markdown heading with ≥ 2 acceptance-criteria bullets), Non-goals, Open questions. Front-matter: role=pm, phase=SPEC, status=review-requested, timestamp=now.',
        '- Emit an `artifact` block for SPEC.md with a one-sentence excerpt.',
        '- Emit a `gate` block SPEC → ARCHITECT with 3 self-checks (front-matter correct, every story has ≥ 2 ACs, non-goals non-empty).',
        '- Set `advance: true`.',
        suffix,
      ].join('\n');
    case 'ARCHITECT':
      return [
        'We are in ARCHITECT. Given SPEC.md, produce ARCHITECTURE.md and at least one ADR.',
        'Output:',
        '- `writes[]`:',
        '  1. `ARCHITECTURE.md` with: Overview, Components table (Component | Responsibility | Tech), Data model, Sequence diagram (mermaid), Open questions. Front-matter role=architect, phase=ARCHITECT.',
        '  2. `adr/ADR-0001-<slug>.md` explaining the top stack choice with Context, Decision, Consequences. Front-matter role=architect, phase=ARCHITECT.',
        '- Emit an `artifact` block per file.',
        '- Emit a `gate` block ARCHITECT → PLAN.',
        '- Set `advance: true`.',
        suffix,
      ].join('\n');
    case 'PLAN':
      return [
        'We are in PLAN. You are the Tech Lead.',
        'Output:',
        '- `writes[]`:',
        '  1. `PLAN.md` with a mermaid DAG and a table: Code | Title | Role | Depends on | Acceptance ref.',
        '  2. One file per ticket at `tickets/T-000N-<slug>.md` with front-matter (role, phase=PLAN, ticket, assignee, depends_on). Close the front-matter with a single `---` fence, then write the body. Do NOT append another `---` (or `...`) terminator after the body.',
        '- Include `@devops` tickets where needed for runnable infra (Docker/compose, CI, `scripts/`, env samples). DevOps ships that code in IMPLEMENT like any developer — same reviewer approve / request-changes loop.',
        '- Emit a `ticket` block for each ticket (code, title, assigneeRole, dependsOn, status="todo").',
        '- Emit a `gate` block PLAN → IMPLEMENT.',
        '- Set `advance: true`.',
        suffix,
      ].join('\n');
    case 'BRINGUP':
      return [
        'We are in BRINGUP. You are the DevOps engineer.',
        'Scope here is **local run + manual UI test readiness** only — not new product/infra code.',
        'Infra and scripts belong in **IMPLEMENT** tickets (already reviewed). This phase: confirm nothing blocks Olympus from starting the workspace dev server and opening it in the App / Runtime tab.',
        'Output:',
        '- `writes[]`: short `.software-house/BRINGUP.md` (how the orchestrator runs the app: it executes `pnpm run dev` in the workspace with `PORT`, waits for HTTP 200, surfaces logs + iframe — note fixed ports vs dynamic Olymp pool, prerequisites, and any operator checklist for manual QA).',
        '- Do **not** use `sourceWrites[]` in BRINGUP — if scripts or Docker fixes are still needed, they should be a tracked IMPLEMENT ticket + reviewer.',
        'After `advance: true`, the driver starts the dev server and probes HTTP automatically.',
        '- Emit a `gate` block BRINGUP → QA_MANUAL.',
        '- Set `advance: true` when the note is written.',
        suffix,
      ].join('\n');
    case 'QA_MANUAL':
      return [
        'We are in QA_MANUAL. You are the QA Engineer.',
        'Output:',
        '- `writes[]`: `qa/test-plan.md` with one scenario per SPEC acceptance criterion. Each scenario: preconditions, steps (ARIA-ref based), expected, evidence path under `qa/screenshots/<slug>/step-NN.png`.',
        '- Emit one `artifact` block for the test plan.',
        'After your turn with `advance: true`, the orchestrator runs bundled Playwright smoke tests (real Chromium UI) against the running app URL, writes a report under `.software-house/qa/reports/`, and opens incidents on failures.',
        '- Emit a `gate` block QA_MANUAL → SELF_HEAL summarizing how many scenarios exist vs SPEC criteria.',
        '- Set `advance: true` when the plan is complete.',
        suffix,
      ].join('\n');
    case 'SELF_HEAL':
      return [
        'We are in SELF_HEAL. You are the Incident Responder.',
        'Output:',
        '- Read `qa/reports/*` and `reviews/PR-*-review.md`. If none show failures, emit a `gate` block SELF_HEAL → SECURITY with all checks green and set `advance: true`.',
        '- If failures exist, create `incidents/I-<ts>-<slug>.md` via `writes[]`. Each incident MUST have front-matter:',
        '  ```yaml',
        '  ---',
        '  role: incident',
        '  phase: SELF_HEAL',
        '  id: I-<ts>-<slug>',
        '  title: <short description>',
        '  classification: frontend | backend | infra | data | spec-gap',
        '  dispatch: backend-dev | frontend-dev | devops',
        '  status: open',
        '  attempts: 0',
        '  ticket: T-000N         # optional — link to the failing ticket',
        '  ---',
        '  ```',
        '- Body sections: Reproduction, Observed, Expected, Dispatch rationale.',
        '- Emit an `incident` content block per new incident.',
        '- Set `advance: false`. The heal workers will dispatch fixes automatically.',
        suffix,
      ].join('\n');
    case 'SECURITY':
      return [
        'We are in SECURITY. You are the Security Auditor (readonly).',
        'Output:',
        '- `writes[]`: `SECURITY_REVIEW.md` covering deps (known CVEs, abandoned packages), secrets (none committed), auth (sessions, tokens), IO boundaries, and 3 highest-risk remediations. Front-matter: role=security, phase=SECURITY, status=review.',
        '- Emit an `artifact` block for SECURITY_REVIEW.md and a `gate` block SECURITY → RELEASE.',
        '- Set `advance: true` only if no `severity: high` findings remain open.',
        suffix,
      ].join('\n');
    case 'RELEASE':
      return [
        'We are in RELEASE. You are the Release Manager.',
        'Output:',
        '- `writes[]`:',
        '  1. `CHANGELOG.md` grouped by Added / Changed / Fixed / Security, listing merged tickets.',
        '  2. `DEMO.md` with a 5-step demo script that maps to SPEC acceptance criteria.',
        '- Emit a `gate` block RELEASE → DEMO.',
        '- Set `advance: true`.',
        suffix,
      ].join('\n');
    case 'DEMO':
      return [
        'We are in DEMO. You are the Technical Writer.',
        'Output:',
        '- `sourceWrites[]`: update `README.md` with a Quickstart, Features (from SPEC), and Links (SPEC.md, CHANGELOG.md, DEMO.md).',
        '- Emit a `gate` block summarising exit criteria (all acceptance met, no open high findings, CHANGELOG + DEMO present).',
        '- Set `advance: false` — DEMO is a terminal phase.',
        suffix,
      ].join('\n');
    default:
      return `We are in ${phase}. Describe the next concrete action and emit a gate block proposing the next transition.${suffix}`;
  }
}

export { buildPromptForPhase };
