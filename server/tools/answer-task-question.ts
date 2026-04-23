import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { emit } from '../../app/lib/event-bus.server';
import { kanbanTaskPayload } from '../lib/kanban-task-payload';
import { appendUserNote, getTaskById, unblockTask } from '../db/queries';
import { getMemory } from '../mastra/runtime';
import { abortRunningTask } from '../daemon/task-abort-registry';

interface ToolCtx {
  projectId: string;
  projectSlug: string;
  role: string;
  taskId?: string;
}

export function buildAnswerTaskQuestionTool(ctx: ToolCtx) {
  return createTool({
    id: 'answer_task_question',
    description: [
      'CTO-only. Resolve another agent\'s blocked-needs-input question on behalf of the human.',
      '',
      'Use ONLY after you have actually investigated the spec, plan, generated code, and task history — not as a guess. Low-level assumptions are allowed as long as they do not contradict any observed fact.',
      '',
      'Effect:',
      '- Target task transitions out of `blocked-needs-input` and its current run is aborted so the next attempt picks up with your answer injected into the memory thread as if the human had replied.',
      '- A dedicated `cto-resolution` chat message is posted on the target task so humans can audit the decision.',
      '',
      'If you cannot confidently conclude, call `request_human_input` on YOUR OWN task instead so the overseer is pulled in.',
    ].join('\n'),
    inputSchema: z.object({
      taskId: z.string().describe('The blocked task id (uuid string) to resolve (the original question asker, not your own task).'),
      answer: z
        .string()
        .min(1)
        .describe('The answer text that will be injected as if from the human. Be specific and actionable.'),
      rationale: z
        .string()
        .optional()
        .describe('Optional short note explaining what evidence / assumptions led to this answer.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      taskId: z.string().optional(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      const target = await getTaskById(input.taskId);
      if (!target) return { ok: false, error: 'task not found' };
      if (target.status !== 'blocked-needs-input') {
        return { ok: false, error: `task not blocked (status: ${target.status})` };
      }

      const answerBlock = input.rationale
        ? `[CTO-on-behalf] ${input.answer}\n\nCTO rationale: ${input.rationale}`
        : `[CTO-on-behalf] ${input.answer}`;

      await appendUserNote(input.taskId, answerBlock);
      await unblockTask(input.taskId);
      abortRunningTask(input.taskId);

      const threadId = target.threadId ?? `task-${target.id}`;
      try {
        const memory = getMemory();
        await memory.saveMessages({
          messages: [
            {
              id: `cto-answer-${Date.now()}`,
              threadId,
              resourceId: target.projectId,
              role: 'user',
              content: { format: 2, parts: [{ type: 'text', text: answerBlock }] },
              type: 'text',
              createdAt: new Date(),
            },
          ],
        });
      } catch (err) {
        console.error('[answer_task_question] memory save failed:', err);
      }

      const updated = await getTaskById(input.taskId);
      if (updated) {
        emit({
          projectId: target.projectId,
          role: target.role,
          taskId: target.id,
          type: 'task-update',
          payload: kanbanTaskPayload(updated),
        });
      }

      emit({
        projectId: target.projectId,
        role: target.role,
        taskId: target.id,
        type: 'chat',
        payload: {
          from: 'cto',
          direction: 'from-agent',
          text: `CTO resolved the blocked question on behalf of the human.\nAnswer: ${input.answer}${input.rationale ? `\nRationale: ${input.rationale}` : ''}`,
          scope: 'task',
          messageType: 'cto-resolution',
          answer: input.answer,
          rationale: input.rationale ?? '',
          originalQuestion: target.blockedReason ?? '',
        },
      });

      emit({
        projectId: target.projectId,
        role: target.role,
        taskId: target.id,
        type: 'state',
        payload: { status: 'idle', reason: 'resolved-by-cto' },
      });

      return { ok: true, taskId: input.taskId };
    },
  });
}
