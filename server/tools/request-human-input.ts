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

export function buildRequestHumanInputTool(ctx: ToolCtx) {
  return createTool({
    id: 'request_human_input',
    description: [
      'Block the current task on a question that needs authoritative input.',
      '',
      'Routing:',
      '- Non-CTO roles: the question is filtered through the CTO first. The CTO investigates the spec/plan/code and either answers on your behalf (via `answer_task_question`) or escalates to the human.',
      '- CTO role: escalates directly to the human overseer (use sparingly — exhaust the docs / board first).',
      '',
      'Prefer `ask_clarifying_questions` when you have multiple ambiguities — batching is cheaper than a drip-feed of single questions.',
      '',
      'Pass `options` (2–8 short labels) when the answer is one of a fixed set so the responder sees clickable choices. Omit for freeform input.',
    ].join('\n'),
    inputSchema: z.object({
      question: z.string().min(1).describe('A single, specific question for the human.'),
      context: z.string().optional().describe('Optional context, e.g. what you tried.'),
      options: z
        .array(z.string().min(1))
        .min(2)
        .max(8)
        .optional()
        .describe('Optional multiple-choice answer set. Include 2-8 short labels when applicable.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      status: z.string(),
    }),
    execute: async (input) => {
      const options = input.options ?? [];
      const reasonParts = [input.question];
      if (options.length > 0) {
        reasonParts.push('', 'Options:', ...options.map((o, i) => `${i + 1}. ${o}`));
      }
      if (input.context) {
        reasonParts.push('', '---', input.context);
      }
      const reason = reasonParts.join('\n');

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
        const triage = await spawnOrAppendCtoFilterTask(ctx, {
          question: input.question,
          context: input.context,
          options,
        });

        const headline =
          triage.kind === 'merged'
            ? 'Added a follow-up question to the existing CTO triage.'
            : 'Forwarded to the CTO for triage.';

        emit({
          projectId: ctx.projectId,
          role: ctx.role,
          taskId: ctx.taskId,
          type: 'chat',
          payload: {
            from: ctx.role,
            direction: 'from-agent',
            text: `${headline}\n\nQuestion: ${input.question}${options.length > 0 ? `\n\nOptions:\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}` : ''}${input.context ? `\n\nContext: ${input.context}` : ''}`,
            scope: 'task',
            messageType: 'hitl-question',
            triageTaskId: triage.triageId,
            ...(options.length > 0 ? { options } : {}),
            ...(input.context ? { context: input.context } : {}),
          },
        });
      } else {
        emit({
          projectId: ctx.projectId,
          role: ctx.role,
          taskId: ctx.taskId,
          type: 'chat',
          payload: {
            from: ctx.role,
            direction: 'to-human',
            text: input.question,
            ...(options.length > 0 ? { options } : {}),
            ...(input.context ? { context: input.context } : {}),
          },
        });
      }

      return { ok: true, status: 'blocked-needs-input' };
    },
  });
}

interface CtoFilterInput {
  question: string;
  context?: string;
  options: string[];
}

type TriageAction = { kind: 'spawned'; triageId: string } | { kind: 'merged'; triageId: string };

function formatQuestionBlock(input: CtoFilterInput): string {
  const lines = [`Question:\n${input.question}`];
  if (input.options.length > 0) {
    lines.push('', 'Answer options:');
    input.options.forEach((opt, index) => lines.push(`${index + 1}. ${opt}`));
  }
  if (input.context) {
    lines.push('', 'Context from the asker:', input.context);
  }
  return lines.join('\n');
}

async function spawnOrAppendCtoFilterTask(
  ctx: ToolCtx,
  input: CtoFilterInput,
): Promise<TriageAction> {
  if (!ctx.taskId) return { kind: 'spawned', triageId: '' };

  const existing = await findOpenCtoTriageForParent(ctx.taskId);
  if (existing) {
    const addendum = [
      `--- follow-up question (${new Date().toISOString()}) ---`,
      formatQuestionBlock(input),
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
  const shortQuestion = input.question.length > 80 ? `${input.question.slice(0, 77)}...` : input.question;

  const description = [
    'CTO TRIAGE: an agent asked a human question. Filter it before it reaches the overseer.',
    '',
    `Asking role: ${ctx.role}`,
    `Original task id: ${ctx.taskId}`,
    `Original task title: ${originalTitle}`,
    '',
    formatQuestionBlock(input),
    '',
    'Your job:',
    '1. Investigate the spec, plan, generated code, and task history to see if this question can be answered factually.',
    '2. Low-level assumptions are allowed when they do not contradict any observed fact.',
    '3. If you can confidently answer, call `answer_task_question` with the original task id above and your answer.',
    '4. If you cannot conclude, call `request_human_input` on this task — that will escalate to the real human overseer.',
    '5. Never write code yourself; if a code change is the fix, delegate it with `create_task` to the right role.',
  ].join('\n');

  const filterTask = await createTask({
    projectId: ctx.projectId,
    role: 'cto',
    title: `Triage: ${originalTitle} — ${shortQuestion}`,
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
