import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { emit } from '../../app/lib/event-bus.server';
import { kanbanTaskPayload } from '../lib/kanban-task-payload';
import {
  appendToTaskDescription,
  createTask,
  findOpenCtoTriageForParent,
  getTaskById,
  markTaskBlocked,
} from '../db/queries';

interface ToolCtx {
  projectId: string;
  projectSlug: string;
  role: string;
  taskId?: string;
}

const MAX_QUESTIONS = 8;

const QuestionSchema = z.object({
  question: z.string().min(1).describe('A single, specific clarifying question.'),
  context: z
    .string()
    .optional()
    .describe('Why this matters — the risk of guessing or the decisions it unlocks.'),
  options: z
    .array(z.string().min(1))
    .min(2)
    .max(8)
    .optional()
    .describe('Optional MCQ answer set (2-8 short labels).'),
  fallbackAssumption: z
    .string()
    .min(1)
    .describe(
      'The assumption you will proceed with if no answer arrives. Must be specific and actionable.',
    ),
});

type ClarifyingQuestion = z.infer<typeof QuestionSchema>;

export function buildAskClarifyingQuestionsTool(ctx: ToolCtx) {
  return createTool({
    id: 'ask_clarifying_questions',
    description: [
      'Batch-ask a set of clarifying questions before starting planning work.',
      'For non-CTO roles the questions are first routed to the CTO, who tries to answer them using the spec, plan, and generated artifacts and only escalates to the actual human when it cannot conclude.',
      'Prefer this over `request_human_input` when you have multiple ambiguities — asking everything at once is cheaper than a drip-feed.',
      'Every question MUST include a `fallbackAssumption` so the role can proceed if no answer arrives within the configured timeout.',
      'The task is parked in `blocked-needs-input` until the answer comes back. If the clarification timeout elapses the watcher resumes the task with an instruction to commit to the fallback assumptions.',
    ].join(' '),
    inputSchema: z.object({
      summary: z
        .string()
        .min(1)
        .describe('One-line framing of the decision you are trying to unblock.'),
      questions: z
        .array(QuestionSchema)
        .min(1)
        .max(MAX_QUESTIONS)
        .describe('The clarifying questions to ask, most impactful first.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      status: z.string(),
    }),
    execute: async (input) => {
      const { summary, questions } = input;

      const reason = buildBlockedReason(summary, questions);

      if (ctx.taskId) {
        await markTaskBlocked(ctx.taskId, reason);
        const row = await getTaskById(ctx.taskId);
        if (row) {
          emit({
            projectId: ctx.projectId,
            role: ctx.role,
            taskId: ctx.taskId,
            type: 'task-update',
            payload: kanbanTaskPayload(row),
          });
        }
      }

      emit({
        projectId: ctx.projectId,
        role: ctx.role,
        taskId: ctx.taskId,
        type: 'state',
        payload: { status: 'blocked', reason },
      });

      const routeThroughCto = ctx.role !== 'cto' && Boolean(ctx.taskId);

      if (routeThroughCto) {
        const triageAction = await spawnOrAppendCtoFilterTask(ctx, summary, questions);
        emitQuestionAuditTrail(ctx, summary, questions, triageAction);
      } else {
        emitToHumanChat(ctx, summary, questions);
      }

      return { ok: true, status: 'blocked-needs-input' };
    },
  });
}

type TriageAction = { kind: 'spawned'; triageId: string } | { kind: 'merged'; triageId: string };

// keep a single source of truth for the question block so the chat audit trail,
// the triage task description, and the blockedReason all render identically.
function formatQuestionBlock(summary: string, questions: ClarifyingQuestion[]): string {
  const lines = [`Summary: ${summary}`, '', 'Questions:'];
  questions.forEach((q, index) => {
    lines.push(`Q${index + 1}. ${q.question}`);
    if (q.options && q.options.length > 0) {
      q.options.forEach((opt, optionIndex) => {
        lines.push(`   ${String.fromCharCode(97 + optionIndex)}. ${opt}`);
      });
    }
    if (q.context) lines.push(`   context: ${q.context}`);
    lines.push(`   fallback: ${q.fallbackAssumption}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

function emitQuestionAuditTrail(
  ctx: ToolCtx,
  summary: string,
  questions: ClarifyingQuestion[],
  triage: TriageAction,
): void {
  const headline =
    triage.kind === 'merged'
      ? `Added ${questions.length} more clarification(s) to the existing CTO triage.`
      : `Forwarded ${questions.length} clarification(s) to the CTO for triage.`;

  emit({
    projectId: ctx.projectId,
    role: ctx.role,
    taskId: ctx.taskId,
    type: 'chat',
    payload: {
      from: ctx.role,
      direction: 'from-agent',
      text: `${headline}\n\n${formatQuestionBlock(summary, questions)}`,
      scope: 'task',
      messageType: 'hitl-question',
      triageTaskId: triage.triageId,
      clarifications: questions.map((q) => ({
        question: q.question,
        options: q.options ?? [],
        context: q.context ?? '',
        fallbackAssumption: q.fallbackAssumption,
      })),
    },
  });
}

function buildBlockedReason(summary: string, questions: ClarifyingQuestion[]): string {
  const lines: string[] = [`CLARIFICATION NEEDED: ${summary}`, ''];
  questions.forEach((q, index) => {
    lines.push(`Q${index + 1}. ${q.question}`);
    if (q.options && q.options.length > 0) {
      q.options.forEach((opt, optionIndex) => {
        lines.push(`   ${String.fromCharCode(97 + optionIndex)}. ${opt}`);
      });
    }
    if (q.context) lines.push(`   context: ${q.context}`);
    lines.push(`   fallback: ${q.fallbackAssumption}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

function emitToHumanChat(ctx: ToolCtx, summary: string, questions: ClarifyingQuestion[]): void {
  const headerText = [
    `Clarification needed: ${summary}`,
    '',
    ...questions.map((q, index) => {
      const parts = [`${index + 1}. ${q.question}`];
      if (q.options && q.options.length > 0) {
        parts.push(
          '   ' + q.options.map((opt, optionIndex) => `(${String.fromCharCode(97 + optionIndex)}) ${opt}`).join('  '),
        );
      }
      return parts.join('\n');
    }),
  ].join('\n');

  // flatten MCQ options across every question so the chat UI can still
  // render click-to-answer buttons. each label is prefixed with "Qn:" so
  // the agent can tell which question a click response is answering.
  const flattenedOptions: string[] = [];
  questions.forEach((q, index) => {
    if (!q.options || q.options.length === 0) return;
    for (const opt of q.options) flattenedOptions.push(`Q${index + 1}: ${opt}`);
  });

  emit({
    projectId: ctx.projectId,
    role: ctx.role,
    taskId: ctx.taskId,
    type: 'chat',
    payload: {
      from: ctx.role,
      direction: 'to-human',
      text: headerText,
      ...(flattenedOptions.length > 0 ? { options: flattenedOptions } : {}),
      clarifications: questions.map((q) => ({
        question: q.question,
        options: q.options ?? [],
        context: q.context ?? '',
        fallbackAssumption: q.fallbackAssumption,
      })),
    },
  });
}

async function spawnOrAppendCtoFilterTask(
  ctx: ToolCtx,
  summary: string,
  questions: ClarifyingQuestion[],
): Promise<TriageAction> {
  if (!ctx.taskId) return { kind: 'spawned', triageId: '' };

  const existing = await findOpenCtoTriageForParent(ctx.taskId);
  if (existing) {
    const addendum = [
      `--- follow-up batch (${new Date().toISOString()}) ---`,
      formatQuestionBlock(summary, questions),
    ].join('\n');
    const updated = await appendToTaskDescription(existing.id, addendum);
    if (updated) {
      emit({
        projectId: updated.projectId,
        role: 'cto',
        taskId: updated.id,
        type: 'task-update',
        payload: kanbanTaskPayload(updated),
      });
    }
    return { kind: 'merged', triageId: existing.id };
  }

  const originalTask = await getTaskById(ctx.taskId);
  const originalTitle = originalTask?.title ?? 'unknown task';

  const description = [
    'CTO TRIAGE: an agent requested clarification. Filter these questions before they reach the overseer.',
    '',
    `Asking role: ${ctx.role}`,
    `Original task id: ${ctx.taskId}`,
    `Original task title: ${originalTitle}`,
    '',
    formatQuestionBlock(summary, questions),
    '',
    'Your job:',
    '1. Investigate the spec, plan, generated code, and task history to see if each question can be answered factually.',
    '2. Low-level assumptions are allowed when they do not contradict any observed fact.',
    '3. If you can confidently answer ALL of them, call `answer_task_question` with the original task id above and a single consolidated answer covering every question.',
    '4. If you cannot conclude, call `request_human_input` (or `ask_clarifying_questions` for the subset still in doubt) on this CTO task — that will escalate to the real human overseer.',
    '5. Never write code yourself; if a code change is the fix, delegate it with `create_task` to the right role.',
  ].join('\n');

  const filterTask = await createTask({
    projectId: ctx.projectId,
    role: 'cto',
    title: `Triage: ${originalTitle} — ${questions.length} clarification(s)`,
    description,
    status: 'todo',
    parentTaskId: ctx.taskId,
  });

  emit({
    projectId: filterTask.projectId,
    role: 'cto',
    taskId: filterTask.id,
    type: 'task-update',
    payload: kanbanTaskPayload(filterTask),
  });

  return { kind: 'spawned', triageId: filterTask.id };
}
