import {
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import { createTool } from "@mastra/core/tools";
import fg from "fast-glob";
import { z } from "zod";

import { emit } from "../../app/lib/event-bus.server";
import { emitToolLog } from "../lib/tool-log";
import { projectWorkspace, resolveInsideProject } from "../workspace/paths";

interface ToolCtx {
  projectId: string;
  projectSlug: string;
  role: string;
  taskId?: string;
}

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  md: "markdown",
  html: "html",
  css: "css",
  scss: "css",
  py: "python",
  go: "go",
  rs: "rust",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  sh: "shell",
};

function inferLanguage(path: string): string {
  const basename = path.split("/").pop() ?? path;
  if (basename === "Dockerfile") return "dockerfile";
  const ext = basename.includes(".")
    ? basename.split(".").pop()!.toLowerCase()
    : "";
  return LANG_BY_EXT[ext] ?? "plaintext";
}

function isEnoent(err: unknown): boolean {
  return (
    Boolean(err) &&
    typeof err === "object" &&
    (err as { code?: string }).code === "ENOENT"
  );
}

const DESCRIPTION = [
  "Read, write, list, glob, or delete files inside the project workspace.",
  'All paths are RELATIVE to the workspace root (never absolute, never contain "..").',
  "",
  "Actions:",
  "- `list` — list a directory. Returns entries with name, kind (file/dir), size in bytes, and lineCount (for files under 100 KB). Returns `{ exists: false }` when the directory is missing. Use this after writing files to verify they landed correctly.",
  "- `read` — read a file. Returns `{ exists: false }` when the file is missing. For large files (>50 KB) consider using `glob` first to confirm the file exists, then read it.",
  "- `write` — create/overwrite a file with the FULL final contents. Parent directories are auto-created. Prefer `stream_code` for code files so humans can Follow-Mode watch the diff; use `write` for one-shot writes of config/json/tiny files.",
  "- `glob` — find files matching a glob pattern (e.g. `src/**/*.tsx`, `**/*.env*`). Returns up to 200 matching paths. Much faster than recursively listing directories. Use to discover what files exist before reading them.",
  "- `delete` — remove a file. Use when renaming (delete old + write new) or cleaning obsolete files flagged by a reviewer. Silently succeeds if the file is already gone.",
].join("\n");

export function buildFileSystemTool(ctx: ToolCtx) {
  return createTool({
    id: "file_system",
    description: DESCRIPTION,
    inputSchema: z.object({
      action: z.enum(["read", "write", "list", "glob", "delete"]),
      path: z
        .string()
        .describe(
          'Path or glob pattern relative to the workspace root. Use "" (empty string) to target the workspace root itself for `list`.',
        ),
      contents: z
        .string()
        .optional()
        .describe("Required for `write` only. Full final file contents."),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      exists: z.boolean().optional(),
      data: z.unknown().optional(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      const started = Date.now();
      try {
        if (input.action === "read")
          return await handleRead(ctx, input.path, started);
        if (input.action === "write")
          return await handleWrite(ctx, input.path, input.contents, started);
        if (input.action === "list")
          return await handleList(ctx, input.path, started);
        if (input.action === "glob")
          return await handleGlob(ctx, input.path, started);
        return await handleDelete(ctx, input.path, started);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        emitToolLog(ctx, {
          kind: "fs",
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

async function handleRead(ctx: ToolCtx, path: string, started: number) {
  emitToolLog(ctx, { kind: "fs", action: "read", path });
  const full = resolveInsideProject(ctx.projectSlug, path);
  try {
    const body = await readFile(full, "utf8");
    emitToolLog(ctx, {
      kind: "fs",
      action: "read.done",
      path,
      ok: true,
      ms: Date.now() - started,
      summary: `${body.length} chars`,
    });
    return { ok: true, exists: true, data: body };
  } catch (err) {
    if (isEnoent(err)) {
      emitToolLog(ctx, {
        kind: "fs",
        action: "read.missing",
        path,
        ok: true,
        ms: Date.now() - started,
        summary: "file does not exist",
      });
      return { ok: true, exists: false, data: null };
    }
    throw err;
  }
}

async function handleWrite(
  ctx: ToolCtx,
  path: string,
  contents: string | undefined,
  started: number,
) {
  if (typeof contents !== "string") {
    return { ok: false, error: "contents required for write" };
  }
  emitToolLog(ctx, {
    kind: "fs",
    action: "write",
    path,
    summary: `${contents.length} chars`,
  });
  const full = resolveInsideProject(ctx.projectSlug, path);
  await mkdir(dirname(full), { recursive: true });

  emit({
    projectId: ctx.projectId,
    role: ctx.role,
    taskId: ctx.taskId,
    type: "code-chunk",
    payload: {
      path,
      phase: "start",
      language: inferLanguage(path),
    },
  });
  emit({
    projectId: ctx.projectId,
    role: ctx.role,
    taskId: ctx.taskId,
    type: "code-chunk",
    payload: { path, phase: "chunk", chunk: contents },
  });
  emit({
    projectId: ctx.projectId,
    role: ctx.role,
    taskId: ctx.taskId,
    type: "code-chunk",
    payload: { path, phase: "end", bytes: contents.length },
  });

  await writeFile(full, contents, "utf8");
  emit({
    projectId: ctx.projectId,
    role: ctx.role,
    taskId: ctx.taskId,
    type: "workspace-change",
    payload: { path, bytes: contents.length },
  });
  emitToolLog(ctx, {
    kind: "fs",
    action: "write.done",
    path,
    ok: true,
    ms: Date.now() - started,
  });
  return { ok: true, exists: true, data: { bytes: contents.length } };
}

async function handleList(ctx: ToolCtx, path: string, started: number) {
  emitToolLog(ctx, { kind: "fs", action: "list", path });
  const base =
    path === ""
      ? projectWorkspace(ctx.projectSlug)
      : resolveInsideProject(ctx.projectSlug, path);
  try {
    const entries = await readdir(base, { withFileTypes: true });
    const listed = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = `${base}/${entry.name}`;
        const info = await stat(entryPath);
        const isFile = !entry.isDirectory();
        let lineCount: number | undefined;
        if (isFile && info.size > 0 && info.size < 100_000) {
          try {
            const content = await readFile(entryPath, "utf8");
            lineCount = content.split("\n").length;
          } catch {
            // non-fatal
          }
        }
        return {
          name: entry.name,
          kind: entry.isDirectory() ? ("dir" as const) : ("file" as const),
          size: info.size,
          ...(lineCount !== undefined ? { lineCount } : {}),
        };
      }),
    );
    emitToolLog(ctx, {
      kind: "fs",
      action: "list.done",
      path,
      ok: true,
      ms: Date.now() - started,
      summary: `${listed.length} entries`,
    });
    return { ok: true, exists: true, data: listed };
  } catch (err) {
    if (isEnoent(err)) {
      emitToolLog(ctx, {
        kind: "fs",
        action: "list.missing",
        path,
        ok: true,
        ms: Date.now() - started,
        summary: "directory does not exist",
      });
      return { ok: true, exists: false, data: [] };
    }
    throw err;
  }
}

async function handleGlob(ctx: ToolCtx, pattern: string, started: number) {
  emitToolLog(ctx, { kind: "fs", action: "glob", path: pattern });
  const root = projectWorkspace(ctx.projectSlug);
  const matches = await fg(pattern, {
    cwd: root,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: ["node_modules/**", "dist/**", ".git/**", "**/.DS_Store"],
  });
  const capped = matches.slice(0, 200);
  emitToolLog(ctx, {
    kind: "fs",
    action: "glob.done",
    path: pattern,
    ok: true,
    ms: Date.now() - started,
    summary: `${capped.length}${matches.length > capped.length ? `/${matches.length}` : ""} match(es)`,
  });
  return {
    ok: true,
    exists: capped.length > 0,
    data: {
      pattern,
      matches: capped,
      truncated: matches.length > capped.length ? matches.length : 0,
    },
  };
}

async function handleDelete(ctx: ToolCtx, path: string, started: number) {
  emitToolLog(ctx, { kind: "fs", action: "delete", path });
  const full = resolveInsideProject(ctx.projectSlug, path);
  try {
    await unlink(full);
    emit({
      projectId: ctx.projectId,
      role: ctx.role,
      taskId: ctx.taskId,
      type: "workspace-change",
      payload: { path, bytes: 0, deleted: true },
    });
    emitToolLog(ctx, {
      kind: "fs",
      action: "delete.done",
      path,
      ok: true,
      ms: Date.now() - started,
    });
    return { ok: true, exists: false, data: { deleted: true } };
  } catch (err) {
    if (isEnoent(err)) {
      emitToolLog(ctx, {
        kind: "fs",
        action: "delete.missing",
        path,
        ok: true,
        ms: Date.now() - started,
        summary: "already gone",
      });
      return {
        ok: true,
        exists: false,
        data: { deleted: false, reason: "already-absent" },
      };
    }
    throw err;
  }
}
