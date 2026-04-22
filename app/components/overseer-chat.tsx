import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSse, type SseEvent } from '../hooks/use-sse';
import { useFollowMode } from '../lib/follow-mode';
import { ROLES, ROLE_COLOR, ROLE_LABEL, isRole, type Role } from '../lib/roles';
import { buildTaskCodeMap, getTaskCode } from '../lib/task-code';
import { cn } from '../lib/cn';

interface OverseerMessage {
  id: string;
  role: string;
  direction: 'from-agent' | 'from-human';
  text: string;
  taskRef?: string;
  taskTitle?: string;
  at: number;
}

interface OverseerTaskSeed {
  id: string;
  role: string;
  createdAt: string;
}

interface OverseerChatProps {
  projectId: string;
}

function mapOverseerEvent(event: SseEvent): OverseerMessage | null {
  if (event.type !== 'chat') return null;
  const p = event.payload as {
    from?: string;
    direction?: string;
    text?: string;
    scope?: string;
    taskRef?: string;
    taskTitle?: string;
    localId?: string;
  };
  if (p.scope !== 'overseer') return null;
  if (!p.text || !p.direction || !p.from) return null;
  if (p.direction !== 'from-agent' && p.direction !== 'from-human') return null;
  // reuse the sender's optimistic bubble id for their own messages so the
  // live echo dedupes instead of stacking a duplicate below the input.
  const id =
    p.direction === 'from-human' && typeof p.localId === 'string' && p.localId.length > 0
      ? p.localId
      : event.id;
  return {
    id,
    role: p.from,
    direction: p.direction,
    text: p.text,
    taskRef: typeof p.taskRef === 'string' ? p.taskRef : undefined,
    taskTitle: typeof p.taskTitle === 'string' ? p.taskTitle : undefined,
    at: event.createdAt,
  };
}

export function OverseerChat({ projectId }: OverseerChatProps) {
  const [messages, setMessages] = useState<OverseerMessage[]>([]);
  const [taskSeeds, setTaskSeeds] = useState<OverseerTaskSeed[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const { followRole, setFollowRole } = useFollowMode();
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // pull tasks once so overseer-scoped messages can surface their task codes.
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/tasks?projectId=${encodeURIComponent(projectId)}`)
      .then((res) => (res.ok ? res.json() : { tasks: [] }))
      .then((data: { tasks?: OverseerTaskSeed[] }) => {
        if (cancelled) return;
        setTaskSeeds(data.tasks ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useSse({
    projectId,
    onEvent: (event) => {
      if (event.type === 'task-update') {
        const p = event.payload as Partial<OverseerTaskSeed>;
        if (typeof p.id !== 'string' || typeof p.role !== 'string' || typeof p.createdAt !== 'string') {
          return;
        }
        const seed: OverseerTaskSeed = { id: p.id, role: p.role, createdAt: p.createdAt };
        setTaskSeeds((prev) => {
          const idx = prev.findIndex((entry) => entry.id === seed.id);
          if (idx === -1) return [...prev, seed];
          const next = prev.slice();
          next[idx] = seed;
          return next;
        });
        return;
      }
      const mapped = mapOverseerEvent(event);
      if (!mapped) return;
      setMessages((prev) => (prev.some((m) => m.id === mapped.id) ? prev : [...prev, mapped]));
    },
  });

  const taskCodes = useMemo(() => buildTaskCodeMap(taskSeeds), [taskSeeds]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text || sending) return;
      setSending(true);
      setDraft('');
      const localId = `local-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: localId,
          role: 'human',
          direction: 'from-human',
          text,
          at: Date.now(),
        },
      ]);
      try {
        await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            role: 'orchestrator',
            message: text,
            scope: 'overseer',
            localId,
          }),
        });
      } finally {
        setSending(false);
      }
    },
    [draft, projectId, sending],
  );

  return (
    <div className="h-full flex flex-col">
      <div className="panel-header justify-between">
        <span>Overseer chat</span>
        <span className="text-[10px] text-text-faint">
          summaries from employees · talk to the orchestrator
        </span>
      </div>

      <div className="px-3 py-2 border-b border-border flex flex-wrap gap-1">
        {ROLES.map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => setFollowRole(followRole === role ? null : role)}
            className={cn(
              'px-2 py-0.5 text-[10px] rounded border',
              followRole === role
                ? 'border-accent text-accent bg-accent-soft'
                : 'border-border text-text-muted hover:border-border-strong',
            )}
            style={{ borderLeftColor: ROLE_COLOR[role], borderLeftWidth: 3 }}
          >
            {ROLE_LABEL[role]}
          </button>
        ))}
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-auto px-3 py-2 space-y-2 text-xs">
        {messages.length === 0 && (
          <div className="text-text-faint italic">
            no high-level activity yet. completion summaries land here, and anything you type
            becomes a new orchestrator requirement.
          </div>
        )}
        {messages.map((message) => (
          <OverseerMessageRow key={message.id} message={message} taskCodes={taskCodes} />
        ))}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-border p-2 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="add a requirement or course-correct the orchestrator"
          disabled={sending}
          className="flex-1 bg-bg-sunken border border-border rounded px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <button type="submit" className="btn btn-primary" disabled={sending || draft.trim().length === 0}>
          Send
        </button>
      </form>
    </div>
  );
}

function OverseerMessageRow({
  message,
  taskCodes,
}: {
  message: OverseerMessage;
  taskCodes: Map<string, string>;
}) {
  const isHuman = message.direction === 'from-human';
  const color = isRole(message.role) ? ROLE_COLOR[message.role as Role] : '#f59e0b';
  const label = isHuman
    ? 'you'
    : isRole(message.role)
      ? ROLE_LABEL[message.role as Role]
      : message.role;
  const taskCode = message.taskRef ? getTaskCode(message.taskRef, taskCodes) : null;

  return (
    <div className={cn('flex', isHuman ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded px-2 py-1.5 border',
          isHuman ? 'bg-accent-soft border-accent/40' : 'bg-bg-sunken border-border',
        )}
      >
        <div className="flex items-center gap-1.5 text-[10px] text-text-faint mb-0.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
          <span>{label}</span>
          {taskCode && (
            <span className="inline-flex items-center rounded border border-border bg-bg-sunken/70 px-1 font-mono text-[10px] text-text-muted">
              {taskCode}
            </span>
          )}
          {message.taskTitle && (
            <span className="truncate text-text-faint/80">· {message.taskTitle}</span>
          )}
        </div>
        <div className="whitespace-pre-wrap break-words text-text">{message.text}</div>
      </div>
    </div>
  );
}
