import 'dotenv/config';
import { nanoid } from 'nanoid';

import { createProject, createTask, listProjects } from '../server/db/queries';
import { projectWorkspace } from '../server/workspace/paths';

async function main() {
  const existing = await listProjects();
  const slug = `smoke-${nanoid(4)}`;
  const name = 'Smoke Project';
  const brief =
    'Minimal smoke test: build a hello-world HTML file that shows the current timestamp.';

  const project = await createProject({
    name,
    slug,
    brief,
    workspaceDir: projectWorkspace(slug),
  });
  console.log(`created project ${project.name} (${project.id})`);

  const task = await createTask({
    projectId: project.id,
    role: 'backend-dev',
    title: 'Create index.html with the current date',
    description:
      'Using the `stream_code` tool, write a file called `index.html` at the workspace root. It should display the text "Hello from L\'Olympus" and a server-rendered timestamp.',
    status: 'todo',
  });
  console.log(`seeded ticket ${task.id} for role=${task.role}`);
  console.log(`existing projects: ${existing.length + 1}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
