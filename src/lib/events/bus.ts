import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import type { OlympusEvent } from '@/lib/schemas/events';

type BusState = {
  emitter: EventEmitter;
  recent: Map<string, OlympusEvent[]>;
};

declare global {
  // eslint-disable-next-line no-var
  var __olympus_bus__: BusState | undefined;
}

function getBus(): BusState {
  if (!globalThis.__olympus_bus__) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    globalThis.__olympus_bus__ = { emitter, recent: new Map() };
  }
  return globalThis.__olympus_bus__;
}

const RECENT_CAP = 500;

type DistributedOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
type EmitInput = DistributedOmit<OlympusEvent, 'id' | 'ts'> & { id?: string; ts?: string };

export function emit(event: EmitInput): OlympusEvent {
  const full = {
    ...(event as object),
    id: event.id ?? nanoid(),
    ts: event.ts ?? new Date().toISOString(),
  } as OlympusEvent;

  const bus = getBus();
  const buffer = bus.recent.get(full.projectId) ?? [];
  buffer.push(full);
  if (buffer.length > RECENT_CAP) buffer.splice(0, buffer.length - RECENT_CAP);
  bus.recent.set(full.projectId, buffer);

  bus.emitter.emit('event', full);
  bus.emitter.emit(`project:${full.projectId}`, full);

  return full;
}

export function subscribe(projectId: string, onEvent: (e: OlympusEvent) => void): () => void {
  const bus = getBus();
  const listener = (e: OlympusEvent) => onEvent(e);
  bus.emitter.on(`project:${projectId}`, listener);
  return () => bus.emitter.off(`project:${projectId}`, listener);
}

export function getRecentEvents(projectId: string): OlympusEvent[] {
  return getBus().recent.get(projectId) ?? [];
}

export function clearProjectEventBuffer(projectId: string): void {
  getBus().recent.delete(projectId);
}
