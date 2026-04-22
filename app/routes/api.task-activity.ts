import { taskEventHistory } from '../../server/db/queries';
import { startEventPersistence } from '../lib/event-persistence.server';
import { subscribe, type OlympusEvent } from '../lib/event-bus.server';

import type { Route } from './+types/api.task-activity';

// every event carries a stable logical id so the client can dedup across
// reconnects. for persisted rows, this is the bus id we stored in payload.
// for live bus events, it's the bus-generated id directly.
interface ActivityEventBase {
  id: string;
  role?: string;
  at: number;
}

type ActivityEvent =
  | (ActivityEventBase & {
      kind: 'chat';
      direction: 'from-agent' | 'to-human' | 'from-human';
      text: string;
      options?: string[];
      context?: string;
      clarifications?: ClarificationShape[];
      messageType?: 'hitl-question' | 'cto-resolution';
      triageTaskId?: string;
      answer?: string;
      rationale?: string;
      originalQuestion?: string;
    })
  | (ActivityEventBase & {
      kind: 'tool';
      toolKind: string;
      action: string;
      path?: string;
      url?: string;
      summary?: string;
      ok?: boolean;
      ms?: number;
    })
  | (ActivityEventBase & { kind: 'log'; stream: 'stdout' | 'stderr'; text: string })
  | (ActivityEventBase & {
      kind: 'token';
      streamKind: 'text' | 'reasoning';
      streamId: string;
      phase: 'start' | 'delta' | 'end';
      text?: string;
    })
  | (ActivityEventBase & { kind: 'state'; status: string; note?: string })
  | (ActivityEventBase & { kind: 'workspace'; path: string })
  | (ActivityEventBase & { kind: 'task'; status: string });

interface ClarificationShape {
  question: string;
  options: string[];
  context: string;
  fallbackAssumption: string;
}

interface NormalizedSource {
  type: OlympusEvent['type'];
  role?: string;
  payload: Record<string, unknown>;
  id: string;
  at: number;
}

function toActivity(source: NormalizedSource): ActivityEvent | null {
  const { type, payload: p, id, at, role } = source;
  const base = { id, role, at } as const;

  if (type === 'chat') {
    const direction = p.direction;
    if (direction !== 'from-agent' && direction !== 'to-human' && direction !== 'from-human') {
      return null;
    }
    const text = typeof p.text === 'string' ? p.text : '';
    if (!text) return null;
    const from = typeof p.from === 'string' ? p.from : role ?? 'agent';
    // reuse the client-supplied id for human-authored messages so the live
    // echo dedupes against the optimistic bubble the sender already rendered.
    const localId =
      direction === 'from-human' && typeof p.localId === 'string' && p.localId.length > 0
        ? p.localId
        : null;
    const effectiveBase = localId ? { ...base, id: localId } : base;
    const options = Array.isArray(p.options)
      ? p.options.filter((item): item is string => typeof item === 'string')
      : undefined;
    const context = typeof p.context === 'string' ? p.context : undefined;
    const clarifications = Array.isArray(p.clarifications)
      ? (p.clarifications as unknown[])
          .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
          .map((entry) => ({
            question: typeof entry.question === 'string' ? entry.question : '',
            options: Array.isArray(entry.options)
              ? entry.options.filter((opt): opt is string => typeof opt === 'string')
              : [],
            context: typeof entry.context === 'string' ? entry.context : '',
            fallbackAssumption:
              typeof entry.fallbackAssumption === 'string' ? entry.fallbackAssumption : '',
          }))
          .filter((entry) => entry.question.length > 0)
      : undefined;
    const messageTypeRaw = typeof p.messageType === 'string' ? p.messageType : undefined;
    const messageType: 'hitl-question' | 'cto-resolution' | undefined =
      messageTypeRaw === 'hitl-question' || messageTypeRaw === 'cto-resolution'
        ? messageTypeRaw
        : undefined;
    const triageTaskId = typeof p.triageTaskId === 'string' ? p.triageTaskId : undefined;
    const answer = typeof p.answer === 'string' ? p.answer : undefined;
    const rationale = typeof p.rationale === 'string' ? p.rationale : undefined;
    const originalQuestion = typeof p.originalQuestion === 'string' ? p.originalQuestion : undefined;

    return {
      kind: 'chat',
      ...effectiveBase,
      role: from,
      direction,
      text,
      options,
      context,
      clarifications,
      messageType,
      triageTaskId,
      answer,
      rationale,
      originalQuestion,
    };
  }

  if (type === 'log') {
    const channel = typeof p.channel === 'string' ? p.channel : undefined;
    if (channel === 'tool') {
      const toolKind = typeof p.kind === 'string' ? p.kind : 'misc';
      const action = typeof p.action === 'string' ? p.action : '?';
      return {
        kind: 'tool',
        ...base,
        toolKind,
        action,
        path: typeof p.path === 'string' ? p.path : undefined,
        url: typeof p.url === 'string' ? p.url : undefined,
        summary: typeof p.summary === 'string' ? p.summary : undefined,
        ok: typeof p.ok === 'boolean' ? p.ok : undefined,
        ms: typeof p.ms === 'number' ? p.ms : undefined,
      };
    }
    if (channel === 'agent-stream') {
      const streamKindRaw = typeof p.kind === 'string' ? p.kind : 'text';
      const streamKind: 'text' | 'reasoning' = streamKindRaw === 'reasoning' ? 'reasoning' : 'text';
      const streamId = typeof p.streamId === 'string' ? p.streamId : 'stream';
      const phaseRaw = typeof p.phase === 'string' ? p.phase : 'delta';
      const phase: 'start' | 'delta' | 'end' =
        phaseRaw === 'start' ? 'start' : phaseRaw === 'end' ? 'end' : 'delta';
      const text = typeof p.text === 'string' ? p.text : undefined;
      return { kind: 'token', ...base, streamKind, streamId, phase, text };
    }
    const streamRaw = typeof p.stream === 'string' ? p.stream : 'stdout';
    const stream: 'stdout' | 'stderr' = streamRaw === 'stderr' ? 'stderr' : 'stdout';
    const text =
      typeof p.line === 'string' ? p.line : typeof p.text === 'string' ? p.text : '';
    if (!text) return null;
    return { kind: 'log', ...base, stream, text };
  }

  if (type === 'state') {
    const status = typeof p.status === 'string' ? p.status : 'update';
    const note =
      typeof p.reason === 'string'
        ? p.reason
        : typeof p.title === 'string'
          ? p.title
          : typeof p.lastTask === 'string'
            ? p.lastTask
            : undefined;
    return { kind: 'state', ...base, status, note };
  }

  if (type === 'workspace-change') {
    const path = typeof p.path === 'string' ? p.path : '';
    if (!path) return null;
    return { kind: 'workspace', ...base, path };
  }

  if (type === 'task-update') {
    const status = typeof p.status === 'string' ? p.status : '';
    if (!status) return null;
    return { kind: 'task', ...base, status };
  }

  return null;
}

async function buildHistoryFrames(taskId: string): Promise<ActivityEvent[]> {
  const rows = await taskEventHistory(taskId);
  const frames: ActivityEvent[] = [];
  for (const row of rows) {
    const rawPayload = (row.payload ?? {}) as Record<string, unknown> & {
      __id?: string;
      __ts?: number;
    };
    const busId = typeof rawPayload.__id === 'string' ? rawPayload.__id : `db-${row.id}`;
    const at = typeof rawPayload.__ts === 'number' ? rawPayload.__ts : row.createdAt.getTime();
    const { __id: _id, __ts: _ts, ...rest } = rawPayload;
    void _id;
    void _ts;
    const activity = toActivity({
      type: row.type,
      role: row.role ?? undefined,
      payload: rest,
      id: busId,
      at,
    });
    if (!activity) continue;
    frames.push(activity);
  }
  return frames;
}

// newline-delimited JSON livestream for a single task's activity feed.
// first N lines are { kind: 'history', item } replayed from the db, then
// { kind: 'ready' }, then { kind: 'event', item } as live events arrive,
// interspersed with { kind: 'ping' } keepalives.
export async function loader({ request, params }: Route.LoaderArgs) {
  const taskId = params.taskId;
  if (!taskId) return new Response('taskId required', { status: 400 });

  await startEventPersistence();

  let historyFrames: ActivityEvent[] = [];
  try {
    historyFrames = await buildHistoryFrames(taskId);
  } catch (err) {
    console.error('[task-activity] history load failed', err);
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const writeLine = (obj: unknown): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      writeLine({ kind: 'hello', at: Date.now() });

      for (const item of historyFrames) {
        if (!writeLine({ kind: 'history', item })) return;
      }
      writeLine({ kind: 'ready', at: Date.now() });

      const unsubscribe = subscribe((event) => {
        if (event.taskId !== taskId) return;
        const activity = toActivity({
          type: event.type,
          role: event.role,
          payload: event.payload,
          id: event.id,
          at: event.createdAt,
        });
        if (!activity) return;
        writeLine({ kind: 'event', item: activity });
      });

      const keepalive = setInterval(() => {
        if (!writeLine({ kind: 'ping', at: Date.now() })) {
          clearInterval(keepalive);
          unsubscribe();
        }
      }, 15_000);

      request.signal.addEventListener(
        'abort',
        () => {
          closed = true;
          clearInterval(keepalive);
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
        { once: true },
      );
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
