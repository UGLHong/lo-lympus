import type { Task } from "../db/schema";

/** Convert a date or timestamp string to ISO string format. Handles both Date objects and string timestamps from the database. */
function toISOString(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  if (typeof date === "string") return date;
  if (date instanceof Date) return date.toISOString();
  return null;
}

/** Serializable task shape for loaders and SSE (ISO date strings). */
export function kanbanTaskPayload(task: Task) {
  // createdAt and updatedAt are required fields, so they should never be null
  // but the pg driver may return them as strings already
  const createdAt =
    typeof task.createdAt === "string"
      ? task.createdAt
      : task.createdAt.toISOString();
  const updatedAt =
    typeof task.updatedAt === "string"
      ? task.updatedAt
      : task.updatedAt.toISOString();

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    role: task.role,
    claimedBy: task.claimedBy,
    claimedAt: toISOString(task.claimedAt),
    blockedReason: task.blockedReason,
    result: task.result,
    dependsOn: task.dependsOn,
    parentTaskId: task.parentTaskId,
    iteration: task.iteration,
    modelTier: task.modelTier,
    modelName: task.modelName,
    createdAt,
    updatedAt,
  };
}
