import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { sendJson, logJson } from './jsonrpc';

type WatcherOptions = {
  workspacePath: string;
  projectId: string;
};

type BargeInEvent = {
  kind: 'barge.in';
  role: string;
  text: string;
  ts?: string;
  source?: string;
};

// tails the workspace events.ndjson for barge.in events written by the web
// app. when a new one appears, forwards it to Zed as an ACP notification so
// the agent panel sees what the human typed on the Olympus side. events
// originating from the ACP session itself (source === 'acp') are skipped to
// avoid echoing our own notifications back to Zed.
export function startEventsWatcher(options: WatcherOptions): () => void {
  const { workspacePath, projectId } = options;
  if (!workspacePath) {
    logJson({ kind: 'events-watcher.skipped', reason: 'workspacePath missing' });
    return () => {};
  }

  const filePath = path.join(workspacePath, '.software-house', 'events.ndjson');
  let offset = 0;
  let leftover = '';
  let closed = false;
  let watcher: fs.FSWatcher | null = null;

  const readNew = async () => {
    if (closed) return;
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return;
    }
    if (stat.size < offset) {
      offset = 0;
      leftover = '';
    }
    if (stat.size === offset) return;

    const handle = await fsp.open(filePath, 'r');
    try {
      const length = stat.size - offset;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      offset = stat.size;
      const text = leftover + buffer.toString('utf8');
      const lines = text.split('\n');
      leftover = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as BargeInEvent;
          if (parsed.kind !== 'barge.in') continue;
          if (parsed.source === 'acp') continue;
          sendNotification(projectId, parsed);
        } catch {
          // ignore malformed ndjson
        }
      }
    } finally {
      await handle.close();
    }
  };

  const seed = async () => {
    try {
      const stat = await fsp.stat(filePath);
      offset = stat.size;
    } catch {
      offset = 0;
    }
    try {
      watcher = fs.watch(filePath, { persistent: false }, () => {
        readNew().catch((error) => {
          logJson({
            kind: 'events-watcher.read-error',
            error: error instanceof Error ? error.message : String(error),
          });
        });
      });
    } catch (error) {
      logJson({
        kind: 'events-watcher.watch-error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  void seed();

  const interval = setInterval(() => {
    readNew().catch(() => {});
  }, 3_000);

  return () => {
    closed = true;
    clearInterval(interval);
    watcher?.close();
  };
}

function sendNotification(projectId: string, event: BargeInEvent): void {
  sendJson({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      projectId,
      kind: 'barge.in',
      role: event.role,
      text: event.text,
      ts: event.ts ?? new Date().toISOString(),
    },
  });
}
