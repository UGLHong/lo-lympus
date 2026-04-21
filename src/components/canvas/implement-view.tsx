'use client';

import { Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import type { ProjectViewState } from '@/lib/client/project-store';

type TicketSnapshot = {
  code: string;
  status: string;
};

type Props = {
  view: ProjectViewState;
};

type ImplementSummary = {
  completed: string[];
  changesRequested: string[];
  blocked: string[];
  paused: boolean;
  reason?: string;
  steps: number;
};

type RunState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; summary: ImplementSummary }
  | { kind: 'error'; message: string };

type KickState = { kind: 'idle' } | { kind: 'pending' } | { kind: 'error'; message: string };

export function ImplementView({ view }: Props) {
  const [runState, setRunState] = useState<RunState>({ kind: 'idle' });
  const [kickState, setKickState] = useState<KickState>({ kind: 'idle' });
  const projectId = view.state.projectId;
  const paused = view.state.paused;
  const phase = view.state.phase;
  const pipelineComplete = phase === 'DEMO';
  const pipelineBusy = runState.kind === 'pending' || kickState.kind === 'pending';

  const ticketEvents = useMemo(() => {
    return view.events.filter(
      (event) =>
        event.kind === 'ticket.status' ||
        event.kind === 'review.posted' ||
        event.kind === 'source.written' ||
        event.kind === 'pipeline.paused' ||
        event.kind === 'gate.evaluated',
    );
  }, [view.events]);

  // The event stream buffer only holds recent events and won't replay historical
  // `ticket.status` events after a dev-server restart, so we fetch the tickets
  // index directly to reliably detect blocked tickets. Refetch when new
  // `ticket.status` events arrive so the UI stays in sync with the backend.
  const [tickets, setTickets] = useState<TicketSnapshot[]>([]);
  const latestTicketStatusTs = useMemo(() => {
    for (let i = view.events.length - 1; i >= 0; i -= 1) {
      if (view.events[i]!.kind === 'ticket.status') return view.events[i]!.ts;
    }
    return null;
  }, [view.events]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/tickets`);
        if (!res.ok) return;
        const payload = (await res.json()) as { tickets: TicketSnapshot[] };
        if (cancelled) return;
        setTickets(payload.tickets ?? []);
      } catch {
        // next refetch will retry on the next ticket.status event
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, latestTicketStatusTs]);

  const blockedTicketCodes = useMemo(
    () => tickets.filter((t) => t.status === 'blocked').map((t) => t.code),
    [tickets],
  );

  const stuckInFlightCodes = useMemo(
    () =>
      tickets
        .filter((t) => t.status === 'in-progress' || t.status === 'review')
        .map((t) => t.code),
    [tickets],
  );

  const needsResume =
    paused || blockedTicketCodes.length > 0 || stuckInFlightCodes.length > 0;
  const resumeLabel = paused
    ? 'Resume implementation'
    : blockedTicketCodes.length > 0
      ? 'Retry blocked tickets'
      : 'Recover stuck ticket';

  const triggerImplement = useCallback(
    async (resume = false) => {
      setRunState({ kind: 'pending' });
      try {
        const response = await fetch(`/api/projects/${projectId}/implement`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resume }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setRunState({
            kind: 'error',
            message: body.error ?? `request failed (${response.status})`,
          });
          return;
        }
        const payload = (await response.json()) as { summary: ImplementSummary };
        setRunState({ kind: 'success', summary: payload.summary });
      } catch (err) {
        setRunState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [projectId],
  );

  const handleRun = useCallback(() => triggerImplement(false), [triggerImplement]);
  const handleResume = useCallback(() => triggerImplement(true), [triggerImplement]);

  const handleKickPipeline = useCallback(async () => {
    if (pipelineComplete) return;
    const confirmed = window.confirm(
      [
        'Kick the full pipeline from the current phase?',
        '',
        'This clears pause, unblocks stuck tickets, and runs the orchestrator (driveProject).',
        'Use when the project is stuck outside the implement loop alone.',
      ].join('\n'),
    );
    if (!confirmed) return;
    setKickState({ kind: 'pending' });
    try {
      const response = await fetch(`/api/projects/${projectId}/pipeline/kick`, { method: 'POST' });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setKickState({
          kind: 'error',
          message: body.error ?? `request failed (${response.status})`,
        });
        return;
      }
      setKickState({ kind: 'idle' });
    } catch (err) {
      setKickState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [pipelineComplete, projectId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-olympus-bg">
      <div className="border-b border-olympus-border bg-olympus-panel text-xs">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="uppercase tracking-wider text-olympus-dim">Implement</span>
        <span className="text-olympus-ink/80">phase: {view.state.phase}</span>
        {paused && (
          <span className="rounded bg-olympus-amber/20 px-2 py-0.5 text-[11px] text-olympus-amber">
            paused — HELP_NEEDED.md written
          </span>
        )}
        {!paused && blockedTicketCodes.length > 0 && (
          <span className="rounded bg-olympus-amber/20 px-2 py-0.5 text-[11px] text-olympus-amber">
            blocked: {blockedTicketCodes.join(', ')}
          </span>
        )}
        {!paused && stuckInFlightCodes.length > 0 && (
          <span className="rounded bg-olympus-amber/20 px-2 py-0.5 text-[11px] text-olympus-amber">
            stuck in flight: {stuckInFlightCodes.join(', ')}
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleRun}
            disabled={pipelineBusy}
            className={twMerge(
              'rounded border border-olympus-border bg-olympus-muted px-2.5 py-1 text-xs text-olympus-ink transition hover:bg-olympus-panel disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {runState.kind === 'pending' ? 'Running…' : 'Run loop'}
          </button>
          {needsResume && (
            <button
              type="button"
              onClick={handleResume}
              disabled={pipelineBusy}
              className="rounded border border-olympus-amber/60 bg-olympus-muted px-2.5 py-1 text-xs text-olympus-amber transition hover:bg-olympus-panel disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resumeLabel}
            </button>
          )}
          <button
            type="button"
            onClick={handleKickPipeline}
            disabled={pipelineComplete || pipelineBusy}
            title={
              pipelineComplete
                ? 'Pipeline finished (DEMO)'
                : 'Unstick + run full orchestrator from current phase'
            }
            className={twMerge(
              'inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
              pipelineComplete
                ? 'cursor-not-allowed border-olympus-border text-olympus-dim'
                : 'border-olympus-red/50 bg-olympus-red/10 text-olympus-red hover:bg-olympus-red/20',
            )}
          >
            <Zap className="h-3.5 w-3.5" aria-hidden />
            {kickState.kind === 'pending' ? 'Kicking…' : 'Kick pipeline'}
          </button>
        </div>
        {kickState.kind === 'error' && (
          <div className="px-3 pb-2 text-end text-[11px] text-olympus-red">{kickState.message}</div>
        )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ImplementSummaryPanel
          runState={runState}
          implementAttemptsPerTicket={view.state.limits?.implementAttemptsPerTicket ?? null}
        />
        <ImplementEventStream events={ticketEvents} />
      </div>
    </div>
  );
}

function ImplementSummaryPanel({
  runState,
  implementAttemptsPerTicket,
}: {
  runState: RunState;
  implementAttemptsPerTicket: number | null;
}) {
  const attemptsHint =
    implementAttemptsPerTicket === null
      ? 'Budgets tab or server env (BUDGET_IMPLEMENT_ATTEMPTS_PER_TICKET)'
      : `${implementAttemptsPerTicket} (Budgets tab)`;
  return (
    <div className="flex min-h-0 flex-col border-r border-olympus-border p-3 text-xs">
      <div className="mb-2 text-[11px] uppercase tracking-wider text-olympus-dim">
        Last run summary
      </div>
      {runState.kind === 'idle' && (
        <p className="text-olympus-dim">
          Press <span className="text-olympus-ink">Run loop</span> to walk the ticket DAG. Each ticket runs Dev →
          Reviewer → status, bounded by the per-ticket attempt cap ({attemptsHint}). Exhaustion writes HELP_NEEDED.md
          and pauses — Resume clears the block and starts a fresh attempt budget.{' '}
          <span className="text-olympus-ink/90">Kick pipeline</span> clears pause, unblocks tickets, and runs the full
          orchestrator from the current phase (disabled when phase is DEMO).
        </p>
      )}
      {runState.kind === 'pending' && <p className="text-olympus-ink/80">Implement loop running…</p>}
      {runState.kind === 'error' && <p className="text-olympus-red">{runState.message}</p>}
      {runState.kind === 'success' && <ImplementSummaryCard summary={runState.summary} />}
    </div>
  );
}

function ImplementSummaryCard({ summary }: { summary: ImplementSummary }) {
  return (
    <div className="space-y-2 text-olympus-ink/90">
      <div>steps walked: {summary.steps}</div>
      <SummaryRow label="completed" items={summary.completed} tone="ok" />
      <SummaryRow label="changes requested" items={summary.changesRequested} tone="warn" />
      <SummaryRow label="blocked" items={summary.blocked} tone="bad" />
      {summary.paused && (
        <div className="rounded border border-olympus-amber/40 bg-olympus-amber/10 px-2 py-1 text-[11px] text-olympus-amber">
          paused: {summary.reason ?? 'unknown reason'}
        </div>
      )}
      {summary.reason && !summary.paused && (
        <div className="text-[11px] text-olympus-dim">stopped: {summary.reason}</div>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: 'ok' | 'warn' | 'bad';
}) {
  const toneClass =
    tone === 'ok' ? 'text-olympus-green' : tone === 'warn' ? 'text-olympus-amber' : 'text-olympus-red';
  return (
    <div>
      <span className="mr-2 text-olympus-dim">{label}:</span>
      {items.length === 0 ? (
        <span className="text-olympus-dim">none</span>
      ) : (
        <span className={toneClass}>{items.join(', ')}</span>
      )}
    </div>
  );
}

function ImplementEventStream({
  events,
}: {
  events: ProjectViewState['events'];
}) {
  const reversed = [...events].slice(-80).reverse();
  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-olympus-border px-3 py-1.5 text-[11px] uppercase tracking-wider text-olympus-dim">
        Implement-related events ({events.length})
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11px]">
        {reversed.length === 0 ? (
          <div className="text-olympus-dim">No ticket/review events yet.</div>
        ) : (
          <ul className="space-y-0.5">
            {reversed.map((event) => (
              <li key={event.id} className="flex gap-2">
                <span className="w-20 flex-shrink-0 text-olympus-dim/70">{event.ts.slice(11, 19)}</span>
                <span className="w-32 flex-shrink-0 text-olympus-accent">{event.kind}</span>
                <span className="min-w-0 flex-1 truncate text-olympus-ink/90">
                  {summarizeImplementEvent(event)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function summarizeImplementEvent(event: ProjectViewState['events'][number]): string {
  switch (event.kind) {
    case 'ticket.status':
      return `${event.code} → ${event.status}${event.attempts ? ` [attempt ${event.attempts}]` : ''}`;
    case 'review.posted':
      return `${event.ticketCode}: ${event.decision} (${event.findings} finding${event.findings === 1 ? '' : 's'})`;
    case 'source.written':
      return `${event.path} by @${event.role} (${event.bytes}B)`;
    case 'pipeline.paused':
      return `paused: ${event.reason}`;
    case 'gate.evaluated':
      return event.ok
        ? `${event.targetPhase}: gate ok`
        : `${event.targetPhase}: gate blocked — ${event.failingCheck ?? 'unknown check'}`;
    default:
      return event.kind;
  }
}
