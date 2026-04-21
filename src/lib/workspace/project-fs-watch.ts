import path from 'node:path';
import chokidar from 'chokidar';
import { emit } from '@/lib/events/bus';
import { getProjectDir } from '@/lib/workspace/fs';

type WatchEntry = {
  refCount: number;
  watcher: chokidar.FSWatcher;
  debounce: ReturnType<typeof setTimeout> | null;
};

const registry = new Map<string, WatchEntry>();

const DEBOUNCE_MS = 150;

const IGNORED: RegExp[] = [
  /(^|[/\\])\.git([/\\]|$)/,
  /(^|[/\\])node_modules([/\\]|$)/,
  /(^|[/\\])\.next([/\\]|$)/,
  /(^|[/\\])dist([/\\]|$)/,
];

export function acquireProjectFsWatch(projectId: string): () => void {
  let entry = registry.get(projectId);
  if (!entry) {
    const root = getProjectDir(projectId);
    const usePolling = process.env.OLYMPUS_FS_POLLING === '1';
    const watcher = chokidar.watch(root, {
      ignored: IGNORED,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
      usePolling,
      interval: usePolling ? 1000 : undefined,
    });
    const bucket: WatchEntry = { refCount: 0, watcher, debounce: null };
    watcher.on('all', (eventName, filePath) => {
      if (eventName !== 'change' && eventName !== 'add' && eventName !== 'unlink') return;
      if (typeof filePath !== 'string') return;
      const rel = path.relative(root, filePath).replace(/\\/g, '/');
      if (!rel || rel.startsWith('..')) return;
      if (bucket.debounce) clearTimeout(bucket.debounce);
      bucket.debounce = setTimeout(() => {
        bucket.debounce = null;
        emit({ projectId, kind: 'workspace.fs.changed', path: rel });
      }, DEBOUNCE_MS);
    });
    entry = bucket;
    registry.set(projectId, entry);
  }
  entry.refCount += 1;
  return () => {
    const current = registry.get(projectId);
    if (!current) return;
    current.refCount -= 1;
    if (current.refCount > 0) return;
    if (current.debounce) clearTimeout(current.debounce);
    void current.watcher.close();
    registry.delete(projectId);
  };
}

export function closeProjectFsWatch(projectId: string): void {
  const entry = registry.get(projectId);
  if (!entry) return;
  if (entry.debounce) clearTimeout(entry.debounce);
  void entry.watcher.close();
  registry.delete(projectId);
}
