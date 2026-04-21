import type { RoleKey } from '@/lib/const/roles';
import type { Phase } from '@/lib/const/phases';
import {
  claimNextForRole as poolClaimNextForRole,
  clearProjectTasks,
  completeTask as poolCompleteTask,
  createTask,
  dropPendingTasks as poolDropPendingTasks,
  failTask as poolFailTask,
  hasLiveTaskWithPayload as poolHasLiveTaskWithPayload,
  listTasks,
  pauseTaskAwaitingHuman,
} from '@/lib/task-pool/store';
import type { Task, TaskKind, TaskStatus } from '@/lib/task-pool/schema';

// the pool is the source of truth now. This module is kept as the thin
// public API the pipeline/supervisor/handlers already import; all calls
// forward to the persistent task-pool store.
export type BacklogTask = Task;
export type { TaskKind, TaskStatus } from '@/lib/task-pool/schema';

type EnqueueInput = {
  projectId: string;
  kind: TaskKind;
  role: RoleKey;
  phase: Phase;
  payload?: Record<string, unknown>;
  humanMessage?: string | null;
};

export function enqueueTask(input: EnqueueInput): BacklogTask {
  return createTask(input);
}

export function claimNextForRole(
  projectId: string,
  role: RoleKey,
  workerId: string,
  acceptedKinds?: readonly TaskKind[] | null,
): BacklogTask | null {
  return poolClaimNextForRole(projectId, role, workerId, {
    acceptedKinds: acceptedKinds ?? null,
  });
}

export function completeTask(projectId: string, id: string): BacklogTask | null {
  return poolCompleteTask(projectId, id);
}

export function failTask(
  projectId: string,
  id: string,
  reason?: string,
): BacklogTask | null {
  return poolFailTask(projectId, id, reason);
}

export function pauseTaskForHuman(
  projectId: string,
  id: string,
  reason?: string,
): BacklogTask | null {
  return pauseTaskAwaitingHuman(projectId, id, reason);
}

export type BacklogFilter = {
  phase?: Phase;
  role?: RoleKey;
  kind?: TaskKind;
  statuses?: readonly TaskStatus[];
};

export function listBacklog(
  projectId: string,
  filter?: BacklogFilter,
): BacklogTask[] {
  return listTasks(projectId, filter);
}

export function countBacklog(
  projectId: string,
  filter?: BacklogFilter,
): number {
  return listTasks(projectId, filter).length;
}

export function hasLiveTaskWithPayload(
  projectId: string,
  kind: TaskKind,
  payloadKey: string,
  payloadValue: string,
): boolean {
  return poolHasLiveTaskWithPayload(projectId, kind, payloadKey, payloadValue);
}

export function clearBacklog(projectId: string): void {
  clearProjectTasks(projectId);
}

export function dropPendingTasks(
  projectId: string,
  filter: BacklogFilter,
): number {
  return poolDropPendingTasks(projectId, filter);
}
