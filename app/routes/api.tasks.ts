import { z } from "zod";

import { emit } from "../lib/event-bus.server";
import { kanbanTaskPayload } from "../../server/lib/kanban-task-payload";
import {
  createTask,
  getTaskById,
  listProjectTasks,
  unblockTask,
  updateTask,
} from "../../server/db/queries";
import { ROLES } from "../../server/const/roles";

import type { Route } from "./+types/api.tasks";

const CreateSchema = z.object({
  projectId: z.string().uuid(),
  role: z.enum(ROLES),
  title: z.string().min(1),
  description: z.string().default(""),
  dependsOn: z.array(z.string().uuid()).optional(),
});

const UpdateSchema = z.object({
  id: z.string().uuid(),
  status: z
    .enum([
      "todo",
      "in-progress",
      "pending-review",
      "blocked-needs-input",
      "done",
      "failed",
      "skipped",
    ])
    .optional(),
  title: z.string().optional(),
  description: z.string().optional(),
});

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const taskId = url.searchParams.get("id");

  if (taskId) {
    const task = await getTaskById(taskId);
    if (!task)
      return Response.json({ error: "Task not found" }, { status: 404 });
    return Response.json({ task: kanbanTaskPayload(task) });
  }

  if (!projectId)
    return Response.json({ error: "projectId required" }, { status: 400 });
  const tasks = await listProjectTasks(projectId);
  return Response.json({ tasks: tasks.map(kanbanTaskPayload) });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method === "POST") {
    const json = await request.json();
    const parsed = CreateSchema.safeParse(json);
    if (!parsed.success)
      return Response.json({ error: parsed.error.flatten() }, { status: 400 });
    const task = await createTask({
      projectId: parsed.data.projectId,
      role: parsed.data.role,
      title: parsed.data.title,
      description: parsed.data.description,
      dependsOn: parsed.data.dependsOn ?? [],
      status: "todo",
    });
    emit({
      projectId: task.projectId,
      role: task.role,
      taskId: task.id,
      type: "task-update",
      payload: kanbanTaskPayload(task),
    });
    return Response.json({ task });
  }
  if (request.method === "PATCH") {
    const json = await request.json();
    const parsed = UpdateSchema.safeParse(json);
    if (!parsed.success)
      return Response.json({ error: parsed.error.flatten() }, { status: 400 });
    const existing = await getTaskById(parsed.data.id);
    if (!existing)
      return Response.json({ error: "not found" }, { status: 404 });
    if (
      parsed.data.status === "todo" &&
      existing.status === "blocked-needs-input"
    ) {
      await unblockTask(existing.id);
    } else {
      await updateTask(parsed.data.id, parsed.data);
    }
    const next = await getTaskById(parsed.data.id);
    if (next) {
      emit({
        projectId: next.projectId,
        role: next.role,
        taskId: next.id,
        type: "task-update",
        payload: kanbanTaskPayload(next),
      });
    }
    return Response.json({ task: next });
  }
  return new Response("Method not allowed", { status: 405 });
}
