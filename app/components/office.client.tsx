import { BadgeCheck, Clock, ListChecks, Loader2, Moon, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSse, type SseEvent } from '../hooks/use-sse';
import { useUi } from '../lib/ui-context';
import { ROLES, ROLE_COLOR, ROLE_LABEL, type Role } from '../lib/roles';
import { cn } from '../lib/cn';

const AGENTS_REFRESH_DEBOUNCE_MS = 1500;

interface OfficeProps {
  projectId: string;
}

interface AgentView {
  role: Role;
  status: 'idle' | 'working' | 'blocked';
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  completed: number;
  active: number;
  backlog: number;
  lastActivity?: number;
}

function seedAgents(): Record<Role, AgentView> {
  const record = {} as Record<Role, AgentView>;
  for (const role of ROLES) {
    record[role] = {
      role,
      status: 'idle',
      currentTaskId: null,
      currentTaskTitle: null,
      completed: 0,
      active: 0,
      backlog: 0,
    };
  }
  return record;
}

export default function Office({ projectId }: OfficeProps) {
  const [agents, setAgents] = useState<Record<Role, AgentView>>(seedAgents);
  const { followRole, setFollowRole } = useUi();
  const refreshTimerRef = useRef<number | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        agents?: Array<{
          role: string;
          status: 'idle' | 'working' | 'blocked';
          currentTaskId: string | null;
          currentTaskTitle: string | null;
          completed: number;
          active: number;
          backlog: number;
        }>;
      };
      setAgents((prev) => {
        const next = { ...prev };
        for (const row of data.agents ?? []) {
          if (!(ROLES as readonly string[]).includes(row.role)) continue;
          const role = row.role as Role;
          next[role] = {
            role,
            status: row.status,
            currentTaskId: row.currentTaskId,
            currentTaskTitle: row.currentTaskTitle,
            completed: row.completed,
            active: row.active,
            backlog: row.backlog,
            lastActivity: prev[role].lastActivity,
          };
        }
        return next;
      });
    } catch (err) {
      console.warn('[office] failed to load agents', err);
    }
  }, [projectId]);

  // coalesce bursts of task-update events into a single /api/agents fetch.
  // without this, heavy agent activity fires dozens of task-updates/sec and
  // each one spawned a fetch, overwhelming the browser's connection pool.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void loadAgents();
    }, AGENTS_REFRESH_DEBOUNCE_MS);
  }, [loadAgents]);

  useEffect(() => {
    void loadAgents();
    const handle = window.setInterval(() => void loadAgents(), 15_000);
    return () => {
      window.clearInterval(handle);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [loadAgents]);

  const handleSse = useCallback(
    (event: SseEvent) => {
      if (!event.role) return;
      if (!(ROLES as readonly string[]).includes(event.role)) return;
      const role = event.role as Role;
      const now = Date.now();

      if (event.type === 'state') {
        const p = event.payload as {
          status?: 'idle' | 'working' | 'blocked';
          currentTaskId?: string | null;
        };
        setAgents((prev) => ({
          ...prev,
          [role]: {
            ...prev[role],
            status: p.status ?? prev[role].status,
            currentTaskId: p.currentTaskId ?? null,
            lastActivity: now,
          },
        }));
        return;
      }

      if (event.type === 'task-update') {
        scheduleRefresh();
        return;
      }

      setAgents((prev) => ({ ...prev, [role]: { ...prev[role], lastActivity: now } }));
    },
    [scheduleRefresh],
  );

  useSse({ projectId, onEvent: handleSse });

  const summary = useMemo(() => {
    const all = Object.values(agents);
    return {
      total: all.length,
      working: all.filter((a) => a.status === 'working').length,
      blocked: all.filter((a) => a.status === 'blocked').length,
      idle: all.filter((a) => a.status === 'idle').length,
      completed: all.reduce((acc, a) => acc + a.completed, 0),
    };
  }, [agents]);

  return (
    <div className="h-full flex flex-col bg-bg">
      <div className="panel-header border-x-0 border-t-0">
        <span className="flex items-center gap-2">
          <Users size={12} className="text-accent" />
          Team Floor
        </span>
        <span className="text-text-faint text-[10px]">
          <span className="text-emerald-300">{summary.working} working</span> ·{' '}
          <span className="text-yellow-300">{summary.blocked} blocked</span> ·{' '}
          <span>{summary.idle} idle</span> · {summary.completed} shipped
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-3">
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          {ROLES.map((role) => (
            <DeskCard
              key={role}
              agent={agents[role]}
              isFollowing={followRole === role}
              onToggleFollow={() => setFollowRole(followRole === role ? null : role)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface DeskCardProps {
  agent: AgentView;
  isFollowing: boolean;
  onToggleFollow: () => void;
}

function DeskCard({ agent, isFollowing, onToggleFollow }: DeskCardProps) {
  const color = ROLE_COLOR[agent.role];
  const StatusIcon =
    agent.status === 'working' ? Loader2 : agent.status === 'blocked' ? Clock : Moon;
  const statusColor =
    agent.status === 'working'
      ? 'text-emerald-300'
      : agent.status === 'blocked'
        ? 'text-yellow-300'
        : 'text-text-faint';

  return (
    <button
      type="button"
      onClick={onToggleFollow}
      className={cn(
        'text-left rounded border p-3 transition-colors bg-bg-raised hover:border-accent/60',
        isFollowing ? 'border-accent ring-1 ring-accent/40' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-8 h-8 rounded"
          style={{
            background: `linear-gradient(135deg, ${color}, ${color}66)`,
            boxShadow: `0 0 12px ${color}40`,
          }}
        />
        <div className="min-w-0">
          <div className="text-xs font-medium truncate">{ROLE_LABEL[agent.role]}</div>
          <div className={cn('flex items-center gap-1 text-[10px]', statusColor)}>
            <StatusIcon size={10} className={agent.status === 'working' ? 'animate-spin' : ''} />
            <span className="uppercase tracking-wider">{agent.status}</span>
          </div>
        </div>
        {isFollowing && (
          <span className="ml-auto text-[9px] uppercase tracking-wider text-accent">following</span>
        )}
      </div>

      <div className="mt-3 text-[11px] text-text">
        {agent.currentTaskTitle ? (
          <div className="flex gap-1.5 items-start">
            <ListChecks size={12} className="text-text-muted shrink-0 mt-0.5" />
            <span className="truncate">{agent.currentTaskTitle}</span>
          </div>
        ) : (
          <div className="text-text-faint italic">no active task</div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2 text-[10px] text-text-faint">
        <BadgeCheck size={11} className="text-emerald-400" />
        <span>{agent.completed} done</span>
        <span>·</span>
        <span>{agent.active} active</span>
        <span>·</span>
        <span>{agent.backlog} queued</span>
      </div>
    </button>
  );
}
