import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export type ImplementRequest = {
  apiBase: string;
  projectId: string;
  maxSteps?: number;
  resume?: boolean;
};

export type ImplementSummary = {
  completed: string[];
  changesRequested: string[];
  blocked: string[];
  paused: boolean;
  reason?: string;
  steps: number;
};

type ImplementResponse = {
  ok?: boolean;
  summary?: ImplementSummary;
  error?: string;
};

// minimal HTTP client — we intentionally avoid adding undici/fetch
// to this package to keep the ACP server footprint small.
export async function runImplementOverHttp(
  request: ImplementRequest,
): Promise<ImplementSummary> {
  const url = new URL(
    `${request.apiBase.replace(/\/$/, '')}/projects/${encodeURIComponent(request.projectId)}/implement`,
  );

  const payload = JSON.stringify({
    maxSteps: request.maxSteps,
    resume: request.resume,
  });

  const response = await postJson(url, payload);
  if (response.status >= 400) {
    const body = safeParse(response.body);
    const reason = (body && typeof body.error === 'string' ? body.error : response.body.slice(0, 200))
      || `HTTP ${response.status}`;
    throw new Error(`implement endpoint failed: ${reason}`);
  }

  const parsed = safeParse(response.body);
  if (!parsed || !parsed.summary) {
    throw new Error('implement endpoint returned no summary');
  }
  return parsed.summary;
}

type HttpResult = {
  status: number;
  body: string;
};

function postJson(url: URL, body: string): Promise<HttpResult> {
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function safeParse(body: string): ImplementResponse | null {
  try {
    return JSON.parse(body) as ImplementResponse;
  } catch {
    return null;
  }
}
