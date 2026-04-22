import { ChevronDown, ChevronRight, File, FileCode2, FileText, Folder, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useWorkspace, type WorkspaceNode } from '../lib/workspace-context';
import { ROLE_COLOR, ROLE_LABEL, ROLES, type Role } from '../lib/roles';
import { cn } from '../lib/cn';

interface WorkspaceBrowserProps {
  projectId: string;
}

export function WorkspaceBrowser({ projectId: _projectId }: WorkspaceBrowserProps) {
  const { tree, refreshTree, openFile, openFileState, recentWrites } = useWorkspace();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['.software-house']));
  const [query, setQuery] = useState<string>('');
  const [, forceNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (recentWrites.length === 0) return;
    const interval = setInterval(() => forceNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [recentWrites.length]);

  useEffect(() => {
    if (recentWrites.length === 0) return;
    setExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const write of recentWrites) {
        for (const ancestor of ancestorsOf(write.path)) {
          if (!next.has(ancestor)) {
            next.add(ancestor);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [recentWrites]);

  const writeIndex = useMemo(() => {
    const map = new Map<string, (typeof recentWrites)[number]>();
    for (const row of recentWrites) map.set(row.path, row);
    return map;
  }, [recentWrites]);

  const filteredTree = useMemo(() => filterTree(tree, query.trim().toLowerCase()), [tree, query]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleFileClick = useCallback(
    (path: string) => {
      void openFile(path);
    },
    [openFile],
  );

  const handleRefresh = useCallback(() => {
    void refreshTree();
  }, [refreshTree]);

  const totalFiles = useMemo(() => countFiles(tree), [tree]);

  return (
    <div className="h-full flex flex-col">
      <div className="panel-header gap-2">
        <span className="truncate">Workspace</span>
        <span className="text-text-faint ml-auto text-[10px] shrink-0">
          {totalFiles} {totalFiles === 1 ? 'file' : 'files'}
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          title="Refresh"
          className="text-text-faint hover:text-text shrink-0"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="border-b border-border px-2 py-1.5 flex items-center gap-1.5">
        <Search size={11} className="text-text-faint shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="filter…"
          className="flex-1 bg-transparent text-[11px] focus:outline-none placeholder:text-text-faint"
        />
      </div>

      <div className="flex-1 overflow-auto text-xs py-1">
        {tree.length === 0 ? (
          <EmptyState />
        ) : filteredTree.length === 0 ? (
          <div className="text-text-faint italic p-3">no files match "{query}"</div>
        ) : (
          <TreeList
            nodes={filteredTree}
            depth={0}
            expanded={expanded}
            onToggleDir={toggleDir}
            onFileClick={handleFileClick}
            selectedPath={openFileState?.path ?? null}
            writeIndex={writeIndex}
          />
        )}
      </div>

      {recentWrites.length > 0 && <RecentWritesFooter rows={recentWrites.slice(0, 4)} />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-text-faint italic p-3 text-[11px] leading-relaxed">
      empty. as agents produce files — requirements, architecture, source code — they'll appear here
      live.
    </div>
  );
}

interface TreeListProps {
  nodes: WorkspaceNode[];
  depth: number;
  expanded: Set<string>;
  onToggleDir: (path: string) => void;
  onFileClick: (path: string) => void;
  selectedPath: string | null;
  writeIndex: Map<string, { role?: string; at: number; isStreaming: boolean }>;
}

function TreeList({
  nodes,
  depth,
  expanded,
  onToggleDir,
  onFileClick,
  selectedPath,
  writeIndex,
}: TreeListProps) {
  return (
    <div>
      {nodes.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={depth}
          expanded={expanded}
          onToggleDir={onToggleDir}
          onFileClick={onFileClick}
          selectedPath={selectedPath}
          writeIndex={writeIndex}
        />
      ))}
    </div>
  );
}

interface TreeRowProps extends Omit<TreeListProps, 'nodes'> {
  node: WorkspaceNode;
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggleDir,
  onFileClick,
  selectedPath,
  writeIndex,
}: TreeRowProps) {
  const isDir = node.kind === 'dir';
  const isExpanded = isDir && expanded.has(node.path);
  const isSelected = !isDir && selectedPath === node.path;
  const write = writeIndex.get(node.path);
  const writeAgeMs = write ? Date.now() - write.at : Infinity;
  const isFresh = writeAgeMs < 6000;
  const isStreaming = write?.isStreaming === true;
  const roleColor = write?.role && (ROLES as readonly string[]).includes(write.role)
    ? ROLE_COLOR[write.role as Role]
    : undefined;

  const handleClick = () => {
    if (isDir) onToggleDir(node.path);
    else onFileClick(node.path);
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'group w-full flex items-center gap-1 px-1.5 py-0.5 rounded text-left transition-colors',
          'hover:bg-bg-sunken',
          isSelected && 'bg-accent-soft text-accent',
          isStreaming && 'bg-accent/10',
          isFresh && !isStreaming && !isSelected && 'bg-accent/5',
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        {isDir ? (
          isExpanded ? (
            <ChevronDown size={12} className="text-text-faint shrink-0" />
          ) : (
            <ChevronRight size={12} className="text-text-faint shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <FileIcon node={node} />
        <span className="truncate flex-1 min-w-0">{node.name}</span>
        {isStreaming && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
            style={{ backgroundColor: roleColor ?? 'currentColor' }}
            title={`being written by ${write?.role ? ROLE_LABEL[write.role as Role] ?? write.role : 'agent'}`}
          />
        )}
        {!isStreaming && isFresh && roleColor && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0 opacity-70"
            style={{ backgroundColor: roleColor }}
            title={`updated ${formatRelativeSeconds(writeAgeMs)} by ${ROLE_LABEL[write!.role as Role] ?? write!.role}`}
          />
        )}
        {!isDir && !isStreaming && (
          <span className="text-text-faint text-[10px] opacity-0 group-hover:opacity-100 shrink-0">
            {formatBytes(node.size)}
          </span>
        )}
      </button>
      {isDir && isExpanded && node.children && node.children.length > 0 && (
        <TreeList
          nodes={node.children}
          depth={depth + 1}
          expanded={expanded}
          onToggleDir={onToggleDir}
          onFileClick={onFileClick}
          selectedPath={selectedPath}
          writeIndex={writeIndex}
        />
      )}
    </div>
  );
}

function FileIcon({ node }: { node: WorkspaceNode }) {
  if (node.kind === 'dir') {
    return <Folder size={12} className="text-accent shrink-0" />;
  }
  const ext = node.name.includes('.') ? node.name.split('.').pop()!.toLowerCase() : '';
  if (ext === 'md' || ext === 'mdx' || ext === 'txt') {
    return <FileText size={12} className="text-text-muted shrink-0" />;
  }
  if (CODE_EXT.has(ext)) {
    return <FileCode2 size={12} className="text-accent/80 shrink-0" />;
  }
  return <File size={12} className="text-text-faint shrink-0" />;
}

const CODE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'swift',
  'rb', 'php', 'html', 'css', 'scss', 'sh', 'bash', 'zsh', 'sql', 'json', 'yml', 'yaml',
]);

interface RecentWritesFooterProps {
  rows: Array<{ path: string; role?: string; at: number; isStreaming: boolean }>;
}

function RecentWritesFooter({ rows }: RecentWritesFooterProps) {
  return (
    <div className="border-t border-border px-2 py-1.5 text-[10px] text-text-faint bg-bg-raised">
      <div className="uppercase tracking-wider mb-1 text-[9px]">Recent writes</div>
      <div className="flex flex-col gap-0.5">
        {rows.map((row) => {
          const roleColor = row.role && (ROLES as readonly string[]).includes(row.role)
            ? ROLE_COLOR[row.role as Role]
            : undefined;
          return (
            <div key={`${row.path}-${row.at}`} className="flex items-center gap-1.5 truncate">
              {roleColor && (
                <span
                  className={cn(
                    'inline-block w-1.5 h-1.5 rounded-full shrink-0',
                    row.isStreaming && 'animate-pulse',
                  )}
                  style={{ backgroundColor: roleColor }}
                />
              )}
              <span className="truncate">{row.path}</span>
              <span className="ml-auto shrink-0">
                {row.isStreaming ? 'streaming' : formatRelativeSeconds(Date.now() - row.at)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ancestorsOf(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    out.push(parts.slice(0, i).join('/'));
  }
  return out;
}

function filterTree(nodes: WorkspaceNode[], query: string): WorkspaceNode[] {
  if (!query) return nodes;
  const result: WorkspaceNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'dir') {
      const filteredChildren = filterTree(node.children ?? [], query);
      const selfMatch = node.name.toLowerCase().includes(query);
      if (selfMatch || filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren });
      }
      continue;
    }
    if (node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)) {
      result.push(node);
    }
  }
  return result;
}

function countFiles(nodes: WorkspaceNode[]): number {
  let total = 0;
  for (const node of nodes) {
    if (node.kind === 'file') total += 1;
    if (node.children) total += countFiles(node.children);
  }
  return total;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes}b`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kb`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}mb`;
}

function formatRelativeSeconds(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
