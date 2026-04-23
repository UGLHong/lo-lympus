import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { emit } from "../../app/lib/event-bus.server";
import { emitToolLog } from "../lib/tool-log";
import {
  getRecentLogs,
  getRuntimeStatus,
  hasRuntime,
  startRuntime,
  stopRuntimeAsync,
} from "../lib/runtime-process";

interface ToolCtx {
  projectId: string;
  projectSlug: string;
  role: string;
  taskId?: string;
}

export function buildRuntimeTool(ctx: ToolCtx) {
  return createTool({
    id: "runtime",
    description: [
      "Control the generated project's long-running dev server.",
      "",
      "Actions:",
      "- `status` — peek at the current runtime (returns status/pid/port). Safe, read-only.",
      "- `start`  — spawn a dev server if none is running. No-op when one is already up with the same command.",
      "- `restart` — force-stop any existing process (including orphaned children) then start fresh. Use after fixing env vars, installing deps, or changing the run command.",
      "- `stop`   — terminate the running server.",
      "- `logs`   — return the last N lines of stdout+stderr from the running process (default 100). Use after a failed boot to diagnose the error without waiting for live SSE.",
      "",
      "Logs are streamed live to the Terminal pane. `command` defaults to `pnpm dev` — override with the command the project actually uses (e.g. `npm run dev`, `docker compose up`, `python manage.py runserver`). Working directory is the project workspace root.",
    ].join("\n"),
    inputSchema: z.object({
      action: z.enum(["start", "stop", "status", "restart", "logs"]),
      command: z
        .string()
        .optional()
        .describe(
          'Shell command for start/restart (run from workspace root). Defaults to "pnpm dev".',
        ),
      lines: z
        .number()
        .optional()
        .describe(
          "For `logs`: number of recent stdout+stderr lines to return (default 100, max 500).",
        ),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      status: z.string(),
      pid: z.number().optional(),
      port: z.number().optional(),
      data: z.unknown().optional(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      if (input.action === "logs") {
        const n = Math.min(input.lines ?? 100, 500);
        const recent = getRecentLogs(ctx.projectSlug, n);
        return { ok: true, status: "ok", data: recent };
      }

      if (input.action === "status") {
        const snapshot = getRuntimeStatus(ctx.projectSlug);
        return {
          ok: true,
          status: snapshot.status,
          pid: snapshot.pid,
          port: snapshot.port,
        };
      }

      if (input.action === "stop") {
        emitToolLog(ctx, { kind: "runtime", action: "stop" });
        await stopRuntimeAsync(ctx.projectSlug, { timeoutMs: 5000 });
        emit({
          projectId: ctx.projectId,
          role: ctx.role,
          taskId: ctx.taskId,
          type: "log",
          payload: { stream: "stdout", line: "[runtime] stopped" },
        });
        return { ok: true, status: "stopped" };
      }

      const command = input.command ?? "pnpm dev";

      if (input.action === "restart" && hasRuntime(ctx.projectSlug)) {
        emitToolLog(ctx, { kind: "runtime", action: "restart.stopping" });
        const stopResult = await stopRuntimeAsync(ctx.projectSlug, {
          timeoutMs: 5000,
        });
        if (stopResult.escalatedToKill) {
          emit({
            projectId: ctx.projectId,
            role: ctx.role,
            taskId: ctx.taskId,
            type: "log",
            payload: {
              stream: "stdout",
              line: "[runtime] previous process ignored SIGTERM — sent SIGKILL",
            },
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      emitToolLog(ctx, {
        kind: "runtime",
        action: input.action === "restart" ? "restart" : "start",
        summary: command,
      });

      const result = await startRuntime({
        projectId: ctx.projectId,
        projectSlug: ctx.projectSlug,
        role: ctx.role,
        taskId: ctx.taskId,
        command,
      });

      if (result.status === "already-running") {
        emitToolLog(ctx, { kind: "runtime", action: "start.already-running" });
      }
      if (result.port) {
        emitToolLog(ctx, {
          kind: "runtime",
          action: "port-ready",
          summary: `http://localhost:${result.port}`,
        });
      }

      return {
        ok: true,
        status: result.status,
        pid: result.pid,
        port: result.port,
      };
    },
  });
}
