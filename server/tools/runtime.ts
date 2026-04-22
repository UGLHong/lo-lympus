import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { emit } from '../../app/lib/event-bus.server';
import { emitToolLog } from '../lib/tool-log';
import {
  getRuntimeStatus,
  hasRuntime,
  startRuntime,
  stopRuntimeAsync,
} from '../lib/runtime-process';

interface ToolCtx {
  projectId: string;
  projectSlug: string;
  role: string;
  taskId?: string;
}

export function buildRuntimeTool(ctx: ToolCtx) {
  return createTool({
    id: 'runtime',
    description: [
      'Control the running generated product.',
      '"start" spawns a long-running dev server (skips if one is already up and matches).',
      '"restart" force-stops any existing dev server (including orphan child processes) then starts a fresh one — use this after fixing env vars or swapping the run command.',
      '"stop" kills it.',
      '"status" returns the current state.',
      'Logs are streamed to the Terminal pane.',
    ].join(' '),
    inputSchema: z.object({
      action: z.enum(['start', 'stop', 'status', 'restart']),
      command: z.string().optional().describe('Shell command for start/restart. Defaults to "pnpm dev".'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      status: z.string(),
      pid: z.number().optional(),
      port: z.number().optional(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      if (input.action === 'status') {
        const snapshot = getRuntimeStatus(ctx.projectSlug);
        return {
          ok: true,
          status: snapshot.status,
          pid: snapshot.pid,
          port: snapshot.port,
        };
      }

      if (input.action === 'stop') {
        emitToolLog(ctx, { kind: 'runtime', action: 'stop' });
        await stopRuntimeAsync(ctx.projectSlug, { timeoutMs: 5000 });
        emit({
          projectId: ctx.projectId,
          role: ctx.role,
          taskId: ctx.taskId,
          type: 'log',
          payload: { stream: 'stdout', line: '[runtime] stopped' },
        });
        return { ok: true, status: 'stopped' };
      }

      const command = input.command ?? 'pnpm dev';

      if (input.action === 'restart' && hasRuntime(ctx.projectSlug)) {
        emitToolLog(ctx, { kind: 'runtime', action: 'restart.stopping' });
        const stopResult = await stopRuntimeAsync(ctx.projectSlug, { timeoutMs: 5000 });
        if (stopResult.escalatedToKill) {
          emit({
            projectId: ctx.projectId,
            role: ctx.role,
            taskId: ctx.taskId,
            type: 'log',
            payload: {
              stream: 'stdout',
              line: '[runtime] previous process ignored SIGTERM — sent SIGKILL',
            },
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      emitToolLog(ctx, {
        kind: 'runtime',
        action: input.action === 'restart' ? 'restart' : 'start',
        summary: command,
      });

      const result = await startRuntime({
        projectId: ctx.projectId,
        projectSlug: ctx.projectSlug,
        role: ctx.role,
        taskId: ctx.taskId,
        command,
      });

      if (result.status === 'already-running') {
        emitToolLog(ctx, { kind: 'runtime', action: 'start.already-running' });
      }
      if (result.port) {
        emitToolLog(ctx, {
          kind: 'runtime',
          action: 'port-ready',
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
