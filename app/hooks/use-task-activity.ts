import { useCallback, useEffect, useRef, useState } from 'react';

import { runNdjsonStream, type NdjsonStatus } from '../lib/ndjson-stream';

export interface ClarificationEntry {
  question: string;
  options: string[];
  context: string;
  fallbackAssumption: string;
}

interface BaseItem {
  id: string;
  role?: string;
  at: number;
}

export type ActivityItem =
  | (BaseItem & {
      kind: 'chat';
      direction: 'from-agent' | 'to-human' | 'from-human';
      text: string;
      options?: string[];
      context?: string;
      clarifications?: ClarificationEntry[];
    })
  | (BaseItem & {
      kind: 'tool';
      toolKind: string;
      action: string;
      path?: string;
      url?: string;
      summary?: string;
      ok?: boolean;
      ms?: number;
    })
  | (BaseItem & { kind: 'log'; stream: 'stdout' | 'stderr'; text: string })
  | (BaseItem & {
      kind: 'token-stream';
      streamKind: 'text' | 'reasoning';
      streamId: string;
      text: string;
      done: boolean;
    })
  | (BaseItem & { kind: 'state'; status: string; note?: string })
  | (BaseItem & { kind: 'workspace'; path: string })
  | (BaseItem & { kind: 'task'; status: string });

type ActivityStatus = 'connecting' | 'replaying' | 'live' | 'reconnecting' | 'closed';

type ActivityFrame =
  | { kind: 'hello'; at: number }
  | { kind: 'history'; item: ActivityItem | TokenWireEvent }
  | { kind: 'event'; item: ActivityItem | TokenWireEvent }
  | { kind: 'ready'; at: number }
  | { kind: 'ping'; at: number };

interface TokenWireEvent extends BaseItem {
  kind: 'token';
  streamKind: 'text' | 'reasoning';
  streamId: string;
  phase: 'start' | 'delta' | 'end';
  text?: string;
}

// merge a server `token` wire event into the running feed. consecutive deltas
// on the same streamId collapse into one growing `token-stream` bubble.
function applyTokenEvent(prev: ActivityItem[], wire: TokenWireEvent): ActivityItem[] {
  const existingIdx = prev.findIndex(
    (candidate) =>
      candidate.kind === 'token-stream' &&
      candidate.streamKind === wire.streamKind &&
      candidate.streamId === wire.streamId &&
      !candidate.done,
  );

  if (wire.phase === 'start') {
    if (existingIdx !== -1) return prev;
    return [
      ...prev,
      {
        kind: 'token-stream',
        id: wire.id,
        role: wire.role,
        at: wire.at,
        streamKind: wire.streamKind,
        streamId: wire.streamId,
        text: '',
        done: false,
      },
    ];
  }

  if (wire.phase === 'delta') {
    if (existingIdx === -1) {
      return [
        ...prev,
        {
          kind: 'token-stream',
          id: wire.id,
          role: wire.role,
          at: wire.at,
          streamKind: wire.streamKind,
          streamId: wire.streamId,
          text: wire.text ?? '',
          done: false,
        },
      ];
    }
    const next = prev.slice();
    const prior = next[existingIdx] as Extract<ActivityItem, { kind: 'token-stream' }>;
    next[existingIdx] = {
      ...prior,
      text: prior.text + (wire.text ?? ''),
      at: wire.at,
    };
    return next;
  }

  // phase === 'end'
  if (existingIdx === -1) return prev;
  const next = prev.slice();
  const prior = next[existingIdx] as Extract<ActivityItem, { kind: 'token-stream' }>;
  next[existingIdx] = { ...prior, done: true, at: wire.at };
  return next;
}

function appendUnique(prev: ActivityItem[], incoming: ActivityItem): ActivityItem[] {
  if (prev.some((existing) => existing.id === incoming.id)) return prev;
  return [...prev, incoming];
}

interface UseTaskActivityResult {
  items: ActivityItem[];
  status: ActivityStatus;
  ingestLocal: (item: ActivityItem) => void;
}

// map the lifecycle status of the underlying ndjson stream onto the richer
// activity status the UI surfaces (so consumers can still distinguish
// "replaying history" from "subscribed and idle").
function projectStreamStatus(prev: ActivityStatus, wire: NdjsonStatus): ActivityStatus {
  if (wire === 'open') return prev === 'live' ? 'live' : 'replaying';
  if (wire === 'connecting') return 'connecting';
  if (wire === 'reconnecting') return 'reconnecting';
  return 'closed';
}

function isTokenWireEvent(value: unknown): value is TokenWireEvent {
  return Boolean(value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'token');
}

export function useTaskActivity(taskId: string): UseTaskActivityResult {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [status, setStatus] = useState<ActivityStatus>('connecting');
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setItems([]);
    setStatus('connecting');
    seenIdsRef.current = new Set();

    const controller = new AbortController();

    const ingest = (raw: ActivityItem | TokenWireEvent) => {
      if (!raw?.id) return;
      if (seenIdsRef.current.has(raw.id)) return;
      seenIdsRef.current.add(raw.id);
      if (isTokenWireEvent(raw)) {
        setItems((prev) => applyTokenEvent(prev, raw));
      } else {
        setItems((prev) => appendUnique(prev, raw));
      }
    };

    void runNdjsonStream<ActivityFrame>({
      url: `/api/tasks/${encodeURIComponent(taskId)}/activity`,
      signal: controller.signal,
      onStatus: (wire) => setStatus((prev) => projectStreamStatus(prev, wire)),
      onLine: (frame) => {
        if (!frame || typeof frame.kind !== 'string') return;
        if (frame.kind === 'history' && frame.item) ingest(frame.item);
        else if (frame.kind === 'event' && frame.item) ingest(frame.item);
        else if (frame.kind === 'ready') setStatus('live');
      },
    });

    return () => {
      controller.abort();
      setStatus('closed');
    };
  }, [taskId]);

  const ingestLocal = useCallback((item: ActivityItem) => {
    setItems((prev) => appendUnique(prev, item));
    seenIdsRef.current.add(item.id);
  }, []);

  return { items, status, ingestLocal };
}
