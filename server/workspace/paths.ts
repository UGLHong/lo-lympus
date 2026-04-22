import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd(), process.env.OLYMPUS_WORKSPACES_DIR ?? 'workspaces');

export function ensureWorkspacesRoot(): string {
  if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
  return ROOT;
}

export function projectWorkspace(slug: string): string {
  ensureWorkspacesRoot();
  const dir = resolve(ROOT, slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveInsideProject(slug: string, relative: string): string {
  const base = projectWorkspace(slug);
  const full = resolve(base, relative);
  if (!full.startsWith(base + '/') && full !== base) {
    throw new Error(`path traversal blocked: ${relative}`);
  }
  return full;
}
