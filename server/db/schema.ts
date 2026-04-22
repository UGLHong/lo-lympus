import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const taskStatusEnum = pgEnum('olympus_task_status', [
  'todo',
  'in-progress',
  'pending-review',
  'blocked-needs-input',
  'done',
  'failed',
  'skipped',
]);

export const projectStatusEnum = pgEnum('olympus_project_status', [
  'active',
  'paused',
  'archived',
]);

export const agentStatusEnum = pgEnum('olympus_agent_status', [
  'idle',
  'working',
  'blocked',
  'offline',
]);

export const eventTypeEnum = pgEnum('olympus_event_type', [
  'code-chunk',
  'state',
  'log',
  'chat',
  'workspace-change',
  'task-update',
]);

export const projects = pgTable(
  'olympus_projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    brief: text('brief').notNull(),
    workspaceDir: text('workspace_dir').notNull(),
    status: projectStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: index('projects_slug_idx').on(table.slug),
  }),
);

export const tasks = pgTable(
  'olympus_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: taskStatusEnum('status').notNull().default('todo'),
    dependsOn: jsonb('depends_on').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    threadId: text('thread_id'),
    claimedBy: text('claimed_by'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    result: jsonb('result').$type<Record<string, unknown> | null>(),
    blockedReason: text('blocked_reason'),
    // review chain: a reviewer task points at the task it reviewed; a fix task
    // points at the reviewer task that requested the change. walking parents
    // reconstructs the full self-healing iteration history for any task.
    parentTaskId: uuid('parent_task_id'),
    iteration: integer('iteration').notNull().default(0),
    // per-task override for the review iteration cap. lets the human extend the
    // budget on a specific failing chain (via "retry") without touching the
    // global setting. null means "use settings.maxReviewIterations".
    maxIterationsOverride: integer('max_iterations_override'),
    // human notes typed in the task chat that are not Q&A answers —
    // appended on each non-clarification user message and injected into the
    // next agent/reviewer prompt so context never gets lost.
    userNotes: text('user_notes'),
    modelTier: text('model_tier'),
    modelName: text('model_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusRoleIdx: index('tasks_status_role_idx').on(table.status, table.role),
    projectStatusIdx: index('tasks_project_status_idx').on(table.projectId, table.status),
    parentIdx: index('tasks_parent_idx').on(table.parentTaskId),
  }),
);

export const agents = pgTable('olympus_agents', {
  role: text('role').primaryKey(),
  status: agentStatusEnum('status').notNull().default('idle'),
  currentTaskId: uuid('current_task_id'),
  currentProjectId: uuid('current_project_id'),
  position: jsonb('position').$type<{ x: number; y: number }>().notNull().default({ x: 0, y: 0 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable(
  'olympus_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    projectId: uuid('project_id').notNull(),
    role: text('role'),
    taskId: uuid('task_id'),
    type: eventTypeEnum('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectCreatedIdx: index('events_project_created_idx').on(table.projectId, table.createdAt),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type AgentRow = typeof agents.$inferSelect;
export type NewAgentRow = typeof agents.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
