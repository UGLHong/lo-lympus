import { useCallback, useEffect, useMemo, useState } from 'react';

import { useSse, type SseEvent } from '../hooks/use-sse';
import { cn } from '../lib/cn';
import type { KanbanTask } from './kanban';

interface ProjectActionsProps {
  projectId: string;
  initialTasks: KanbanTask[];
}

type TaskStatus = KanbanTask['status'];

const BLOCKING_STATUSES: readonly TaskStatus[] = ['todo', 'in-progress', 'pending-review'];

interface TaskStatusMap {
  [taskId: string]: TaskStatus;
}

interface DetectedRunCommand {
  command: string;
  source: string;
}

interface DetectionResponse {
  primary: DetectedRunCommand | null;
  candidates: DetectedRunCommand[];
}

export function ProjectActions({ projectId, initialTasks }: ProjectActionsProps) {
  const taskStatuses = useProjectTaskStatuses(projectId, initialTasks);

  const summary = useMemo(() => {
    const values = Object.values(taskStatuses);
    const total = values.length;
    const blocking = values.filter((status) => BLOCKING_STATUSES.includes(status)).length;
    return {
      total,
      blocking,
      canRun: total > 0 && blocking === 0,
    };
  }, [taskStatuses]);

  return (
    <div className="flex items-center gap-1.5">
      <OpenInZedButton projectId={projectId} />
      <RunApplicationButton
        projectId={projectId}
        canRun={summary.canRun}
        blockingCount={summary.blocking}
        totalCount={summary.total}
      />
    </div>
  );
}

function useProjectTaskStatuses(
  projectId: string,
  initialTasks: KanbanTask[],
): TaskStatusMap {
  const [statuses, setStatuses] = useState<TaskStatusMap>(() => {
    const seed: TaskStatusMap = {};
    for (const task of initialTasks) seed[task.id] = task.status;
    return seed;
  });

  useSse({
    projectId,
    onEvent: (event: SseEvent) => {
      if (event.type !== 'task-update') return;
      const payload = event.payload as { id?: string; status?: TaskStatus };
      if (!payload.id || !payload.status) return;
      setStatuses((prev) =>
        prev[payload.id!] === payload.status
          ? prev
          : { ...prev, [payload.id!]: payload.status! },
      );
    },
  });

  return statuses;
}

function OpenInZedButton({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'open-in-zed' }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(data.error ?? `failed (${res.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error');
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="btn text-[10px] disabled:opacity-50"
      title={error ?? 'Open the workspace folder in the Zed editor'}
    >
      {busy ? 'Opening…' : 'Open in Zed'}
    </button>
  );
}

interface RunApplicationButtonProps {
  projectId: string;
  canRun: boolean;
  blockingCount: number;
  totalCount: number;
}

function RunApplicationButton({
  projectId,
  canRun,
  blockingCount,
  totalCount,
}: RunApplicationButtonProps) {
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [detection, setDetection] = useState<DetectionResponse | null>(null);
  const [commandDraft, setCommandDraft] = useState('');
  const [loadingDetection, setLoadingDetection] = useState(false);

  const openConfig = useCallback(async () => {
    setShowConfig(true);
    setLoadingDetection(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/action`);
      if (res.ok) {
        const data = (await res.json()) as DetectionResponse;
        setDetection(data);
        setCommandDraft((prev) => (prev.length > 0 ? prev : data.primary?.command ?? ''));
      }
    } catch {
      setDetection({ primary: null, candidates: [] });
    } finally {
      setLoadingDetection(false);
    }
  }, [projectId]);

  const closeConfig = useCallback(() => setShowConfig(false), []);

  const executeRun = useCallback(
    async (command?: string) => {
      if (!canRun) return;
      setBusy(true);
      setInfo(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'run-app',
            ...(command ? { command } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          url?: string | null;
          error?: string;
          message?: string;
          command?: string;
          source?: string;
          restarted?: boolean;
        };
        if (!res.ok || data.ok === false) {
          setInfo(data.error ?? `failed (${res.status})`);
        } else {
          const prefix = data.restarted ? 'Restarted' : 'Running';
          if (data.url) {
            setInfo(`${prefix} at ${data.url} (${data.command})`);
          } else {
            setInfo(data.message ?? `${prefix} via: ${data.command ?? 'detected command'}`);
          }
        }
      } catch (err) {
        setInfo(err instanceof Error ? err.message : 'network error');
      } finally {
        setBusy(false);
        setShowConfig(false);
      }
    },
    [canRun, projectId],
  );

  const handlePrimaryClick = useCallback(() => {
    if (!canRun || busy) return;
    void openConfig();
  }, [busy, canRun, openConfig]);

  const handleRunDraft = useCallback(() => {
    const trimmed = commandDraft.trim();
    if (trimmed.length === 0) return;
    const isDefault = detection?.primary?.command === trimmed;
    void executeRun(isDefault ? undefined : trimmed);
  }, [commandDraft, detection, executeRun]);

  useEffect(() => {
    if (!info) return;
    const timer = setTimeout(() => setInfo(null), 8000);
    return () => clearTimeout(timer);
  }, [info]);

  const disabled = !canRun || busy;
  const title = canRun
    ? 'Start the generated app and open it in your default browser'
    : totalCount === 0
      ? 'No tasks yet — nothing has been built'
      : `${blockingCount} task(s) still active (todo / in-progress / pending-review)`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handlePrimaryClick}
        disabled={disabled}
        className={cn('btn text-[10px]', canRun && 'btn-primary', 'disabled:opacity-40')}
        title={info ?? title}
      >
        {busy ? 'Launching…' : 'Run application'}
      </button>
      {info && (
        <span className="absolute top-full right-0 mt-1 whitespace-nowrap rounded border border-border bg-bg-raised px-2 py-0.5 text-[10px] text-text-muted">
          {info}
        </span>
      )}
      {showConfig && (
        <RunCommandDialog
          detection={detection}
          loading={loadingDetection}
          commandDraft={commandDraft}
          onCommandDraftChange={setCommandDraft}
          onPickCandidate={setCommandDraft}
          onCancel={closeConfig}
          onConfirm={handleRunDraft}
          busy={busy}
        />
      )}
    </div>
  );
}

interface RunCommandDialogProps {
  detection: DetectionResponse | null;
  loading: boolean;
  commandDraft: string;
  onCommandDraftChange: (value: string) => void;
  onPickCandidate: (command: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}

function RunCommandDialog({
  detection,
  loading,
  commandDraft,
  onCommandDraftChange,
  onPickCandidate,
  onCancel,
  onConfirm,
  busy,
}: RunCommandDialogProps) {
  const candidates = detection?.candidates ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 text-xs"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="panel w-[480px] max-w-[90vw] p-4 space-y-3"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="space-y-1">
          <h2 className="text-sm font-semibold">Run application</h2>
          <p className="text-text-faint">
            A fast model + heuristic rules inspected the workspace to guess how to boot
            the app. Edit the command if the project uses docker, chained install+start
            steps, or a specific entry point.
          </p>
        </header>

        {loading ? (
          <div className="text-text-faint italic">
            inspecting workspace & asking fast model…
          </div>
        ) : (
          <>
            {candidates.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-text-faint">
                  detected candidates
                </div>
                <ul className="space-y-1">
                  {candidates.map((candidate) => (
                    <li key={candidate.command}>
                      <button
                        type="button"
                        onClick={() => onPickCandidate(candidate.command)}
                        className={cn(
                          'w-full text-left rounded border px-2 py-1.5 transition-colors',
                          candidate.command === commandDraft
                            ? 'border-accent bg-accent-soft text-accent'
                            : 'border-border hover:border-border-strong hover:bg-bg-raised',
                        )}
                      >
                        <div className="font-mono text-[11px]">{candidate.command}</div>
                        <div className="text-[10px] text-text-faint">{candidate.source}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {candidates.length === 0 && (
              <div className="rounded border border-border bg-bg-sunken p-2 text-text-faint italic">
                no run command could be auto-detected from the workspace files. enter the
                command manually below.
              </div>
            )}

            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-text-faint">
                command to execute
              </span>
              <input
                value={commandDraft}
                onChange={(event) => onCommandDraftChange(event.target.value)}
                placeholder="e.g. docker compose up --build"
                className="w-full bg-bg-sunken border border-border rounded px-2 py-1.5 font-mono text-[11px] text-text focus:outline-none focus:border-accent"
              />
            </label>
          </>
        )}

        <footer className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="btn text-[10px]">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || commandDraft.trim().length === 0}
            className="btn btn-primary text-[10px] disabled:opacity-50"
          >
            {busy ? 'Launching…' : 'Launch'}
          </button>
        </footer>
      </div>
    </div>
  );
}
