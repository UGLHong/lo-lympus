import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { emit } from '../../app/lib/event-bus.server';
import { emitToolLog } from '../lib/tool-log';
import { resolveInsideProject } from '../workspace/paths';

interface ToolCtx {
  projectId: string;
  projectSlug: string;
  role: string;
  taskId?: string;
}

const DESCRIPTION = [
  'Write a file to the workspace while streaming its content chunk-by-chunk into the editor so humans can watch you work via Follow Mode.',
  '',
  'When to use:',
  '- Creating or fully rewriting source code, markdown docs (REQUIREMENTS/ARCHITECTURE/PLAN), or any file where showing the diff live is valuable.',
  '- Preferred over `file_system.write` for anything a human might want to watch land in the editor.',
  '',
  'Semantics:',
  '- Provide the FULL final contents — this is an overwrite, not a patch.',
  '- Parent directories are auto-created; never pre-check existence, never ask the human to create directories, just call this tool.',
  '- Paths are relative to the workspace root, never absolute, never contain "..".',
].join('\n');

export function buildStreamCodeTool(ctx: ToolCtx) {
  return createTool({
    id: 'stream_code',
    description: DESCRIPTION,
    inputSchema: z.object({
      path: z.string().describe('Target path relative to workspace root.'),
      contents: z.string().describe('Full final file contents (overwrite; not a patch).'),
      language: z
        .string()
        .optional()
        .describe('Monaco language id override (e.g. "typescript"). Auto-detected from the extension otherwise.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      bytes: z.number().optional(),
      created: z.boolean().optional(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      const started = Date.now();
      try {
        const full = resolveInsideProject(ctx.projectSlug, input.path);
        await mkdir(dirname(full), { recursive: true });
        const existed = await access(full).then(() => true).catch(() => false);

        emitToolLog(ctx, {
          kind: 'code',
          action: 'stream.start',
          path: input.path,
          summary: `${existed ? 'overwrite' : 'create'} · ${input.contents.length} chars`,
        });

        emit({
          projectId: ctx.projectId,
          role: ctx.role,
          taskId: ctx.taskId,
          type: 'code-chunk',
          payload: {
            path: input.path,
            language: input.language ?? inferLanguage(input.path),
            phase: 'start',
          },
        });

        const chunks = splitIntoChunks(input.contents, 256);
        for (const chunk of chunks) {
          emit({
            projectId: ctx.projectId,
            role: ctx.role,
            taskId: ctx.taskId,
            type: 'code-chunk',
            payload: {
              path: input.path,
              phase: 'chunk',
              chunk,
            },
          });
          await sleep(15);
        }

        await writeFile(full, input.contents, 'utf8');

        emit({
          projectId: ctx.projectId,
          role: ctx.role,
          taskId: ctx.taskId,
          type: 'code-chunk',
          payload: { path: input.path, phase: 'end', bytes: input.contents.length },
        });
        emit({
          projectId: ctx.projectId,
          role: ctx.role,
          taskId: ctx.taskId,
          type: 'workspace-change',
          payload: { path: input.path, bytes: input.contents.length },
        });

        emitToolLog(ctx, {
          kind: 'code',
          action: 'stream.end',
          path: input.path,
          ok: true,
          ms: Date.now() - started,
          summary: `${input.contents.length} bytes written`,
        });

        return { ok: true, bytes: input.contents.length, created: !existed };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        emitToolLog(ctx, {
          kind: 'code',
          action: 'stream.error',
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

function splitIntoChunks(text: string, size: number): string[] {
  const result: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    result.push(text.slice(i, i + size));
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function inferLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    html: 'html',
    css: 'css',
    py: 'python',
    go: 'go',
    rs: 'rust',
    sql: 'sql',
  };
  return map[ext] ?? 'plaintext';
}
