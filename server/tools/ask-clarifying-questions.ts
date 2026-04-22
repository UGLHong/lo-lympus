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
      'The assumption you will proceed with if the human does not answer. Must be specific and actionable.',
    ),
});

export function buildAskClarifyingQuestionsTool(ctx: ToolCtx) {
  return createTool({
    id: 'ask_clarifying_questions',
    description: [
      'Batch-ask the human overseer a set of clarifying questions before starting planning or orchestration work.',
      'Prefer this over `request_human_input` when you have multiple ambiguities — asking everything at once is cheaper for the human than a drip-feed.',
      'Every question MUST include a `fallbackAssumption` so the role can proceed if no answer arrives within the configured timeout.',
      'The task is parked in `blocked-needs-input` until the human replies. If the clarification timeout elapses the watcher resumes the task with an instruction to commit to the fallback assumptions.',
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

      const reasonLines: string[] = [`CLARIFICATION NEEDED: ${summary}`, ''];
      questions.forEach((q, i) => {
        reasonLines.push(`Q${i + 1}. ${q.question}`);
        if (q.options && q.options.length > 0) {
          q.options.forEach((opt, j) => {
            reasonLines.push(`   ${String.fromCharCode(97 + j)}. ${opt}`);
          });
        }
        if (q.context) reasonLines.push(`   context: ${q.context}`);
        reasonLines.push(`   fallback: ${q.fallbackAssumption}`);
        reasonLines.push('');
      });
      const reason = reasonLines.join('\n').trim();

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

      const headerText = [
        `Clarification needed: ${summary}`,
        '',
        ...questions.map((q, i) => {
          const parts = [`${i + 1}. ${q.question}`];
          if (q.options && q.options.length > 0) {
            parts.push(
              '   ' + q.options.map((opt, j) => `(${String.fromCharCode(97 + j)}) ${opt}`).join('  '),
            );
          }
          return parts.join('\n');
        }),
      ].join('\n');

      // flatten MCQ options across every question so the chat UI can still
      // render click-to-answer buttons. each label is prefixed with "Qn:" so
      // the agent can tell which question a click response is answering.
      const flattenedOptions: string[] = [];
      questions.forEach((q, i) => {
        if (!q.options || q.options.length === 0) return;
        for (const opt of q.options) flattenedOptions.push(`Q${i + 1}: ${opt}`);
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

      return { ok: true, status: 'blocked-needs-input' };
    },
  });
}
