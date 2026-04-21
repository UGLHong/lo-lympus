import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Project not found</h1>
      <p className="text-sm text-olympus-dim">
        The project you requested does not exist in{' '}
        <code className="rounded bg-olympus-muted px-1">./workspaces/</code>.
      </p>
      <Link href="/" className="rounded bg-olympus-accent px-3 py-1.5 text-sm font-medium text-olympus-bg">
        Back to project picker
      </Link>
    </main>
  );
}
