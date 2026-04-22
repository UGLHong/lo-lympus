import type { PoolClient } from 'pg';

import { pool } from '../../server/db/client';
import { recordEvent } from '../../server/db/queries';

import { emit as rawEmit, subscribe, type OlympusEvent } from './event-bus.server';

const globalForPersistence = globalThis as unknown as {
  __olympusPersistenceStarted?: boolean;
  __olympusNotifyClient?: PoolClient;
};

const CHANNEL = 'olympus_events';

async function persistEvent(event: OlympusEvent): Promise<void> {
  // agent-stream deltas are extremely chatty (one per token) and only useful
  // live. skip persistence so task history stays lean — the final chat message
  // emitted after the agent finishes already captures the outcome.
  if (event.type === 'log' && event.payload?.channel === 'agent-stream') return;

  try {
    await recordEvent({
      projectId: event.projectId,
      role: event.role ?? null,
      taskId: event.taskId ?? null,
      type: event.type,
      payload: { ...event.payload, __id: event.id, __ts: event.createdAt },
    });
  } catch {
    /* swallow - DB unavailable must not break the bus */
  }
}

export async function startEventPersistence(): Promise<void> {
  if (globalForPersistence.__olympusPersistenceStarted) return;
  globalForPersistence.__olympusPersistenceStarted = true;

  subscribe((event) => {
    void persistEvent(event);
    void broadcast(event);
  });

  try {
    const client = await pool.connect();
    globalForPersistence.__olympusNotifyClient = client;
    await client.query(`LISTEN ${CHANNEL}`);
    client.on('notification', (msg) => {
      if (!msg.payload) return;
      try {
        const parsed = JSON.parse(msg.payload) as OlympusEvent & { __origin?: string };
        if (parsed.__origin === processOrigin) return;
        rawEmit({
          projectId: parsed.projectId,
          role: parsed.role,
          taskId: parsed.taskId,
          type: parsed.type,
          payload: parsed.payload,
        });
      } catch {
        /* ignore malformed */
      }
    });
  } catch {
    /* LISTEN is optional - bus still works in a single-process setup */
  }
}

const processOrigin = `${process.pid}-${Date.now()}`;

async function broadcast(event: OlympusEvent): Promise<void> {
  // agent-stream deltas are high-volume and only matter to the SSE client
  // already connected to this process. skip cross-process rebroadcast.
  if (event.type === 'log' && event.payload?.channel === 'agent-stream') return;
  try {
    const payload = JSON.stringify({ ...event, __origin: processOrigin });
    if (payload.length > 7800) return;
    await pool.query(`SELECT pg_notify($1, $2)`, [CHANNEL, payload]);
  } catch {
    /* ignore */
  }
}
