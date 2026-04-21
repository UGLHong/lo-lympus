'use client';

import { ROLE_LIST, type RoleKey } from '@/lib/const/roles';
import { DotLottieRoleAvatar } from '@/components/ui/dotlottie-role-avatar';
import type { ProjectViewState } from '@/lib/client/project-store';
import { TaskDesk, useWorkerTaskMap } from './task-desk';

export function OfficeScene({ view }: { view: ProjectViewState }) {
  const projectId = view.state.projectId;
  const currentTasks = useWorkerTaskMap(projectId);

  return (
    <div className="relative h-full w-full overflow-hidden bg-olympus-bg">
      <OfficeFloor />
      <div className="relative z-10 mx-auto flex h-full w-full max-w-6xl flex-col gap-6 p-8">
        <OfficeHeader />

        <div className="grid grid-cols-4 gap-x-4 gap-y-6 md:grid-cols-5 lg:grid-cols-7">
          {ROLE_LIST.map((role) => {
            const state = view.roleStates[role.key] ?? 'idle';
            const currentTask = currentTasks.get(role.key as RoleKey) ?? null;
            return (
              <div key={role.key} className="flex flex-col items-center gap-1">
                <DotLottieRoleAvatar role={role.key} state={state} size={52} />
                <div className="text-center text-xs font-medium text-olympus-ink">
                  {role.displayName}
                </div>
                <div className="text-center text-[10px] text-olympus-dim capitalize">
                  {state}
                </div>
                <CurrentTaskLabel title={currentTask?.title ?? null} />
              </div>
            );
          })}
        </div>

        <TaskDesk projectId={projectId} />
      </div>
    </div>
  );
}

function OfficeHeader() {
  return (
    <header className="flex items-baseline justify-between">
      <div>
        <h2 className="text-lg font-semibold">Office — ambient presence</h2>
        <p className="text-xs text-olympus-dim">
          Every employee polls the shared task pool. Multiple employees can work in parallel;
          the supervisor only waits on a gate (e.g. all tickets done) before advancing phases.
        </p>
      </div>
      <div className="flex gap-3 text-[11px] text-olympus-dim">
        <LegendDot color="bg-olympus-amber" label="thinking" />
        <LegendDot color="bg-olympus-blue" label="typing" />
        <LegendDot color="bg-olympus-green" label="done" />
        <LegendDot color="bg-olympus-red" label="blocked" />
      </div>
    </header>
  );
}

function CurrentTaskLabel({ title }: { title: string | null }) {
  if (!title) return <span className="h-3.5 text-[10px] text-olympus-dim/50">—</span>;
  return (
    <span
      className="mt-0.5 max-w-[9rem] truncate text-center text-[10px] text-olympus-blue"
      title={title}
    >
      {title}
    </span>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} /> {label}
    </span>
  );
}

function OfficeFloor() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.15]"
      style={{
        backgroundImage:
          'linear-gradient(#ffffff1a 1px, transparent 1px), linear-gradient(90deg, #ffffff1a 1px, transparent 1px)',
        backgroundSize: '36px 36px',
      }}
    />
  );
}
