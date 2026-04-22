import { data, redirect, useLoaderData } from 'react-router';

import { ControlRoom } from '../components/control-room';
import { kanbanTaskPayload } from '../../server/lib/kanban-task-payload';
import {
  deleteProjectById,
  getProjectById,
  listProjectTasks,
  createProject,
  createTask,
} from '../../server/db/queries';
import { slugify } from '../lib/slug';
import { projectWorkspace } from '../../server/workspace/paths';
import { nanoid } from 'nanoid';

import type { Route } from './+types/projects.$id';

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== 'POST') throw data('Method not allowed', { status: 405 });
  const formData = await request.formData();
  const intent = formData.get('_intent');

  if (intent === 'delete') {
    const removed = await deleteProjectById(params.id);
    if (!removed) throw data('Project not found', { status: 404 });
    return redirect('/projects');
  }

  if (intent === 'recreate') {
    const project = await getProjectById(params.id);
    if (!project) throw data('Project not found', { status: 404 });

    const name = String(formData.get('name') ?? '').trim();
    const brief = String(formData.get('brief') ?? '').trim();

    if (!name || !brief) {
      throw data('name and brief are required', { status: 400 });
    }

    await deleteProjectById(params.id);

    const slug = `${slugify(name)}-${nanoid(6)}`;
    const dir = projectWorkspace(slug);
    const newProject = await createProject({
      name,
      slug,
      brief,
      workspaceDir: dir,
    });

    await createTask({
      projectId: newProject.id,
      role: 'orchestrator',
      title: 'Orchestrate project development',
      description: `Decompose the project brief into concrete, role-scoped tasks for the team. Here is the project brief:\n\n${brief}\n\nYou should create tasks for the appropriate team members to complete the project.`,
    });

    return redirect(`/projects/${newProject.id}`);
  }

  throw data('Unsupported action', { status: 400 });
}

export async function loader({ params }: Route.LoaderArgs) {
  const project = await getProjectById(params.id);
  if (!project) throw data('Project not found', { status: 404 });
  const tasks = await listProjectTasks(project.id);
  return {
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      brief: project.brief,
    },
    tasks: tasks.map((t) => kanbanTaskPayload(t)),
  };
}

export default function ProjectDetail() {
  const { project, tasks } = useLoaderData<typeof loader>();
  return <ControlRoom project={project} initialTasks={tasks} />;
}
