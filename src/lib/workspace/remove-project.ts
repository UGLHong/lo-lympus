import { clearProjectEventBuffer } from '@/lib/events/bus';
import { clearBacklog } from '@/lib/pipeline/backlog';
import { clearPipelineProjectBusy } from '@/lib/pipeline/in-flight-projects';
import { stopSoftwareHouse } from '@/lib/pipeline/software-house';
import { deleteProjectWorkspace, readState } from '@/lib/workspace/fs';
import { closeProjectFsWatch } from '@/lib/workspace/project-fs-watch';
import { stopRuntime } from '@/lib/workspace/runtime';

function isSafeProjectId(projectId: string): boolean {
  if (!projectId || projectId.length > 200) return false;
  if (projectId.includes('..') || projectId.includes('/') || projectId.includes('\\')) return false;
  return true;
}

export async function removeProject(projectId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSafeProjectId(projectId)) {
    return { ok: false, error: 'Invalid project id' };
  }

  try {
    await readState(projectId);
  } catch {
    return { ok: false, error: 'Project not found' };
  }

  await stopRuntime(projectId);
  await stopSoftwareHouse(projectId);
  clearPipelineProjectBusy(projectId);
  clearBacklog(projectId);
  closeProjectFsWatch(projectId);
  clearProjectEventBuffer(projectId);
  await deleteProjectWorkspace(projectId);

  return { ok: true };
}
