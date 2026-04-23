import { sql } from "drizzle-orm";

import { db } from "../db/client";

import type { Task } from "../db/schema";
import type { Role } from "../const/roles";

interface RawTaskRow {
  id: string;
  project_id: string;
  role: string;
  title: string;
  description: string;
  status: Task["status"];
  depends_on: string[];
  thread_id: string | null;
  claimed_by: string | null;
  claimed_at: Date | null;
  result: Record<string, unknown> | null;
  blocked_reason: string | null;
  parent_task_id: string | null;
  iteration: number;
  max_iterations_override: number | null;
  user_notes: string | null;
  error_log: Array<{
    ts: string;
    phase: string;
    message: string;
    stack?: string;
  }> | null;
  model_tier: string | null;
  model_name: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: RawTaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    role: row.role,
    title: row.title,
    description: row.description,
    status: row.status,
    dependsOn: row.depends_on ?? [],
    threadId: row.thread_id,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    result: row.result,
    blockedReason: row.blocked_reason,
    parentTaskId: row.parent_task_id,
    iteration: row.iteration ?? 0,
    maxIterationsOverride: row.max_iterations_override,
    userNotes: row.user_notes,
    errorLog: row.error_log ?? [],
    modelTier: row.model_tier,
    modelName: row.model_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function claimNextTask(role: Role): Promise<Task | null> {
  // Use Drizzle transaction to properly handle connection pooling and avoid pg deprecation warning.
  // Instead of calling pool.query() directly, we defer to Drizzle's transaction context, which
  // ensures each concurrent role loop gets its own connection from the pool and serializes
  // the claim operation atomically.
  return db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      UPDATE olympus_tasks
      SET status = ${"in-progress"},
          claimed_by = ${role},
          claimed_at = NOW(),
          updated_at = NOW()
      WHERE id = (
        SELECT t.id
        FROM olympus_tasks t
        WHERE t.role = ${role}
          AND t.status = ${"todo"}
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(t.depends_on) d
            JOIN olympus_tasks dep ON dep.id::text = d
            WHERE dep.status NOT IN (${"done"}, ${"skipped"})
          )
        ORDER BY t.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *;
    `);

    if (!result.rows || result.rows.length === 0) {
      return null;
    }

    return mapRow(result.rows[0] as unknown as RawTaskRow);
  });
}
