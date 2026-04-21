'use client';

import { CheckCircle2, XCircle, CircleDashed } from 'lucide-react';
import type { GateBlock } from '@/lib/schemas/content-blocks';

export function GateCard({ block }: { block: GateBlock }) {
  const allOk = block.checks.every((check) => check.ok);
  return (
    <div className="rounded-md border border-olympus-border bg-olympus-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-olympus-dim">
          <CircleDashed className="h-4 w-4" />
          Gate · {block.fromPhase} → {block.toPhase}
        </div>
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            block.decision === 'approved'
              ? 'bg-olympus-green/15 text-olympus-green'
              : block.decision === 'rejected'
                ? 'bg-olympus-red/15 text-olympus-red'
                : allOk
                  ? 'bg-olympus-blue/15 text-olympus-blue'
                  : 'bg-olympus-amber/15 text-olympus-amber'
          }`}
        >
          {block.decision}
        </span>
      </div>
      <ul className="space-y-1">
        {block.checks.map((check, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-olympus-ink/90">
            {check.ok ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-olympus-green" />
            ) : (
              <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-olympus-red" />
            )}
            <span>{check.label}</span>
            {check.note && <span className="text-olympus-dim">— {check.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
