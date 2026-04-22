import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useSse, type SseEvent } from '../hooks/use-sse';

export interface WorkspaceNode {
  name: string;
  kind: 'file' | 'dir';
  path: string;
  size: number;
  modifiedAt: number;
  children?: WorkspaceNode[];
}

export interface OpenFileState {
  path: string;
  contents: string;
  language: string;
  bytes: number;
  modifiedAt: number;
  // when non-null, this file is actively being written right now. we collect
  // streamed chunks into `contents` until an `end` frame arrives.
  streamingRole: string | null;
}

export interface RecentWrite {
  path: string;
  role: string | undefined;
  at: number;
  bytes?: number;
  isStreaming: boolean;
}

interface WorkspaceContextValue {
  projectId: string;
  tree: WorkspaceNode[];
  refreshTree: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeFile: () => void;
  openFileState: OpenFileState | null;
  recentWrites: RecentWrite[];
  autoFollow: boolean;
  setAutoFollow: (value: boolean) => void;
  onFileOpened?: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

interface WorkspaceProviderProps {
  projectId: string;
  onFileOpened?: () => void;
  children: ReactNode;
}

interface ChunkPayload {
  path?: string;
  phase?: 'start' | 'chunk' | 'end';
  chunk?: string;
  language?: string;
  bytes?: number;
}

interface ChangePayload {
  path?: string;
  bytes?: number;
}

const MAX_RECENT_WRITES = 12;
const FLASH_DURATION_MS = 6000;

export function WorkspaceProvider({ projectId, onFileOpened, children }: WorkspaceProviderProps) {
  const [tree, setTree] = useState<WorkspaceNode[]>([]);
  const [openFileState, setOpenFileState] = useState<OpenFileState | null>(null);
  const [recentWrites, setRecentWrites] = useState<RecentWrite[]>([]);
  const [autoFollow, setAutoFollow] = useState<boolean>(true);

  const openPathRef = useRef<string | null>(null);
  const streamingPathRef = useRef<string | null>(null);
  const autoFollowRef = useRef<boolean>(autoFollow);
  const treeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFileOpenedRef = useRef(onFileOpened);

  useEffect(() => {
    onFileOpenedRef.current = onFileOpened;
  }, [onFileOpened]);

  useEffect(() => {
    autoFollowRef.current = autoFollow;
  }, [autoFollow]);

  const refreshTree = useCallback(async () => {
    if (!projectId) return;
    try {
      const url = new URL('/api/workspace', window.location.origin);
      url.searchParams.set('projectId', projectId);
      url.searchParams.set('mode', 'tree');
      const res = await fetch(url.toString());
      if (!res.ok) return;
      const data = (await res.json()) as { tree?: WorkspaceNode[] };
      setTree(data.tree ?? []);
    } catch (err) {
      console.warn('[workspace] refreshTree failed', err);
    }
  }, [projectId]);

  const scheduleTreeRefresh = useCallback(() => {
    if (treeDebounceRef.current) clearTimeout(treeDebounceRef.current);
    treeDebounceRef.current = setTimeout(() => {
      treeDebounceRef.current = null;
      void refreshTree();
    }, 250);
  }, [refreshTree]);

  useEffect(() => {
    void refreshTree();
    return () => {
      if (treeDebounceRef.current) clearTimeout(treeDebounceRef.current);
    };
  }, [refreshTree]);

  const fetchFile = useCallback(
    async (path: string): Promise<OpenFileState | null> => {
      if (!projectId) return null;
      const url = new URL('/api/workspace', window.location.origin);
      url.searchParams.set('projectId', projectId);
      url.searchParams.set('path', path);
      url.searchParams.set('mode', 'read');
      try {
        const res = await fetch(url.toString());
        if (!res.ok) return null;
        const data = (await res.json()) as {
          path?: string;
          contents?: string;
          language?: string;
          bytes?: number;
          modifiedAt?: number;
        };
        return {
          path: data.path ?? path,
          contents: data.contents ?? '',
          language: data.language ?? 'plaintext',
          bytes: data.bytes ?? data.contents?.length ?? 0,
          modifiedAt: data.modifiedAt ?? Date.now(),
          streamingRole: null,
        };
      } catch (err) {
        console.warn('[workspace] fetchFile failed', err);
        return null;
      }
    },
    [projectId],
  );

  const openFile = useCallback(
    async (path: string) => {
      openPathRef.current = path;
      streamingPathRef.current = null;
      const next = await fetchFile(path);
      if (next && openPathRef.current === path) {
        setOpenFileState(next);
        onFileOpenedRef.current?.();
      }
    },
    [fetchFile],
  );

  const closeFile = useCallback(() => {
    openPathRef.current = null;
    streamingPathRef.current = null;
    setOpenFileState(null);
  }, []);

  const noteWrite = useCallback((entry: RecentWrite) => {
    setRecentWrites((prev) => {
      const filtered = prev.filter((row) => row.path !== entry.path);
      return [entry, ...filtered].slice(0, MAX_RECENT_WRITES);
    });
  }, []);

  const clearFlash = useCallback((path: string) => {
    setRecentWrites((prev) =>
      prev.map((row) => (row.path === path ? { ...row, isStreaming: false } : row)),
    );
  }, []);

  const handleSseEvent = useCallback(
    (event: SseEvent) => {
      if (event.type === 'code-chunk') {
        const payload = event.payload as ChunkPayload;
        if (!payload.path || !payload.phase) return;
        const targetPath = payload.path;
        const role = event.role;
        const now = Date.now();

        if (payload.phase === 'start') {
          noteWrite({ path: targetPath, role, at: now, isStreaming: true });
          const shouldFollow =
            autoFollowRef.current &&
            (openPathRef.current === null || openPathRef.current === targetPath);
          if (shouldFollow) {
            // auto-follow updates the editor buffer in-place but does NOT switch
            // tabs — the user stays on whatever view they chose. explicit clicks
            // (openFile) are the only path that opens the editor tab.
            openPathRef.current = targetPath;
            streamingPathRef.current = targetPath;
            setOpenFileState({
              path: targetPath,
              contents: '',
              language: payload.language ?? 'plaintext',
              bytes: 0,
              modifiedAt: now,
              streamingRole: role ?? null,
            });
          } else if (openPathRef.current === targetPath) {
            streamingPathRef.current = targetPath;
            setOpenFileState((prev) =>
              prev && prev.path === targetPath
                ? {
                    ...prev,
                    contents: '',
                    bytes: 0,
                    language: payload.language ?? prev.language,
                    modifiedAt: now,
                    streamingRole: role ?? null,
                  }
                : prev,
            );
          }
          return;
        }

        if (payload.phase === 'chunk') {
          if (!payload.chunk) return;
          if (streamingPathRef.current === targetPath) {
            setOpenFileState((prev) =>
              prev && prev.path === targetPath
                ? {
                    ...prev,
                    contents: prev.contents + payload.chunk,
                    bytes: prev.bytes + payload.chunk!.length,
                    modifiedAt: Date.now(),
                  }
                : prev,
            );
          }
          return;
        }

        if (payload.phase === 'end') {
          if (streamingPathRef.current === targetPath) {
            streamingPathRef.current = null;
            setOpenFileState((prev) =>
              prev && prev.path === targetPath
                ? { ...prev, streamingRole: null, bytes: payload.bytes ?? prev.bytes }
                : prev,
            );
          }
          setTimeout(() => clearFlash(targetPath), FLASH_DURATION_MS);
          return;
        }
        return;
      }

      if (event.type === 'workspace-change') {
        const payload = event.payload as ChangePayload;
        if (!payload.path) return;
        const targetPath = payload.path;
        noteWrite({
          path: targetPath,
          role: event.role,
          at: Date.now(),
          bytes: payload.bytes,
          isStreaming: false,
        });
        scheduleTreeRefresh();

        // for files we're viewing that we did NOT just stream ourselves,
        // refetch from disk so the editor shows the freshly-written content.
        if (openPathRef.current === targetPath && streamingPathRef.current !== targetPath) {
          void fetchFile(targetPath).then((next) => {
            if (next && openPathRef.current === targetPath) {
              setOpenFileState(next);
            }
          });
        }
      }
    },
    [noteWrite, clearFlash, scheduleTreeRefresh, fetchFile],
  );

  useSse({ projectId, onEvent: handleSseEvent });

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      projectId,
      tree,
      refreshTree,
      openFile,
      closeFile,
      openFileState,
      recentWrites,
      autoFollow,
      setAutoFollow,
    }),
    [projectId, tree, refreshTree, openFile, closeFile, openFileState, recentWrites, autoFollow],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return ctx;
}
