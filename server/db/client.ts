import 'dotenv/config';

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema';

const globalForPg = globalThis as unknown as {
  __olympusPgPool?: pg.Pool;
};

function createPool(): pg.Pool {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('DATABASE_URL is not set');
  }

  // pg v8.20+ treats sslmode=require as verify-full, which rejects DigitalOcean's
  // self-signed CA chain. Strip the URL-level sslmode and control TLS via pool opts.
  const url = new URL(raw);
  const sslMode = url.searchParams.get('sslmode');
  url.searchParams.delete('sslmode');
  const sanitizedUrl = url.toString();

  const sslFromEnv = process.env.DATABASE_SSL;
  const rejectUnauthorized = sslFromEnv
    ? sslFromEnv === 'verify'
    : false;

  const needsSsl = Boolean(sslMode) || sslFromEnv !== 'disable';

  return new pg.Pool({
    connectionString: sanitizedUrl,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    ssl: needsSsl ? { rejectUnauthorized } : false,
  });
}

export const pool = (globalForPg.__olympusPgPool ??= createPool());

export const db = drizzle(pool, { schema });

export { schema };
