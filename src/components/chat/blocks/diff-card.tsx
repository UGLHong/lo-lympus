'use client';

import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, FileDiff } from 'lucide-react';
import type { DiffBlock } from '@/lib/schemas/content-blocks';
import { useProjectNavigation } from '@/components/layout/project-navigation';
import { cn } from '@/lib/utils/cn';

type Props = { block: DiffBlock };

export function DiffCard({ block }: Props) {
  const { openArtifact } = useProjectNavigation();
  const [expanded, setExpanded] = useState(false);
  const handleOpen = useCallback(() => openArtifact(block.path), [block.path, openArtifact]);
  const handleToggle = useCallback(() => setExpanded((previous) => !previous), []);

  const lineStats = useMemo(() => {
    const beforeCount = block.before === '' ? 0 : block.before.split('\n').length;
    const afterCount = block.after === '' ? 0 : block.after.split('\n').length;
    return { beforeCount, afterCount };
  }, [block.after, block.before]);

  const previewAfter =
    block.after.trim().length > 0
      ? block.after.split('\n').slice(0, 3).join('\n')
      : '(empty)';

  return (
    <div className="rounded-md border border-emerald-500/25 bg-olympus-bg/50">
      <div className="flex items-start gap-2 p-3">
        <FileDiff className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-sm font-medium text-olympus-ink">{block.path}</span>
            <span className="rounded bg-olympus-muted px-1.5 py-[1px] text-[10px] uppercase text-olympus-dim">
              diff
            </span>
            <span className="text-[10px] text-olympus-dim">
              {lineStats.beforeCount}→{lineStats.afterCount} lines
            </span>
          </div>
          {!expanded && (
            <pre className="mt-2 line-clamp-4 max-h-24 overflow-hidden rounded border border-olympus-border/40 bg-olympus-muted/20 p-2 font-mono text-[11px] leading-snug text-olympus-dim">
              {previewAfter}
            </pre>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleOpen}
              className="rounded border border-olympus-border/60 px-2 py-1 text-[10px] uppercase tracking-wider text-olympus-dim transition hover:border-olympus-accent/50 hover:text-olympus-ink"
            >
              Open file
            </button>
            <button
              type="button"
              onClick={handleToggle}
              className="flex items-center gap-1 rounded border border-olympus-border/60 px-2 py-1 text-[10px] uppercase tracking-wider text-olympus-dim transition hover:border-olympus-accent/50 hover:text-olympus-ink"
            >
              {expanded ? 'Hide' : 'Full'} before / after
              <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
            </button>
          </div>
        </div>
      </div>
      {expanded && (
        <div className="grid max-h-72 grid-cols-2 gap-px border-t border-olympus-border/40 bg-olympus-border/40">
          <div className="min-h-0 bg-olympus-bg/80 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-olympus-dim">Before</div>
            <pre className="max-h-60 overflow-auto font-mono text-[11px] leading-snug text-olympus-dim">
              {block.before || ' '}
            </pre>
          </div>
          <div className="min-h-0 bg-olympus-bg/80 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-olympus-dim">After</div>
            <pre className="max-h-60 overflow-auto font-mono text-[11px] leading-snug text-olympus-ink">
              {block.after || ' '}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
