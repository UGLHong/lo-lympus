import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { emit } from '../../app/lib/event-bus.server';
import { kanbanTaskPayload } from '../lib/kanban-task-payload';
import { getTaskById, markTaskBlocked } from '../db/queries';

interface ToolCtx {
  projectId: string;
  projectSlug: string;
  role: string;
  taskId?: string;
}

export function buildRequestHumanInputTool(ctx: ToolCtx) {
  return createTool({
    id: 'request_human_input',
    description:
      'Block the current task and ask the human overseer a specific question. Use when requirements are ambiguous or credentials are missing. The task will pause until the human replies in the task chat. Pass `options` when the answer is one of a small fixed set so the human sees clickable choices (MCQ); omit `options` for freeform input.',
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
      return { ok: true, status: 'blocked-needs-input' };
    },
  });
}
