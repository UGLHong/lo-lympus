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

const DESCRIPTION = [
  'Run a READ-ONLY SELECT statement against the Olympus control-plane Postgres.',
  'Use this to inspect the current board before filing or delegating work — e.g. see which tickets already exist, which ones blocked, what a reviewer wrote, etc.',
  '',
  'Useful tables (column names in parens):',
  '- `olympus_tasks`   (id, project_id, role, title, description, status, iteration, parent_task_id, depends_on, user_notes, result, created_at, updated_at) — the task board.',
  '- `olympus_projects` (id, name, slug, brief, workspace_dir, created_at) — project metadata.',
  '',
  `ALWAYS scope to \`project_id = '{YOUR_PROJECT_ID}'\` (the project_id is pinned in your RUNTIME CONTEXT block).`,
  'Only SELECT is allowed; multi-statement queries and DDL/DML are blocked. Results are capped to 200 rows.',
].join('\n');

const FORBIDDEN_STATEMENT = /;\s*\S/i;

export function buildDatabaseQueryTool(ctx: ToolCtx) {
  return createTool({
    id: 'database_query',
    description: DESCRIPTION,
    inputSchema: z.object({
      sql: z
        .string()
        .min(7)
        .describe('A single SELECT statement. No trailing semicolons needed.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      rows: z.array(z.record(z.unknown())).optional(),
      rowCount: z.number().optional(),
      truncated: z.boolean().optional(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      const sql = input.sql.trim().replace(/;+\s*$/, '');
      emitToolLog(ctx, { kind: 'db', action: 'query', summary: sql.slice(0, 140) });
      if (!/^select\s/i.test(sql) && !/^with\s/i.test(sql)) {
        return { ok: false, error: 'only SELECT / WITH queries are permitted' };
      }
      if (FORBIDDEN_STATEMENT.test(sql)) {
        return { ok: false, error: 'multi-statement queries are blocked — send one SELECT at a time' };
      }
      const started = Date.now();
      try {
        const result = await pool.query(sql);
        const capped = result.rows.slice(0, 200);
        emitToolLog(ctx, {
          kind: 'db',
          action: 'query.done',
          ok: true,
          ms: Date.now() - started,
          summary: `${capped.length}${result.rows.length > capped.length ? `/${result.rows.length}` : ''} row(s)`,
        });
        return {
          ok: true,
          rows: capped,
          rowCount: result.rows.length,
          truncated: result.rows.length > capped.length,
        };
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
