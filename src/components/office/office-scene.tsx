'use client';

import { ROLE_LIST } from '@/lib/const/roles';
import { DotLottieRoleAvatar } from '@/components/ui/dotlottie-role-avatar';
import type { ProjectViewState } from '@/lib/client/project-store';

export function OfficeScene({ view }: { view: ProjectViewState }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-olympus-bg">
      <OfficeFloor />
      <div className="relative z-10 mx-auto flex h-full w-full max-w-5xl flex-col gap-8 p-8">
        <header className="flex items-baseline justify-between">
          <div>
            <h2 className="text-lg font-semibold">Office — ambient presence</h2>
            <p className="text-xs text-olympus-dim">
              Avatars drive per-role dotLottie bundles when present under <code>/avatars/&lt;role&gt;.lottie</code>,
              and fall back to colored discs otherwise. Markers match role states (idle, thinking, typing,
              reviewing, testing, blocked, celebrating).
            </p>
          </div>
          <div className="flex gap-3 text-[11px] text-olympus-dim">
            <LegendDot color="bg-olympus-amber" label="thinking" />
            <LegendDot color="bg-olympus-blue" label="typing" />
            <LegendDot color="bg-olympus-green" label="done" />
            <LegendDot color="bg-olympus-red" label="blocked" />
          </div>
        </header>

        <div className="grid grid-cols-4 gap-x-4 gap-y-6 md:grid-cols-5 lg:grid-cols-7">
          {ROLE_LIST.map((role) => {
            const state = view.roleStates[role.key] ?? 'idle';
            return (
              <div key={role.key} className="flex flex-col items-center gap-1">
                <DotLottieRoleAvatar role={role.key} state={state} size={52} />
                <div className="text-xs font-medium text-olympus-ink text-center">{role.displayName}</div>
                <div className="text-[10px] text-olympus-dim capitalize">{state}</div>
              </div>
            );
          })}
        </div>

        <MeetingRoomNote />
      </div>
    </div>
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

function MeetingRoomNote() {
  return (
    <div className="mt-auto rounded-lg border border-dashed border-olympus-border/70 p-3 text-xs text-olympus-dim">
      The pipeline runs one LLM turn at a time (orchestrator → phase agents → implement loop), so only one role
      shows typing at once. Parallel tickets share the same workspace safely because each dev/review step is
      serialized. Meeting-table animations are planned for a later phase.
    </div>
  );
}
