import { nanoid } from 'nanoid';
import { z } from 'zod';

import { createProject, listProjects } from '../../server/db/queries';
import { projectWorkspace } from '../../server/workspace/paths';
import { slugify } from '../lib/slug';

import type { Route } from './+types/api.projects';

const CreateSchema = z.object({
  name: z.string().min(1),
  brief: z.string().min(1),
});

export async function loader(_args: Route.LoaderArgs) {
  const projects = await listProjects();
  return Response.json({ projects });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const json = await request.json();
  const parsed = CreateSchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  const slug = `${slugify(parsed.data.name)}-${nanoid(6)}`;
  const dir = projectWorkspace(slug);
  const project = await createProject({
    name: parsed.data.name,
    brief: parsed.data.brief,
    slug,
    workspaceDir: dir,
  });
  return Response.json({ project });
}
