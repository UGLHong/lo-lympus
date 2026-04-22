import { EventEmitter } from 'node:events';

export type OlympusEventType =
  | 'code-chunk'
  | 'state'
  | 'log'
  | 'chat'
  | 'workspace-change'
  | 'task-update';

export interface OlympusEvent {
  id: string;
  projectId: string;
  role?: string;
  taskId?: string;
  type: OlympusEventType;
  payload: Record<string, unknown>;
  createdAt: number;
}

const globalForBus = globalThis as unknown as {
  __olympusEventBus?: EventEmitter;
};

function createBus(): EventEmitter {
  const bus = new EventEmitter();
  bus.setMaxListeners(1000);
  return bus;
}

export const eventBus = (globalForBus.__olympusEventBus ??= createBus());

let counter = 0;
function nextId(): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function emit(event: Omit<OlympusEvent, 'id' | 'createdAt'>): OlympusEvent {
  const full: OlympusEvent = {
    ...event,
    id: nextId(),
    createdAt: Date.now(),
  };
  eventBus.emit('event', full);
  return full;
}

export function subscribe(handler: (event: OlympusEvent) => void): () => void {
  eventBus.on('event', handler);
  return () => eventBus.off('event', handler);
}
