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
import { useUi } from './ui-context';

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

export interface ActiveStream {
  path: string;
  role: string | null;
  startedAt: number;
}

interface WorkspaceContextValue {
  projectId: string;
  tree: WorkspaceNode[];
  refreshTree: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeFile: () => void;
  openFileState: OpenFileState | null;
  recentWrites: RecentWrite[];
  activeStreams: ActiveStream[];
  autoFollow: boolean;
  setAutoFollow: (value: boolean) => void;
  // true when the user manually picked the current file. follow mode never
  // steals focus from a pinned file; unpinning (toggle follow, close file,
  // or click a live stream) lets auto-switching resume.
  isPinned: boolean;
  unpin: () => void;
  // jump the editor to whatever a specific role or stream is writing right
  // now. used by the "live" ribbon to let the user peek without breaking
  // follow mode.
  jumpToStream: (path: string) => Promise<void>;
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
  const { followRole } = useUi();
  const [tree, setTree] = useState<WorkspaceNode[]>([]);
  const [openFileState, setOpenFileState] = useState<OpenFileState | null>(null);
  const [recentWrites, setRecentWrites] = useState<RecentWrite[]>([]);
  const [activeStreams, setActiveStreams] = useState<ActiveStream[]>([]);
  const [autoFollow, setAutoFollowState] = useState<boolean>(true);
  const [isPinned, setIsPinned] = useState<boolean>(false);

  const openPathRef = useRef<string | null>(null);
  const streamingPathRef = useRef<string | null>(null);
  const autoFollowRef = useRef<boolean>(autoFollow);
  const pinnedRef = useRef<boolean>(isPinned);
  const followRoleRef = useRef<string | null>(followRole);
  const treeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFileOpenedRef = useRef(onFileOpened);

  useEffect(() => {
    onFileOpenedRef.current = onFileOpened;
  }, [onFileOpened]);

  useEffect(() => {
    autoFollowRef.current = autoFollow;
  }, [autoFollow]);

  useEffect(() => {
    pinnedRef.current = isPinned;
  }, [isPinned]);

  useEffect(() => {
    followRoleRef.current = followRole;
  }, [followRole]);

  const setAutoFollow = useCallback((value: boolean) => {
    setAutoFollowState(value);
    // toggling follow ON clears any pin so auto-switching engages immediately
    // the next time an agent starts streaming. toggling OFF implicitly pins
    // whatever is currently open (or the lack of a file) so nothing replaces it.
    setIsPinned(!value);
  }, []);

  const unpin = useCallback(() => {
    setIsPinned(false);
    setAutoFollowState(true);
  }, []);

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
      // an explicit user click pins the editor. follow mode will no longer
      // steal focus until the user unpins (close, toggle follow on, or click
      // a live stream chip).
      setIsPinned(true);
      const next = await fetchFile(path);
      if (next && openPathRef.current === path) {
        setOpenFileState(next);
        onFileOpenedRef.current?.();
      }
    },
    [fetchFile],
  );

  // used by the "LIVE · role is writing X" chip — jumps to the streaming
  // file without flipping the pin, so the user keeps following once the
  // current stream ends.
  const jumpToStream = useCallback(
    async (path: string) => {
      openPathRef.current = path;
      const active = activeStreams.find((row) => row.path === path);
      if (active) {
        streamingPathRef.current = path;
        setOpenFileState({
          path,
          contents: '',
          language: inferLanguageFromPath(path),
          bytes: 0,
          modifiedAt: Date.now(),
          streamingRole: active.role,
        });
        setIsPinned(false);
        setAutoFollowState(true);
        onFileOpenedRef.current?.();
        return;
      }
      streamingPathRef.current = null;
      const next = await fetchFile(path);
      if (next && openPathRef.current === path) {
        setOpenFileState(next);
        setIsPinned(false);
        setAutoFollowState(true);
        onFileOpenedRef.current?.();
      }
    },
    [activeStreams, fetchFile],
  );

  const closeFile = useCallback(() => {
    openPathRef.current = null;
    streamingPathRef.current = null;
    setOpenFileState(null);
    setIsPinned(false);
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
          setActiveStreams((prev) => {
            const without = prev.filter((row) => row.path !== targetPath);
            return [...without, { path: targetPath, role: role ?? null, startedAt: now }];
          });
          // follow only matches streams from the selected role when a filter
          // is active; `null` means "any role".
          const matchesRoleFilter = !followRoleRef.current || followRoleRef.current === role;
          const shouldFollow =
            autoFollowRef.current && !pinnedRef.current && matchesRoleFilter;
          if (shouldFollow) {
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
          setActiveStreams((prev) => prev.filter((row) => row.path !== targetPath));
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
      activeStreams,
      autoFollow,
      setAutoFollow,
      isPinned,
      unpin,
      jumpToStream,
    }),
    [
      projectId,
      tree,
      refreshTree,
      openFile,
      closeFile,
      openFileState,
      recentWrites,
      activeStreams,
      autoFollow,
      setAutoFollow,
      isPinned,
      unpin,
      jumpToStream,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

// monaco language id heuristic for paths we don't have a cached language for
// yet (e.g. when the editor jumps to a live stream whose `start` frame has
// already been consumed and we no longer have access to `payload.language`).
function inferLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'sql':
      return 'sql';
    case 'yml':
    case 'yaml':
      return 'yaml';
    default:
      return 'plaintext';
  }
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return ctx;
}
