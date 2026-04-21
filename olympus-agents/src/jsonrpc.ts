type Handler = (request: unknown) => Promise<void> | void;

type ContentLengthState = {
  buffer: Buffer;
  contentLength: number | null;
};

// minimal LSP/ACP-style "Content-Length: N\r\n\r\n<json>" framing over stdio
export async function startJsonRpcLoop(handler: Handler): Promise<void> {
  const state: ContentLengthState = { buffer: Buffer.alloc(0), contentLength: null };

  process.stdin.on('data', (chunk: Buffer) => {
    state.buffer = Buffer.concat([state.buffer, chunk]);
    drainFrames(state, handler).catch((error) => {
      process.stderr.write(`json-rpc loop error: ${error instanceof Error ? error.message : String(error)}\n`);
    });
  });

  return new Promise<void>((resolve) => {
    process.stdin.on('end', () => resolve());
    process.stdin.on('close', () => resolve());
  });
}

async function drainFrames(state: ContentLengthState, handler: Handler): Promise<void> {
  while (true) {
    if (state.contentLength === null) {
      const headerEnd = state.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = state.buffer.slice(0, headerEnd).toString('utf8');
      state.buffer = state.buffer.slice(headerEnd + 4);
      state.contentLength = parseContentLength(header);
      if (state.contentLength === null) {
        process.stderr.write(`malformed header: ${header}\n`);
        return;
      }
    }

    if (state.buffer.length < state.contentLength) return;
    const body = state.buffer.slice(0, state.contentLength).toString('utf8');
    state.buffer = state.buffer.slice(state.contentLength);
    state.contentLength = null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      process.stderr.write(`invalid json payload: ${body}\n`);
      continue;
    }

    await handler(parsed);
  }
}

function parseContentLength(header: string): number | null {
  for (const line of header.split(/\r?\n/)) {
    const match = line.match(/^Content-Length:\s*(\d+)$/i);
    if (match) return Number(match[1]);
  }
  return null;
}

export function sendJson(payload: unknown): void {
  const body = JSON.stringify(payload);
  const frame = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
  process.stdout.write(frame);
}

export function logJson(payload: unknown): void {
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}
