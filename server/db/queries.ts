import { existsSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';

import { ensureWorkspacesRoot } from '../workspace/paths';
import { db } from './client';
import { agents, events, projects, tasks } from './schema';

import type { NewAgentRow, NewEventRow, NewProject, NewTask, Project, Task } from './schema';
import type { Role } from '../const/roles';

export async function listProjects(): Promise<Project[]> {
  return db.select().from(projects).orderBy(desc(projects.createdAt));
}

export async function getProjectById(id: string): Promise<Project | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return row;
}

export async function getProjectBySlug(slug: string): Promise<Project | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  return row;
}

export async function createProject(input: NewProject): Promise<Project> {
  const [row] = await db.insert(projects).values(input).returning();
  return row;
}

export async function deleteProjectById(id: string): Promise<Project | undefined> {
  const project = await getProjectById(id);
  if (!project) return undefined;

  await db.transaction(async (tx) => {
    await tx.delete(events).where(eq(events.projectId, id));
    await tx
      .update(agents)
      .set({
        currentTaskId: null,
        currentProjectId: null,
        updatedAt: new Date(),
      })
      .where(eq(agents.currentProjectId, id));
    await tx.delete(projects).where(eq(projects.id, id));
  });

  const workspacesRoot = resolve(ensureWorkspacesRoot());
  const workspacePath = resolve(project.workspaceDir);
  const isUnderRoot =
    workspacePath === workspacesRoot || workspacePath.startsWith(workspacesRoot + sep);
  try {
    if (isUnderRoot && existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('[deleteProjectById] workspace rm failed', project.workspaceDir, err);
  }

  return project;
}

export async function listProjectTasks(projectId: string): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.createdAt));
}

export async function listChildTasks(parentTaskId: string): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.parentTaskId, parentTaskId))
    .orderBy(asc(tasks.createdAt));
}

/**
 * Walk the review/fix chain rooted at `taskId`.
 * - ancestors: parent → grandparent → ... (closest first)
 * - descendants: every task whose parent chain leads back to `taskId` (oldest first)
 */
export async function getTaskChain(taskId: string): Promise<{
  root: Task | null;
  ancestors: Task[];
  descendants: Task[];
}> {
  const root = await getTaskById(taskId);
  if (!root) return { root: null, ancestors: [], descendants: [] };

  const ancestors: Task[] = [];
  let cursor: Task | undefined = root;
  const seen = new Set<string>([root.id]);
  while (cursor?.parentTaskId && !seen.has(cursor.parentTaskId)) {
    const next = await getTaskById(cursor.parentTaskId);
    if (!next) break;
    seen.add(next.id);
    ancestors.push(next);
    cursor = next;
  }

  const descendants: Task[] = [];
  const queue: string[] = [root.id];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    if (visited.has(parentId)) continue;
    visited.add(parentId);
    const children = await listChildTasks(parentId);
    for (const child of children) {
      descendants.push(child);
      queue.push(child.id);
    }
  }
  descendants.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return { root, ancestors, descendants };
}

export async function getTaskById(id: string): Promise<Task | undefined> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return row;
}

export async function createTask(input: NewTask): Promise<Task> {
  const [row] = await db.insert(tasks).values(input).returning();
  return row;
}

export async function updateTask(
  id: string,
  patch: Partial<NewTask>,
): Promise<Task | undefined> {
  const [row] = await db
    .update(tasks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return row;
}

export async function markTaskDone(id: string, result?: Record<string, unknown>): Promise<void> {
  await db
    .update(tasks)
    .set({ status: 'done', result: result ?? null, updatedAt: new Date() })
    .where(eq(tasks.id, id));
}

export async function markTaskPendingReview(
  id: string,
  result?: Record<string, unknown>,
): Promise<void> {
  await db
    .update(tasks)
    .set({ status: 'pending-review', result: result ?? null, updatedAt: new Date() })
    .where(eq(tasks.id, id));
}

// walk ancestors from `startId` upward and update any task currently in
// 'pending-review' to the target status. returns the tasks that transitioned
// so callers can emit kanban updates for them.
async function propagateChainStatus(
  startId: string,
  next: 'done' | 'failed',
  reason?: string,
): Promise<Task[]> {
  const updated: Task[] = [];
  const seen = new Set<string>();
  let cursor: string | null = startId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const row = await getTaskById(cursor);
    if (!row) break;
    if (row.status === 'pending-review') {
      if (next === 'done') {
        await markTaskDone(row.id, row.result ?? undefined);
      } else {
        await markTaskFailed(row.id, reason ?? 'review chain escalated');
      }
      const refreshed = await getTaskById(row.id);
      if (refreshed) updated.push(refreshed);
    }
    cursor = row.parentTaskId;
  }
  return updated;
}

export async function approveReviewedChain(reviewedTaskId: string): Promise<Task[]> {
  return propagateChainStatus(reviewedTaskId, 'done');
}

export async function failReviewedChain(
  reviewedTaskId: string,
  reason: string,
): Promise<Task[]> {
  return propagateChainStatus(reviewedTaskId, 'failed', reason);
}

export async function markTaskFailed(id: string, reason: string): Promise<void> {
  await db
    .update(tasks)
    .set({
      status: 'failed',
      blockedReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, id));
}

// human-triggered retry for a failed task. bumps the per-task review-iteration
// budget and drops the task back into 'todo' so the matching role picks it up
// on the next claim loop. downstream fix tasks inherit the override via
// handleReviewerOutcome when a new fix chain spawns.
export async function retryFailedTaskWithBudgetBonus(
  id: string,
  bonusIterations: number,
): Promise<Task | undefined> {
  const existing = await getTaskById(id);
  if (!existing) return undefined;

  const currentIteration = existing.iteration ?? 0;
  const currentOverride = existing.maxIterationsOverride ?? 0;
  const nextOverride = Math.max(currentOverride, currentIteration) + bonusIterations;

  const [row] = await db
    .update(tasks)
    .set({
      status: 'todo',
      claimedBy: null,
      claimedAt: null,
      blockedReason: null,
      maxIterationsOverride: nextOverride,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, id))
    .returning();
  return row;
}

// human-triggered redo for a completed task. resets it back to todo so the
// agent re-runs from scratch, clearing any prior result and claim state.
export async function redoTask(id: string): Promise<Task | undefined> {
  const [row] = await db
    .update(tasks)
    .set({
      status: 'todo',
      claimedBy: null,
      claimedAt: null,
      blockedReason: null,
      result: null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, id))
    .returning();
  return row;
}

// mark a task and every descendant in its review/fix chain as 'skipped'.
// callers pass the chain root (walk `parentTaskId` to null first) so a skip
// on a mid-chain fix task also clears the original 'pending-review' ancestor
// and any other branches, leaving no pending work behind.
export async function skipTaskSubtree(rootTaskId: string): Promise<Task[]> {
  const { root, descendants } = await getTaskChain(rootTaskId);
  if (!root) return [];

  const targets: Task[] = [root, ...descendants];
  const ids = targets
    .filter((task) => task.status !== 'done' && task.status !== 'skipped')
    .map((task) => task.id);

  if (ids.length === 0) return [];

  const updated = await db
    .update(tasks)
    .set({
      status: 'skipped',
      claimedBy: null,
      claimedAt: null,
      updatedAt: new Date(),
    })
    .where(inArray(tasks.id, ids))
    .returning();

  return updated;
}

// walk parentTaskId upward to find the top of a review/fix chain. a "root"
// here is the first task whose own parent is null — typically the original
// orchestrated ticket that kicked off the review chain.
export async function getTaskChainRoot(taskId: string): Promise<Task | undefined> {
  let cursor = await getTaskById(taskId);
  const seen = new Set<string>();
  while (cursor?.parentTaskId && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    const parent = await getTaskById(cursor.parentTaskId);
    if (!parent) break;
    cursor = parent;
  }
  return cursor;
}

// appends a timestamped human note to the task. notes accumulate and are
// injected into the next agent/reviewer prompt via buildUserMessage /
// buildReviewBrief so context typed in the chat is never silently dropped.
export async function appendUserNote(id: string, note: string): Promise<void> {
  const existing = await getTaskById(id);
  if (!existing) return;

  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const entry = `[${timestamp}] ${note}`;
  const updated = existing.userNotes ? `${existing.userNotes}\n${entry}` : entry;

  await db
    .update(tasks)
    .set({ userNotes: updated, updatedAt: new Date() })
    .where(eq(tasks.id, id));
}

export async function requeueTask(id: string, reason: string): Promise<void> {
  await db
    .update(tasks)
    .set({
      status: 'todo',
      claimedBy: null,
      claimedAt: null,
      blockedReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, id));
}

// tasks left in 'in-progress' from a previous process are orphaned — their
// claiming loop is gone. push them back to 'todo' so the next boot can pick
// them up again.
export async function requeueOrphanedInProgressTasks(): Promise<number> {
  const orphans = await db
    .update(tasks)
    .set({
      status: 'todo',
      claimedBy: null,
      claimedAt: null,
      blockedReason: 'recovered after server restart',
      updatedAt: new Date(),
    })
    .where(eq(tasks.status, 'in-progress'))
    .returning({ id: tasks.id });
  return orphans.length;
}

export async function markTaskBlocked(id: string, reason: string): Promise<void> {
  await db
    .update(tasks)
    .set({
      status: 'blocked-needs-input',
      blockedReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, id));
}

export async function unblockTask(id: string): Promise<void> {
  await db
    .update(tasks)
    .set({
      status: 'todo',
      blockedReason: null,
      claimedBy: null,
      claimedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, id), eq(tasks.status, 'blocked-needs-input')));
}

// tasks currently blocked-on-input whose latest update is older than the
// provided cutoff. used by the clarification watcher to auto-resume tasks
// whose questions the human never answered.
export async function listStaleBlockedTasks(olderThan: Date): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.status, 'blocked-needs-input'),
        sql`${tasks.updatedAt} < ${olderThan.toISOString()}`,
      ),
    )
    .orderBy(asc(tasks.updatedAt));
}

// force-resume a blocked task with a TIMEOUT annotation so the role can
// see, when it re-claims the ticket, that it must proceed with its
// documented fallback assumptions.
export async function resumeBlockedTaskWithAssumptions(
  id: string,
  originalReason: string,
): Promise<Task | undefined> {
  const annotated = [
    'CLARIFICATION TIMEOUT',
    'The human did not answer within the configured budget.',
    'Commit to the fallback assumptions you listed and produce the artifact now.',
    '',
    '--- original question(s) ---',
    originalReason,
  ].join('\n');

  const [row] = await db
    .update(tasks)
    .set({
      status: 'todo',
      blockedReason: annotated,
      claimedBy: null,
      claimedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, id), eq(tasks.status, 'blocked-needs-input')))
    .returning();
  return row;
}

export async function upsertAgent(row: NewAgentRow): Promise<void> {
  await db
    .insert(agents)
    .values(row)
    .onConflictDoUpdate({
      target: agents.role,
      set: {
        status: row.status,
        currentTaskId: row.currentTaskId ?? null,
        currentProjectId: row.currentProjectId ?? null,
        position: row.position ?? { x: 0, y: 0 },
        updatedAt: new Date(),
      },
    });
}

export async function listAgents() {
  return db.select().from(agents).orderBy(asc(agents.role));
}

export async function recordEvent(row: NewEventRow): Promise<void> {
  await db.insert(events).values(row);
}

export async function recentEvents(projectId: string, limit = 200) {
  return db
    .select()
    .from(events)
    .where(eq(events.projectId, projectId))
    .orderBy(desc(events.createdAt))
    .limit(limit);
}

export async function taskEventHistory(taskId: string, limit = 500) {
  return db
    .select()
    .from(events)
    .where(eq(events.taskId, taskId))
    .orderBy(asc(events.createdAt))
    .limit(limit);
}

export async function countTasksByStatus(projectId: string) {
  const rows = await db
    .select({ status: tasks.status, count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .groupBy(tasks.status);
  return rows;
}

export async function pendingRoleTasks(role: Role, projectId?: string): Promise<Task[]> {
  const conditions = projectId
    ? and(eq(tasks.role, role), eq(tasks.status, 'todo'), eq(tasks.projectId, projectId))
    : and(eq(tasks.role, role), eq(tasks.status, 'todo'));
  return db.select().from(tasks).where(conditions).orderBy(asc(tasks.createdAt));
}

export async function tasksDependenciesSatisfied(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const rows = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(inArray(tasks.id, ids));
  if (rows.length !== ids.length) return false;
  return rows.every((row) => row.status === 'done' || row.status === 'skipped');
}
