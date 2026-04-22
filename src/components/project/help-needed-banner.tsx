'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, RefreshCw, SkipForward, Zap } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import type { ProjectViewState } from '@/lib/client/project-store';
import { useProjectNavigation } from '@/components/layout/project-navigation';

type HelpNeededInfo = {
  helpNeeded: true;
  ticketCode: string | null;
  ticketTitle: string | null;
  reason: string;
  attempts: number | null;
  maxAttempts: number;
  reviewPath: string | null;
};

type ActionState = 'idle' | 'loading' | 'done';

type Props = {
  view: ProjectViewState;
};

export function HelpNeededBanner({ view }: Props) {
  const projectId = view.state.projectId;
  const isPaused = view.state.paused;
  const isImplementPhase = view.state.phase === 'IMPLEMENT';

  const [info, setInfo] = useState<HelpNeededInfo | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [actionState, setActionState] = useState<ActionState>('idle');
  const { openArtifact } = useProjectNavigation();

  const fetchInfo = useCallback(async () => {
    if (!isPaused || !isImplementPhase) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/help-needed`);
      const data = await res.json();
      setInfo(data.helpNeeded ? (data as HelpNeededInfo) : null);
    } catch {
      setInfo(null);
    }
  }, [projectId, isPaused, isImplementPhase]);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  const handleAction = useCallback(
    async (action: 'retry' | 'double-and-retry' | 'skip-and-continue') => {
      setActionState('loading');
      try {
        await fetch(`/api/projects/${projectId}/help-needed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        setInfo(null);
        setActionState('done');
      } catch {
        setActionState('idle');
      }
    },
    [projectId],
  );

  const handleOpenReview = useCallback(() => {
    if (info?.reviewPath) openArtifact(info.reviewPath);
  }, [info, openArtifact]);

  const handleToggle = useCallback(() => setExpanded((prev) => !prev), []);

  if (!info) return null;

  const attemptsLabel =
    info.attempts !== null ? `${info.attempts}/${info.maxAttempts} attempts used` : null;

  const isActing = actionState === 'loading';

  return (
    <div className="col-span-3 border-b border-olympus-amber/40 bg-olympus-amber/10">
      <div className="flex items-start gap-3 px-4 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-olympus-amber" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-semibold text-olympus-amber">Help needed</span>

            {info.ticketCode && (
              <span className="font-mono text-xs text-olympus-amber/80">
                {info.ticketCode}
                {info.ticketTitle ? ` — ${info.ticketTitle}` : ''}
              </span>
            )}

            {attemptsLabel && (
              <span className="rounded bg-olympus-amber/20 px-1.5 py-px text-[10px] text-olympus-amber">
                {attemptsLabel}
              </span>
            )}
          </div>

          {expanded && (
            <div className="mt-2 space-y-3">
              <div className="rounded-md border border-olympus-amber/20 bg-olympus-bg/60 px-3 py-2 text-xs text-olympus-ink/80">
                <span className="font-medium text-olympus-ink">Last failure: </span>
                {info.reason}
              </div>

              <p className="text-xs text-olympus-ink/60">
                The agent exhausted its attempt budget without getting an approved review. Choose an
                action below, or fix the code in Zed then retry.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <ActionButton
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  label="Retry"
                  description="Reset attempts and try again with same budget"
                  onClick={() => handleAction('retry')}
                  disabled={isActing}
                  variant="secondary"
                />
                <ActionButton
                  icon={<Zap className="h-3.5 w-3.5" />}
                  label={`Double attempts (→ ${info.maxAttempts * 2})`}
                  description="Give the agent more chances before asking again"
                  onClick={() => handleAction('double-and-retry')}
                  disabled={isActing}
                  variant="primary"
                />
                <ActionButton
                  icon={<SkipForward className="h-3.5 w-3.5" />}
                  label="Skip this ticket"
                  description="Mark as done and continue with remaining tickets"
                  onClick={() => handleAction('skip-and-continue')}
                  disabled={isActing}
                  variant="ghost"
                />
                {info.reviewPath && (
                  <button
                    type="button"
                    onClick={handleOpenReview}
                    className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-olympus-dim underline decoration-olympus-dim/40 underline-offset-2 hover:text-olympus-ink hover:decoration-olympus-ink"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View last review
                  </button>
                )}
              </div>

              {isActing && (
                <p className="text-xs text-olympus-dim">Resuming pipeline…</p>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleToggle}
          className="flex-shrink-0 rounded p-1 text-olympus-amber/60 hover:bg-olympus-amber/10 hover:text-olympus-amber"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

type ActionButtonProps = {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
  disabled: boolean;
  variant: 'primary' | 'secondary' | 'ghost';
};

function ActionButton({ icon, label, description, onClick, disabled, variant }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={description}
      className={twMerge(
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-50',
        variant === 'primary' &&
          'bg-olympus-amber text-olympus-bg hover:bg-olympus-amber/80',
        variant === 'secondary' &&
          'border border-olympus-amber/40 text-olympus-amber hover:bg-olympus-amber/10',
        variant === 'ghost' &&
          'text-olympus-dim hover:bg-olympus-muted/40 hover:text-olympus-ink',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
