import { emit } from '../../app/lib/event-bus.server';
import { kanbanTaskPayload } from '../lib/kanban-task-payload';
import {
  getTaskById,
  listStaleBlockedTasks,
  resumeBlockedTaskWithAssumptions,
} from '../db/queries';
import { getSettings } from '../lib/settings';

import type { Task } from '../db/schema';

interface WatcherOptions {
  stopSignal: AbortSignal;
}

// background loop: periodically scans for tasks stuck in 'blocked-needs-input'
// longer than the configured clarification timeout and forces them back into
// the pool with a 'CLARIFICATION TIMEOUT' marker so the role proceeds using
// the fallback assumptions it already committed to.
export async function runClarificationWatcher(opts: WatcherOptions): Promise<void> {
  let lastErrorLogged = 0;

  while (!opts.stopSignal.aborted) {
    const settings = getSettings();
    const tickMs = Math.max(settings.clarificationWatcherTickMs, 1000);

    try {
      await sweepOnce();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const now = Date.now();
      if (now - lastErrorLogged > 30_000) {
        console.error('[clarification-watcher] sweep error:', message);
        lastErrorLogged = now;
      }
    }

    await sleep(tickMs, opts.stopSignal);
  }
}

async function sweepOnce(): Promise<void> {
  const settings = getSettings();
  const timeoutMs = settings.clarificationTimeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;

  const cutoff = new Date(Date.now() - timeoutMs);
  const stale = await listStaleBlockedTasks(cutoff);
  if (stale.length === 0) return;

  for (const task of stale) {
    await resumeOne(task);
  }
}

async function resumeOne(task: Task): Promise<void> {
  const originalReason = task.blockedReason ?? '(no question recorded)';
  const resumed = await resumeBlockedTaskWithAssumptions(task.id, originalReason);
  if (!resumed) return;

  emit({
    projectId: resumed.projectId,
    role: resumed.role,
    taskId: resumed.id,
    type: 'chat',
    payload: {
      from: 'system',
      direction: 'from-agent',
      text: 'Clarification timed out. Proceeding with the documented fallback assumptions.',
    },
  });

  emit({
    projectId: resumed.projectId,
    role: resumed.role,
    taskId: resumed.id,
    type: 'state',
    payload: { status: 'idle', reason: 'clarification-timeout' },
  });

  const refreshed = await getTaskById(resumed.id);
  if (refreshed) {
    emit({
      projectId: refreshed.projectId,
      role: refreshed.role,
      taskId: refreshed.id,
      type: 'task-update',
      payload: kanbanTaskPayload(refreshed),
    });
  }

  console.log(
    `[clarification-watcher] resumed task ${resumed.id} (role=${resumed.role}) after clarification timeout`,
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
