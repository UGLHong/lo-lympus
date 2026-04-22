import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { pool } from '../db/client';
import { emitToolLog } from '../lib/tool-log';

interface ToolCtx {
  projectId: string;
  projectSlug: string;
  role: string;
  taskId?: string;
}

export function buildDatabaseQueryTool(ctx: ToolCtx) {
  return createTool({
    id: 'database_query',
    description:
      'Run a READ-ONLY SQL query against the shared Postgres for schema introspection. Only SELECT statements against information_schema / pg_catalog / public views are permitted.',
    inputSchema: z.object({
      sql: z.string().describe('A single SELECT statement.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      rows: z.array(z.record(z.unknown())).optional(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      const sql = input.sql.trim();
      emitToolLog(ctx, { kind: 'db', action: 'query', summary: sql.slice(0, 140) });
      if (!/^select\s/i.test(sql)) {
        return { ok: false, error: 'only SELECT queries are permitted' };
      }
      if (/;\s*(select|insert|update|delete|drop|alter|truncate)/i.test(sql)) {
        return { ok: false, error: 'multi-statement queries are blocked' };
      }
      const started = Date.now();
      try {
        const result = await pool.query(sql);
        emitToolLog(ctx, {
          kind: 'db',
          action: 'query.done',
          ok: true,
          ms: Date.now() - started,
          summary: `${result.rows.length} rows`,
        });
        return { ok: true, rows: result.rows.slice(0, 200) };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        emitToolLog(ctx, {
          kind: 'db',
          action: 'query.error',
          ok: false,
          ms: Date.now() - started,
          summary: error,
        });
        return { ok: false, error };
      }
    },
  });
}
