import { emit } from '../../app/lib/event-bus.server';
import { ROLES, ROLE_LABEL, ROLE_TIER, type Role } from '../const/roles';
import {
  approveReviewedChain,
  createTask,
  failReviewedChain,
  getProjectById,
  getTaskById,
  markTaskDone,
  markTaskFailed,
  markTaskPendingReview,
  requeueTask,
  updateTask,
} from '../db/queries';
import { deregisterTaskAbort, registerTaskAbort } from './task-abort-registry';
import { kanbanTaskPayload } from '../lib/kanban-task-payload';
import { emitToolLog } from '../lib/tool-log';
import { createRoleAgent } from '../mastra/agent-factory';
import { getSettings } from '../lib/settings';
import { resolveTierModel } from '../mastra/model';

import type { Task } from '../db/schema';

// roles whose artifacts should be auto-reviewed when they finish a task.
// manual tasks (tester, qa) and the reviewer itself are excluded.
const REVIEWABLE_ROLES: ReadonlySet<Role> = new Set<Role>([
  'backend-dev',
  'frontend-dev',
  'architect',
  'techlead',
  'devops',
  'pm',
  'writer',
  'security',
  'release',
]);

// roles that MUST produce a concrete artifact (file on disk, browser action,
// etc.). if the agent returns with zero text AND zero productive tool calls,
// we treat that as an upstream failure rather than letting an empty ticket
// sail through the reviewer auto-approve path.
const ARTIFACT_PRODUCING_ROLES: ReadonlySet<Role> = new Set<Role>([
  'pm',
  'architect',
  'techlead',
  'backend-dev',
  'frontend-dev',
  'devops',
  'writer',
  'release',
  'security',
  'tester',
  'orchestrator',
]);

export async function executeTask(role: Role, task: Task): Promise<void> {
  const project = await getProjectById(task.projectId);
  if (!project) {
    await markTaskFailed(task.id, `project ${task.projectId} not found`);
    const gone = await getTaskById(task.id);
    if (gone) {
      emit({
        projectId: task.projectId,
        role,
        taskId: task.id,
        type: 'task-update',
        payload: kanbanTaskPayload(gone),
      });
    }
    return;
  }

  emit({
    projectId: task.projectId,
    role,
    taskId: task.id,
    type: 'state',
    payload: { status: 'working', title: task.title },
  });

  const threadId = task.threadId ?? `task-${task.id}`;
  const tierModel = resolveTierModel(ROLE_TIER[role]);
  if (!task.threadId || !task.modelTier || !task.modelName) {
    await updateTask(task.id, {
      threadId,
      modelTier: ROLE_TIER[role],
      modelName: tierModel,
    });
  }

  const agent = createRoleAgent({
    projectId: task.projectId,
    projectSlug: project.slug,
    role,
    taskId: task.id,
  });

  const userMessage = buildUserMessage(task);

  const started = Date.now();
  emitToolLog(
    { projectId: task.projectId, role, taskId: task.id },
    {
      kind: 'agent',
      action: 'generate.start',
      summary: `${ROLE_LABEL[role]} thinking on "${task.title}"`,
    },
  );

  const abortController = new AbortController();
  registerTaskAbort(task.id, abortController);

  try {
    const stream = await agent.stream(userMessage, {
      memory: {
        thread: threadId,
        resource: task.projectId,
      },
    });

    const activity = await pumpAgentStream(
      stream,
      { projectId: task.projectId, role, taskId: task.id },
      abortController.signal,
    );

    const text = await stream.text;

    const latest = await readLatestTaskStatus(task.id);
    if (latest === 'blocked-needs-input') {
      emitToolLog(
        { projectId: task.projectId, role, taskId: task.id },
        {
          kind: 'agent',
          action: 'generate.end',
          ok: true,
          ms: Date.now() - started,
          summary: `${text.length} chars · blocked for input`,
        },
      );
      emit({
        projectId: task.projectId,
        role,
        taskId: task.id,
        type: 'state',
        payload: { status: 'blocked' },
      });
      return;
    }

    // guard: a role that is supposed to produce an artifact finished with
    // literally nothing — no text, no file write, no browser action, nothing.
    // this is almost always an upstream failure (rate-limit, truncated stream,
    // provider error). treat it as transient so the poll loop retries, instead
    // of marking the ticket "done" with empty output and letting the reviewer
    // rubber-stamp a blank artifact.
    const looksEmpty =
      text.trim().length === 0 && activity.productiveToolCallCount === 0;
    if (looksEmpty && ARTIFACT_PRODUCING_ROLES.has(role)) {
      throw new EmptyAgentOutputError(
        `agent returned zero text and zero productive tool calls (total tool calls: ${activity.toolCallCount}, reasoning deltas: ${activity.reasoningDeltaCount})`,
      );
    }

    // guard: orchestrator must emit a JSON task list — if the LLM returned
    // text but without a parseable JSON array (e.g. truncated stream, partial
    // rate-limited response), treat it as transient so the poll loop retries.
    if (role === 'orchestrator' && !hasOrchestrationJson(text)) {
      throw new EmptyAgentOutputError(
        `orchestrator produced no parseable task JSON (output length: ${text.length})`,
      );
    }

    emitToolLog(
      { projectId: task.projectId, role, taskId: task.id },
      {
        kind: 'agent',
        action: 'generate.end',
        ok: true,
        ms: Date.now() - started,
        summary: `${text.length} chars · ${activity.toolCallCount} tool call(s) · ${activity.productiveToolCallCount} productive`,
      },
    );

    const resultData = buildTaskResult(role, text);
    attemptCounts.delete(task.id);

    // reviewable artifacts park in 'pending-review' until a reviewer approves.
    // everything else (orchestrator, reviewer, tester, qa) finalizes to 'done' directly.
    const parksForReview = REVIEWABLE_ROLES.has(role);
    if (parksForReview) {
      await markTaskPendingReview(task.id, resultData);
    } else {
      await markTaskDone(task.id, resultData);
    }

    if (role === 'orchestrator') {
      await createSubtasksFromOrchestration(task.projectId, text);
    }
    if (role === 'tester') {
      await createBugReportTasks(task.projectId, task, text);
    }
    if (role === 'reviewer') {
      await handleReviewerOutcome(task, resultData);
    } else if (parksForReview) {
      await scheduleReviewOf(task);
    }

    const finalRow = await getTaskById(task.id);
    if (finalRow) {
      emit({
        projectId: task.projectId,
        role,
        taskId: task.id,
        type: 'task-update',
        payload: kanbanTaskPayload(finalRow),
      });
    }
    emit({
      projectId: task.projectId,
      role,
      taskId: task.id,
      type: 'state',
      payload: { status: 'idle', lastTask: task.title },
    });

    const finishedPhrase = parksForReview ? 'finished (awaiting review)' : 'finished';
    emit({
      projectId: task.projectId,
      role,
      taskId: task.id,
      type: 'chat',
      payload: {
        from: role,
        direction: 'from-agent',
        text: `${ROLE_LABEL[role]} ${finishedPhrase}: ${task.title}`,
        scope: 'task',
      },
    });

    const overseerSummary = buildOverseerSummary(role, task.title, text);
    emit({
      projectId: task.projectId,
      role,
      type: 'chat',
      payload: {
        from: role,
        direction: 'from-agent',
        text: overseerSummary,
        scope: 'overseer',
        taskRef: task.id,
        taskTitle: task.title,
      },
    });
  } catch (err) {
    if (err instanceof UserInterruptError) {
      await updateTask(task.id, { status: 'todo', claimedBy: null, claimedAt: null, blockedReason: null });
      const requeued = await getTaskById(task.id);
      if (requeued) {
        emit({
          projectId: task.projectId,
          role,
          taskId: task.id,
          type: 'task-update',
          payload: kanbanTaskPayload(requeued),
        });
      }
      emit({
        projectId: task.projectId,
        role,
        taskId: task.id,
        type: 'state',
        payload: { status: 'idle' },
      });
      emit({
        projectId: task.projectId,
        role,
        taskId: task.id,
        type: 'chat',
        payload: {
          from: role,
          direction: 'from-agent',
          text: `${ROLE_LABEL[role]} restarting "${task.title}" with your updated instructions.`,
          scope: 'task',
        },
      });
      return;
    }

    const reason = extractErrorReason(err);
    emitToolLog(
      { projectId: task.projectId, role, taskId: task.id },
      {
        kind: 'agent',
        action: 'generate.error',
        ok: false,
        ms: Date.now() - started,
        summary: reason,
      },
    );

    const settings = getSettings();
    const attempt = incrementAttempt(task.id);

    // transient upstream errors (rate limits, 5xx) should retry via the poll loop
    // instead of permanently failing the ticket — up to the configured limit.
    if (isTransientError(err) && attempt < settings.maxRetries) {
      console.warn(`[${role}] transient error on task ${task.id} (attempt ${attempt}/${settings.maxRetries}): ${reason}`);
      await requeueTask(task.id, reason);
      const requeued = await getTaskById(task.id);
      if (requeued) {
        emit({
          projectId: task.projectId,
          role,
          taskId: task.id,
          type: 'task-update',
          payload: kanbanTaskPayload(requeued),
        });
      }

      emit({
        projectId: task.projectId,
        role,
        taskId: task.id,
        type: 'chat',
        payload: {
          from: role,
          direction: 'from-agent',
          text: `${ROLE_LABEL[role]} hit a transient error (attempt ${attempt}/${settings.maxRetries}), retrying in 15s.\nReason: ${reason}`,
          scope: 'task',
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 15_000));
      return;
    }

    attemptCounts.delete(task.id);
    await markTaskFailed(task.id, reason);
    const failedRow = await getTaskById(task.id);
    if (failedRow) {
      emit({
        projectId: task.projectId,
        role,
        taskId: task.id,
        type: 'task-update',
        payload: kanbanTaskPayload(failedRow),
      });
    }

    emit({
      projectId: task.projectId,
      role,
      taskId: task.id,
      type: 'chat',
      payload: {
        from: role,
        direction: 'from-agent',
        text: `${ROLE_LABEL[role]} failed on "${task.title}".\nReason: ${reason}`,
        scope: 'task',
      },
    });

    // a reviewer failing permanently would otherwise leave the reviewed task
    // stuck in 'pending-review' forever. surface the failure up the chain so
    // it moves out of the pending-review lane and into 'failed'.
    if (role === 'reviewer' && task.parentTaskId) {
      const propagated = await failReviewedChain(
        task.parentTaskId,
        `reviewer failed: ${reason}`,
      );
      for (const row of propagated) {
        emit({
          projectId: row.projectId,
          role: row.role,
          taskId: row.id,
          type: 'task-update',
          payload: kanbanTaskPayload(row),
        });
      }
    }
  } finally {
    deregisterTaskAbort(task.id);
  }
}

const attemptCounts = new Map<string, number>();

function incrementAttempt(taskId: string): number {
  const next = (attemptCounts.get(taskId) ?? 0) + 1;
  attemptCounts.set(taskId, next);
  return next;
}

type ReviewerIncident = {
  role?: string;
  title?: string;
  description?: string;
  severity?: 'error' | 'warn' | 'info';
};

type ReviewerVerdict = 'approved' | 'changes-requested';

interface ReviewerStructured {
  verdict: ReviewerVerdict;
  summary?: string;
  incidents: ReviewerIncident[];
  findings?: unknown;
  // true when the reviewer's response could not be parsed as a structured
  // verdict (empty text, rate-limited stream, or unparseable JSON). callers
  // must not treat this as a genuine "changes-requested" — there is nothing
  // actionable to fix.
  malformed?: boolean;
}

function buildOverseerSummary(role: Role, title: string, fullText: string): string {
  const firstLine = fullText
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('```') && !line.startsWith('{') && !line.startsWith('['));
  const oneLiner = (firstLine ?? '').slice(0, 240);
  const head = `${ROLE_LABEL[role]} finished "${title}".`;
  return oneLiner ? `${head}\n${oneLiner}` : head;
}

function buildTaskResult(role: Role, text: string): Record<string, unknown> {
  const summary = text.slice(0, 4000);
  if (role !== 'reviewer') {
    return { summary };
  }
  const structured = parseReviewerOutput(text);
  return { summary, review: structured };
}

function parseReviewerOutput(text: string): ReviewerStructured {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { verdict: 'changes-requested', incidents: [], malformed: true };
  }

  const positiveKeyword = /\bapproved\b|\blgtm\b|\blooks good\b|\bno issues\b/i.test(trimmed);

  try {
    const codeBlock = trimmed.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    const jsonStr = codeBlock ? codeBlock[1] : trimmed;
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!objMatch) {
      return positiveKeyword
        ? { verdict: 'approved', incidents: [] }
        : { verdict: 'changes-requested', incidents: [], malformed: true };
    }

    const parsed = JSON.parse(objMatch[0]) as {
      verdict?: string;
      approval?: string;
      status?: string;
      summary?: string;
      incidents?: ReviewerIncident[];
      findings?: unknown;
    };

    const rawVerdict = (parsed.verdict ?? parsed.approval ?? parsed.status ?? '').toLowerCase();
    const incidents = Array.isArray(parsed.incidents) ? parsed.incidents : [];
    const hasVerdictField =
      rawVerdict === 'approved' ||
      rawVerdict === 'lgtm' ||
      rawVerdict === 'changes-requested' ||
      rawVerdict === 'changes_requested';

    // an empty verdict with empty incidents and no summary means the LLM
    // returned a skeleton without any actual content — treat as malformed so
    // callers don't loop on a phantom "changes-requested".
    if (!hasVerdictField && incidents.length === 0 && !parsed.summary) {
      return positiveKeyword
        ? { verdict: 'approved', incidents: [] }
        : { verdict: 'changes-requested', incidents: [], malformed: true };
    }

    const verdict: ReviewerVerdict =
      rawVerdict === 'approved' || rawVerdict === 'lgtm'
        ? 'approved'
        : rawVerdict === 'changes-requested' || rawVerdict === 'changes_requested'
          ? 'changes-requested'
          : incidents.length > 0
            ? 'changes-requested'
            : positiveKeyword
              ? 'approved'
              : 'changes-requested';

    return {
      verdict,
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
      incidents,
      ...(parsed.findings !== undefined ? { findings: parsed.findings } : {}),
    };
  } catch {
    return positiveKeyword
      ? { verdict: 'approved', incidents: [] }
      : { verdict: 'changes-requested', incidents: [], malformed: true };
  }
}

/**
 * Auto-enqueue a reviewer task for a just-finished reviewable task so no
 * completed code artifact escapes without review.
 */
async function scheduleReviewOf(finished: Task): Promise<void> {
  if (finished.role === 'orchestrator') return;

  // review title uses the clean base title too, so the kanban doesn't show
  // "Review: Fix #3: Fix #2: Fix #1: ..." in the review lane.
  const reviewTitle = `Review: ${stripFixPrefix(finished.title)}`;
  // reviewer tasks intentionally have no dependsOn — the reviewed task is in
  // 'pending-review' (not 'done'), so a hard dependency would block the claim
  // loop forever. parentTaskId captures the relationship without gating claims.
  const reviewTask = await createTask({
    projectId: finished.projectId,
    role: 'reviewer',
    title: reviewTitle,
    description: buildReviewBrief(finished),
    dependsOn: [],
    parentTaskId: finished.id,
    iteration: finished.iteration ?? 0,
  });

  emit({
    projectId: reviewTask.projectId,
    role: 'reviewer',
    taskId: reviewTask.id,
    type: 'task-update',
    payload: kanbanTaskPayload(reviewTask),
  });
  emit({
    projectId: finished.projectId,
    role: 'reviewer',
    taskId: finished.id,
    type: 'chat',
    payload: {
      from: 'reviewer',
      direction: 'from-agent',
      text: `Queued review #${(finished.iteration ?? 0) + 1} for "${finished.title}".`,
      scope: 'task',
    },
  });
}

function buildReviewBrief(target: Task): string {
  const lines = [
    `Review iteration ${(target.iteration ?? 0) + 1} of task "${target.title}" (${target.role}).`,
    '',
    'Original ticket description:',
    target.description || '(no description)',
  ];

  if (target.userNotes) {
    lines.push('', '--- human notes ---', target.userNotes);
  }

  lines.push(
    '',
    'Load the artifacts produced by this task and evaluate them against the ticket.',
    '',
    'Respond with a JSON object:',
    '```json',
    '{',
    '  "verdict": "approved" | "changes-requested",',
    '  "summary": "<one-line overall assessment>",',
    '  "incidents": [',
    '    { "severity": "error|warn|info", "title": "...", "description": "...", "role": "<who should fix>" }',
    '  ]',
    '}',
    '```',
    '- Use "approved" only when no error/warn severity incidents remain.',
    '- The <who should fix> field is optional; if omitted, the original task role will be retried.',
  );
  return lines.join('\n');
}

/**
 * Called after a reviewer task completes. Walks back to the reviewed task and
 * either closes the loop (approved / iteration cap) or queues a fix task
 * followed by another review pass.
 */
async function handleReviewerOutcome(
  reviewerTask: Task,
  result: Record<string, unknown>,
): Promise<void> {
  if (!reviewerTask.parentTaskId) return;
  const reviewed = await getTaskById(reviewerTask.parentTaskId);
  if (!reviewed) return;

  const reviewRaw = result.review;
  const review = isReviewerStructured(reviewRaw) ? reviewRaw : null;
  const settings = getSettings();
  // per-task override (set by the human via "retry failed task") wins over
  // the global setting when it is larger. this lets a specific failing chain
  // get extra budget without affecting every other project.
  const overrideCap = reviewed.maxIterationsOverride ?? 0;
  const maxIterations = Math.max(0, settings.maxReviewIterations, overrideCap);
  const currentIteration = reviewed.iteration ?? 0;

  const chatEmit = (text: string) => {
    emit({
      projectId: reviewerTask.projectId,
      role: 'reviewer',
      taskId: reviewerTask.id,
      type: 'chat',
      payload: { from: 'reviewer', direction: 'from-agent', text, scope: 'task' },
    });
  };

  if (!review || review.verdict === 'approved') {
    const promoted = await approveReviewedChain(reviewed.id);
    for (const row of promoted) {
      emit({
        projectId: row.projectId,
        role: row.role,
        taskId: row.id,
        type: 'task-update',
        payload: kanbanTaskPayload(row),
      });
    }
    chatEmit(`Review #${currentIteration + 1} approved "${reviewed.title}". No further iterations.`);
    return;
  }

  // reviewer contract violation: either the response was unparseable (likely
  // a rate-limited or truncated LLM stream) or it said "changes-requested"
  // with no incidents. in both cases there is literally nothing actionable
  // for the employee to fix. queueing a fix task would just waste another
  // iteration producing another blank review, so we approve with a warning
  // and let downstream roles (tester, human) catch any real defect instead
  // of burning the entire review budget on phantom feedback.
  if (review.malformed || review.incidents.length === 0) {
    const promoted = await approveReviewedChain(reviewed.id);
    for (const row of promoted) {
      emit({
        projectId: row.projectId,
        role: row.role,
        taskId: row.id,
        type: 'task-update',
        payload: kanbanTaskPayload(row),
      });
    }
    const cause = review.malformed
      ? 'reviewer returned an empty/unparseable response (likely upstream rate-limit or timeout)'
      : 'reviewer said changes-requested but enumerated zero incidents';
    chatEmit(
      `Review #${currentIteration + 1} auto-approved "${reviewed.title}" — ${cause}. Please spot-check manually.`,
    );
    return;
  }

  if (currentIteration >= maxIterations) {
    const escalationReason = `review cap (${maxIterations}) reached with ${review.incidents.length} unresolved incident(s)`;
    const failed = await failReviewedChain(reviewed.id, escalationReason);
    for (const row of failed) {
      emit({
        projectId: row.projectId,
        role: row.role,
        taskId: row.id,
        type: 'task-update',
        payload: kanbanTaskPayload(row),
      });
    }
    chatEmit(
      `Review #${currentIteration + 1} still has ${review.incidents.length} incident(s) but the self-healing cap (${maxIterations}) was reached. Escalating to humans.`,
    );
    return;
  }

  const fixRole = resolveFixRole(review.incidents, reviewed.role);
  const iteration = currentIteration + 1;
  const fixDescription = buildFixBrief(reviewed, reviewerTask, review, iteration);
  // strip any prior "Fix #N: " prefix so titles don't stack into
  // "Fix #3: Fix #2: Fix #1: ..." across successive review rounds.
  const baseTitle = stripFixPrefix(reviewed.title);

  const fixTask = await createTask({
    projectId: reviewerTask.projectId,
    role: fixRole,
    title: `Fix #${iteration}: ${baseTitle}`,
    description: fixDescription,
    dependsOn: [reviewerTask.id],
    parentTaskId: reviewerTask.id,
    iteration,
    // carry the human-extended budget forward so a retry that bumps the cap
    // on an ancestor keeps applying to every new fix in the same chain.
    maxIterationsOverride: reviewed.maxIterationsOverride ?? null,
  });

  emit({
    projectId: fixTask.projectId,
    role: fixRole,
    taskId: fixTask.id,
    type: 'task-update',
    payload: kanbanTaskPayload(fixTask),
  });
  chatEmit(
    `Review #${currentIteration + 1} requested changes (${review.incidents.length} incident(s)). Queued fix task for ${ROLE_LABEL[fixRole] ?? fixRole} — iteration ${iteration}/${maxIterations}.`,
  );
}

// matches leading "Fix #12: " (case-insensitive, any trailing whitespace),
// applied repeatedly in case prior code already stacked multiple prefixes.
const FIX_PREFIX_PATTERN = /^\s*fix\s*#\d+\s*:\s*/i;

function stripFixPrefix(title: string): string {
  let current = title;
  while (FIX_PREFIX_PATTERN.test(current)) {
    current = current.replace(FIX_PREFIX_PATTERN, '');
  }
  return current.trim();
}

function isReviewerStructured(value: unknown): value is ReviewerStructured {
  if (!value || typeof value !== 'object') return false;
  const obj = value as { verdict?: unknown; incidents?: unknown };
  const verdictOk = obj.verdict === 'approved' || obj.verdict === 'changes-requested';
  return verdictOk && Array.isArray(obj.incidents);
}

function resolveFixRole(incidents: ReviewerIncident[], fallback: string): Role {
  for (const incident of incidents) {
    const role = typeof incident.role === 'string' ? normalizeRole(incident.role) : null;
    if (role && (ROLES as readonly string[]).includes(role)) return role;
  }
  return normalizeRole(fallback);
}

function buildFixBrief(
  reviewed: Task,
  reviewer: Task,
  review: ReviewerStructured,
  iteration: number,
): string {
  const lines = [
    `Iteration ${iteration}: address reviewer feedback for "${reviewed.title}".`,
    '',
    'Original ticket:',
    reviewed.description || '(no description)',
    '',
    `Reviewer verdict: ${review.verdict}`,
  ];
  if (review.summary) {
    lines.push(`Reviewer summary: ${review.summary}`);
  }
  lines.push('', 'Incidents to resolve:');
  if (review.incidents.length === 0) {
    lines.push('- (reviewer flagged issues but did not enumerate incidents — re-read the review narrative)');
  } else {
    review.incidents.forEach((incident, index) => {
      const severity = incident.severity ? `[${incident.severity}] ` : '';
      lines.push(`${index + 1}. ${severity}${incident.title ?? '(no title)'}`);
      if (incident.description) {
        lines.push(`   ${incident.description}`);
      }
    });
  }
  lines.push(
    '',
    `Reviewer task id: ${reviewer.id}`,
    `Original task id: ${reviewed.id}`,
    '',
    'Apply the fix end-to-end. A new reviewer pass will follow automatically.',
  );
  return lines.join('\n');
}

class EmptyAgentOutputError extends Error {
  readonly isRetryable = true;
  constructor(message: string) {
    super(message);
    this.name = 'EmptyAgentOutputError';
  }
}

class UserInterruptError extends Error {
  constructor() {
    super('interrupted by human instruction');
    this.name = 'UserInterruptError';
  }
}

function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (err instanceof EmptyAgentOutputError) return true;
  const candidate = err as {
    statusCode?: number;
    status?: number;
    isRetryable?: boolean;
    message?: string;
  };
  if (candidate.statusCode === 429 || candidate.status === 429) return true;
  if (candidate.statusCode && candidate.statusCode >= 500) return true;
  if (candidate.isRetryable === true) return true;
  const msg = (candidate.message ?? '').toLowerCase();
  return msg.includes('rate limit') || msg.includes('timeout') || msg.includes('econnreset');
}

// extracts the most human-readable failure reason from an API error,
// preferring upstream provider details buried in responseBody over the
// generic top-level message (e.g. "Provider returned error").
function extractErrorReason(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);

  const candidate = err as {
    message?: string;
    statusCode?: number;
    responseBody?: string;
    provider?: string;
    modelId?: string;
  };

  if (candidate.responseBody) {
    try {
      const body = JSON.parse(candidate.responseBody) as {
        error?: { message?: string; metadata?: { raw?: string } };
      };
      const upstream = body?.error?.metadata?.raw ?? body?.error?.message;
      if (upstream) {
        const context =
          candidate.provider && candidate.modelId
            ? `[${candidate.provider}/${candidate.modelId}] `
            : '';
        return `${context}${upstream}`;
      }
    } catch {
      // responseBody was not valid JSON — fall through
    }
  }

  return (err instanceof Error ? err.message : null) ?? String(err);
}

interface StreamCtx {
  projectId: string;
  role: Role;
  taskId: string;
}

export interface AgentActivitySummary {
  toolCallCount: number;
  // tool ids that indicate the agent actually produced a workspace artifact
  // (vs purely read/observe/browse tools). used to tell "agent did something
  // meaningful" from "agent merely thought about the task".
  productiveToolCallCount: number;
  reasoningDeltaCount: number;
}

// tool ids considered "productive" — invoking any of these means the agent
// created real side effects (files on disk, browser actions, server boot).
// kept broad on purpose so a legit developer run isn't flagged as empty just
// because it used a slightly different tool name.
const PRODUCTIVE_TOOL_IDS: ReadonlySet<string> = new Set([
  'stream_code',
  'file_system',
  'playwright_browser',
  'runtime',
  'ask_clarifying_questions',
  'request_human_input',
]);

// consume the agent's fullStream, forwarding text and reasoning deltas to the
// UI as grouped "agent-stream" log events. tool calls are NOT forwarded (the
// tools themselves emit their own progress logs) but we do count them so the
// caller can tell a silent-but-productive run apart from a totally empty one.
async function pumpAgentStream(
  stream: { fullStream: AsyncIterable<unknown> | ReadableStream<unknown> },
  ctx: StreamCtx,
  signal?: AbortSignal,
): Promise<AgentActivitySummary> {
  const summary: AgentActivitySummary = {
    toolCallCount: 0,
    productiveToolCallCount: 0,
    reasoningDeltaCount: 0,
  };

  const iterable = toAsyncIterable(stream.fullStream);
  for await (const raw of iterable) {
    if (signal?.aborted) throw new UserInterruptError();
    const chunk = raw as { type?: string; payload?: Record<string, unknown> };
    if (!chunk || typeof chunk.type !== 'string') continue;

    if (chunk.type === 'tool-call') {
      summary.toolCallCount += 1;
      const toolName = asString(chunk.payload?.toolName) ?? asString(chunk.payload?.name);
      if (toolName && PRODUCTIVE_TOOL_IDS.has(toolName)) {
        summary.productiveToolCallCount += 1;
      }
      continue;
    }

    if (chunk.type === 'text-start' || chunk.type === 'text-end') {
      emitAgentStreamEvent(ctx, {
        kind: 'text',
        phase: chunk.type === 'text-start' ? 'start' : 'end',
        streamId: asString(chunk.payload?.id) ?? 'text',
      });
      continue;
    }

    if (chunk.type === 'text-delta') {
      const text = asString(chunk.payload?.text);
      if (!text) continue;
      emitAgentStreamEvent(ctx, {
        kind: 'text',
        phase: 'delta',
        streamId: asString(chunk.payload?.id) ?? 'text',
        text,
      });
      continue;
    }

    if (chunk.type === 'reasoning-start' || chunk.type === 'reasoning-end') {
      emitAgentStreamEvent(ctx, {
        kind: 'reasoning',
        phase: chunk.type === 'reasoning-start' ? 'start' : 'end',
        streamId: asString(chunk.payload?.id) ?? 'reasoning',
      });
      continue;
    }

    if (chunk.type === 'reasoning-delta') {
      const text = asString(chunk.payload?.text);
      if (text) summary.reasoningDeltaCount += 1;
      if (!text) continue;
      emitAgentStreamEvent(ctx, {
        kind: 'reasoning',
        phase: 'delta',
        streamId: asString(chunk.payload?.id) ?? 'reasoning',
        text,
      });
      continue;
    }
  }

  return summary;
}

function toAsyncIterable<T>(
  source: AsyncIterable<T> | ReadableStream<T>,
): AsyncIterable<T> {
  if (Symbol.asyncIterator in (source as object)) {
    return source as AsyncIterable<T>;
  }
  const reader = (source as ReadableStream<T>).getReader();
  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<T>> {
          const { done, value } = await reader.read();
          if (done) return { done: true, value: undefined as unknown as T };
          return { done: false, value };
        },
        async return(): Promise<IteratorResult<T>> {
          reader.releaseLock();
          return { done: true, value: undefined as unknown as T };
        },
      };
    },
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

interface AgentStreamEvent {
  kind: 'text' | 'reasoning';
  phase: 'start' | 'delta' | 'end';
  streamId: string;
  text?: string;
}

function emitAgentStreamEvent(ctx: StreamCtx, event: AgentStreamEvent): void {
  emit({
    projectId: ctx.projectId,
    role: ctx.role,
    taskId: ctx.taskId,
    type: 'log',
    payload: {
      channel: 'agent-stream',
      kind: event.kind,
      phase: event.phase,
      streamId: event.streamId,
      ...(event.text ? { text: event.text } : {}),
    },
  });
}

function buildUserMessage(task: Task): string {
  const lines = [`Ticket: ${task.title}`, '', task.description || '(no description)'];

  if (task.userNotes) {
    lines.push('', '--- human notes ---', task.userNotes);
  }

  if (task.blockedReason?.startsWith('CLARIFICATION TIMEOUT')) {
    lines.push('', '--- clarification timeout ---', task.blockedReason);
  }

  lines.push('', 'Follow your role instructions. Use tools to produce real artifacts.');
  return lines.join('\n');
}

async function readLatestTaskStatus(id: string): Promise<string | null> {
  const { getTaskById } = await import('../db/queries');
  const row = await getTaskById(id);
  return row?.status ?? null;
}

const ROLE_ALIASES: Record<string, Role> = {
  'frontend-developer': 'frontend-dev',
  'frontend developer': 'frontend-dev',
  'backend-developer': 'backend-dev',
  'backend developer': 'backend-dev',
  'quality-assurance': 'qa',
  'quality-assurance-engineer': 'qa',
  'qa-engineer': 'qa',
  'devops-engineer': 'devops',
  'tech-lead': 'techlead',
  'tech lead': 'techlead',
  'product-manager': 'pm',
  'product manager': 'pm',
  'security-engineer': 'security',
  'release-manager': 'release',
  'manual-tester': 'tester',
  'manual tester': 'tester',
};

function extractOrchestrationJsonStr(output: string): string | null {
  const codeBlockMatch = output.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  const searchIn = codeBlockMatch ? codeBlockMatch[1] : output;
  const jsonMatch = searchIn.match(/\[[\s\S]*\]/);
  return jsonMatch ? jsonMatch[0] : null;
}

function hasOrchestrationJson(output: string): boolean {
  return extractOrchestrationJsonStr(output) !== null;
}

function normalizeRole(raw: string): Role {
  const lower = raw.toLowerCase().trim();
  if (ROLE_ALIASES[lower]) return ROLE_ALIASES[lower];
  const hyphenated = lower.replaceAll(' ', '-') as Role;
  if ((ROLES as readonly string[]).includes(hyphenated)) return hyphenated;
  const stripped = lower.replaceAll(' ', '') as Role;
  const match = ROLES.find((role) => role.replaceAll('-', '') === stripped);
  return match ?? (lower as Role);
}

async function createSubtasksFromOrchestration(
  projectId: string,
  orchestrationOutput: string,
): Promise<void> {
  try {
    const jsonStr = extractOrchestrationJsonStr(orchestrationOutput);
    if (!jsonStr) {
      console.error('[orchestration] no JSON found in output — this should have been caught earlier');
      emit({
        projectId,
        role: 'orchestrator',
        type: 'chat',
        payload: {
          from: 'orchestrator',
          direction: 'from-agent',
          text: 'Orchestrator finished but produced no task list. The output did not contain a parseable JSON array.',
          scope: 'overseer',
        },
      });
      return;
    }

    const rawTasks = JSON.parse(jsonStr) as Array<{
      role: string;
      title: string;
      description: string;
      dependsOn?: string[];
    }>;

    // orchestrator must never re-enqueue itself — that causes unbounded recursion
    const tasks = rawTasks.filter((subtask) => {
      if (normalizeRole(subtask.role) === 'orchestrator') {
        console.log(`[orchestration] dropping self-referential orchestrator subtask: ${subtask.title}`);
        return false;
      }
      return true;
    });

    console.log(`[orchestration] parsing ${tasks.length} subtasks`);

    const normalizedTasks = tasks.map((subtask) => ({
      ...subtask,
      roleNormalized: normalizeRole(subtask.role),
    }));

    const augmentedDepsByTitle = augmentPhaseDependencies(normalizedTasks);
    const createdTaskMap = new Map<string, string>();

    for (const subtask of normalizedTasks) {
      const augmentedDepTitles = augmentedDepsByTitle.get(subtask.title) ?? [];
      const dependsOnIds = augmentedDepTitles
        .map((depName) => createdTaskMap.get(depName))
        .filter((id) => Boolean(id)) as string[];

      const created = await createTask({
        projectId,
        role: subtask.roleNormalized,
        title: subtask.title,
        description: subtask.description,
        dependsOn: dependsOnIds,
      });

      createdTaskMap.set(subtask.title, created.id);
      console.log(`[orchestration] created: ${subtask.title}`);

      emit({
        projectId,
        role: subtask.roleNormalized,
        taskId: created.id,
        type: 'task-update',
        payload: kanbanTaskPayload(created),
      });
    }

    console.log(`[orchestration] done`);
  } catch (err) {
    console.error('[orchestration] error:', err);
  }
}

// phase-ordering rules, enforced regardless of what the orchestrator emits:
// - devops tickets wait for every implementation/planning ticket (everything
//   that isn't devops/tester), because devops needs to see the chosen stack
//   on disk before writing env/deploy config.
// - tester tickets wait for every non-tester ticket (including devops), so the
//   app is complete and runnable locally before any manual testing starts.
function augmentPhaseDependencies(
  subtasks: Array<{ title: string; roleNormalized: Role; dependsOn?: string[] }>,
): Map<string, string[]> {
  const implementationTitles = subtasks
    .filter((subtask) => subtask.roleNormalized !== 'devops' && subtask.roleNormalized !== 'tester')
    .map((subtask) => subtask.title);

  const nonTesterTitles = subtasks
    .filter((subtask) => subtask.roleNormalized !== 'tester')
    .map((subtask) => subtask.title);

  const merged = new Map<string, string[]>();

  for (const subtask of subtasks) {
    const originalDeps = subtask.dependsOn ?? [];
    const enforcedDeps =
      subtask.roleNormalized === 'tester'
        ? nonTesterTitles.filter((title) => title !== subtask.title)
        : subtask.roleNormalized === 'devops'
          ? implementationTitles
          : [];

    const seen = new Set<string>();
    const deps: string[] = [];
    for (const depTitle of [...originalDeps, ...enforcedDeps]) {
      if (depTitle === subtask.title) continue;
      if (seen.has(depTitle)) continue;
      seen.add(depTitle);
      deps.push(depTitle);
    }
    merged.set(subtask.title, deps);
  }

  return merged;
}

async function createBugReportTasks(
  projectId: string,
  testerTask: Task,
  testerOutput: string,
): Promise<void> {
  try {
    const codeBlockMatch = testerOutput.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1] : testerOutput;

    const jsonMatch = jsonStr.match(/\{[\s\S]*"bugs"[\s\S]*\}/);
    if (!jsonMatch) return;

    const parsed = JSON.parse(jsonMatch[0]) as {
      bugs: Array<{ role: string; title: string; description: string }>;
    };

    if (!Array.isArray(parsed.bugs) || parsed.bugs.length === 0) return;

    console.log(`[tester] filing ${parsed.bugs.length} bug report(s)`);

    for (const bug of parsed.bugs) {
      const roleNormalized = normalizeRole(bug.role);
      const created = await createTask({
        projectId,
        role: roleNormalized,
        title: `[Bug] ${bug.title}`,
        description: bug.description,
        dependsOn: [],
        parentTaskId: testerTask.id,
        iteration: (testerTask.iteration ?? 0) + 1,
      });
      emit({
        projectId,
        role: roleNormalized,
        taskId: created.id,
        type: 'task-update',
        payload: kanbanTaskPayload(created),
      });
      console.log(`[tester] filed: ${bug.title} → ${roleNormalized}`);
    }
  } catch (err) {
    console.error('[tester] bug-report parse error:', err);
  }
}
