import type { Task } from '../db/schema';

/** Serializable task shape for loaders and SSE (ISO date strings). */
export function kanbanTaskPayload(task: Task) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    role: task.role,
    claimedBy: task.claimedBy,
    claimedAt: task.claimedAt ? task.claimedAt.toISOString() : null,
    blockedReason: task.blockedReason,
    result: task.result,
    dependsOn: task.dependsOn,
    parentTaskId: task.parentTaskId,
    iteration: task.iteration,
    modelTier: task.modelTier,
    modelName: task.modelName,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}
