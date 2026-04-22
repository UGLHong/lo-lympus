import { Form, Link, redirect, useLoaderData, useNavigation } from 'react-router';

import { DeleteProjectForm } from '../components/delete-project-form';
import { RecreateProjectForm } from '../components/recreate-project-form';
import { createProject, createTask, listProjects } from '../../server/db/queries';
import { slugify } from '../lib/slug';
import { projectWorkspace } from '../../server/workspace/paths';
import { nanoid } from 'nanoid';

import type { Route } from './+types/projects._index';

export async function loader(_args: Route.LoaderArgs) {
  const projects = await listProjects().catch(() => []);
  return { projects };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const name = String(form.get('name') ?? '').trim();
  const brief = String(form.get('brief') ?? '').trim();
  if (!name || !brief) {
    return { error: 'name and brief are required' };
  }
  const slug = `${slugify(name)}-${nanoid(6)}`;
  const dir = projectWorkspace(slug);
  const project = await createProject({
    name,
    slug,
    brief,
    workspaceDir: dir,
  });
  
  await createTask({
    projectId: project.id,
    role: 'orchestrator',
    title: 'Orchestrate project development',
    description: `Decompose the project brief into concrete, role-scoped tasks for the team. Here is the project brief:\n\n${brief}\n\nYou should create tasks for the appropriate team members to complete the project.`,
  });
  
  return redirect(`/projects/${project.id}`);
}

export default function ProjectsIndex() {
  const { projects } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const busy = nav.state !== 'idle';

  return (
    <div className="min-h-full p-8 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-accent">L'Olympus</h1>
        <p className="text-sm text-text-muted mt-1">
          the virtual software house. pick a project to enter the control room, or spin up a new
          one.
        </p>
      </header>

      <section className="panel mb-6">
        <div className="panel-header">
          <span>New project</span>
        </div>
        <Form method="post" className="p-4 space-y-3">
          <label className="block text-xs">
            <span className="text-text-muted">Name</span>
            <input
              name="name"
              required
              placeholder="To-do list web app"
              className="mt-1 w-full bg-bg-sunken border border-border rounded px-2 py-1.5 text-xs"
            />
          </label>
          <label className="block text-xs">
            <span className="text-text-muted">Brief</span>
            <textarea
              name="brief"
              required
              rows={4}
              placeholder="A single-page todo app with add, complete, delete. Local storage only. Tailwind UI."
              className="mt-1 w-full bg-bg-sunken border border-border rounded px-2 py-1.5 text-xs font-mono resize-none"
            />
          </label>
          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'creating…' : 'Create project'}
            </button>
          </div>
        </Form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span>Projects</span>
          <span className="text-text-faint">{projects.length}</span>
        </div>
        <ul className="divide-y divide-border">
          {projects.length === 0 && (
            <li className="p-4 text-xs text-text-faint italic">no projects yet.</li>
          )}
          {projects.map((p) => (
            <li key={p.id} className="flex items-stretch gap-0">
              <Link
                to={`/projects/${p.id}`}
                className="flex-1 min-w-0 block px-4 py-3 text-xs hover:bg-bg-raised"
              >
                <div className="flex items-center gap-2">
                  <span className="text-text">{p.name}</span>
                  <span className="text-text-faint">/{p.slug}</span>
                  <span className="ml-auto text-text-faint shrink-0">
                    {new Date(p.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-text-muted mt-1 line-clamp-2">{p.brief}</p>
              </Link>
              <div className="shrink-0 flex items-center gap-2 pr-3 py-2">
                <RecreateProjectForm
                  projectId={p.id}
                  projectName={p.name}
                  projectBrief={p.brief}
                  buttonLabel="Recreate"
                />
                <DeleteProjectForm projectId={p.id} buttonLabel="Delete" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
