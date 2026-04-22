import { emit } from '../../app/lib/event-bus.server';
import { kanbanTaskPayload } from '../lib/kanban-task-payload';
import { upsertAgent } from '../db/queries';

import { claimNextTask } from './claim';
import { executeTask } from './execute';

import type { Role } from '../const/roles';

interface LoopOptions {
  pollMs: number;
  stopSignal: AbortSignal;
}

export async function runLoop(role: Role, opts: LoopOptions): Promise<void> {
  try {
    await upsertAgent({ role, status: 'idle', currentTaskId: null, currentProjectId: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${role}] initial upsert failed:`, message);
  }

  let lastErrorLogged = 0;
  while (!opts.stopSignal.aborted) {
    try {
      const task = await claimNextTask(role);
      if (!task) {
        await sleep(opts.pollMs, opts.stopSignal);
        continue;
      }

      await upsertAgent({
        role,
        status: 'working',
        currentTaskId: task.id,
        currentProjectId: task.projectId,
      });
      emit({
        projectId: task.projectId,
        role,
        taskId: task.id,
        type: 'task-update',
        payload: kanbanTaskPayload(task),
      });

      await executeTask(role, task);

      await upsertAgent({
        role,
        status: 'idle',
        currentTaskId: null,
        currentProjectId: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const now = Date.now();
      // throttle identical-looking errors so a misconfigured DB doesn't spam the log
      if (now - lastErrorLogged > 30_000) {
        console.error(`[${role}] loop error:`, message);
        lastErrorLogged = now;
      }
      await sleep(Math.min(opts.pollMs * 2, 30_000), opts.stopSignal);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
