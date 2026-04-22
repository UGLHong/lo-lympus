import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { getProjectById } from '../../server/db/queries';
import { projectWorkspace, resolveInsideProject } from '../../server/workspace/paths';

import type { Route } from './+types/api.workspace';

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  mdx: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'plaintext',
  sql: 'sql',
  xml: 'xml',
  svg: 'xml',
  env: 'plaintext',
  txt: 'plaintext',
};

// hide only machinery directories. agent artifacts live under `.software-house/`
// and must remain visible, so we do NOT filter dotfiles wholesale.
const HIDDEN_ENTRY_NAMES = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.vite',
  'dist',
  'build',
  '.output',
  '.DS_Store',
]);

function languageForPath(path: string): string {
  const basename = path.split('/').pop() ?? path;
  if (basename === 'Dockerfile') return 'dockerfile';
  if (basename === 'Makefile') return 'makefile';
  if (basename.startsWith('.env')) return 'plaintext';
  const ext = basename.includes('.') ? basename.split('.').pop()!.toLowerCase() : '';
  return LANG_BY_EXT[ext] ?? 'plaintext';
}

function extractRelativePath(url: URL, params: Record<string, string | undefined>): string {
  const explicit = url.searchParams.get('path');
  if (explicit !== null) return explicit;
  const splat = params['*'];
  return typeof splat === 'string' ? splat : '';
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  const relative = extractRelativePath(url, params as Record<string, string | undefined>);
  const mode = url.searchParams.get('mode') ?? 'list';

  if (!projectId) return Response.json({ error: 'projectId required' }, { status: 400 });

  const project = await getProjectById(projectId);
  if (!project) return Response.json({ error: 'project not found' }, { status: 404 });

  if (mode === 'read') {
    try {
      const full = resolveInsideProject(project.slug, relative);
      const info = await stat(full);
      if (info.isDirectory()) {
        return Response.json({ error: 'path is a directory' }, { status: 400 });
      }
      const contents = await readFile(full, 'utf8');
      return Response.json({
        path: relative,
        contents,
        language: languageForPath(relative),
        bytes: info.size,
        modifiedAt: info.mtimeMs,
      });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'read failed' },
        { status: 404 },
      );
    }
  }

  if (mode === 'tree') {
    try {
      const root = projectWorkspace(project.slug);
      const maxDepth = Number(url.searchParams.get('depth') ?? '6');
      const tree = await collectTree(root, '', maxDepth);
      return Response.json({ tree });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'tree failed' },
        { status: 500 },
      );
    }
  }

  try {
    const base = relative
      ? resolveInsideProject(project.slug, relative)
      : projectWorkspace(project.slug);
    const entries = await readdir(base, { withFileTypes: true });
    const rows = await Promise.all(
      entries
        .filter((entry) => !HIDDEN_ENTRY_NAMES.has(entry.name))
        .map(async (entry) => {
          const full = join(base, entry.name);
          const info = await stat(full).catch(() => null);
          return {
            name: entry.name,
            kind: entry.isDirectory() ? ('dir' as const) : ('file' as const),
            path: relative ? `${relative}/${entry.name}` : entry.name,
            size: info?.size ?? 0,
            modifiedAt: info?.mtimeMs ?? 0,
          };
        }),
    );
    rows.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return Response.json({ entries: rows });
  } catch {
    return Response.json({ entries: [] });
  }
}

interface TreeNode {
  name: string;
  kind: 'file' | 'dir';
  path: string;
  size: number;
  modifiedAt: number;
  children?: TreeNode[];
}

async function collectTree(
  root: string,
  relative: string,
  remainingDepth: number,
): Promise<TreeNode[]> {
  if (remainingDepth < 0) return [];
  const base = relative ? join(root, relative) : root;
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    if (HIDDEN_ENTRY_NAMES.has(entry.name)) continue;
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const full = join(base, entry.name);
    const info = await stat(full).catch(() => null);
    if (!info) continue;
    const node: TreeNode = {
      name: entry.name,
      kind: entry.isDirectory() ? 'dir' : 'file',
      path: childRelative,
      size: info.size,
      modifiedAt: info.mtimeMs,
    };
    if (entry.isDirectory()) {
      node.children = await collectTree(root, childRelative, remainingDepth - 1);
    }
    nodes.push(node);
  }
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}
