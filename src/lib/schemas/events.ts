import { z } from 'zod';
import { ROLE_KEYS, type RoleState } from '@/lib/const/roles';
import { PIPELINE_PHASES } from '@/lib/const/phases';
import { messageSchema } from './messages';
import { contentBlockSchema } from './content-blocks';
import { ticketStatusValues } from './tickets';

const baseEvent = z.object({
  id: z.string(),
  projectId: z.string(),
  ts: z.string(),
});

export const roleStateValues = [
  'off-duty',
  'idle',
  'thinking',
  'typing',
  'reviewing',
  'testing',
  'blocked',
  'celebrating',
] as const satisfies readonly RoleState[];

export const eventSchema = z.discriminatedUnion('kind', [
  baseEvent.extend({ kind: z.literal('message.created'), message: messageSchema }),
  baseEvent.extend({
    kind: z.literal('message.token'),
    messageId: z.string(),
    delta: z.string(),
  }),
  baseEvent.extend({
    kind: z.literal('message.block'),
    messageId: z.string(),
    block: contentBlockSchema,
  }),
  baseEvent.extend({
    kind: z.literal('message.done'),
    messageId: z.string(),
  }),
  baseEvent.extend({
    kind: z.literal('role.state'),
    role: z.enum(ROLE_KEYS),
    state: z.enum(roleStateValues),
    note: z.string().optional(),
  }),
  baseEvent.extend({
    kind: z.literal('phase.advanced'),
    fromPhase: z.enum(PIPELINE_PHASES),
    toPhase: z.enum(PIPELINE_PHASES),
  }),
  baseEvent.extend({
    kind: z.literal('artifact.written'),
    path: z.string(),
    role: z.enum(ROLE_KEYS),
  }),
  baseEvent.extend({
    kind: z.literal('source.written'),
    path: z.string(),
    role: z.enum(ROLE_KEYS),
    bytes: z.number().int().nonnegative(),
    ticketCode: z.string().optional(),
  }),
  baseEvent.extend({
    kind: z.literal('file.edit'),
    path: z.string(),
    role: z.enum(ROLE_KEYS),
    inserted: z.string(),
    range: z.object({
      startLine: z.number(),
      startCol: z.number(),
      endLine: z.number(),
      endCol: z.number(),
    }),
  }),
  baseEvent.extend({
    kind: z.literal('tool.call'),
    role: z.enum(ROLE_KEYS),
    tool: z.string(),
    args: z.record(z.any()).optional(),
    ok: z.boolean().optional(),
    resultSummary: z.string().optional(),
  }),
  baseEvent.extend({
    kind: z.literal('budget.update'),
    tokensUsed: z.number(),
    wallClockMs: z.number(),
    usdUsed: z.number().default(0),
  }),
  baseEvent.extend({
    kind: z.literal('budget.caps'),
    tokensHard: z.number(),
    wallClockCapMs: z.number(),
    usdHard: z.number(),
    implementAttemptsPerTicket: z.number().int().min(1).max(64).optional(),
  }),
  baseEvent.extend({
    kind: z.literal('log'),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string(),
  }),
  baseEvent.extend({
    kind: z.literal('ticket.index.updated'),
    count: z.number().int().nonnegative(),
  }),
  baseEvent.extend({
    kind: z.literal('ticket.status'),
    code: z.string(),
    status: z.enum(ticketStatusValues),
    attempts: z.number().int().nonnegative().optional(),
  }),
  baseEvent.extend({
    kind: z.literal('review.posted'),
    ticketCode: z.string(),
    decision: z.enum(['approve', 'request-changes', 'block']),
    findings: z.number().int().nonnegative(),
    reviewPath: z.string().optional(),
  }),
  baseEvent.extend({
    kind: z.literal('pipeline.paused'),
    reason: z.string(),
    ticketCode: z.string().optional(),
  }),
  baseEvent.extend({
    kind: z.literal('gate.evaluated'),
    targetPhase: z.enum(PIPELINE_PHASES),
    ok: z.boolean(),
    failingCheck: z.string().optional(),
  }),
  baseEvent.extend({
    kind: z.literal('runtime.start'),
    port: z.number().int().positive(),
    pid: z.number().int().positive().optional(),
    script: z.string(),
    packageManager: z.string(),
    logPath: z.string(),
  }),
  baseEvent.extend({
    kind: z.literal('runtime.stop'),
    reason: z.string(),
  }),
  baseEvent.extend({
    kind: z.literal('runtime.log'),
    channel: z.enum(['stdout', 'stderr']),
    text: z.string(),
  }),
  baseEvent.extend({
    kind: z.literal('incident.opened'),
    incidentId: z.string(),
    classification: z.enum(['frontend', 'backend', 'infra', 'data', 'spec-gap', 'unknown']),
    path: z.string().optional(),
    ticketCode: z.string().optional(),
  }),
  baseEvent.extend({
    kind: z.literal('incident.index.updated'),
    count: z.number().int().nonnegative(),
  }),
  baseEvent.extend({
    kind: z.literal('incident.status'),
    incidentId: z.string(),
    status: z.enum(['open', 'fixing', 'resolved', 'escalated']),
    attempts: z.number().int().nonnegative().optional(),
  }),
  baseEvent.extend({
    kind: z.literal('incident.dispatched'),
    incidentId: z.string(),
    role: z.enum(ROLE_KEYS),
    attempt: z.number().int().positive(),
  }),
  baseEvent.extend({
    kind: z.literal('qa.run'),
    status: z.enum(['started', 'passed', 'failed', 'error']),
    passed: z.number().int().nonnegative().optional(),
    failed: z.number().int().nonnegative().optional(),
    reportPath: z.string().optional(),
    message: z.string().optional(),
  }),
  baseEvent.extend({
    kind: z.literal('barge.in'),
    role: z.enum(ROLE_KEYS),
    text: z.string(),
  }),
  baseEvent.extend({
    kind: z.literal('workspace.fs.changed'),
    path: z.string(),
  }),
  baseEvent.extend({
    kind: z.literal('task.created'),
    taskId: z.string(),
    taskSlug: z.string(),
    taskKind: z.string(),
    role: z.enum(ROLE_KEYS),
    phase: z.enum(PIPELINE_PHASES),
    title: z.string(),
    summary: z.string().optional(),
  }),
  baseEvent.extend({
    kind: z.literal('task.claimed'),
    taskId: z.string(),
    taskSlug: z.string(),
    workerId: z.string(),
    role: z.enum(ROLE_KEYS),
  }),
  baseEvent.extend({
    kind: z.literal('task.completed'),
    taskId: z.string(),
    taskSlug: z.string(),
  }),
  baseEvent.extend({
    kind: z.literal('task.failed'),
    taskId: z.string(),
    taskSlug: z.string(),
    reason: z.string().optional(),
  }),
  baseEvent.extend({
    kind: z.literal('task.paused'),
    taskId: z.string(),
    taskSlug: z.string(),
    reason: z.string().optional(),
  }),
  baseEvent.extend({
    kind: z.literal('task.dropped'),
    taskId: z.string(),
    taskSlug: z.string(),
  }),
]);

export type OlympusEvent = z.infer<typeof eventSchema>;
