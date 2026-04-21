import { nanoid } from 'nanoid';
import type { RoleKey } from '@/lib/const/roles';
import type { Phase } from '@/lib/const/phases';

export type TaskKind =
  | 'orchestrator-intake'
  | 'orchestrator-clarify'
  | 'pm-spec'
  | 'architect-design'
  | 'techlead-plan'
  | 'phase-review'
  | 'ticket-dev'
  | 'ticket-review'
  | 'devops-bringup'
  | 'qa-plan'
  | 'incident-triage'
  | 'incident-heal'
  | 'security-review'
  | 'release-notes'
  | 'writer-demo';

export type TaskStatus = 'pending' | 'in-progress' | 'done' | 'failed';

export type BacklogTask = {
  id: string;
  projectId: string;
  kind: TaskKind;
  role: RoleKey;
  phase: Phase;
  payload: Record<string, unknown>;
  status: TaskStatus;
  createdAt: number;
  claimedAt: number | null;
  finishedAt: number | null;
  claimedBy: string | null;
  humanMessage: string | null;
};

type ProjectBacklog = {
  tasks: Map<string, BacklogTask>;
};

type BacklogStore = Map<string, ProjectBacklog>;

declare global {
  // eslint-disable-next-line no-var
  var __olympus_backlog__: BacklogStore | undefined;
}

function getStore(): BacklogStore {
  if (!globalThis.__olympus_backlog__) {
    globalThis.__olympus_backlog__ = new Map();
  }
  return globalThis.__olympus_backlog__;
}

function getProjectBacklog(projectId: string): ProjectBacklog {
  const store = getStore();
  let existing = store.get(projectId);
  if (!existing) {
    existing = { tasks: new Map() };
    store.set(projectId, existing);
  }
  return existing;
}

type EnqueueInput = {
  projectId: string;
  kind: TaskKind;
  role: RoleKey;
  phase: Phase;
  payload?: Record<string, unknown>;
  humanMessage?: string | null;
};

// dedupe key: tasks that target the same conceptual unit of work should not
// stack in the backlog. Covers re-seed races where the supervisor and a
// completion handler both try to queue the same dev/review.
function dedupeKey(task: EnqueueInput): string {
  const payloadKey = task.payload
    ? Object.keys(task.payload)
        .sort()
        .map((k) => `${k}=${String(task.payload?.[k])}`)
        .join('|')
    : '';
  return `${task.kind}::${task.role}::${payloadKey}`;
}

export function enqueueTask(input: EnqueueInput): BacklogTask {
  const backlog = getProjectBacklog(input.projectId);
  const key = dedupeKey(input);

  for (const existing of backlog.tasks.values()) {
    if (existing.status === 'done' || existing.status === 'failed') continue;
    if (dedupeKey(existing) === key) return existing;
  }

  const task: BacklogTask = {
    id: nanoid(),
    projectId: input.projectId,
    kind: input.kind,
    role: input.role,
    phase: input.phase,
    payload: input.payload ?? {},
    status: 'pending',
    createdAt: Date.now(),
    claimedAt: null,
    finishedAt: null,
    claimedBy: null,
    humanMessage: input.humanMessage ?? null,
  };

  backlog.tasks.set(task.id, task);
  return task;
}

export function claimNextForRole(
  projectId: string,
  role: RoleKey,
  workerId: string,
): BacklogTask | null {
  const backlog = getProjectBacklog(projectId);
  const pending = [...backlog.tasks.values()]
    .filter((task) => task.status === 'pending' && task.role === role)
    .sort((a, b) => a.createdAt - b.createdAt);

  const next = pending[0];
  if (!next) return null;

  next.status = 'in-progress';
  next.claimedAt = Date.now();
  next.claimedBy = workerId;
  return next;
}

export function completeTask(projectId: string, id: string): BacklogTask | null {
  const backlog = getProjectBacklog(projectId);
  const task = backlog.tasks.get(id);
  if (!task) return null;
  task.status = 'done';
  task.finishedAt = Date.now();
  backlog.tasks.delete(id);
  return task;
}

export function failTask(projectId: string, id: string): BacklogTask | null {
  const backlog = getProjectBacklog(projectId);
  const task = backlog.tasks.get(id);
  if (!task) return null;
  task.status = 'failed';
  task.finishedAt = Date.now();
  backlog.tasks.delete(id);
  return task;
}

export type BacklogFilter = {
  phase?: Phase;
  role?: RoleKey;
  kind?: TaskKind;
  statuses?: readonly TaskStatus[];
};

function matchesFilter(task: BacklogTask, filter: BacklogFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.phase && task.phase !== filter.phase) return false;
  if (filter.role && task.role !== filter.role) return false;
  if (filter.kind && task.kind !== filter.kind) return false;
  if (filter.statuses && !filter.statuses.includes(task.status)) return false;
  return true;
}

export function listBacklog(projectId: string, filter?: BacklogFilter): BacklogTask[] {
  const backlog = getProjectBacklog(projectId);
  return [...backlog.tasks.values()].filter((task) => matchesFilter(task, filter));
}

export function countBacklog(projectId: string, filter?: BacklogFilter): number {
  return listBacklog(projectId, filter).length;
}

export function hasLiveTaskWithPayload(
  projectId: string,
  kind: TaskKind,
  payloadKey: string,
  payloadValue: string,
): boolean {
  return listBacklog(projectId, { kind, statuses: ['pending', 'in-progress'] }).some(
    (task) => String(task.payload[payloadKey]) === payloadValue,
  );
}

export function clearBacklog(projectId: string): void {
  getStore().delete(projectId);
}

// drops every pending (not-yet-claimed) task matching the filter. Used when
// the artifact under review is about to be rewritten and any queued review
// would be stale. In-progress tasks are left alone so a running worker
// finishes cleanly without a mid-flight cancel.
export function dropPendingTasks(projectId: string, filter: BacklogFilter): number {
  const backlog = getProjectBacklog(projectId);
  let dropped = 0;
  for (const task of [...backlog.tasks.values()]) {
    if (task.status !== 'pending') continue;
    if (!matchesFilter(task, filter)) continue;
    backlog.tasks.delete(task.id);
    dropped += 1;
  }
  return dropped;
}
