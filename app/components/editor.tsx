import {
  CircleDot,
  Eye,
  EyeOff,
  FileX2,
  Pin,
  PinOff,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import type { OnMount } from '@monaco-editor/react';

import { useFollowMode } from '../lib/follow-mode';
import { useWorkspace, type ActiveStream } from '../lib/workspace-context';
import { ROLE_COLOR, ROLE_LABEL, ROLES, type Role } from '../lib/roles';
import { cn } from '../lib/cn';

const Monaco = lazy(() => import('@monaco-editor/react').then((m) => ({ default: m.Editor })));

interface EditorProps {
  projectId: string;
}

export function Editor({ projectId: _projectId }: EditorProps) {
  const {
    openFileState,
    closeFile,
    autoFollow,
    setAutoFollow,
    openFile,
    activeStreams,
    isPinned,
    unpin,
    jumpToStream,
  } = useWorkspace();
  const { followRole, setFollowRole } = useFollowMode();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const isStreaming = openFileState?.streamingRole != null;
  const streamingRole = openFileState?.streamingRole ?? null;

  const handleMount = useCallback<OnMount>((editor) => {
    editorRef.current = editor;
  }, []);

  useEffect(() => {
    if (!isStreaming || !editorRef.current || !openFileState) return;
    const model = editorRef.current.getModel();
    if (!model) return;
    const lineCount = model.getLineCount();
    editorRef.current.revealLine(lineCount);
  }, [isStreaming, openFileState]);

  const handleToggleFollow = useCallback(() => {
    setAutoFollow(!autoFollow);
  }, [autoFollow, setAutoFollow]);

  const handleReload = useCallback(() => {
    if (openFileState?.path) void openFile(openFileState.path);
  }, [openFile, openFileState?.path]);

  const handleClose = useCallback(() => {
    closeFile();
  }, [closeFile]);

  const handleUnpin = useCallback(() => {
    unpin();
  }, [unpin]);

  const handleJumpToStream = useCallback(
    (path: string) => {
      void jumpToStream(path);
    },
    [jumpToStream],
  );

  // a stream elsewhere is anything being written that is NOT the file the
  // editor is currently focused on. shown as clickable chips in the live
  // ribbon so the user can peek without losing their pin.
  const streamsElsewhere = useMemo<ActiveStream[]>(() => {
    const currentPath = openFileState?.path ?? null;
    return activeStreams.filter((stream) => stream.path !== currentPath);
  }, [activeStreams, openFileState?.path]);

  return (
    <div className="h-full flex flex-col">
      <EditorHeader
        openFileState={openFileState}
        streamingRole={streamingRole}
        autoFollow={autoFollow}
        isPinned={isPinned}
        followRole={followRole}
        onToggleFollow={handleToggleFollow}
        onUnpin={handleUnpin}
        onClearRoleFilter={() => setFollowRole(null)}
        onReload={handleReload}
        onClose={handleClose}
      />
      <LiveStreamRibbon
        streams={streamsElsewhere}
        autoFollow={autoFollow}
        isPinned={isPinned}
        followRole={followRole}
        onJump={handleJumpToStream}
        onResumeFollow={handleUnpin}
      />
      <div className="flex-1 min-h-0 bg-bg-sunken relative">
        {openFileState ? (
          <Suspense fallback={<div className="p-4 text-xs text-text-muted">loading editor…</div>}>
            <Monaco
              height="100%"
              theme="vs-dark"
              path={openFileState.path}
              language={openFileState.language}
              value={openFileState.contents}
              onMount={handleMount}
              options={{
                readOnly: true,
                fontSize: 12,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                automaticLayout: true,
                renderWhitespace: 'selection',
                lineNumbers: 'on',
              }}
            />
          </Suspense>
        ) : (
          <EmptyEditor
            autoFollow={autoFollow}
            activeStreams={activeStreams}
            onToggleFollow={handleToggleFollow}
            onJump={handleJumpToStream}
          />
        )}
      </div>
    </div>
  );
}

interface EditorHeaderProps {
  openFileState: ReturnType<typeof useWorkspace>['openFileState'];
  streamingRole: string | null;
  autoFollow: boolean;
  isPinned: boolean;
  followRole: string | null;
  onToggleFollow: () => void;
  onUnpin: () => void;
  onClearRoleFilter: () => void;
  onReload: () => void;
  onClose: () => void;
}

function EditorHeader({
  openFileState,
  streamingRole,
  autoFollow,
  isPinned,
  followRole,
  onToggleFollow,
  onUnpin,
  onClearRoleFilter,
  onReload,
  onClose,
}: EditorHeaderProps) {
  const hasFile = openFileState !== null;
  const streamingLabel = useMemo(() => {
    if (!streamingRole) return null;
    return ROLE_LABEL[streamingRole as Role] ?? streamingRole;
  }, [streamingRole]);
  const streamingColor = streamingRole && (ROLES as readonly string[]).includes(streamingRole)
    ? ROLE_COLOR[streamingRole as Role]
    : undefined;

  const followTooltip = (() => {
    if (!autoFollow) return 'follow OFF — editor stays on this file';
    if (isPinned) return 'follow ON but pinned — click unpin to resume';
    if (followRole) return `following ${ROLE_LABEL[followRole as Role] ?? followRole} only`;
    return 'following all agents — editor auto-switches to the file being written';
  })();

  return (
    <div className="panel-header gap-2">
      <span className="truncate flex-1 min-w-0">
        {hasFile ? openFileState!.path : 'no file open'}
      </span>
      {streamingLabel && (
        <span
          className="flex items-center gap-1 text-[10px] font-medium"
          style={{ color: streamingColor }}
        >
          <CircleDot size={10} className="animate-pulse" />
          {streamingLabel} is writing…
        </span>
      )}
      {hasFile && !streamingRole && (
        <span className="text-[10px] text-text-faint shrink-0">
          {formatBytes(openFileState!.bytes)}
        </span>
      )}
      {followRole && (
        <button
          type="button"
          onClick={onClearRoleFilter}
          title={`clear role filter (currently only following ${ROLE_LABEL[followRole as Role] ?? followRole})`}
          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-accent/40 text-accent hover:border-accent"
          style={{ borderLeftColor: ROLE_COLOR[followRole as Role], borderLeftWidth: 3 }}
        >
          {ROLE_LABEL[followRole as Role] ?? followRole}
          <span className="text-text-faint">×</span>
        </button>
      )}
      {isPinned && hasFile && (
        <button
          type="button"
          onClick={onUnpin}
          title="unpin — let follow mode auto-switch to live streams again"
          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/50 text-amber-300 hover:border-amber-400"
        >
          <Pin size={11} />
          pinned
        </button>
      )}
      <button
        type="button"
        onClick={onToggleFollow}
        title={followTooltip}
        className={cn(
          'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border',
          autoFollow && !isPinned
            ? 'border-accent/40 text-accent'
            : 'border-border text-text-faint hover:text-text',
        )}
      >
        {autoFollow ? <Eye size={11} /> : <EyeOff size={11} />}
        {autoFollow ? (isPinned ? 'follow (paused)' : 'follow') : 'follow off'}
      </button>
      {hasFile && (
        <>
          <button
            type="button"
            onClick={onReload}
            title="Reload from disk"
            className="text-text-faint hover:text-text shrink-0"
          >
            <RefreshCw size={12} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close file"
            className="text-text-faint hover:text-text shrink-0"
          >
            <FileX2 size={12} />
          </button>
        </>
      )}
    </div>
  );
}

interface LiveStreamRibbonProps {
  streams: ActiveStream[];
  autoFollow: boolean;
  isPinned: boolean;
  followRole: string | null;
  onJump: (path: string) => void;
  onResumeFollow: () => void;
}

function LiveStreamRibbon({
  streams,
  autoFollow,
  isPinned,
  followRole,
  onJump,
  onResumeFollow,
}: LiveStreamRibbonProps) {
  if (streams.length === 0) return null;

  const wouldBeFollowing = autoFollow && !isPinned;
  const showResumeHint = !wouldBeFollowing;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-raised/40">
      <span className="flex items-center gap-1 text-[10px] font-medium text-accent shrink-0">
        <Zap size={11} />
        LIVE
      </span>
      <div className="flex-1 min-w-0 flex flex-wrap gap-1">
        {streams.map((stream) => (
          <LiveStreamChip
            key={stream.path}
            stream={stream}
            dimmed={Boolean(followRole && followRole !== stream.role)}
            onJump={onJump}
          />
        ))}
      </div>
      {showResumeHint && (
        <button
          type="button"
          onClick={onResumeFollow}
          title="unpin and re-enable follow mode"
          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-accent/40 text-accent hover:bg-accent-soft shrink-0"
        >
          <PinOff size={11} />
          resume follow
        </button>
      )}
    </div>
  );
}

interface LiveStreamChipProps {
  stream: ActiveStream;
  dimmed: boolean;
  onJump: (path: string) => void;
}

function LiveStreamChip({ stream, dimmed, onJump }: LiveStreamChipProps) {
  const roleColor = stream.role && (ROLES as readonly string[]).includes(stream.role)
    ? ROLE_COLOR[stream.role as Role]
    : undefined;
  const roleLabel = stream.role
    ? (ROLE_LABEL[stream.role as Role] ?? stream.role)
    : 'unknown';

  return (
    <button
      type="button"
      onClick={() => onJump(stream.path)}
      title={`jump to ${stream.path} (being written by ${roleLabel})`}
      className={cn(
        'flex items-center gap-1.5 text-[10px] px-1.5 py-0.5 rounded border transition',
        dimmed
          ? 'border-border/60 text-text-faint opacity-50 hover:opacity-100'
          : 'border-border text-text hover:border-accent hover:text-accent',
      )}
      style={{ borderLeftColor: roleColor, borderLeftWidth: 3 }}
    >
      <CircleDot size={9} className="animate-pulse shrink-0" style={{ color: roleColor }} />
      <span className="font-medium shrink-0">{roleLabel}</span>
      <span className="text-text-faint truncate max-w-[220px]">{stream.path}</span>
    </button>
  );
}

interface EmptyEditorProps {
  autoFollow: boolean;
  activeStreams: ActiveStream[];
  onToggleFollow: () => void;
  onJump: (path: string) => void;
}

function EmptyEditor({ autoFollow, activeStreams, onToggleFollow, onJump }: EmptyEditorProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="max-w-sm text-center text-xs text-text-muted leading-relaxed space-y-3">
        <div className="text-sm text-text">No file open</div>
        <p>Click a file in the workspace tree to open it here.</p>
        <p>
          With{' '}
          <button
            type="button"
            onClick={onToggleFollow}
            className={cn(
              'underline underline-offset-2',
              autoFollow ? 'text-accent' : 'text-text-faint hover:text-text',
            )}
          >
            follow mode {autoFollow ? 'ON' : 'OFF'}
          </button>
          , the editor auto-opens whatever file the agents are writing and streams each character as
          it lands.
        </p>
        {activeStreams.length > 0 && (
          <div className="pt-2 border-t border-border space-y-1 text-left">
            <div className="text-[10px] uppercase tracking-wider text-text-faint text-center">
              writing right now
            </div>
            {activeStreams.map((stream) => (
              <LiveStreamChip
                key={stream.path}
                stream={stream}
                dimmed={false}
                onJump={onJump}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0b';
  if (bytes < 1024) return `${bytes}b`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kb`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
}
