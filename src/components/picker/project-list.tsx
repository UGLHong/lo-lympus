'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

type ProjectSummary = {
  id: string;
  name: string;
  phase: string;
  updatedAt: string;
};

type ProjectListProps = {
  projects: ProjectSummary[];
};

export function ProjectList({ projects: initialProjects }: ProjectListProps) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {initialProjects.map((project) => (
        <li key={project.id}>
          <ProjectCardItem project={project} />
        </li>
      ))}
    </ul>
  );
}

type ProjectCardItemProps = {
  project: ProjectSummary;
};

function ProjectCardItem({ project }: ProjectCardItemProps) {
  const router = useRouter();
  const confirmDialogRef = useRef<HTMLDialogElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = confirmDialogRef.current;
    if (!dialog) return;
    const handleClose = () => setError(null);
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, []);

  const handleOpenConfirm = useCallback(() => {
    setError(null);
    confirmDialogRef.current?.showModal();
  }, []);

  const handleCancelConfirm = useCallback(() => {
    confirmDialogRef.current?.close();
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (res.ok) {
        confirmDialogRef.current?.close();
        router.refresh();
      } else {
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }, [project.id, router]);

  return (
    <>
      <div
        className={twMerge(
          'flex overflow-hidden rounded-lg border border-olympus-border bg-olympus-panel transition',
          'hover:border-olympus-accent/50 hover:bg-olympus-muted/40',
        )}
      >
        <Link
          href={`/project/${project.id}`}
          className="min-w-0 flex-1 p-4 outline-none focus-visible:ring-2 focus-visible:ring-olympus-accent/40"
        >
          <div className="flex items-baseline justify-between gap-4">
            <span className="truncate font-medium text-olympus-ink">{project.name}</span>
            <span className="shrink-0 rounded bg-olympus-muted px-2 py-0.5 text-xs text-olympus-dim">
              {project.phase}
            </span>
          </div>
          <div className="mt-2 truncate text-xs text-olympus-dim">
            {project.id} &middot; updated {new Date(project.updatedAt).toLocaleString()}
          </div>
        </Link>
        <div className="flex shrink-0 flex-col justify-center border-l border-olympus-border bg-olympus-muted/20 pr-3 pl-2">
          <button
            type="button"
            onClick={handleOpenConfirm}
            className={twMerge(
              'rounded-md p-2 text-olympus-dim transition',
              'hover:bg-olympus-muted hover:text-olympus-red',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olympus-accent/40',
            )}
            aria-label={`Delete project ${project.name}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <dialog
        ref={confirmDialogRef}
        className={twMerge(
          'w-[min(100%,24rem)] rounded-xl border border-olympus-border bg-olympus-panel p-5 text-olympus-ink shadow-soft',
          'backdrop:bg-black/50 backdrop:backdrop-blur-[2px]',
        )}
      >
        <h3 className="text-sm font-semibold">Delete this project?</h3>
        <p className="mt-2 text-sm text-olympus-dim">
          <span className="font-medium text-olympus-ink">{project.name}</span> and its workspace under{' '}
          <code className="rounded bg-olympus-muted px-1 text-xs">workspaces/{project.id}</code> will be removed
          permanently. This cannot be undone.
        </p>
        {error ? <p className="mt-3 text-xs text-olympus-red">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancelConfirm}
            disabled={deleting}
            className="rounded-md border border-olympus-border bg-olympus-bg px-3 py-1.5 text-sm text-olympus-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmDelete}
            disabled={deleting}
            className="rounded-md bg-olympus-red px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </dialog>
    </>
  );
}
