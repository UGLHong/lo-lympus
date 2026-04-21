import { z } from 'zod';
import { ROLE_KEYS } from '@/lib/const/roles';
import { PIPELINE_PHASES } from '@/lib/const/phases';

// keep in sync with the legacy TaskKind union in src/lib/pipeline/backlog.ts.
// This schema lives in its own module so the new task-pool store can evolve
// without cycles against the pipeline layer.
export const TASK_KINDS = [
  'orchestrator-intake',
  'orchestrator-clarify',
  'pm-spec',
  'architect-design',
  'techlead-plan',
  'phase-review',
  'ticket-dev',
  'ticket-review',
  'devops-bringup',
  'qa-plan',
  'incident-triage',
  'incident-heal',
  'security-review',
  'release-notes',
  'writer-demo',
] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = [
  'pending',
  'in-progress',
  'paused-awaiting-human',
  'done',
  'failed',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const taskSchema = z.object({
  id: z.string(),
  slug: z.string(),
  projectId: z.string(),
  kind: z.enum(TASK_KINDS),
  role: z.enum(ROLE_KEYS),
  phase: z.enum(PIPELINE_PHASES),
  status: z.enum(TASK_STATUSES),
  title: z.string(),
  summary: z.string().optional(),
  payload: z.record(z.any()).default({}),
  humanMessage: z.string().nullable().default(null),
  dependsOn: z.array(z.string()).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
  claimedAt: z.number().nullable().default(null),
  claimedBy: z.string().nullable().default(null),
  finishedAt: z.number().nullable().default(null),
  failureReason: z.string().nullable().default(null),
  pauseReason: z.string().nullable().default(null),
});

export type Task = z.infer<typeof taskSchema>;

export const taskSnapshotSchema = z.object({
  projectId: z.string(),
  updatedAt: z.number(),
  tasks: z.array(taskSchema),
});

export type TaskSnapshot = z.infer<typeof taskSnapshotSchema>;

export const taskEventKinds = [
  'task.created',
  'task.claimed',
  'task.completed',
  'task.failed',
  'task.paused',
  'task.dropped',
] as const;

export type TaskEventKind = (typeof taskEventKinds)[number];
