import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

// seed `.software-house/project.json` with the runtime identifiers so agents
// can always rediscover project_id from disk (in addition to the system-prompt
// injection in agent-factory). this lives alongside the planning artifacts
// (REQUIREMENTS.md / ARCHITECTURE.md / PLAN.md) as the canonical metadata file
// for the project workspace.
export interface ProjectMetadata {
  projectId: string;
  slug: string;
  name: string;
  brief: string;
  createdAt?: string;
}

export function writeProjectMetadata(slug: string, meta: ProjectMetadata): void {
  const softwareHouseDir = resolve(projectWorkspace(slug), '.software-house');
  if (!existsSync(softwareHouseDir)) {
    mkdirSync(softwareHouseDir, { recursive: true });
  }
  const file = resolve(softwareHouseDir, 'project.json');
  const payload = {
    project_id: meta.projectId,
    slug: meta.slug,
    name: meta.name,
    brief: meta.brief,
    created_at: meta.createdAt ?? new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}
