'use client';

import { useCallback, useMemo, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import type { ProjectViewState } from '@/lib/client/project-store';

type Props = {
  view: ProjectViewState;
};

type RuntimeAction = 'start' | 'stop';
type PendingState = { kind: 'idle' } | { kind: 'pending'; action: RuntimeAction } | { kind: 'error'; message: string };

export function RuntimeView({ view }: Props) {
  const [pending, setPending] = useState<PendingState>({ kind: 'idle' });
  const projectId = view.state.projectId;
  const runtime = view.runtime;

  const callRuntime = useCallback(
    async (action: RuntimeAction) => {
      setPending({ kind: 'pending', action });
      try {
        const response = await fetch(`/api/projects/${projectId}/runtime`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, script: 'dev' }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { reason?: string; error?: string };
          setPending({
            kind: 'error',
            message: body.reason ?? body.error ?? `${action} failed (${response.status})`,
          });
          return;
        }
        setPending({ kind: 'idle' });
      } catch (err) {
        setPending({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [projectId],
  );

  const handleStart = useCallback(() => callRuntime('start'), [callRuntime]);
  const handleStop = useCallback(() => callRuntime('stop'), [callRuntime]);

  const previewUrl = useMemo(() => {
    if (!runtime.running || !runtime.port) return null;
    return `http://localhost:${runtime.port}`;
  }, [runtime.running, runtime.port]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-olympus-bg">
      <RuntimeToolbar
        running={runtime.running}
        port={runtime.port}
        pid={runtime.pid}
        previewUrl={previewUrl}
        pending={pending}
        onStart={handleStart}
        onStop={handleStop}
      />

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,2fr)_minmax(0,1fr)]">
        <RuntimePreview previewUrl={previewUrl} running={runtime.running} />
        <RuntimeLogPanel logs={runtime.logTail} />
      </div>
    </div>
  );
}

type ToolbarProps = {
  running: boolean;
  port: number | null;
  pid: number | null;
  previewUrl: string | null;
  pending: PendingState;
  onStart: () => void;
  onStop: () => void;
};

function RuntimeToolbar({ running, port, pid, previewUrl, pending, onStart, onStop }: ToolbarProps) {
  const isPending = pending.kind === 'pending';
  return (
    <div className="flex items-center gap-2 border-b border-olympus-border bg-olympus-panel px-3 py-2 text-xs">
      <span className="text-olympus-dim uppercase tracking-wider">App / Runtime</span>
      <span
        className={twMerge(
          'ml-2 inline-flex h-2 w-2 rounded-full',
          running ? 'bg-olympus-green animate-pulse-dot' : 'bg-olympus-red/60',
        )}
      />
      <span className="text-olympus-ink/90">
        {running
          ? `running on :${port ?? '?'}${pid ? ` (pid ${pid})` : ''}`
          : 'not running'}
      </span>
      {previewUrl && (
        <a
          className="ml-2 text-olympus-accent hover:underline"
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
        >
          open ↗
        </a>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onStart}
          disabled={running || isPending}
          className={twMerge(
            'rounded border border-olympus-border bg-olympus-muted px-2.5 py-1 text-xs text-olympus-ink transition hover:bg-olympus-panel disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {isPending && pending.action === 'start' ? 'Starting…' : 'Start'}
        </button>
        <button
          type="button"
          onClick={onStop}
          disabled={!running || isPending}
          className={twMerge(
            'rounded border border-olympus-border bg-olympus-muted px-2.5 py-1 text-xs text-olympus-ink transition hover:bg-olympus-panel disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {isPending && pending.action === 'stop' ? 'Stopping…' : 'Stop'}
        </button>
      </div>

      {pending.kind === 'error' && (
        <span className="ml-3 truncate text-[11px] text-olympus-red">{pending.message}</span>
      )}
    </div>
  );
}

function RuntimePreview({ previewUrl, running }: { previewUrl: string | null; running: boolean }) {
  if (!running || !previewUrl) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center border-b border-olympus-border text-olympus-dim">
        <div className="max-w-md text-center text-sm">
          <div className="mb-1 font-medium text-olympus-ink/80">No runtime is active.</div>
          <div>
            Press <span className="text-olympus-ink">Start</span> to spawn{' '}
            <code className="text-olympus-ink">pnpm run dev</code> inside the workspace. Logs will stream
            into the panel below.
          </div>
        </div>
      </div>
    );
  }
  return (
    <iframe
      title="runtime-preview"
      src={previewUrl}
      className="min-h-0 flex-1 border-b border-olympus-border bg-white"
    />
  );
}

function RuntimeLogPanel({
  logs,
}: {
  logs: { ts: string; channel: 'stdout' | 'stderr'; text: string }[];
}) {
  const reversed = [...logs].reverse();
  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-olympus-border px-3 py-1.5 text-[11px] uppercase tracking-wider text-olympus-dim">
        Logs ({logs.length})
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-olympus-bg p-2 font-mono text-[11px] leading-snug">
        {reversed.length === 0 ? (
          <div className="text-olympus-dim">No log output yet.</div>
        ) : (
          reversed.map((line, index) => (
            <div
              key={`${line.ts}-${index}`}
              className={twMerge(
                'whitespace-pre-wrap',
                line.channel === 'stderr' ? 'text-olympus-red/90' : 'text-olympus-ink/85',
              )}
            >
              {line.text.replace(/\n$/, '')}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
