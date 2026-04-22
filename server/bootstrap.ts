import { startEventPersistence } from '../app/lib/event-persistence.server';

import { runMigrations } from './db/migrate';
import { requeueOrphanedInProgressTasks } from './db/queries';
import { startDispatcher } from './daemon/dispatcher';

const globalForBootstrap = globalThis as unknown as {
  __olympusBootstrap?: { stop: () => void };
};

export async function bootstrapWorkforce(): Promise<void> {
  if (globalForBootstrap.__olympusBootstrap) return;

  await runMigrations();
  await startEventPersistence();

  try {
    const recovered = await requeueOrphanedInProgressTasks();
    if (recovered > 0) {
      console.log(`[olympus] recovered ${recovered} orphaned in-progress task(s)`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[olympus] orphan recovery failed:', message);
  }

  if (process.env.OLYMPUS_DISABLE_WORKFORCE === 'true') {
    console.log('[olympus] workforce disabled via OLYMPUS_DISABLE_WORKFORCE');
    globalForBootstrap.__olympusBootstrap = { stop: () => undefined };
    return;
  }

  const dispatcher = startDispatcher();
  globalForBootstrap.__olympusBootstrap = dispatcher;

  const shutdown = () => dispatcher.stop();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
