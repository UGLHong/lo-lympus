import { type ChildProcess, spawn } from 'node:child_process';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { emit } from '../../app/lib/event-bus.server';
import { emitToolLog } from '../lib/tool-log';
import { projectWorkspace } from '../workspace/paths';

interface ToolCtx {
  projectId: string;
  projectSlug: string;
  role: string;
  taskId?: string;
}

const globalForRuntime = globalThis as unknown as {
  __olympusRuntimeProcesses?: Map<string, ChildProcess>;
};

const processes = (globalForRuntime.__olympusRuntimeProcesses ??= new Map());

export function buildRuntimeTool(ctx: ToolCtx) {
  return createTool({
    id: 'runtime',
    description:
      'Control the running generated product. "start" spawns a long-running dev server; "stop" kills it; "status" returns the current state. Logs are streamed to the Terminal pane.',
    inputSchema: z.object({
      action: z.enum(['start', 'stop', 'status']),
      command: z.string().optional().describe('Shell command for start. Defaults to "pnpm dev".'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      status: z.string(),
      pid: z.number().optional(),
      port: z.number().optional(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      const key = ctx.projectSlug;

      if (input.action === 'status') {
        const existing = processes.get(key);
        return {
          ok: true,
          status: existing && !existing.killed ? 'running' : 'stopped',
          pid: existing?.pid,
        };
      }

      if (input.action === 'stop') {
        emitToolLog(ctx, { kind: 'runtime', action: 'stop' });
        const existing = processes.get(key);
        if (existing && !existing.killed) existing.kill('SIGTERM');
        processes.delete(key);
        emit({
          projectId: ctx.projectId,
          role: ctx.role,
          taskId: ctx.taskId,
          type: 'log',
          payload: { stream: 'stdout', line: '[runtime] stopped' },
        });
        return { ok: true, status: 'stopped' };
      }

      if (processes.has(key)) {
        emitToolLog(ctx, { kind: 'runtime', action: 'start.already-running' });
        return { ok: true, status: 'already-running' };
      }

      const cwd = projectWorkspace(ctx.projectSlug);
      const cmd = input.command ?? 'pnpm dev';
      emitToolLog(ctx, { kind: 'runtime', action: 'start', summary: cmd });
      const child = spawn(cmd, { cwd, shell: true, env: process.env });
      processes.set(key, child);

      let detectedPort: number | undefined;
      const portRegex = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/;

      child.stdout?.on('data', (chunk: Buffer) => {
        const line = chunk.toString();
        emit({
          projectId: ctx.projectId,
          role: ctx.role,
          taskId: ctx.taskId,
          type: 'log',
          payload: { stream: 'stdout', line },
        });
        const match = line.match(portRegex);
        if (match && !detectedPort) {
          detectedPort = Number(match[1]);
          emitToolLog(ctx, {
            kind: 'runtime',
            action: 'port-ready',
            summary: `http://localhost:${detectedPort}`,
          });
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        emit({
          projectId: ctx.projectId,
          role: ctx.role,
          taskId: ctx.taskId,
          type: 'log',
          payload: { stream: 'stderr', line: chunk.toString() },
        });
      });
      child.on('exit', (code) => {
        processes.delete(key);
        emit({
          projectId: ctx.projectId,
          role: ctx.role,
          taskId: ctx.taskId,
          type: 'log',
          payload: { stream: 'stdout', line: `[runtime] exited ${code}` },
        });
      });

      await new Promise((resolve) => setTimeout(resolve, 4000));

      return {
        ok: true,
        status: detectedPort ? 'port-ready' : 'starting',
        pid: child.pid,
        port: detectedPort,
      };
    },
  });
}
