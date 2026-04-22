import { setMaxListeners } from 'node:events';

import { ROLES, type Role } from '../const/roles';
import { getSettings } from '../lib/settings';

import { runClarificationWatcher } from './clarification-watcher';
import { runLoop } from './loop';

export function startDispatcher(): { stop: () => void } {
  const controller = new AbortController();
  // the shared abort signal is handed to every role loop, the clarification
  // watcher, and downstream SDKs (mastra / ai-sdk / pg). each of them may
  // register listeners concurrently, so use 0 (unlimited) to silence noisy
  // MaxListenersExceededWarning without hiding real leaks — the signal itself
  // is fired at most once on shutdown.
  setMaxListeners(0, controller.signal);

  for (const role of ROLES) {
    const pollMs = rolePollMs(role);
    void runLoop(role, { pollMs, stopSignal: controller.signal });
    console.log(`[olympus] started ${role} loop (pollMs=${pollMs})`);
  }

  void runClarificationWatcher({ stopSignal: controller.signal });
  console.log('[olympus] started clarification watcher');

  return {
    stop: () => controller.abort(),
  };
}

function rolePollMs(role: Role): number {
  const key = `OLYMPUS_EMPLOYEE_POLL_MS_${role.toUpperCase().replaceAll('-', '_')}`;
  const override = process.env[key];
  if (override) {
    const num = Number(override);
    if (!Number.isNaN(num)) return num;
  }
  return getSettings().pollMs;
}
