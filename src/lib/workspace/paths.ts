import path from 'node:path';

export function workspacesRoot(): string {
  const raw = process.env.OLYMPUS_WORKSPACES_DIR ?? './workspaces';
  return path.resolve(process.cwd(), raw);
}

export function projectDir(projectId: string): string {
  return path.join(workspacesRoot(), projectId);
}

export function softwareHouseDir(projectId: string): string {
  return path.join(projectDir(projectId), '.software-house');
}

export function statePath(projectId: string): string {
  return path.join(softwareHouseDir(projectId), 'state.json');
}

export function metaPath(projectId: string): string {
  return path.join(softwareHouseDir(projectId), 'meta.json');
}

export function messagesPath(projectId: string): string {
  return path.join(softwareHouseDir(projectId), 'messages.ndjson');
}

export function eventsPath(projectId: string): string {
  return path.join(softwareHouseDir(projectId), 'events.ndjson');
}

export function artifactPath(projectId: string, relative: string): string {
  return path.join(softwareHouseDir(projectId), relative);
}

export function sourcePath(projectId: string, relative: string): string {
  return path.join(projectDir(projectId), relative);
}
