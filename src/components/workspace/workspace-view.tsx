'use client';

import dynamic from 'next/dynamic';
import matter from 'gray-matter';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { twMerge } from 'tailwind-merge';
import type { ProjectViewState } from '@/lib/client/project-store';
import { ROLES } from '@/lib/const/roles';
import { useProjectNavigation } from '@/components/layout/project-navigation';

const MonacoEditor = dynamic(() => import('@monaco-editor/react').then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-olympus-dim">Loading editor…</div>
  ),
});

type TreeNode = {
  name: string;
  relativePath: string;
  isDir: boolean;
  children?: TreeNode[];
};

type FileKind = 'markdown' | 'json' | 'text';

export function WorkspaceView({ view }: { view: ProjectViewState }) {
  const projectId = view.state.projectId;
  const { activeArtifactPath } = useProjectNavigation();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/artifacts`)
      .then((r) => r.json())
      .then((data: { tree: TreeNode[] }) => {
        if (!cancelled) setTree(data.tree ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, view.activeArtifactPaths.length, view.messages.length, view.workspaceFsRevision]);

  useEffect(() => {
    if (tree.length === 0) return;
    if (activeArtifactPath) {
      const resolved = resolveArtifactPath(tree, activeArtifactPath);
      if (resolved) setSelectedPath(resolved);
      return;
    }
    if (!selectedPath) {
      const firstFile = findFirstMarkdown(tree) ?? findFirstFile(tree);
      if (firstFile) setSelectedPath(firstFile);
    }
  }, [activeArtifactPath, tree, selectedPath]);

  useEffect(() => {
    if (!selectedPath) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/projects/${projectId}/artifacts?path=${encodeURIComponent(selectedPath)}`)
      .then((r) => r.json())
      .then((data: { content?: string; error?: string }) => {
        if (cancelled) return;
        setContent(data.content ?? `# ${selectedPath}\n\n(${data.error ?? 'not yet written by any agent'})`);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    selectedPath,
    view.activeArtifactPaths.join('|'),
    view.messages.length,
    view.workspaceFsRevision,
  ]);

  const language = useMemo(() => inferLanguage(selectedPath ?? ''), [selectedPath]);
  const fileKind = useMemo(() => detectFileKind(selectedPath), [selectedPath]);

  const markdownParsed = useMemo(() => {
    if (fileKind !== 'markdown' || !content) return { data: {}, content: '' };
    try {
      return matter(content);
    } catch {
      return { data: {}, content };
    }
  }, [content, fileKind]);

  const formattedPreview = useMemo(() => {
    if (fileKind === 'markdown' || !content) return '';
    if (fileKind === 'json') return prettyPrintJson(content);
    return content;
  }, [content, fileKind]);

  const recentEditRoles = useMemo(() => {
    if (!selectedPath) return [] as string[];
    const roles = new Set<string>();
    for (const edit of view.fileEdits) {
      if (edit.path === selectedPath) roles.add(edit.role);
    }
    return Array.from(roles);
  }, [selectedPath, view.fileEdits]);

  const handleSelect = useCallback((path: string) => setSelectedPath(path), []);

  const handleMouseDown = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - rect.left;

      if (newWidth >= 200 && newWidth <= 600) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    if (isDraggingRef.current) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div ref={containerRef} className="flex h-full bg-olympus-bg" style={{ userSelect: isDraggingRef.current ? 'none' : 'auto' }}>
      <aside className="flex h-full min-h-0 flex-col border-r border-olympus-border bg-olympus-panel" style={{ width: `${sidebarWidth}px` }}>
        <div className="border-b border-olympus-border px-3 py-2 text-xs uppercase tracking-wider text-olympus-dim">
          Workspace
        </div>
        <div className="flex-1 overflow-y-auto p-2 text-sm">
          <FileTree nodes={tree} selected={selectedPath} onSelect={handleSelect} />
        </div>
      </aside>

      <div
        onMouseDown={handleMouseDown}
        className="w-1 cursor-col-resize border-r border-olympus-border bg-olympus-border/20 hover:bg-olympus-blue/30 transition-colors"
        title="Drag to resize workspace panel"
      />

      <main className="flex h-full min-h-0 flex-col flex-1">
        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-olympus-border px-3 py-1.5 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-olympus-dim">{selectedPath ?? '(nothing selected)'}</span>
            {loading && <span className="text-olympus-blue">loading…</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-olympus-dim">Edited by:</span>
            {recentEditRoles.length === 0 ? (
              <span className="text-olympus-dim/60">none</span>
            ) : (
              recentEditRoles.map((role) => (
                <span
                  key={role}
                  className="rounded bg-olympus-muted px-1.5 py-0.5 text-[10px]"
                  style={{ color: ROLES[role as keyof typeof ROLES]?.color }}
                >
                  @{ROLES[role as keyof typeof ROLES]?.displayName ?? role}
                </span>
              ))
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col border-b border-olympus-border">
            <div className="flex-shrink-0 border-b border-olympus-border/60 bg-olympus-panel/50 px-3 py-1 text-[10px] uppercase tracking-wider text-olympus-dim">
              Preview
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {selectedPath ? (
                <div className="mx-auto w-full max-w-3xl px-4 py-4">
                  {fileKind === 'markdown' &&
                    Object.entries(markdownParsed.data).length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        {Object.entries(markdownParsed.data).map(([key, value]) => (
                          <span
                            key={key}
                            className="rounded bg-olympus-muted px-1.5 py-0.5 text-[10px] text-olympus-dim"
                          >
                            {key}: {String(value)}
                          </span>
                        ))}
                      </div>
                    )}
                  {fileKind === 'markdown' ? (
                    <article className="markdown-body text-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {markdownParsed.content || content}
                      </ReactMarkdown>
                    </article>
                  ) : (
                    <pre className="overflow-x-auto rounded-md border border-olympus-border bg-olympus-bg/80 p-3 font-mono text-[12px] leading-[1.5rem] text-olympus-ink/95">
                      <code data-language={fileKind}>{formattedPreview || ' '}</code>
                    </pre>
                  )}
                </div>
              ) : (
                <div className="flex h-full min-h-[120px] items-center justify-center text-xs text-olympus-dim">
                  Select a file in the tree.
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-shrink-0 border-b border-olympus-border/60 bg-olympus-panel/50 px-3 py-1 text-[10px] uppercase tracking-wider text-olympus-dim">
              Raw source
            </div>
            <div className="min-h-0 flex-1">
              {selectedPath ? (
                <MonacoEditor
                  height="100%"
                  language={language}
                  value={content}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    wordWrap: 'on',
                    lineNumbers: 'on',
                    renderLineHighlight: 'line',
                    scrollBeyondLastLine: false,
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-olympus-dim">
                  Select a file to view raw content.
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function FileTree({
  nodes,
  selected,
  onSelect,
  depth = 0,
}: {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <li key={node.relativePath}>
          <FileTreeRow node={node} depth={depth} selected={selected} onSelect={onSelect} />
          {node.isDir && node.children && node.children.length > 0 && (
            <FileTree nodes={node.children} selected={selected} onSelect={onSelect} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}

function FileTreeRow({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: TreeNode;
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
      className={twMerge(
        'flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-sm',
        isSelected ? 'bg-olympus-muted/80 text-olympus-ink' : 'text-olympus-ink/80 hover:bg-olympus-muted/40',
        node.isDir && 'cursor-default text-olympus-dim',
      )}
      style={{ paddingLeft: 6 + depth * 10 }}
    >
      <span>{node.isDir ? '▸' : '·'}</span>
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function findFirstFile(nodes: TreeNode[]): string | null {
  for (const node of nodes) {
    if (!node.isDir) return node.relativePath;
    if (node.children) {
      const found = findFirstFile(node.children);
      if (found) return found;
    }
  }
  return null;
}

function findFirstMarkdown(nodes: TreeNode[]): string | null {
  for (const node of nodes) {
    if (!node.isDir && node.name.endsWith('.md')) return node.relativePath;
    if (node.children) {
      const found = findFirstMarkdown(node.children);
      if (found) return found;
    }
  }
  return null;
}

function resolveArtifactPath(nodes: TreeNode[], target: string): string | null {
  const files = flattenFiles(nodes);
  const exact = files.find((file) => file.relativePath === target);
  if (exact) return exact.relativePath;
  const prefix = files.find((file) => file.relativePath.startsWith(target));
  return prefix?.relativePath ?? null;
}

function flattenFiles(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (!node.isDir) out.push(node);
    if (node.children) out.push(...flattenFiles(node.children));
  }
  return out;
}

function detectFileKind(path: string | null): FileKind {
  if (!path) return 'text';
  const lower = path.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.markdown')) {
    return 'markdown';
  }
  if (lower.endsWith('.json') || lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) {
    return 'json';
  }
  return 'text';
}

function prettyPrintJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return raw;
  }
}

function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'md':
      return 'markdown';
    case 'json':
      return 'json';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'sh':
      return 'shell';
    case 'py':
      return 'python';
    default:
      return 'plaintext';
  }
}
