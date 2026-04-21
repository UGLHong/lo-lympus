import { z } from 'zod';
import { ROLE_KEYS } from '@/lib/const/roles';
import { PIPELINE_PHASES } from '@/lib/const/phases';

const roleKeySchema = z.enum(ROLE_KEYS);
const phaseSchema = z.enum(PIPELINE_PHASES);

export const artifactBlockSchema = z.object({
  kind: z.literal('artifact'),
  title: z.string(),
  path: z.string(),
  artifactKind: z.enum(['requirements', 'spec', 'architecture', 'adr', 'ticket', 'review', 'incident', 'qa-report', 'note']),
  phase: phaseSchema.optional(),
  role: roleKeySchema.optional(),
  status: z.enum(['draft', 'review-requested', 'approved', 'changes-requested']).optional(),
  excerpt: z.string().optional(),
});

export const questionBlockSchema = z.object({
  kind: z.literal('question'),
  id: z.string(),
  question: z.string(),
  options: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        isDefault: z.boolean().optional(),
      }),
    )
    .min(2),
  allowFreeText: z.boolean().default(true),
});

export const gateBlockSchema = z.object({
  kind: z.literal('gate'),
  fromPhase: phaseSchema,
  toPhase: phaseSchema,
  decision: z
    .enum(['pending', 'approved', 'rejected', 'proceed', 'block'])
    .transform((value) => {
      if (value === 'proceed') return 'approved' as const;
      if (value === 'block') return 'rejected' as const;
      return value;
    })
    .default('pending'),
  checks: z.array(
    z.object({
      label: z.string(),
      ok: z.boolean(),
      note: z.string().optional(),
    }),
  ),
});

export const toolCallBlockSchema = z.object({
  kind: z.literal('tool-call'),
  tool: z.string(),
  args: z.record(z.any()).optional(),
  resultSummary: z.string().optional(),
  ok: z.boolean().optional(),
  durationMs: z.number().optional(),
});

export const diffBlockSchema = z.object({
  kind: z.literal('diff'),
  path: z.string(),
  before: z.string(),
  after: z.string(),
});

export const ticketBlockSchema = z.object({
  kind: z.literal('ticket'),
  code: z.string(),
  title: z.string(),
  assigneeRole: roleKeySchema.optional(),
  dependsOn: z.array(z.string()).default([]),
  status: z
    .enum(['todo', 'in-progress', 'review', 'changes-requested', 'done', 'blocked'])
    .default('todo'),
});

export const incidentBlockSchema = z.object({
  kind: z.literal('incident'),
  code: z.string(),
  title: z.string(),
  classification: z.enum(['frontend', 'backend', 'infra', 'data', 'spec-gap']),
  status: z.enum(['open', 'fixing', 'resolved', 'escalated']).default('open'),
});

export const budgetBlockSchema = z.object({
  kind: z.literal('budget'),
  tokensUsed: z.number(),
  tokensHard: z.number(),
  wallClockMs: z.number(),
  wallClockCapMs: z.number(),
});

export const contentBlockSchema = z.discriminatedUnion('kind', [
  artifactBlockSchema,
  questionBlockSchema,
  gateBlockSchema,
  toolCallBlockSchema,
  diffBlockSchema,
  ticketBlockSchema,
  incidentBlockSchema,
  budgetBlockSchema,
]);

export type ContentBlock = z.infer<typeof contentBlockSchema>;
export type DiffBlock = z.infer<typeof diffBlockSchema>;
export type ArtifactBlock = z.infer<typeof artifactBlockSchema>;
export type QuestionBlock = z.infer<typeof questionBlockSchema>;
export type GateBlock = z.infer<typeof gateBlockSchema>;
export type ToolCallBlock = z.infer<typeof toolCallBlockSchema>;
export type TicketBlock = z.infer<typeof ticketBlockSchema>;
