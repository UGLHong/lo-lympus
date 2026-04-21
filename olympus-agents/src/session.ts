import fs from 'node:fs/promises';
import path from 'node:path';

export type SessionInit = {
  projectId: string;
  workspacePath: string;
  olympusApi: string;
};

export type Session = SessionInit & {
  recordInbound(message: unknown): void;
  recordOutbound(message: unknown): void;
  appendEventNdjson(event: Record<string, unknown>): Promise<void>;
};

function eventsPath(workspacePath: string): string {
  return path.join(workspacePath, '.software-house', 'events.ndjson');
}

export function createSession(init: SessionInit): Session {
  const inbound: unknown[] = [];
  const outbound: unknown[] = [];

  return {
    ...init,
    recordInbound(message) {
      inbound.push(message);
    },
    recordOutbound(message) {
      outbound.push(message);
    },
    async appendEventNdjson(event) {
      if (!init.workspacePath) return;
      const target = eventsPath(init.workspacePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const withTs = { ts: new Date().toISOString(), source: 'acp', ...event };
      await fs.appendFile(target, `${JSON.stringify(withTs)}\n`, 'utf8');
    },
  };
}
