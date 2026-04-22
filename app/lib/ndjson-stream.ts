// connect to an NDJSON endpoint via fetch and invoke `onLine` for each parsed
// JSON object. retries with exponential backoff on network errors and when the
// server closes the stream without the caller aborting. cancellation is driven
// by the passed AbortSignal — cancel it to fully tear down the connection.

export interface NdjsonStreamOptions<T> {
  url: string;
  onLine: (line: T) => void;
  onStatus?: (status: NdjsonStatus) => void;
  signal: AbortSignal;
  initialRetryMs?: number;
  maxRetryMs?: number;
}

export type NdjsonStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export async function runNdjsonStream<T = unknown>(
  opts: NdjsonStreamOptions<T>,
): Promise<void> {
  const {
    url,
    onLine,
    onStatus,
    signal,
    initialRetryMs = 1000,
    maxRetryMs = 15_000,
  } = opts;

  let retryMs = initialRetryMs;

  while (!signal.aborted) {
    onStatus?.('connecting');
    try {
      const res = await fetch(url, {
        signal,
        headers: { Accept: 'application/x-ndjson' },
        cache: 'no-store',
      });

      if (!res.ok || !res.body) {
        throw new Error(`ndjson ${res.status}`);
      }

      onStatus?.('open');
      retryMs = initialRetryMs;

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let newlineIdx = buffer.indexOf('\n');
        while (newlineIdx !== -1) {
          const rawLine = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (rawLine) {
            try {
              onLine(JSON.parse(rawLine) as T);
            } catch {
              // ignore malformed frames — server shouldn't emit them
            }
          }
          newlineIdx = buffer.indexOf('\n');
        }
      }
    } catch (err) {
      if (signal.aborted) break;
      // swallow expected abort errors; anything else flows into the retry path
      const name = (err as { name?: string } | null)?.name;
      if (name === 'AbortError') break;
    }

    if (signal.aborted) break;

    onStatus?.('reconnecting');
    await sleep(retryMs, signal);
    retryMs = Math.min(retryMs * 2, maxRetryMs);
  }

  onStatus?.('closed');
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const handle = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(handle);
        resolve();
      },
      { once: true },
    );
  });
}
