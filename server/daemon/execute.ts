import { emit } from '../../app/lib/event-bus.server';
import { ROLES, ROLE_LABEL, ROLE_TIER, type Role } from '../const/roles';
import {
  approveReviewedChain,
  createTask,
  failReviewedChain,
  getProjectById,
  getTaskById,
  getTaskChainRoot,
  listChildTasks,
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
import { writeProjectMetadata } from '../workspace/paths';

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

  // backfill `.software-house/project.json` for projects created before this
  // file existed — cheap and idempotent, guarantees agents can always
  // rediscover the project id from disk if the prompt context is ever lost.
  try {
    writeProjectMetadata(project.slug, {
      projectId: project.id,
      slug: project.slug,
      name: project.name,
      brief: project.brief,
      createdAt: project.createdAt?.toISOString?.() ?? new Date().toISOString(),
    });
  } catch {
    // non-fatal: the prompt injection already carries the same identifiers.
  }

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
    // everything else (reviewer, tester, qa) finalizes to 'done' directly.
    const parksForReview = REVIEWABLE_ROLES.has(role);
    if (parksForReview) {
      await markTaskPendingReview(task.id, resultData);
    } else {
      await markTaskDone(task.id, resultData);
    }

    if (role === 'tester') {
      await createBugReportTasks(task.projectId, task, text);
    }
    if (role === 'reviewer') {
      await handleReviewerOutcome(task, resultData);
    } else if (parksForReview) {
      await scheduleReviewOf(task);
    }

    // safety net for the strict trickle-down chain (cto → pm → architect →
    // techlead → implementation roles). planning roles are expected to hand
    // off via create_task; when they skip it the chain stalls silently, so we
    // auto-spawn the missing next-step ticket to keep work moving.
    await ensureTrickleDownHandoff({ role, task, text });
    await ensureTechleadFannedOut({ role, task });

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

      if (isOverseerRequest(task)) {
        emit({
          projectId: task.projectId,
          role,
          taskId: task.id,
          type: 'chat',
          payload: {
            from: role,
            direction: 'from-agent',
            text: `CTO hit a transient provider error while working on your overseer request — retrying (attempt ${attempt}/${settings.maxRetries}).\nReason: ${reason}`,
            scope: 'overseer',
            taskRef: task.id,
            taskTitle: task.title,
          },
        });
      }

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

    if (isOverseerRequest(task)) {
      emit({
        projectId: task.projectId,
        role,
        taskId: task.id,
        type: 'chat',
        payload: {
          from: role,
          direction: 'from-agent',
          text: `CTO could not complete your overseer request — the ticket is now in the failed lane. Reason: ${reason}`,
          scope: 'overseer',
          taskRef: task.id,
          taskTitle: task.title,
        },
      });
    }

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

// ticket originated from the overseer chat — failure / retry chatter should
// also surface in the overseer scope so the human who typed the request sees
// it, not just anyone opening the task detail.
function isOverseerRequest(task: Task): boolean {
  return task.role === 'cto' && task.title.startsWith('Overseer request:');
}

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
  const reviewHistory = await collectReviewHistory(reviewerTask);
  const rootTicket = await getTaskChainRoot(reviewerTask.id);
  const fixDescription = buildFixBrief({
    reviewed,
    reviewer: reviewerTask,
    currentReview: review,
    iteration,
    reviewHistory,
    rootTicket: rootTicket ?? reviewed,
  });
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

interface ReviewHistoryEntry {
  iteration: number;
  reviewerTaskId: string;
  reviewedTaskId: string;
  reviewedTitle: string;
  review: ReviewerStructured;
}

// walks up the parent chain of a reviewer task and collects every prior
// reviewer verdict in order (oldest first). this gives the next fix attempt
// the full feedback trail — not just the latest review — so the agent can see
// which incidents have been repeatedly flagged across iterations.
async function collectReviewHistory(reviewerTask: Task): Promise<ReviewHistoryEntry[]> {
  const history: ReviewHistoryEntry[] = [];
  let cursor: Task | undefined = reviewerTask;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    if (cursor.role === 'reviewer') {
      const result = (cursor.result ?? {}) as Record<string, unknown>;
      const raw = result.review;
      if (isReviewerStructured(raw)) {
        const reviewed = cursor.parentTaskId ? await getTaskById(cursor.parentTaskId) : undefined;
        history.push({
          iteration: cursor.iteration ?? 0,
          reviewerTaskId: cursor.id,
          reviewedTaskId: reviewed?.id ?? '',
          reviewedTitle: reviewed?.title ?? '(unknown)',
          review: raw,
        });
      }
    }
    if (!cursor.parentTaskId) break;
    cursor = await getTaskById(cursor.parentTaskId);
  }
  return history.reverse();
}

interface BuildFixBriefArgs {
  reviewed: Task;
  reviewer: Task;
  currentReview: ReviewerStructured;
  iteration: number;
  reviewHistory: ReviewHistoryEntry[];
  rootTicket: Task;
}

function formatIncident(incident: ReviewerIncident, index: number): string[] {
  const severity = incident.severity ? `[${incident.severity}] ` : '';
  const title = incident.title ?? '(no title)';
  const out = [`  ${index + 1}. ${severity}${title}`];
  if (incident.description) {
    out.push(`     ${incident.description}`);
  }
  if (incident.role) {
    out.push(`     suggested role: ${incident.role}`);
  }
  return out;
}

function buildFixBrief(args: BuildFixBriefArgs): string {
  const { reviewed, reviewer, currentReview, iteration, reviewHistory, rootTicket } = args;

  const lines: string[] = [
    `Iteration ${iteration}: address reviewer feedback for "${stripFixPrefix(rootTicket.title)}".`,
    '',
    '## Root ticket (the original work this chain is attempting)',
    `Title: ${stripFixPrefix(rootTicket.title)}`,
    `Role: ${rootTicket.role}`,
    'Description:',
    rootTicket.description?.trim() || '(no description)',
  ];

  if (rootTicket.userNotes) {
    lines.push('', '--- human notes on root ticket ---', rootTicket.userNotes);
  }

  const priorHistory = reviewHistory.filter((entry) => entry.reviewerTaskId !== reviewer.id);
  if (priorHistory.length > 0) {
    lines.push(
      '',
      '## Prior review history (oldest first)',
      'These reviews fired on earlier iterations in this same chain. Incidents that appear here AND in the latest review below have been repeatedly flagged — pay extra attention, the previous attempts did NOT fix them.',
      '',
    );
    priorHistory.forEach((entry) => {
      lines.push(
        `### Review iteration ${entry.iteration} — verdict: ${entry.review.verdict}`,
      );
      if (entry.review.summary) {
        lines.push(`Summary: ${entry.review.summary}`);
      }
      if (entry.review.incidents.length === 0) {
        lines.push('  (no enumerated incidents)');
      } else {
        entry.review.incidents.forEach((incident, idx) => {
          lines.push(...formatIncident(incident, idx));
        });
      }
      lines.push('');
    });
  }

  lines.push(
    '## Latest review (you MUST resolve all of these)',
    `Verdict: ${currentReview.verdict}`,
  );
  if (currentReview.summary) {
    lines.push(`Summary: ${currentReview.summary}`);
  }
  lines.push('Incidents to resolve:');
  if (currentReview.incidents.length === 0) {
    lines.push('  (reviewer flagged issues but did not enumerate incidents — re-read the review narrative)');
  } else {
    currentReview.incidents.forEach((incident, idx) => {
      lines.push(...formatIncident(incident, idx));
    });
  }

  const repeatedIncidentTitles = findRepeatedIncidents(priorHistory, currentReview);
  if (repeatedIncidentTitles.length > 0) {
    lines.push(
      '',
      '## ⚠️ Repeated incidents (flagged ≥ 2 iterations in a row)',
      'Your previous attempts did NOT fix the following. Re-read the filesystem state first; do not assume prior writes landed as intended.',
    );
    repeatedIncidentTitles.forEach((title) => lines.push(`  - ${title}`));
  }

  lines.push(
    '',
    '## Execution checklist for this iteration',
    '1. Re-read the current state on disk with `file_system.list` / `file_system.read` for every path the reviewer cited. Do NOT trust memory from earlier iterations — files may or may not exist the way you left them.',
    '2. If the reviewer flagged duplicate or mis-named files, DELETE the obsolete ones (`file_system.delete`) in addition to creating the renamed ones. Renaming = delete old + write new.',
    '3. Cross-check every fix against `.software-house/PLAN.md` (or ARCHITECTURE.md / REQUIREMENTS.md as applicable) so the same reviewer does not fire on the same issue again.',
    '4. Address EVERY incident above — latest and repeated — in a single pass. A partial fix will just queue another iteration.',
    '',
    `Reviewer task id: ${reviewer.id}`,
    `Reviewed task id: ${reviewed.id}`,
    `Root ticket id: ${rootTicket.id}`,
    '',
    'Apply the fix end-to-end. A new reviewer pass will follow automatically.',
  );

  return lines.join('\n');
}

// returns normalized titles of incidents that appear in the current review AND
// in at least one prior review in the same chain. used to highlight "you've
// been told this before" cases in the fix brief.
function findRepeatedIncidents(
  prior: ReviewHistoryEntry[],
  current: ReviewerStructured,
): string[] {
  if (prior.length === 0 || current.incidents.length === 0) return [];
  const priorTitles = new Set<string>();
  for (const entry of prior) {
    for (const incident of entry.review.incidents) {
      const key = normalizeIncidentKey(incident);
      if (key) priorTitles.add(key);
    }
  }
  const repeated: string[] = [];
  const seenDisplay = new Set<string>();
  for (const incident of current.incidents) {
    const key = normalizeIncidentKey(incident);
    if (key && priorTitles.has(key)) {
      const display = incident.title?.trim() || incident.description?.slice(0, 120) || key;
      if (!seenDisplay.has(display)) {
        seenDisplay.add(display);
        repeated.push(display);
      }
    }
  }
  return repeated;
}

function normalizeIncidentKey(incident: ReviewerIncident): string {
  const raw = (incident.title ?? incident.description ?? '').toLowerCase().trim();
  return raw.replace(/\s+/g, ' ').slice(0, 160);
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
    responseBody?: string;
  };
  if (candidate.statusCode === 429 || candidate.status === 429) return true;
  if (candidate.statusCode && candidate.statusCode >= 500) return true;
  if (candidate.isRetryable === true) return true;
  const msg = (candidate.message ?? '').toLowerCase();
  if (msg.includes('rate limit') || msg.includes('timeout') || msg.includes('econnreset')) return true;

  // Gemini/Vertex sometimes 400s with INVALID_ARGUMENT "must include at least
  // one parts field" when the streamed conversation reaches a state its
  // validator rejects (empty content, tool-only assistant turn, odd schema
  // coercion). These are provider-side flakes — a fresh attempt with the same
  // input usually succeeds, so treat them as transient.
  const body = (candidate.responseBody ?? '').toLowerCase();
  if (body.includes('must include at least one parts field')) return true;
  if (body.includes('invalid_argument') && body.includes('parts')) return true;

  return false;
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

function normalizeRole(raw: string): Role {
  const lower = raw.toLowerCase().trim();
  if (ROLE_ALIASES[lower]) return ROLE_ALIASES[lower];
  const hyphenated = lower.replaceAll(' ', '-') as Role;
  if ((ROLES as readonly string[]).includes(hyphenated)) return hyphenated;
  const stripped = lower.replaceAll(' ', '') as Role;
  const match = ROLES.find((role) => role.replaceAll('-', '') === stripped);
  return match ?? (lower as Role);
}

// map of "who must hand off to whom" in the strict trickle-down chain.
// pm → architect, architect → techlead. techlead fans out to every
// implementation / devops / testing / docs role via its own create_task
// allowlist, so we don't auto-spawn for it. cto only triggers the chain
// (pm or architect) via create_task, never via auto-spawn.
const TRICKLE_DOWN_NEXT_STEP: Partial<Record<Role, Role>> = {
  pm: 'architect',
  architect: 'techlead',
};

// heuristic rewrite for the downstream title. when the source task is an
// initial kickoff (no parent, original brief), we word it as "Draft …" so the
// downstream role knows this is the first pass; otherwise we treat it as a
// mid-stream update ("Update …" / "Replan …").
function isKickoffTitle(role: Role, title: string): boolean {
  const normalized = title.trim().toLowerCase();
  if (role === 'pm') {
    return (
      normalized.startsWith('kick off') ||
      normalized.startsWith('kickoff') ||
      normalized.startsWith('kickoff regenerate')
    );
  }
  if (role === 'architect') {
    return normalized.startsWith('draft architecture');
  }
  return false;
}

function rewriteTitleForNextStep(
  sourceRole: Role,
  sourceTitle: string,
  isKickoff: boolean,
): string {
  const stripped = sourceTitle
    .replace(/^(kick ?off( project)?|kickoff regenerate|update (requirements?|architecture)( for)?|replan( for)?|investigate( and fix)?)[:\s]*/i, '')
    .trim();
  const subject = stripped || sourceTitle;
  if (sourceRole === 'pm') {
    return isKickoff ? `Draft architecture for ${subject}` : `Update architecture for ${subject}`;
  }
  return isKickoff ? `Plan implementation for ${subject}` : `Replan for ${subject}`;
}

async function ensureTrickleDownHandoff(args: {
  role: Role;
  task: Task;
  text: string;
}): Promise<void> {
  const { role, task } = args;
  const nextRole = TRICKLE_DOWN_NEXT_STEP[role];
  if (!nextRole) return;

  // if the agent already filed the handoff (via create_task), don't duplicate.
  const children = await listChildTasks(task.id);
  if (children.some((child) => child.role === nextRole)) return;

  // kickoff detection is title-based rather than parent-based because
  // architect and techlead kickoff tickets are spawned via create_task (so
  // they always have a parent). on kickoff the downstream title should say
  // "Draft …" / "Plan implementation …"; on a mid-stream update it should say
  // "Update …" / "Replan …".
  const isKickoff = isKickoffTitle(role, task.title);
  const rationale = [
    `Forwarded automatically by the runtime because ${role} did not file a ${nextRole} task explicitly.`,
    `The ${role} completion summary is preserved on task ${task.id} (title: "${task.title}").`,
  ].join(' ');

  const nextTitle = rewriteTitleForNextStep(role, task.title, isKickoff);
  const kickoffInstructionsPm =
    'Read .software-house/REQUIREMENTS.md end-to-end. Produce .software-house/ARCHITECTURE.md with every section populated to the level of detail the architect prompt describes (Stack / Module Boundaries / Data Model / Key Flows / Deployment Shape / Risks). If any architectural decision that shapes the system (auth model, storage, framework, multi-tenancy, deploy topology) is genuinely ambiguous, ask via `ask_clarifying_questions` before committing. Then hand off to techlead with a `Plan implementation for <scope>` ticket — the runtime auto-spawns it if you forget.';
  const updateInstructionsPm =
    'Read the freshly updated .software-house/REQUIREMENTS.md and refresh .software-house/ARCHITECTURE.md to match. When you finish, hand off to techlead with a Replan ticket — the runtime will auto-spawn it if you forget.';
  const kickoffInstructionsArchitect =
    'Read .software-house/REQUIREMENTS.md and the freshly drafted .software-house/ARCHITECTURE.md end-to-end. Produce .software-house/PLAN.md with a full work breakdown (per-chunk file paths, acceptance tests, dependency graph, risks). Then file EVERY ticket the project needs: implementation (backend-dev / frontend-dev), devops phase 1 (local env + README) and phase 2 (deployment + README extension), a closing manual-test ticket when the upstream TESTING signal is `required`, a writer ticket when the surface shifts user-facing behaviour, and a security ticket when the stack warrants one. Use task-id `dependsOn` to sequence devops after implementation and tester after devops.';
  const updateInstructionsArchitect =
    'Read the freshly updated .software-house/ARCHITECTURE.md (and REQUIREMENTS.md) and refresh .software-house/PLAN.md. File implementation / devops tickets for every chunk of new work and — when the upstream TESTING signal is `required` — a closing manual-test ticket.';

  const instructions =
    role === 'pm'
      ? isKickoff
        ? kickoffInstructionsPm
        : updateInstructionsPm
      : isKickoff
        ? kickoffInstructionsArchitect
        : updateInstructionsArchitect;

  const description = [
    rationale,
    '',
    `## Upstream ${role} brief`,
    task.description.trim() || '(no description)',
    '',
    '## What you need to do',
    instructions,
    '',
    `TESTING: ${extractTestingSignal(task.description) ?? 'required'}`,
  ].join('\n');

  // gate the auto-spawned follow-up on the parent task so the claim loop
  // doesn't start it until the reviewer has approved (done) the parent. the
  // claim query only treats `done` / `skipped` dependencies as satisfied, so
  // this parks the follow-up safely behind the still-pending-review parent.
  const created = await createTask({
    projectId: task.projectId,
    role: nextRole,
    title: nextTitle,
    description,
    status: 'todo',
    parentTaskId: task.id,
    dependsOn: [task.id],
  });

  console.log(
    `[trickle-down] auto-spawned ${nextRole} task ${created.id} because ${role} task ${task.id} did not file one`,
  );

  emit({
    projectId: task.projectId,
    role: nextRole,
    taskId: created.id,
    type: 'task-update',
    payload: { ...kanbanTaskPayload(created), source: `auto:${role}` },
  });

  emit({
    projectId: task.projectId,
    role,
    taskId: task.id,
    type: 'chat',
    payload: {
      from: 'system',
      direction: 'from-agent',
      text: `Auto-queued a ${nextRole} follow-up (${created.id}) because ${role} finished without filing one — keeping the CTO → PM → Architect → Tech Lead chain intact.`,
      scope: 'task',
    },
  });
}

// implementation roles the techlead is expected to delegate to. used to count
// coverage when validating a completed techlead pass — we require at least
// one impl-role ticket (backend-dev / frontend-dev / security / release), two
// devops tickets, and — when TESTING: required — one tester ticket.
const TECHLEAD_IMPL_CODE_ROLES: ReadonlySet<Role> = new Set<Role>([
  'backend-dev',
  'frontend-dev',
  'security',
  'release',
]);

interface TechleadCoverageGap {
  missingImplementation: boolean;
  devopsShortfall: number;
  missingTester: boolean;
  missingWriter: boolean;
}

function summarizeMissing(gap: TechleadCoverageGap, testingRequired: boolean): string[] {
  const missing: string[] = [];
  if (gap.missingImplementation) {
    missing.push('no backend-dev / frontend-dev / security / release ticket exists (PHASE 1)');
  }
  if (gap.devopsShortfall > 0) {
    missing.push(
      `${gap.devopsShortfall} devops ticket(s) missing (PHASE 2 requires exactly 2: "Set Up Local Environment & README" and "Set Up Deployment & Extend README")`,
    );
  }
  if (gap.missingTester && testingRequired) {
    missing.push('no tester ticket exists but the upstream TESTING signal is `required` (PHASE 3)');
  }
  return missing;
}

// evaluates whether the techlead's completed pass actually delegated enough
// work to cover PLAN.md's mandatory ticket set. coverage is counted against
// the prompt contract:
//   PHASE 1 — at least one backend-dev / frontend-dev / security / release
//   PHASE 2 — exactly two devops tickets
//   PHASE 3 — exactly one tester ticket when TESTING: required
// on mid-stream replan runs (iteration > 0 or title starts with "File
// implementation tickets"), only PHASE 1 is enforced — the devops / tester
// tickets may already exist on the board from an earlier techlead pass.
function evaluateTechleadCoverage(
  task: Task,
  children: Task[],
  isInitialBreakdown: boolean,
): TechleadCoverageGap | null {
  const implCount = children.filter((child) => TECHLEAD_IMPL_CODE_ROLES.has(child.role as Role)).length;
  const devopsCount = children.filter((child) => child.role === 'devops').length;
  const testerCount = children.filter((child) => child.role === 'tester').length;

  const missingImplementation = implCount === 0;
  const devopsShortfall = isInitialBreakdown ? Math.max(0, 2 - devopsCount) : 0;
  const testingRequired = (extractTestingSignal(task.description) ?? 'required') === 'required';
  const missingTester = isInitialBreakdown && testingRequired && testerCount === 0;

  if (!missingImplementation && devopsShortfall === 0 && !missingTester) return null;
  return {
    missingImplementation,
    devopsShortfall,
    missingTester,
    missingWriter: false,
  };
}

// when the techlead completes without filing the full mandatory ticket set,
// spawn a pointed follow-up targeting the techlead itself. the upstream task
// already produced PLAN.md via stream_code, so we do NOT re-run the planning
// step — the follow-up focuses purely on converting the existing plan into
// tickets via create_task. parented on the original techlead task so the
// kanban shows the retry chain explicitly and dependsOn gates it behind the
// reviewer approval of the parent.
async function ensureTechleadFannedOut(args: { role: Role; task: Task }): Promise<void> {
  const { role, task } = args;
  if (role !== 'techlead') return;

  // a rescue task is itself a techlead run; don't cascade rescues off it.
  if (task.title.startsWith('File implementation tickets')) return;

  const children = await listChildTasks(task.id);
  const alreadyRescued = children.some(
    (child) => child.role === 'techlead' && child.title.startsWith('File implementation tickets'),
  );
  if (alreadyRescued) return;

  const isInitialBreakdown = !/^replan/i.test(task.title.trim());
  const gap = evaluateTechleadCoverage(task, children, isInitialBreakdown);
  if (!gap) return;

  const testingSignal = extractTestingSignal(task.description) ?? 'required';
  const testingRequired = testingSignal === 'required';
  const missing = summarizeMissing(gap, testingRequired);
  const implCount = children.filter((child) => TECHLEAD_IMPL_CODE_ROLES.has(child.role as Role)).length;
  const devopsCount = children.filter((child) => child.role === 'devops').length;
  const testerCount = children.filter((child) => child.role === 'tester').length;

  const subject = stripFixPrefix(task.title)
    .replace(/^(plan implementation for|replan for)[:\s]*/i, '')
    .trim() || 'the project';

  const description = [
    'Forwarded automatically by the runtime because the previous techlead pass wrote `.software-house/PLAN.md` but filed an INCOMPLETE set of delegation tickets — the project cannot progress without the missing tickets.',
    '',
    '## Gaps detected on the board',
    ...missing.map((line) => `- ${line}`),
    '',
    '## Tickets already on the board (do NOT refile these)',
    `- ${implCount} implementation-code ticket(s) (backend-dev / frontend-dev / security / release)`,
    `- ${devopsCount} devops ticket(s)`,
    `- ${testerCount} tester ticket(s)`,
    '',
    '## Do THIS in this run (no more planning)',
    '1. Read the existing `.software-house/PLAN.md` end-to-end. Do NOT rewrite it; a reviewer will validate the doc itself.',
    '2. Only fall back to REQUIREMENTS.md / ARCHITECTURE.md if a specific detail is missing from PLAN.md.',
    '3. Run `database_query` against `olympus_tasks WHERE project_id = <projectId>` to see what is already queued before filing anything new — do not duplicate existing tickets.',
    '4. For EVERY Work Breakdown chunk in PLAN.md that is NOT already represented on the board, call `create_task` with the correct target role. Copy the file paths, acceptance tests, and risks from PLAN.md into the ticket description verbatim.',
    '5. File any missing PHASE 2 devops tickets (exactly two: "Set Up Local Environment & README" then "Set Up Deployment & Extend README") with the devops-phase-1 ticket depending on every PHASE 1 implementation ticket id, and devops-phase-2 depending on phase-1 AND devops-phase-1.',
    testingRequired
      ? '6. File exactly one `tester` ticket titled "Manual UI test: <scope>" with `dependsOn` listing every PHASE 1 and PHASE 2 ticket id. The upstream TESTING signal is `required`.'
      : '6. Do NOT file a tester ticket. Upstream TESTING signal is `skip`.',
    '7. Sequence with `dependsOn` by task id (not title) exactly as PLAN.md and the phase rules above describe.',
    '',
    '## Absolute rules',
    '- Do NOT call `stream_code` in this run. PLAN.md is already on disk.',
    '- Do NOT finish this task until every gap above is closed with a `create_task` call.',
    '- If a gap looks wrong (e.g. you genuinely already filed the missing ticket and the runtime miscounted), reply with a short summary listing each existing ticket id by role so the reviewer can confirm.',
    '',
    '## Context from the previous techlead run',
    `Upstream techlead task id: ${task.id}`,
    `Upstream title: "${task.title}"`,
    '',
    `TESTING: ${testingSignal}`,
  ].join('\n');

  const created = await createTask({
    projectId: task.projectId,
    role: 'techlead',
    title: `File implementation tickets for ${subject}`,
    description,
    status: 'todo',
    parentTaskId: task.id,
    dependsOn: [task.id],
  });

  console.log(
    `[trickle-down] auto-spawned techlead rescue task ${created.id} because techlead ${task.id} left ${missing.length} coverage gap(s): ${missing.join('; ')}`,
  );

  emit({
    projectId: task.projectId,
    role: 'techlead',
    taskId: created.id,
    type: 'task-update',
    payload: { ...kanbanTaskPayload(created), source: 'auto:techlead-rescue' },
  });

  emit({
    projectId: task.projectId,
    role: 'techlead',
    taskId: task.id,
    type: 'chat',
    payload: {
      from: 'system',
      direction: 'from-agent',
      text: `Techlead finished with incomplete ticket coverage (${missing.length} gap(s)) — auto-queued "${created.title}" (${created.id}) to file the rest.`,
      scope: 'task',
    },
  });
}

function extractTestingSignal(description: string): 'required' | 'skip' | null {
  const match = description.match(/^\s*TESTING:\s*(required|skip)\s*$/im);
  if (!match) return null;
  const value = match[1].toLowerCase();
  return value === 'required' ? 'required' : 'skip';
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
