import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { runNdjsonStream, type NdjsonStatus } from './ndjson-stream';

export interface LiveEvent {
  id: string;
  projectId: string;
  role?: string;
  taskId?: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

type Subscriber = (event: LiveEvent) => void;

interface LiveEventsValue {
  subscribe: (fn: Subscriber) => () => void;
  projectId: string;
}

const LiveEventsContext = createContext<LiveEventsValue | null>(null);

interface LiveEventsProviderProps {
  projectId: string;
  children: ReactNode;
}

interface NdjsonFrame {
  kind: 'hello' | 'event' | 'ping';
  event?: LiveEvent;
}

// opens a single shared NDJSON livestream per project and fans events out to
// any number of component-level subscribers. replaces the prior approach of
// each component opening its own EventSource, which exhausted the browser's
// 6-per-origin connection cap and left unrelated fetches stuck in "pending".
export function LiveEventsProvider({ projectId, children }: LiveEventsProviderProps) {
  const subscribersRef = useRef<Set<Subscriber>>(new Set());

  const subscribe = useMemo<LiveEventsValue['subscribe']>(
    () => (fn) => {
      subscribersRef.current.add(fn);
      return () => {
        subscribersRef.current.delete(fn);
      };
    },
    [],
  );

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();

    void runNdjsonStream<NdjsonFrame>({
      url: `/api/events?projectId=${encodeURIComponent(projectId)}`,
      signal: controller.signal,
      onLine: (frame) => {
        if (frame?.kind !== 'event' || !frame.event) return;
        for (const fn of subscribersRef.current) {
          try {
            fn(frame.event);
          } catch (err) {
            console.warn('[live-events] subscriber threw', err);
          }
        }
      },
    });

    return () => controller.abort();
  }, [projectId]);

  const value = useMemo<LiveEventsValue>(
    () => ({ subscribe, projectId }),
    [subscribe, projectId],
  );

  return <LiveEventsContext.Provider value={value}>{children}</LiveEventsContext.Provider>;
}

export function useLiveEventsContext(): LiveEventsValue {
  const ctx = useContext(LiveEventsContext);
  if (!ctx) throw new Error('useLiveEventsContext must be used within LiveEventsProvider');
  return ctx;
}

export type { NdjsonStatus };
