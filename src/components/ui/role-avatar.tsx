'use client';

import { ROLES, type RoleKey, type RoleState } from '@/lib/const/roles';
import { cn } from '@/lib/utils/cn';

type Props = {
  role: RoleKey;
  state?: RoleState;
  size?: number;
  label?: boolean;
};

const STATE_RINGS: Record<RoleState, string> = {
  'off-duty': 'ring-1 ring-olympus-border opacity-60',
  idle: 'ring-1 ring-olympus-border',
  thinking: 'ring-2 ring-olympus-amber animate-pulse',
  typing: 'ring-2 ring-olympus-blue',
  reviewing: 'ring-2 ring-olympus-accent',
  testing: 'ring-2 ring-olympus-green',
  blocked: 'ring-2 ring-olympus-red',
  celebrating: 'ring-2 ring-olympus-green',
};

export function RoleAvatar({ role, state, size = 32, label = false }: Props) {
  const def = ROLES[role];
  const ring = state ? STATE_RINGS[state] : STATE_RINGS.idle;
  return (
    <div className={cn('flex flex-col items-center gap-1', label && 'w-[76px]')}>
      <div
        className={cn(
          'relative flex items-center justify-center rounded-full font-semibold text-olympus-bg',
          ring,
        )}
        style={{
          width: size,
          height: size,
          background: `linear-gradient(135deg, ${def.color}, ${def.color}80)`,
          fontSize: size * 0.4,
        }}
        title={`${def.displayName}${state ? ` — ${state}` : ''}`}
      >
        {def.initial}
        {state === 'typing' && (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-olympus-blue text-[8px] text-white">
            ✎
          </span>
        )}
        {state === 'thinking' && (
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-olympus-amber animate-pulse-dot" />
        )}
      </div>
      {label && (
        <span className="truncate text-[10px] leading-tight text-olympus-dim text-center w-full" title={def.displayName}>
          {def.displayName}
        </span>
      )}
    </div>
  );
}
