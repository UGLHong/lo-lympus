'use client';

import dynamic from 'next/dynamic';
import { Crosshair, Sparkles } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { editor } from 'monaco-editor';
import type { ProjectViewState } from '@/lib/client/project-store';
import { ROLES } from '@/lib/const/roles';
import { extractStreamingLatestSourceWrite } from '@/lib/utils/stream-envelope';
import { twMerge } from 'tailwind-merge';

const MonacoEditor = dynamic(() => import('@monaco-editor/react').then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-olympus-dim">Loading editor…</div>
  ),
});

type SourceTreeNode = {
  name: string;
  relativePath: string;
  isDir: boolean;
  children?: SourceTreeNode[];
};

type Props = {
  view: ProjectViewState;
};

export function LiveSourceView({ view }: Props) {
  const projectId = view.state.projectId;
  const [tree, setTree] = useState<SourceTreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [followAi, setFollowAi] = useState(true);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const streamingEnvelopeRaw = useMemo(() => {
    for (let i = view.messages.length - 1; i >= 0; i -= 1) {
      const message = view.messages[i]!;
      if (message.id in view.pendingTokens) {
        return view.pendingTokens[message.id] ?? '';
      }
    }
    return '';
  }, [view.messages, view.pendingTokens]);

  const liveSourceWrite = useMemo(
    () => extractStreamingLatestSourceWrite(streamingEnvelopeRaw),
    [streamingEnvelopeRaw],
  );

  const language = useMemo(() => inferLanguage(selectedPath ?? ''), [selectedPath]);

  const displayedContent = useMemo(() => {
    if (!selectedPath) return '';
    const streamingLive =
      streamingEnvelopeRaw.length > 0 && liveSourceWrite.path === selectedPath;
    if (streamingLive) return liveSourceWrite.content;
    return content;
  }, [selectedPath, streamingEnvelopeRaw, liveSourceWrite, content]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/sources`)
      .then((r) => r.json())
      .then((data: { tree?: SourceTreeNode[] }) => {
        if (!cancelled) setTree(data.tree ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, view.sourceCodeRevision, view.workspaceFsRevision]);

  useEffect(() => {
    if (!followAi) return;
    const targetPath = liveSourceWrite.path ?? view.lastAiSourcePath;
    if (!targetPath) return;
    setSelectedPath(targetPath);
  }, [followAi, liveSourceWrite.path, view.lastAiSourcePath, view.sourceCodeRevision]);

  useEffect(() => {
    if (selectedPath) return;
    if (view.lastAiSourcePath) {
      setSelectedPath(view.lastAiSourcePath);
      return;
    }
    const first = findFirstFile(tree);
    if (first) setSelectedPath(first);
  }, [tree, selectedPath, view.lastAiSourcePath]);

  useEffect(() => {
    if (!selectedPath) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/projects/${projectId}/sources?path=${encodeURIComponent(selectedPath)}`)
      .then((r) => r.json())
      .then((data: { content?: string; error?: string }) => {
        if (cancelled) return;
        setContent(
          data.content ??
            `# ${selectedPath}\n\n(${data.error ?? 'could not read file — it may be binary or too large'})`,
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedPath, view.sourceCodeRevision, view.workspaceFsRevision]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || !followAi || !selectedPath) return;
    const model = editor.getModel();
    if (!model) return;
    const line = model.getLineCount();
    requestAnimationFrame(() => {
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: model.getLineMaxColumn(line) });
    });
  }, [displayedContent, followAi, selectedPath]);

  const onSelectFile = useCallback((path: string) => {
    setFollowAi(false);
    setSelectedPath(path);
  }, []);

  const handleEditorMount = useCallback((mounted: editor.IStandaloneCodeEditor) => {
    editorRef.current = mounted;
  }, []);

  const lastWriteMeta = useMemo(() => {
    for (let i = view.events.length - 1; i >= 0; i -= 1) {
      const event = view.events[i]!;
      if (event.kind === 'source.written' && event.path === selectedPath) {
        return {
          role: event.role,
          bytes: event.bytes,
          ts: event.ts,
        };
      }
    }
    return null;
  }, [view.events, selectedPath]);

  return (
    <div className="grid h-full grid-cols-[minmax(200px,260px)_minmax(0,1fr)] bg-olympus-bg">
      <aside className="flex h-full min-h-0 flex-col border-r border-olympus-border bg-olympus-panel">
        <div className="border-b border-olympus-border px-3 py-2 text-xs uppercase tracking-wider text-olympus-dim">
          Workspace source
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
          <SourceTree nodes={tree} selected={selectedPath} onSelect={onSelectFile} />
        </div>
      </aside>

      <main className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-olympus-border px-3 py-1.5 text-xs">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-olympus-accent" aria-hidden />
          <span className="font-mono text-olympus-dim">{selectedPath ?? '(no file)'}</span>
          {(loading || (streamingEnvelopeRaw.length > 0 && liveSourceWrite.path === selectedPath && !liveSourceWrite.contentComplete)) && (
            <span className="text-olympus-blue">{loading ? 'loading…' : 'streaming…'}</span>
          )}
          <button
            type="button"
            onClick={() => setFollowAi((previous) => !previous)}
            className={twMerge(
              'ml-auto inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition',
              followAi
                ? 'border-olympus-accent/50 bg-olympus-accent/10 text-olympus-ink'
                : 'border-olympus-border bg-olympus-muted/40 text-olympus-dim hover:text-olympus-ink',
            )}
          >
            <Crosshair className="h-3 w-3" />
            {followAi ? 'Following AI' : 'Follow AI'}
          </button>
        </div>
        {lastWriteMeta && (
          <div className="flex items-center gap-2 border-b border-olympus-border px-3 py-1 text-[11px] text-olympus-dim">
            <span>Last write</span>
            <span
              className="rounded bg-olympus-muted px-1 py-0.5"
              style={{ color: ROLES[lastWriteMeta.role]?.color }}
            >
              @{ROLES[lastWriteMeta.role]?.displayName ?? lastWriteMeta.role}
            </span>
            <span>
              {lastWriteMeta.bytes} B · {lastWriteMeta.ts.slice(11, 19)}
            </span>
          </div>
        )}
        <div className="min-h-0 flex-1">
          {selectedPath ? (
            <MonacoEditor
              height="100%"
              language={language}
              value={displayedContent}
              theme="vs-dark"
              onMount={handleEditorMount}
              options={{
                readOnly: true,
                minimap: { enabled: true },
                fontSize: 13,
                wordWrap: 'on',
                lineNumbers: 'on',
                renderLineHighlight: 'line',
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                cursorBlinking: 'smooth',
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-olympus-dim">
              No source files yet — generated code appears here as agents write to the workspace.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function SourceTree({
  nodes,
  selected,
  onSelect,
  depth = 0,
}: {
  nodes: SourceTreeNode[];
  selected: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <li key={node.relativePath}>
          <SourceTreeRow node={node} depth={depth} selected={selected} onSelect={onSelect} />
          {node.isDir && node.children && node.children.length > 0 && (
            <SourceTree nodes={node.children} selected={selected} onSelect={onSelect} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}

function SourceTreeRow({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: SourceTreeNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const isSelected = !node.isDir && selected === node.relativePath;
  const handleClick = () => {
    if (!node.isDir) onSelect(node.relativePath);
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={node.isDir}
      className={`flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-sm ${
        isSelected ? 'bg-olympus-muted/80 text-olympus-ink' : 'text-olympus-ink/80 hover:bg-olympus-muted/40'
      } ${node.isDir ? 'cursor-default text-olympus-dim' : ''}`}
      style={{ paddingLeft: 6 + depth * 10 }}
    >
      <span>{node.isDir ? '▸' : '·'}</span>
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function findFirstFile(nodes: SourceTreeNode[]): string | null {
  for (const node of nodes) {
    if (!node.isDir) return node.relativePath;
    if (node.children) {
      const found = findFirstFile(node.children);
      if (found) return found;
    }
  }
  return null;
}

function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'md':
    case 'mdx':
      return 'markdown';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'ts':
    case 'mts':
    case 'cts':
      return 'typescript';
    case 'tsx':
      return 'typescriptreact';
    case 'js':
    case 'cjs':
    case 'mjs':
      return 'javascript';
    case 'jsx':
      return 'javascriptreact';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'sh':
      return 'shell';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'go':
      return 'go';
    default:
      return 'plaintext';
  }
}
