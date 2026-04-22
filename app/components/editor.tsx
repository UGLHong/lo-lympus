import { CircleDot, Eye, EyeOff, FileX2, RefreshCw } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import type { OnMount } from '@monaco-editor/react';

import { useWorkspace } from '../lib/workspace-context';
import { ROLE_COLOR, ROLE_LABEL, ROLES, type Role } from '../lib/roles';
import { cn } from '../lib/cn';

const Monaco = lazy(() => import('@monaco-editor/react').then((m) => ({ default: m.Editor })));

interface EditorProps {
  projectId: string;
}

export function Editor({ projectId: _projectId }: EditorProps) {
  const { openFileState, closeFile, autoFollow, setAutoFollow, openFile } = useWorkspace();
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

  return (
    <div className="h-full flex flex-col">
      <EditorHeader
        openFileState={openFileState}
        streamingRole={streamingRole}
        autoFollow={autoFollow}
        onToggleFollow={handleToggleFollow}
        onReload={handleReload}
        onClose={handleClose}
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
          <EmptyEditor autoFollow={autoFollow} onToggleFollow={handleToggleFollow} />
        )}
      </div>
    </div>
  );
}

interface EditorHeaderProps {
  openFileState: ReturnType<typeof useWorkspace>['openFileState'];
  streamingRole: string | null;
  autoFollow: boolean;
  onToggleFollow: () => void;
  onReload: () => void;
  onClose: () => void;
}

function EditorHeader({
  openFileState,
  streamingRole,
  autoFollow,
  onToggleFollow,
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
      <button
        type="button"
        onClick={onToggleFollow}
        title={autoFollow ? 'auto-follow streaming writes is ON' : 'auto-follow streaming writes is OFF'}
        className={cn(
          'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border',
          autoFollow
            ? 'border-accent/40 text-accent'
            : 'border-border text-text-faint hover:text-text',
        )}
      >
        {autoFollow ? <Eye size={11} /> : <EyeOff size={11} />}
        follow
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

interface EmptyEditorProps {
  autoFollow: boolean;
  onToggleFollow: () => void;
}

function EmptyEditor({ autoFollow, onToggleFollow }: EmptyEditorProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="max-w-sm text-center text-xs text-text-muted leading-relaxed space-y-2">
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
          , the editor will automatically open whichever file the agents are writing right now and
          stream each character as it lands.
        </p>
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
