'use client';

import type { ProjectViewState } from '@/lib/client/project-store';
import { PIPELINE_PHASES, PHASE_DESCRIPTIONS, type Phase } from '@/lib/const/phases';

export function PipelineView({ view }: { view: ProjectViewState }) {
  const current = view.state.phase;
  const history = view.state.phaseHistory;

  return (
    <div className="h-full overflow-y-auto bg-olympus-bg">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="mb-6">
          <h2 className="text-lg font-semibold">Pipeline</h2>
          <p className="text-xs text-olympus-dim">
            INTAKE → CLARIFY → SPEC → ARCHITECT → PLAN → IMPLEMENT ⇄ REVIEW → INTEGRATE → BRINGUP → QA_MANUAL
            → SELF_HEAL → SECURITY → RELEASE → DEMO.
          </p>
        </header>

        <ol className="space-y-2">
          {PIPELINE_PHASES.map((phase) => {
            const pastEntry = history.find((h) => h.phase === phase && h.status !== 'running');
            const isCurrent = phase === current;
            return (
              <PhaseRow
                key={phase}
                phase={phase}
                isCurrent={isCurrent}
                done={Boolean(pastEntry)}
              />
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function PhaseRow({ phase, isCurrent, done }: { phase: Phase; isCurrent: boolean; done: boolean }) {
  const indicator = isCurrent ? 'bg-olympus-blue animate-pulse' : done ? 'bg-olympus-green' : 'bg-olympus-border';
  return (
    <li
      className={`flex items-start gap-3 rounded-md border p-3 ${
        isCurrent
          ? 'border-olympus-blue/50 bg-olympus-blue/5'
          : done
            ? 'border-olympus-border bg-olympus-muted/20'
            : 'border-olympus-border bg-olympus-bg/40'
      }`}
    >
      <span className={`mt-1 inline-block h-2 w-2 rounded-full ${indicator}`} />
      <div className="flex-1">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-sm font-medium">{phase}</span>
          {isCurrent && <span className="text-xs text-olympus-blue">running</span>}
          {!isCurrent && done && <span className="text-xs text-olympus-green">done</span>}
        </div>
        <p className="mt-0.5 text-xs text-olympus-dim">{PHASE_DESCRIPTIONS[phase]}</p>
      </div>
    </li>
  );
}
