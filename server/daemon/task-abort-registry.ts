// per-task AbortController registry — allows api.chat to interrupt a running agent stream
const registry = new Map<string, AbortController>();

export function registerTaskAbort(taskId: string, controller: AbortController): void {
  registry.set(taskId, controller);
}

export function abortRunningTask(taskId: string): boolean {
  const controller = registry.get(taskId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function deregisterTaskAbort(taskId: string): void {
  registry.delete(taskId);
}
