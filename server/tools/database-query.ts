import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { pool } from "../db/client";
import { emitToolLog } from "../lib/tool-log";

interface ToolCtx {
  projectId: string;
  projectSlug: string;
  role: string;
  taskId?: string;
}

const DESCRIPTION = [
  "Run a READ-ONLY SELECT statement against the Olympus control-plane Postgres.",
  "Use this to inspect the current board before filing or delegating work.",
  "",
  "Key tables:",
  "- `olympus_tasks` columns: id, project_id, role, title, description, status,",
  "  iteration, parent_task_id, depends_on, result, error_log, blocked_reason,",
  "  model_tier, model_name, user_notes, created_at, updated_at",
  "- `olympus_projects` columns: id, name, slug, brief, workspace_dir, created_at",
  "",
  "Useful queries:",
  "  -- all tasks for this project, newest first",
  "  SELECT id, role, title, status, iteration FROM olympus_tasks WHERE project_id = '<projectId>' ORDER BY created_at DESC",
  "  -- see what a specific task produced (result + errors)",
  "  SELECT title, status, result, error_log, blocked_reason FROM olympus_tasks WHERE id = '<taskId>'",
  "  -- find tasks that failed or have errors",
  "  SELECT id, role, title, status, error_log FROM olympus_tasks WHERE project_id = '<projectId>' AND (status = 'failed' OR error_log != '[]'::jsonb)",
  "  -- see review history for a task chain",
  "  SELECT id, role, title, status, result FROM olympus_tasks WHERE project_id = '<projectId>' AND role = 'reviewer' ORDER BY created_at",
  "",
  "ALWAYS scope to `project_id = '<YOUR_PROJECT_ID>'` (pinned in your RUNTIME CONTEXT block).",
  "Only SELECT is allowed. Results capped to 200 rows.",
].join("\n");

const FORBIDDEN_STATEMENT = /;\s*\S/i;

export function buildDatabaseQueryTool(ctx: ToolCtx) {
  return createTool({
    id: "database_query",
    description: DESCRIPTION,
    inputSchema: z.object({
      sql: z
        .string()
        .min(7)
        .describe("A single SELECT statement. No trailing semicolons needed."),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      rows: z.array(z.record(z.unknown())).optional(),
      rowCount: z.number().optional(),
      truncated: z.boolean().optional(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      const sql = input.sql.trim().replace(/;+\s*$/, "");
      emitToolLog(ctx, {
        kind: "db",
        action: "query",
        summary: sql.slice(0, 140),
      });
      if (!/^select\s/i.test(sql) && !/^with\s/i.test(sql)) {
        return { ok: false, error: "only SELECT / WITH queries are permitted" };
      }
      if (FORBIDDEN_STATEMENT.test(sql)) {
        return {
          ok: false,
          error:
            "multi-statement queries are blocked — send one SELECT at a time",
        };
      }
      const started = Date.now();
      try {
        const result = await pool.query(sql);
        const capped = result.rows.slice(0, 200);
        emitToolLog(ctx, {
          kind: "db",
          action: "query.done",
          ok: true,
          ms: Date.now() - started,
          summary: `${capped.length}${result.rows.length > capped.length ? `/${result.rows.length}` : ""} row(s)`,
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
          kind: "db",
          action: "query.error",
          ok: false,
          ms: Date.now() - started,
          summary: error,
        });
        return { ok: false, error };
      }
    },
  });
}
