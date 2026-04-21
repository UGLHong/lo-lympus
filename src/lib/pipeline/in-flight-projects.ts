const pipelineBusy = new Set<string>();

export function isPipelineProjectBusy(projectId: string): boolean {
  return pipelineBusy.has(projectId);
}

export function markPipelineProjectBusy(projectId: string): void {
  pipelineBusy.add(projectId);
}

export function clearPipelineProjectBusy(projectId: string): void {
  pipelineBusy.delete(projectId);
}
