import { emit } from '@/lib/events/bus';
import { appendEvent } from '@/lib/workspace/fs';
import { getRuntimeStatus, startRuntime } from '@/lib/workspace/runtime';

type WaitOpts = {
  timeoutMs: number;
  intervalMs: number;
};

export async function waitForHttpOk(url: string, options: WaitOpts): Promise<boolean> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(Math.min(10_000, options.intervalMs * 2)),
      });
      if (response.ok) return true;
    } catch {
      // connection refused or reset until the dev server listens
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  return false;
}

const READY_TIMEOUT_MS = Number(process.env.OLYMPUS_BRINGUP_READY_MS ?? 120_000);
const READY_INTERVAL_MS = Number(process.env.OLYMPUS_BRINGUP_POLL_MS ?? 1_000);

export async function runBringupRuntimeStage(
  projectId: string,
): Promise<{ ok: true; url: string } | { ok: false; detail: string }> {
  let status = getRuntimeStatus(projectId);
  if (!status.running) {
    const startMeta = await startRuntime({ projectId, script: 'dev' });
    if (!startMeta.started) {
      return {
        ok: false,
        detail: startMeta.reason ?? 'failed to start dev server',
      };
    }
    status = getRuntimeStatus(projectId);
  }

  const port = status.port;
  if (port === undefined) {
    return { ok: false, detail: 'runtime has no bound port' };
  }

  const url = `http://127.0.0.1:${port}/`;
  const ready = await waitForHttpOk(url, {
    timeoutMs: READY_TIMEOUT_MS,
    intervalMs: READY_INTERVAL_MS,
  });

  if (!ready) {
    return {
      ok: false,
      detail: `timed out after ${READY_TIMEOUT_MS}ms waiting for HTTP 200 from ${url}`,
    };
  }

  const event = emit({
    projectId,
    kind: 'log',
    level: 'info',
    message: `bringup: dev server is reachable in the App / Runtime tab (${url})`,
  });
  await appendEvent(event);

  return { ok: true, url };
}
