'use client';

import { Ticket, Users } from 'lucide-react';
import type { TicketBlock } from '@/lib/schemas/content-blocks';
import { ROLES } from '@/lib/const/roles';
import { RoleAvatar } from '@/components/ui/role-avatar';
import { useProjectNavigation } from '@/components/layout/project-navigation';
import { cn } from '@/lib/utils/cn';

const STATUS_TONE: Record<TicketBlock['status'], string> = {
  todo: 'bg-olympus-muted text-olympus-dim',
  'in-progress': 'bg-olympus-blue/20 text-olympus-blue',
  review: 'bg-olympus-amber/20 text-olympus-amber',
  'changes-requested': 'bg-olympus-red/20 text-olympus-red',
  done: 'bg-olympus-green/20 text-olympus-green',
  blocked: 'bg-olympus-red/30 text-olympus-red',
};

export function TicketCard({ block }: { block: TicketBlock }) {
  const assignee = block.assigneeRole ? ROLES[block.assigneeRole] : null;
  const { openTicketByCode } = useProjectNavigation();
  const handleOpen = () => openTicketByCode(block.code);

  return (
    <button
      type="button"
      onClick={handleOpen}
      title={`Open ticket ${block.code}`}
      className="group w-full rounded-md border border-olympus-border bg-olympus-muted/20 p-2.5 text-left transition hover:border-olympus-blue/60 hover:bg-olympus-muted/50"
    >
      <div className="flex items-center gap-2">
        <Ticket className="h-3.5 w-3.5 flex-shrink-0 text-olympus-blue" />
        <span className="font-mono text-[11px] text-olympus-blue">{block.code}</span>
        <span className="truncate text-sm text-olympus-ink group-hover:text-olympus-accent">
          {block.title}
        </span>
        <span
          className={cn(
            'ml-auto rounded px-1.5 py-[1px] text-[10px] capitalize',
            STATUS_TONE[block.status],
          )}
        >
          {block.status}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-olympus-dim">
        {assignee && (
          <span className="inline-flex items-center gap-1">
            <RoleAvatar role={assignee.key} size={14} />
            <span>{assignee.displayName}</span>
          </span>
        )}
        {block.dependsOn.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" />
            <span>deps: {block.dependsOn.join(', ')}</span>
          </span>
        )}
        <span className="ml-auto text-[10px] uppercase tracking-wider text-olympus-dim/70 opacity-0 transition group-hover:opacity-100">
          open →
        </span>
      </div>
    </button>
  );
}
