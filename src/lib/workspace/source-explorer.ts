import fs from 'node:fs/promises';
import path from 'node:path';
import { projectDir, sourcePath } from './paths';

export type SourceTreeEntry = {
  name: string;
  relativePath: string;
  isDir: boolean;
  children?: SourceTreeEntry[];
};

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.turbo',
  'coverage',
  '.cache',
  'out',
  '.vercel',
  '__pycache__',
  '.pnpm-store',
]);

const SKIP_FILES = new Set(['.DS_Store']);

const BINARY_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'pdf',
  'zip',
  'gz',
  'tar',
  'mp4',
  'mp3',
  'wasm',
  'dll',
  'so',
  'dylib',
  'exe',
]);

function isSkippableDirectory(name: string): boolean {
  if (name === '.software-house') return true;
  return SKIP_DIRS.has(name);
}

function isSkippableFile(name: string): boolean {
  if (SKIP_FILES.has(name)) return true;
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : '';
  return BINARY_EXT.has(ext);
}

export async function readProjectSourceTree(projectId: string): Promise<SourceTreeEntry[]> {
  const root = projectDir(projectId);
  return walk(root, '');
}

const MAX_SOURCE_BYTES = 2_000_000;

export async function readProjectSourceFile(
  projectId: string,
  relativePath: string,
): Promise<string | null> {
  const cleaned = relativePath.replace(/^\/+/, '').replace(/\\+/g, '/');
  if (cleaned.includes('..') || cleaned.startsWith('.software-house')) {
    return null;
  }
  const base = path.basename(cleaned);
  if (isSkippableFile(base)) {
    return null;
  }
  const full = sourcePath(projectId, cleaned);
  try {
    const stat = await fs.stat(full);
    if (stat.size > MAX_SOURCE_BYTES) {
      return null;
    }
    return await fs.readFile(full, 'utf8');
  } catch {
    return null;
  }
}

async function walk(absolute: string, relative: string): Promise<SourceTreeEntry[]> {
  let entries;
  try {
    entries = await fs.readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }

  const result: SourceTreeEntry[] = [];
  for (const entry of entries) {
    if (entry.name === '.software-house') continue;

    if (entry.isDirectory()) {
      if (isSkippableDirectory(entry.name)) continue;
      const entryAbs = path.join(absolute, entry.name);
      const entryRel = relative ? `${relative}/${entry.name}` : entry.name;
      const children = await walk(entryAbs, entryRel);
      result.push({ name: entry.name, relativePath: entryRel, isDir: true, children });
      continue;
    }

    if (isSkippableFile(entry.name)) continue;
    const entryRel = relative ? `${relative}/${entry.name}` : entry.name;
    result.push({ name: entry.name, relativePath: entryRel, isDir: false });
  }

  result.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}
