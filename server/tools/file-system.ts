import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { emit } from '../../app/lib/event-bus.server';
import { emitToolLog } from '../lib/tool-log';
import { projectWorkspace, resolveInsideProject } from '../workspace/paths';

interface ToolCtx {
  projectId: string;
  projectSlug: string;
  role: string;
  taskId?: string;
}

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  html: 'html',
  css: 'css',
  scss: 'css',
  py: 'python',
  go: 'go',
  rs: 'rust',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  sh: 'shell',
};

function inferLanguage(path: string): string {
  const basename = path.split('/').pop() ?? path;
  if (basename === 'Dockerfile') return 'dockerfile';
  const ext = basename.includes('.') ? basename.split('.').pop()!.toLowerCase() : '';
  return LANG_BY_EXT[ext] ?? 'plaintext';
}

export function buildFileSystemTool(ctx: ToolCtx) {
  return createTool({
    id: 'file_system',
    description:
      'Read, write, and list files inside the project workspace. All paths are relative to the workspace root.',
    inputSchema: z.object({
      action: z.enum(['read', 'write', 'list']),
      path: z.string().describe('Path relative to the project workspace root.'),
      contents: z.string().optional().describe('Required for write action.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      data: z.unknown().optional(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      const started = Date.now();
      try {
        if (input.action === 'read') {
          emitToolLog(ctx, { kind: 'fs', action: 'read', path: input.path });
          const full = resolveInsideProject(ctx.projectSlug, input.path);
          const body = await readFile(full, 'utf8');
          emitToolLog(ctx, {
            kind: 'fs',
            action: 'read.done',
            path: input.path,
            ok: true,
            ms: Date.now() - started,
            summary: `${body.length} chars`,
          });
          return { ok: true, data: body };
        }
        if (input.action === 'write') {
          if (typeof input.contents !== 'string') {
            return { ok: false, error: 'contents required for write' };
          }
          emitToolLog(ctx, {
            kind: 'fs',
            action: 'write',
            path: input.path,
            summary: `${input.contents.length} chars`,
          });
          const full = resolveInsideProject(ctx.projectSlug, input.path);
          await mkdir(dirname(full), { recursive: true });

          emit({
            projectId: ctx.projectId,
            role: ctx.role,
            taskId: ctx.taskId,
            type: 'code-chunk',
            payload: {
              path: input.path,
              phase: 'start',
              language: inferLanguage(input.path),
            },
          });
          emit({
            projectId: ctx.projectId,
            role: ctx.role,
            taskId: ctx.taskId,
            type: 'code-chunk',
            payload: { path: input.path, phase: 'chunk', chunk: input.contents },
          });
          emit({
            projectId: ctx.projectId,
            role: ctx.role,
            taskId: ctx.taskId,
            type: 'code-chunk',
            payload: { path: input.path, phase: 'end', bytes: input.contents.length },
          });

          await writeFile(full, input.contents, 'utf8');
          emit({
            projectId: ctx.projectId,
            role: ctx.role,
            taskId: ctx.taskId,
            type: 'workspace-change',
            payload: { path: input.path, bytes: input.contents.length },
          });
          emitToolLog(ctx, {
            kind: 'fs',
            action: 'write.done',
            path: input.path,
            ok: true,
            ms: Date.now() - started,
          });
          return { ok: true, data: { bytes: input.contents.length } };
        }
        emitToolLog(ctx, { kind: 'fs', action: 'list', path: input.path });
        const base = input.path === '' ? projectWorkspace(ctx.projectSlug) : resolveInsideProject(ctx.projectSlug, input.path);
        const entries = await readdir(base, { withFileTypes: true });
        const listed = await Promise.all(
          entries.map(async (entry) => {
            const entryPath = `${base}/${entry.name}`;
            const info = await stat(entryPath);
            return {
              name: entry.name,
              kind: entry.isDirectory() ? ('dir' as const) : ('file' as const),
              size: info.size,
            };
          }),
        );
        emitToolLog(ctx, {
          kind: 'fs',
          action: 'list.done',
          path: input.path,
          ok: true,
          ms: Date.now() - started,
          summary: `${listed.length} entries`,
        });
        return { ok: true, data: listed };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        emitToolLog(ctx, {
          kind: 'fs',
          action: `${input.action}.error`,
          path: input.path,
          ok: false,
          ms: Date.now() - started,
          summary: error,
        });
        return { ok: false, error };
      }
    },
  });
}
