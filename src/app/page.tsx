import { listProjects } from '@/lib/workspace/fs';
import { NewProjectForm } from '@/components/picker/new-project-form';
import { ProjectList } from '@/components/picker/project-list';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const projects = await listProjects();

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-6 py-14">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-olympus-accent to-olympus-amber shadow-soft" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">L&apos;Olympus</h1>
            <p className="text-sm text-olympus-dim">
              A virtual software house — turn a requirement into a running product.
            </p>
          </div>
        </div>
      </header>

      <section className="rounded-xl border border-olympus-border bg-olympus-panel p-6 shadow-soft">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-olympus-dim">
          Start a new project
        </h2>
        <NewProjectForm />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-olympus-dim">
          Your projects
        </h2>
        {projects.length > 0 ? (
          <ProjectList projects={projects} />
        ) : (
          <div className="rounded-xl border border-dashed border-olympus-border p-8 text-center text-sm text-olympus-dim">
            No projects yet. Describe what you want to build above and Olympus will spin up a workspace.
          </div>
        )}
      </section>

      <footer className="mt-auto pt-10 text-xs text-olympus-dim">
        Artifacts live under <code className="rounded bg-olympus-muted px-1">workspaces/&lt;project-id&gt;/.software-house/</code>
      </footer>
    </main>
  );
}
