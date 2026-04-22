import { useEffect, useRef } from 'react';

import { useLiveEventsContext, type LiveEvent } from '../lib/live-events';

export type SseEvent = LiveEvent;

interface UseSseOptions {
  projectId: string;
  role?: string | null;
  onEvent: (event: SseEvent) => void;
}

// subscribes to the shared LiveEventsProvider stream. despite the legacy name
// "useSse", this no longer opens an EventSource — a single NDJSON fetch stream
// is multiplexed across all consumers at the provider level.
export function useSse({ projectId, role, onEvent }: UseSseOptions): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  const { subscribe, projectId: providerProjectId } = useLiveEventsContext();

  useEffect(() => {
    if (!projectId) return;
    if (projectId !== providerProjectId) {
      console.warn(
        `[useSse] projectId mismatch (caller=${projectId}, provider=${providerProjectId}). ignoring.`,
      );
      return;
    }

    return subscribe((event) => {
      if (event.projectId !== projectId) return;
      if (role && event.role !== role) return;
      handlerRef.current(event);
    });
  }, [projectId, providerProjectId, role, subscribe]);
}
