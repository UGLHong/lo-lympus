import { listAgents, listProjectTasks } from '../../server/db/queries';

import type { Route } from './+types/api.agents';

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  if (!projectId) return Response.json({ error: 'projectId required' }, { status: 400 });

  const [agents, tasks] = await Promise.all([listAgents(), listProjectTasks(projectId)]);

  const agentsById = new Map(agents.map((row) => [row.role, row]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  const projectAgents = Array.from(agentsById.values()).map((row) => {
    const currentTask = row.currentTaskId ? taskById.get(row.currentTaskId) : undefined;
    const completed = tasks.filter(
      (task) => task.role === row.role && task.status === 'done',
    ).length;
    const active = tasks.filter(
      (task) => task.role === row.role && task.status === 'in-progress',
    ).length;
    const backlog = tasks.filter(
      (task) => task.role === row.role && task.status === 'todo',
    ).length;

    return {
      role: row.role,
      status: row.status,
      currentTaskId: row.currentTaskId,
      currentTaskTitle:
        currentTask && currentTask.projectId === projectId ? currentTask.title : null,
      currentProjectId: row.currentProjectId,
      updatedAt: row.updatedAt.toISOString(),
      completed,
      active,
      backlog,
    };
  });

  return Response.json({ agents: projectAgents });
}
