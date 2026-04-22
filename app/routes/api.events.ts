import { startEventPersistence } from '../lib/event-persistence.server';
import { subscribe, type OlympusEvent } from '../lib/event-bus.server';

import type { Route } from './+types/api.events';

// newline-delimited JSON livestream. a single long-lived HTTP response that
// emits one JSON object per line. preferred over SSE because: (1) we don't
// need the EventSource reconnection magic (we control retries on the client),
// (2) the client can multiplex this into many subscribers without opening
// multiple parallel connections and burning through the browser's 6-per-origin
// HTTP/1.1 cap.
export async function loader({ request }: Route.LoaderArgs) {
  await startEventPersistence();

  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  const roleFilter = url.searchParams.get('role');

  if (!projectId) {
    return new Response('projectId required', { status: 400 });
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

      const deliver = (event: OlympusEvent) => {
        if (event.projectId !== projectId) return;
        if (roleFilter && event.role !== roleFilter) return;
        writeLine({ kind: 'event', event });
      };

      const unsubscribe = subscribe(deliver);

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
