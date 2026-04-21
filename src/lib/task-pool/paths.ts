import path from 'node:path';
import { softwareHouseDir } from '@/lib/workspace/paths';

export function taskPoolDir(projectId: string): string {
  return path.join(softwareHouseDir(projectId), 'tasks');
}

export function taskPoolIndexPath(projectId: string): string {
  return path.join(taskPoolDir(projectId), 'index.ndjson');
}

export function taskPoolSnapshotPath(projectId: string): string {
  return path.join(taskPoolDir(projectId), '_open.json');
}

export function taskDir(projectId: string, taskSlug: string): string {
  return path.join(taskPoolDir(projectId), taskSlug);
}

export function taskJsonPath(projectId: string, taskSlug: string): string {
  return path.join(taskDir(projectId, taskSlug), 'task.json');
}

export function taskContentPath(
  projectId: string,
  taskSlug: string,
  filename: string,
): string {
  return path.join(taskDir(projectId, taskSlug), filename);
}
