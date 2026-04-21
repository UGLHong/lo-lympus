'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pause, Play, RefreshCw, SkipBack, SkipForward } from 'lucide-react';
import type { OlympusEvent } from '@/lib/schemas/events';
import type { ProjectViewState } from '@/lib/client/project-store';
import { ROLES } from '@/lib/const/roles';
import { cn } from '@/lib/utils/cn';

type Props = {
  view: ProjectViewState;
};

type EventsResponse = {
  projectId: string;
  count: number;
  events: OlympusEvent[];
};

const PLAYBACK_INTERVAL_MS = 250;

// time-travel scrubber backed by events.ndjson. reads the full history on
// demand, then lets the user step through events to reconstruct "what was
// happening at this moment". playback is tick-based (not wall-clock scaled)
// so a fast-burst of events is still explorable frame-by-frame.
export function ReplayView({ view }: Props) {
  const [events, setEvents] = useState<OlympusEvent[]>([]);
  const [cursor, setCursor] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [playing, setPlaying] = useState<boolean>(false);

  const projectId = view.state.projectId;

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/events`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body: EventsResponse = await res.json();
      setEvents(body.events);
      setCursor(body.events.length);
    } catch (error) {
      console.error('[replay] failed to load events', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (!playing) return;

    const timer = setInterval(() => {
      setCursor((prev) => {
        if (prev >= events.length) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, PLAYBACK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [playing, events.length]);

  const replayState = useMemo(() => reduceEvents(events.slice(0, cursor)), [events, cursor]);
  const focusedEvent = cursor > 0 ? events[cursor - 1] : null;

  const handleScrub = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    setCursor(Number.isFinite(next) ? next : 0);
    setPlaying(false);
  }, []);

  const handlePlay = useCallback(() => setPlaying((p) => !p), []);
  const handleReset = useCallback(() => {
    setCursor(0);
    setPlaying(false);
  }, []);
  const handleEnd = useCallback(() => {
    setCursor(events.length);
    setPlaying(false);
  }, [events.length]);

  return (
    <div className="flex h-full flex-col bg-olympus-bg">
      <ReplayHeader
        loading={loading}
        cursor={cursor}
        total={events.length}
        playing={playing}
        onReset={handleReset}
        onPlay={handlePlay}
        onEnd={handleEnd}
        onRefresh={fetchEvents}
      />

      <div className="border-b border-olympus-border px-3 py-2">
        <input
          type="range"
          min={0}
          max={events.length}
          value={cursor}
          onChange={handleScrub}
          className="w-full accent-olympus-accent"
          aria-label="replay scrubber"
        />
        <div className="mt-1 flex justify-between text-[10px] text-olympus-dim">
          <span>{events[0]?.ts.slice(11, 19) ?? '—'}</span>
          <span>{focusedEvent?.ts.slice(11, 19) ?? '—'}</span>
          <span>{events[events.length - 1]?.ts.slice(11, 19) ?? '—'}</span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] gap-0">
        <RoleStatesPanel roleStates={replayState.roleStates} phase={replayState.phase} />
        <FocusedEventPanel focused={focusedEvent} events={events} cursor={cursor} />
      </div>
    </div>
  );
}

type ReplayHeaderProps = {
  loading: boolean;
  cursor: number;
  total: number;
  playing: boolean;
  onReset: () => void;
  onPlay: () => void;
  onEnd: () => void;
  onRefresh: () => void;
};

function ReplayHeader({
  loading,
  cursor,
  total,
  playing,
  onReset,
  onPlay,
  onEnd,
  onRefresh,
}: ReplayHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-olympus-border bg-olympus-panel px-3 py-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Time travel</h2>
        <span className="text-[11px] text-olympus-dim">
          event {cursor} / {total}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <ReplayIconButton label="rewind" onClick={onReset}>
          <SkipBack className="h-3.5 w-3.5" />
        </ReplayIconButton>
        <ReplayIconButton label={playing ? 'pause' : 'play'} onClick={onPlay}>
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </ReplayIconButton>
        <ReplayIconButton label="jump to end" onClick={onEnd}>
          <SkipForward className="h-3.5 w-3.5" />
        </ReplayIconButton>
        <ReplayIconButton label={loading ? 'refreshing' : 'refresh'} onClick={onRefresh} disabled={loading}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </ReplayIconButton>
      </div>
    </div>
  );
}

type ReplayIconButtonProps = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
};

function ReplayIconButton({ label, onClick, disabled, children }: ReplayIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-olympus-border/60 bg-olympus-bg px-2 py-1 text-olympus-ink hover:bg-olympus-muted/50 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

type RoleStatesPanelProps = {
  roleStates: ReplayState['roleStates'];
  phase: ReplayState['phase'];
};

function RoleStatesPanel({ roleStates, phase }: RoleStatesPanelProps) {
  const entries = Object.entries(roleStates);
  return (
    <div className="overflow-y-auto border-r border-olympus-border p-3">
      <div className="text-[10px] uppercase tracking-wider text-olympus-dim">Phase</div>
      <div className="mt-1 text-sm font-semibold text-olympus-ink">{phase ?? '—'}</div>

      <div className="mt-4 text-[10px] uppercase tracking-wider text-olympus-dim">Role presence</div>
      <ul className="mt-1 space-y-1">
        {entries.length === 0 && <li className="text-xs text-olympus-dim">no role states yet</li>}
        {entries.map(([role, state]) => {
          const def = ROLES[role as keyof typeof ROLES];
          return (
            <li key={role} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: def?.color ?? '#888' }}
                />
                <span className="text-olympus-ink">{def?.displayName ?? role}</span>
              </span>
              <span className="text-olympus-dim capitalize">{state}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type FocusedEventPanelProps = {
  focused: OlympusEvent | null;
  events: OlympusEvent[];
  cursor: number;
};

function FocusedEventPanel({ focused, events, cursor }: FocusedEventPanelProps) {
  const windowStart = Math.max(0, cursor - 10);
  const visible = events.slice(windowStart, cursor);
  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-olympus-border px-3 py-2 text-[10px] uppercase tracking-wider text-olympus-dim">
        Focused event
      </div>
      <div className="border-b border-olympus-border px-3 py-2">
        {focused ? (
          <pre className="overflow-x-auto font-mono text-[11px] text-olympus-ink">
            {JSON.stringify(focused, null, 2)}
          </pre>
        ) : (
          <div className="text-xs text-olympus-dim">Scrub the timeline or press play to step through history.</div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="text-[10px] uppercase tracking-wider text-olympus-dim">Last 10 events</div>
        <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
          {visible.length === 0 && <li className="text-olympus-dim">no events in range</li>}
          {visible
            .slice()
            .reverse()
            .map((event) => (
              <li key={event.id} className="flex gap-2">
                <span className="w-20 flex-shrink-0 text-olympus-dim/70">{event.ts.slice(11, 19)}</span>
                <span className="w-40 flex-shrink-0 text-olympus-accent">{event.kind}</span>
                <span className="min-w-0 flex-1 truncate text-olympus-ink/90">{summarizeEvent(event)}</span>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

type ReplayState = {
  phase: string | null;
  roleStates: Record<string, string>;
};

// slimmed-down reducer mirroring what the client store does live, but from
// a pure event list. extend as we add new event kinds that meaningfully
// change what the operator sees when scrubbing back in time.
function reduceEvents(events: OlympusEvent[]): ReplayState {
  const state: ReplayState = { phase: null, roleStates: {} };
  for (const event of events) {
    if (event.kind === 'phase.advanced') {
      state.phase = event.toPhase;
    } else if (event.kind === 'role.state') {
      state.roleStates[event.role] = event.state;
    }
  }
  return state;
}

function summarizeEvent(event: OlympusEvent): string {
  switch (event.kind) {
    case 'role.state':
      return `@${event.role} → ${event.state}`;
    case 'phase.advanced':
      return `${event.fromPhase} → ${event.toPhase}`;
    case 'artifact.written':
      return `${event.path} by @${event.role}`;
    case 'source.written':
      return `${event.path} by @${event.role}`;
    case 'review.posted':
      return `${event.ticketCode} → ${event.decision}`;
    case 'ticket.status':
      return `${event.code} → ${event.status}`;
    case 'incident.opened':
      return `${event.incidentId} (${event.classification})`;
    case 'incident.status':
      return `${event.incidentId} → ${event.status}`;
    case 'qa.run':
      return `qa ${event.status}${event.passed !== undefined ? ` ${event.passed}✓` : ''}${event.failed ? ` ${event.failed}✗` : ''}`;
    case 'barge.in':
      return `@${event.role} ← ${event.text.slice(0, 60)}`;
    default:
      return event.kind;
  }
}
