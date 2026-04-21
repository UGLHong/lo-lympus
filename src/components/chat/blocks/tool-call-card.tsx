'use client';

import { Terminal } from 'lucide-react';
import type { ToolCallBlock } from '@/lib/schemas/content-blocks';

export function ToolCallCard({ block }: { block: ToolCallBlock }) {
  const argsPreview = block.args ? JSON.stringify(block.args) : '';
  return (
    <div className="rounded-md border border-olympus-border bg-olympus-bg/40 p-2">
      <div className="flex items-center gap-2 text-xs">
        <Terminal className="h-3.5 w-3.5 text-olympus-dim" />
        <span className="font-mono text-olympus-blue">{block.tool}</span>
        {argsPreview && (
          <span className="truncate font-mono text-[11px] text-olympus-dim">{argsPreview}</span>
        )}
        {typeof block.ok === 'boolean' && (
          <span className={`ml-auto text-[11px] ${block.ok ? 'text-olympus-green' : 'text-olympus-red'}`}>
            {block.ok ? 'ok' : 'failed'}
          </span>
        )}
      </div>
      {block.resultSummary && (
        <div className="mt-1 truncate text-[11px] text-olympus-dim">{block.resultSummary}</div>
      )}
    </div>
  );
}
