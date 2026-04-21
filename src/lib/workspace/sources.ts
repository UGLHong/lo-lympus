import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { RoleKey } from '@/lib/const/roles';
import { sourcePath } from './paths';

// per-role write allow-list for the generated product.
// paths are relative to the project workspace root (workspaces/<id>/).
// intentionally permissive for top-level config files so devs can
// bootstrap projects; tightened to src/** for actual code.
const ROLE_SOURCE_PATTERNS: Partial<Record<RoleKey, RegExp[]>> = {
  'backend-dev': [
    /^src\//,
    /^tests?\//,
    /^prisma\//,
    /^drizzle\//,
    /^migrations?\//,
    /^package\.json$/,
    /^pnpm-lock\.yaml$/,
    /^tsconfig(\.[a-z0-9-]+)?\.json$/,
    /^\.env\.example$/,
  ],
  'frontend-dev': [
    /^src\//,
    /^public\//,
    /^styles\//,
    /^app\//,
    /^components\//,
    /^pages\//,
    /^tests?\//,
    /^package\.json$/,
    /^tsconfig(\.[a-z0-9-]+)?\.json$/,
    /^tailwind\.config\.(js|cjs|mjs|ts)$/,
    /^postcss\.config\.(js|cjs|mjs|ts)$/,
    /^next\.config\.(js|cjs|mjs|ts)$/,
  ],
  devops: [
    /^infra\//,
    /^scripts\//,
    /^\.github\//,
    /^docker-compose(\.[a-z0-9-]+)?\.yml$/,
    /^Dockerfile(\.[a-z0-9-]+)?$/,
    /^\.dockerignore$/,
    /^\.gitignore$/,
    /^\.env\.example$/,
    /^package\.json$/,
    /^pnpm-lock\.yaml$/,
    /^src\//,
    /^public\//,
    /^tests?\//,
    /^index\.html$/,
    /^vite\.config\.(js|ts|mjs|cjs)$/,
    /^vitest\.config\.(js|ts|mjs|cjs)$/,
  ],
  writer: [/^README\.md$/, /^docs\//, /^CHANGELOG\.md$/],
};

export function isSourcePathAllowed(role: RoleKey, relativePath: string): boolean {
  const patterns = ROLE_SOURCE_PATTERNS[role];
  if (!patterns || patterns.length === 0) return false;

  const cleaned = relativePath.replace(/^\/+/, '');
  if (cleaned.length === 0) return false;
  if (cleaned.startsWith('.software-house/')) return false;
  if (cleaned.includes('..')) return false;

  return patterns.some((pattern) => pattern.test(cleaned));
}

export async function writeSourceFile(
  projectId: string,
  relativePath: string,
  content: string,
): Promise<{ bytes: number; absolute: string }> {
  const cleaned = relativePath.replace(/^\/+/, '').replace(/\\+/g, '/');
  const absolute = sourcePath(projectId, cleaned);
  await fs.mkdir(path.dirname(absolute), { recursive: true });

  const tmp = `${absolute}.${nanoid(6)}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, absolute);

  return { bytes: Buffer.byteLength(content, 'utf8'), absolute };
}

export function rolesWithSourceAccess(): RoleKey[] {
  return Object.keys(ROLE_SOURCE_PATTERNS) as RoleKey[];
}
