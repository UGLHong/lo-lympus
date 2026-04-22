import 'dotenv/config';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { db, pool } from './client';

export async function runMigrations(): Promise<void> {
  try {
    console.log('[migrations] applying pending migrations...');
    await migrate(db, {
      migrationsFolder: './server/db/migrations',
    });
    console.log('[migrations] all migrations applied successfully');
  } catch (error) {
    console.error('[migrations] failed to apply migrations:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log('[migrations] done');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[migrations] error:', error);
      process.exit(1);
    })
    .finally(() => {
      pool.end();
    });
}
