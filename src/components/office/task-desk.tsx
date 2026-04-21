'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RoleKey, RoleState } from '@/lib/const/roles';
import type { Phase } from '@/lib/const/phases';
import type { TaskKind, TaskStatus } from '@/lib/task-pool/schema';
import { subscribeOlympusEvents } from '@/lib/client/project-store';

type TaskEntry = {
  id: string;
  slug: string;
  kind: TaskKind;
  role: RoleKey;
  phase: Phase;
  status: TaskStatus;
  title: string;
  summary?: string;
  claimedBy: string | null;
  createdAt: number;
  updatedAt: number;
};

type WorkerEntry = {
  id: string;
  role: RoleKey;
  state: RoleState | 'idle' | 'working' | 'stopped';
  currentTaskId: string | null;
  currentTaskSlug: string | null;
  pollMs: number;
};

type Snapshot = {
  tasks: TaskEntry[];
  workers: WorkerEntry[];
  running: boolean;
  awaitingHumanForPhase: Phase | null;
};

const REFRESH_EVENT_KINDS = new Set([
  'task.created',
  'task.claimed',
  'task.completed',
  'task.failed',
  'task.paused',
  'task.dropped',
]);

function useTaskPoolSnapshot(projectId: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSnapshot = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/task-pool`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = (await response.json()) as Snapshot;
      setSnapshot(data);
    } catch {
      // transient fetch error — next event will retry.
    }
  }, [projectId]);

  useEffect(() => {
    void fetchSnapshot();
    const unsubscribe = subscribeOlympusEvents(projectId, (event) => {
      if (!REFRESH_EVENT_KINDS.has(event.kind)) return;
      // debounce to coalesce bursts of task.* events.
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = setTimeout(() => {
        void fetchSnapshot();
      }, 150);
    });
    return () => {
      unsubscribe();
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    };
  }, [projectId, fetchSnapshot]);

  return snapshot;
}

export function TaskDesk({ projectId }: { projectId: string }) {
  const snapshot = useTaskPoolSnapshot(projectId);

  const tasks = snapshot?.tasks ?? [];
  const inProgress = useMemo(
    () => tasks.filter((task) => task.status === 'in-progress'),
    [tasks],
  );
  const pending = useMemo(
    () => tasks.filter((task) => task.status === 'pending'),
    [tasks],
  );
  const awaitingHuman = useMemo(
    () => tasks.filter((task) => task.status === 'paused-awaiting-human'),
    [tasks],
  );

  return (
    <div className="rounded-lg border border-olympus-border/70 bg-olympus-panel/40 p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-olympus-ink">Task desk</h3>
        <span className="text-[11px] text-olympus-dim">
          {tasks.length} task{tasks.length === 1 ? '' : 's'} in the pool
        </span>
      </header>

      {tasks.length === 0 ? (
        <EmptyPool />
      ) : (
        <div className="flex flex-col gap-3">
          <TaskGroup title="In progress" tone="progress" tasks={inProgress} />
          <TaskGroup title="Pending" tone="pending" tasks={pending} />
          {awaitingHuman.length > 0 ? (
            <TaskGroup
              title="Awaiting human"
              tone="awaiting"
              tasks={awaitingHuman}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function EmptyPool() {
  return (
    <p className="text-xs text-olympus-dim">
      No tasks yet. Send a requirement in chat and the orchestrator picks it up.
    </p>
  );
}

type GroupTone = 'progress' | 'pending' | 'awaiting';

function TaskGroup({
  title,
  tone,
  tasks,
}: {
  title: string;
  tone: GroupTone;
  tasks: TaskEntry[];
}) {
  if (tasks.length === 0) return null;

  return (
    <section>
      <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-olympus-dim">
        <ToneDot tone={tone} /> {title} · {tasks.length}
      </div>
      <ul className="flex flex-col gap-1">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </ul>
    </section>
  );
}

function ToneDot({ tone }: { tone: GroupTone }) {
  const color =
    tone === 'progress'
      ? 'bg-olympus-blue'
      : tone === 'awaiting'
        ? 'bg-olympus-amber'
        : 'bg-olympus-dim/60';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function TaskRow({ task }: { task: TaskEntry }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-olympus-border/60 bg-olympus-bg/40 px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-olympus-ink">
          {task.title}
        </div>
        <div className="truncate text-[11px] text-olympus-dim">
          {task.slug}
          {task.summary ? ` · ${task.summary}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[10px] text-olympus-dim">
        <span className="rounded bg-olympus-panel px-1.5 py-0.5 capitalize">
          {task.role}
        </span>
        <span className="rounded bg-olympus-panel px-1.5 py-0.5">{task.phase}</span>
      </div>
    </li>
  );
}

export function useWorkerTaskMap(projectId: string): Map<RoleKey, TaskEntry> {
  const snapshot = useTaskPoolSnapshot(projectId);
  return useMemo(() => {
    const map = new Map<RoleKey, TaskEntry>();
    if (!snapshot) return map;
    for (const worker of snapshot.workers) {
      if (!worker.currentTaskId) continue;
      const task = snapshot.tasks.find((entry) => entry.id === worker.currentTaskId);
      if (task) map.set(worker.role, task);
    }
    return map;
  }, [snapshot]);
}
