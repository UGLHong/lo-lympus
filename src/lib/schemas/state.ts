import { z } from 'zod';
import { PIPELINE_PHASES } from '@/lib/const/phases';

export const projectStateSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  slug: z.string(),
  phase: z.enum(PIPELINE_PHASES),
  paused: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  budgets: z.object({
    tokensUsed: z.number().default(0),
    tokensHard: z.number(),
    wallClockMs: z.number().default(0),
    wallClockCapMs: z.number(),
    usdUsed: z.number().default(0),
    usdHard: z.number().default(0),
  }),
  phaseHistory: z.array(
    z.object({
      phase: z.enum(PIPELINE_PHASES),
      startedAt: z.string(),
      endedAt: z.string().optional(),
      status: z.enum(['running', 'done', 'blocked', 'skipped']),
    }),
  ),
  clarifications: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string().nullable(),
      }),
    )
    .default([]),
  assumptions: z.array(z.string()).default([]),
  limits: z
    .object({
      implementAttemptsPerTicket: z.number().int().min(1).max(64).optional(),
    })
    .optional(),
});

export type ProjectState = z.infer<typeof projectStateSchema>;
