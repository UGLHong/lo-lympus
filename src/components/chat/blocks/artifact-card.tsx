'use client';

import { FileText } from 'lucide-react';
import type { ArtifactBlock } from '@/lib/schemas/content-blocks';
import { useProjectNavigation } from '@/components/layout/project-navigation';

export function ArtifactCard({ block }: { block: ArtifactBlock }) {
  const { openArtifact } = useProjectNavigation();
  const handleOpen = () => openArtifact(block.path);

  return (
    <button
      type="button"
      onClick={handleOpen}
      title={`Open ${block.path}`}
      className="group w-full rounded-md border border-olympus-border bg-olympus-muted/30 p-3 text-left transition hover:border-olympus-accent/60 hover:bg-olympus-muted/60"
    >
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-olympus-accent" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-olympus-ink group-hover:text-olympus-accent">
              {block.title}
            </span>
            <span className="rounded bg-olympus-muted px-1.5 py-[1px] text-[10px] uppercase text-olympus-dim">
              {block.artifactKind}
            </span>
            {block.phase && (
              <span className="rounded bg-olympus-muted px-1.5 py-[1px] text-[10px] text-olympus-dim">
                {block.phase}
              </span>
            )}
            {block.status && (
              <span className="rounded bg-olympus-accent/15 px-1.5 py-[1px] text-[10px] text-olympus-accent">
                {block.status}
              </span>
            )}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-olympus-accent underline decoration-olympus-accent/40 underline-offset-2 group-hover:decoration-olympus-accent">
            {block.path}
          </div>
          {block.excerpt && (
            <div className="mt-1 line-clamp-3 text-xs text-olympus-ink/80">{block.excerpt}</div>
          )}
        </div>
      </div>
    </button>
  );
}
