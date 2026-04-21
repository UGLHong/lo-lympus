import { getRecentEvents, subscribe } from '@/lib/events/bus';
import type { OlympusEvent } from '@/lib/schemas/events';
import { acquireProjectFsWatch } from '@/lib/workspace/project-fs-watch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const url = new URL(request.url);
  const sinceTs = url.searchParams.get('since');

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: OlympusEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: olympus\ndata: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const sendRaw = (name: string, payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const recent = getRecentEvents(id);
      for (const event of recent) {
        if (sinceTs && event.ts <= sinceTs) continue;
        send(event);
      }

      sendRaw('ready', { projectId: id, at: new Date().toISOString() });

      const unsub = subscribe(id, (event) => send(event));
      const releaseFsWatch = acquireProjectFsWatch(id);

      const heartbeat = setInterval(() => sendRaw('ping', { t: Date.now() }), 15_000);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        releaseFsWatch();
        unsub();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
