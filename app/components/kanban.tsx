import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';

import { useSse, type SseEvent } from '../hooks/use-sse';
import { ROLE_COLOR, ROLE_LABEL, isRole } from '../lib/roles';
import { buildTaskCodeMap, getTaskCode } from '../lib/task-code';
import { cn } from '../lib/cn';
import { useUi } from '../lib/ui-context';
import { TaskChat } from './task-chat';

export type KanbanTask = {
  id: string;
  title: string;
  description: string;
  status:
    | 'todo'
    | 'in-progress'
    | 'pending-review'
    | 'blocked-needs-input'
    | 'done'
    | 'failed'
    | 'skipped';
  role: string;
  claimedBy: string | null;
  claimedAt: string | null;
  blockedReason: string | null;
  result: Record<string, unknown> | null;
  dependsOn: string[];
  parentTaskId: string | null;
  iteration: number;
  modelTier: string | null;
  modelName: string | null;
  createdAt: string;
  updatedAt: string;
};

interface KanbanProps {
  projectId: string;
  initialTasks: KanbanTask[];
}

const COLUMNS: { id: KanbanTask['status']; label: string }[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'pending-review', label: 'Pending Review' },
  { id: 'blocked-needs-input', label: 'Blocked' },
  { id: 'done', label: 'Done' },
  { id: 'failed', label: 'Failed' },
];

const STATUS_LABEL: Record<KanbanTask['status'], string> = {
  todo: 'Todo',
  'in-progress': 'In progress',
  'pending-review': 'Pending review',
  'blocked-needs-input': 'Blocked (needs input)',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};

function mergeKanbanTask(prev: KanbanTask, p: Record<string, unknown>): KanbanTask {
  return {
    id: prev.id,
    title: typeof p.title === 'string' ? p.title : prev.title,
    description: typeof p.description === 'string' ? p.description : prev.description,
    status:
      typeof p.status === 'string' ? (p.status as KanbanTask['status']) : prev.status,
    role: typeof p.role === 'string' ? p.role : prev.role,
    claimedBy:
      p.claimedBy !== undefined ? (p.claimedBy as string | null) : prev.claimedBy,
    claimedAt:
      p.claimedAt !== undefined ? (p.claimedAt as string | null) : prev.claimedAt,
    blockedReason:
      p.blockedReason !== undefined
        ? (p.blockedReason as string | null)
        : prev.blockedReason,
    result:
      p.result !== undefined ? (p.result as Record<string, unknown> | null) : prev.result,
    dependsOn: Array.isArray(p.dependsOn) ? (p.dependsOn as string[]) : prev.dependsOn,
    parentTaskId:
      p.parentTaskId !== undefined ? (p.parentTaskId as string | null) : prev.parentTaskId,
    iteration:
      typeof p.iteration === 'number' ? p.iteration : prev.iteration,
    modelTier:
      p.modelTier !== undefined ? (p.modelTier as string | null) : prev.modelTier,
    modelName:
      p.modelName !== undefined ? (p.modelName as string | null) : prev.modelName,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : prev.createdAt,
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : prev.updatedAt,
  };
}

function emptyTaskShell(id: string): KanbanTask {
  const now = new Date().toISOString();
  return {
    id,
    title: '',
    description: '',
    status: 'todo',
    role: '',
    claimedBy: null,
    claimedAt: null,
    blockedReason: null,
    result: null,
    dependsOn: [],
    parentTaskId: null,
    iteration: 0,
    modelTier: null,
    modelName: null,
    createdAt: now,
    updatedAt: now,
  };
}

function roleLabel(role: string): string {
  return isRole(role) ? ROLE_LABEL[role] : role;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function Kanban({ projectId, initialTasks }: KanbanProps) {
  const [tasks, setTasks] = useState<KanbanTask[]>(initialTasks);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailPanelRef = useRef<ImperativePanelHandle>(null);
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const userDismissedRef = useRef<Set<string>>(new Set());
  const { watchStatus } = useUi();

  // merge server-provided tasks into live state without clobbering SSE updates.
  // newer `updatedAt` timestamps win, and tasks added live stay.
  useEffect(() => {
    setTasks((prev) => {
      const byId = new Map(prev.map((task) => [task.id, task]));
      for (const incoming of initialTasks) {
        const existing = byId.get(incoming.id);
        if (!existing || incoming.updatedAt >= existing.updatedAt) {
          byId.set(incoming.id, incoming);
        }
      }
      return Array.from(byId.values());
    });
  }, [initialTasks]);

  useLayoutEffect(() => {
    detailPanelRef.current?.collapse();
  }, []);

  useEffect(() => {
    if (selectedId) {
      detailPanelRef.current?.expand(55);
    } else {
      detailPanelRef.current?.collapse();
    }
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  useSse({
    projectId,
    onEvent: (event: SseEvent) => {
      if (event.type !== 'task-update') return;
      const p = event.payload;
      const id = typeof p.id === 'string' ? p.id : null;
      if (!id) return;
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx === -1) {
          const base = emptyTaskShell(id);
          return [...prev, mergeKanbanTask(base, p)];
        }
        const next = prev.slice();
        next[idx] = mergeKanbanTask(next[idx], p);
        return next;
      });
    },
  });

  // safety net: refresh tasks from the API every 20s to recover from missed SSE events.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/tasks?projectId=${encodeURIComponent(projectId)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { tasks?: KanbanTask[] };
        if (!data.tasks) return;
        setTasks((prev) => {
          const byId = new Map(prev.map((task) => [task.id, task]));
          for (const incoming of data.tasks!) {
            const existing = byId.get(incoming.id);
            if (!existing || incoming.updatedAt > existing.updatedAt) {
              byId.set(incoming.id, incoming);
            }
          }
          return Array.from(byId.values());
        });
      } catch {
        /* ignore */
      }
    };
    const handle = window.setInterval(poll, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [projectId]);

  const selectedTask = selectedId ? tasks.find((t) => t.id === selectedId) : undefined;

  const taskCodes = useMemo(() => buildTaskCodeMap(tasks), [tasks]);

  const handleCloseDetail = useCallback(() => {
    setSelectedId((current) => {
      if (current) userDismissedRef.current.add(current);
      return null;
    });
  }, []);

  const handleSelectTask = useCallback((taskId: string | null) => {
    if (taskId === null) {
      setSelectedId((current) => {
        if (current) userDismissedRef.current.add(current);
        return null;
      });
      return;
    }
    setSelectedId((current) => {
      if (current === taskId) {
        userDismissedRef.current.add(taskId);
        return null;
      }
      userDismissedRef.current.delete(taskId);
      return taskId;
    });
  }, []);

  // auto-focus the detail pane on any task that newly needs human input
  useEffect(() => {
    const prev = prevStatusRef.current;
    let newlyBlocked: string | null = null;
    for (const task of tasks) {
      const previousStatus = prev.get(task.id);
      if (
        task.status === 'blocked-needs-input' &&
        previousStatus !== 'blocked-needs-input' &&
        !userDismissedRef.current.has(task.id)
      ) {
        newlyBlocked = task.id;
      }
      if (task.status !== 'blocked-needs-input') {
        userDismissedRef.current.delete(task.id);
      }
      prev.set(task.id, task.status);
    }
    if (newlyBlocked) {
      setSelectedId(newlyBlocked);
    }
  }, [tasks]);

  // watch mode: auto-select first available task in watched status
  useEffect(() => {
    if (!watchStatus) return;
    const watchedTasks = tasks.filter((t) => t.status === watchStatus);
    if (watchedTasks.length === 0) {
      setSelectedId(null);
      return;
    }
    const currentTask = selectedId ? tasks.find((t) => t.id === selectedId) : null;
    const currentTaskInWatchStatus = currentTask && currentTask.status === watchStatus;
    if (currentTaskInWatchStatus) {
      return;
    }
    const oldestTask = watchedTasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    setSelectedId(oldestTask.id);
  }, [tasks, watchStatus, selectedId]);

  const { setWatchStatus } = useUi();

  return (
    <PanelGroup direction="vertical" className="h-full min-h-0">
      <Panel defaultSize={100} minSize={28}>
        <div className="h-full overflow-auto p-3 min-h-0">
          <div className="grid grid-cols-6 gap-3 min-w-[1080px]">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.id}
                col={col}
                tasks={tasks}
                watchStatus={watchStatus}
                setWatchStatus={setWatchStatus}
                selectedId={selectedId}
                taskCodes={taskCodes}
                onSelect={handleSelectTask}
                allTasks={tasks}
              />
            ))}
          </div>
        </div>
      </Panel>
      <PanelResizeHandle className="h-1 hover:bg-accent/50 transition-colors bg-border/40" />
      <Panel
        ref={detailPanelRef}
        collapsible
        collapsedSize={0}
        defaultSize={0}
        minSize={12}
        maxSize={72}
      >
        <div className="h-full min-h-0 flex flex-col bg-bg-raised border-t border-border">
          {selectedTask ? (
            <TaskDetailSplit
              projectId={projectId}
              task={selectedTask}
              allTasks={tasks}
              taskCodes={taskCodes}
              onClose={handleCloseDetail}
              onSelectTask={handleSelectTask}
            />
          ) : (
            <div className="min-h-0 flex-1" aria-hidden />
          )}
        </div>
      </Panel>
    </PanelGroup>
  );
}

type TaskGroup = {
  root: KanbanTask;
  members: KanbanTask[];
};

// bundle tasks under a common root ONLY when the parent link represents a
// review chain (the reviewer for this task, or a fix iteration queued off a
// reviewer). delegation hand-offs (pm → architect, architect → techlead,
// techlead → coders) share parentTaskId for provenance / dependency gating
// but must render as separate groups — otherwise every downstream ticket
// ends up stacked under the original pm kickoff task.
function isReviewChainLink(cursor: KanbanTask): boolean {
  return cursor.role === 'reviewer' || cursor.iteration > 0;
}

function findColumnRoot(
  task: KanbanTask,
  colTaskIds: Set<string>,
  byId: Map<string, KanbanTask>,
): string {
  let rootId = task.id;
  let cursor = task;
  const seen = new Set<string>();
  while (cursor.parentTaskId && !seen.has(cursor.parentTaskId) && isReviewChainLink(cursor)) {
    seen.add(cursor.id);
    const parent = byId.get(cursor.parentTaskId);
    if (!parent) break;
    cursor = parent;
    if (colTaskIds.has(cursor.id)) rootId = cursor.id;
  }
  return rootId;
}

function groupColumnTasks(colTasks: KanbanTask[], allTasks: KanbanTask[]): TaskGroup[] {
  const byId = new Map(allTasks.map((task) => [task.id, task]));
  const colTaskIds = new Set(colTasks.map((task) => task.id));
  const groupMap = new Map<string, KanbanTask[]>();

  for (const task of colTasks) {
    const rootId = findColumnRoot(task, colTaskIds, byId);
    if (!groupMap.has(rootId)) groupMap.set(rootId, []);
    groupMap.get(rootId)!.push(task);
  }

  return [...groupMap.entries()]
    .map(([rootId, members]) => ({
      root: byId.get(rootId)!,
      members: members.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }))
    .sort((a, b) => a.root.createdAt.localeCompare(b.root.createdAt));
}

function iterationLabel(task: KanbanTask): string {
  return task.iteration === 0 ? 'Original' : `Fix #${task.iteration}`;
}

function ChainGroupCard({
  group,
  selectedId,
  onSelect,
  taskCodes,
}: {
  group: TaskGroup;
  selectedId: string | null;
  onSelect: (taskId: string) => void;
  taskCodes: Map<string, string>;
}) {
  const { root, members } = group;
  const color = isRole(root.role) ? ROLE_COLOR[root.role] : '#666';
  const isAnySelected = members.some((member) => member.id === selectedId);
  const rootCode = getTaskCode(root.id, taskCodes, root.role);
  const handleRootClick = useCallback(() => onSelect(root.id), [onSelect, root.id]);

  return (
    <div
      className={cn(
        'rounded border bg-bg-sunken text-xs leading-snug transition-colors',
        isAnySelected ? 'border-accent/60' : 'border-border',
      )}
    >
      <button
        type="button"
        onClick={handleRootClick}
        className={cn(
          'w-full p-2 text-left rounded-t transition-colors',
          'hover:bg-bg-raised/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
          selectedId === root.id && 'bg-bg-raised/50',
        )}
      >
        <div className="flex items-center gap-1.5 mb-1">
          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <TaskCodeBadge code={rootCode} />
          <span className="text-text-muted truncate">{roleLabel(root.role)}</span>
          <span className="ml-auto shrink-0 text-[10px] text-text-faint bg-border/40 rounded px-1.5 py-0.5">
            {members.length} iterations
          </span>
        </div>
        <div className="text-text font-medium">{root.title}</div>
      </button>

      <div className="border-t border-border/60 divide-y divide-border/40">
        {members.map((member) => (
          <ChainGroupMemberRow
            key={member.id}
            member={member}
            isSelected={selectedId === member.id}
            onSelect={onSelect}
            taskCodes={taskCodes}
          />
        ))}
      </div>
    </div>
  );
}

function ChainGroupMemberRow({
  member,
  isSelected,
  onSelect,
  taskCodes,
}: {
  member: KanbanTask;
  isSelected: boolean;
  onSelect: (taskId: string) => void;
  taskCodes: Map<string, string>;
}) {
  const code = getTaskCode(member.id, taskCodes, member.role);
  const handleClick = useCallback(() => onSelect(member.id), [onSelect, member.id]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'w-full px-2 py-1.5 text-left transition-colors last:rounded-b',
        'hover:bg-bg-raised/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
        isSelected && 'bg-bg-raised/50',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-text-muted w-14 shrink-0">{iterationLabel(member)}</span>
        <TaskCodeBadge code={code} />
        <span className="text-text-faint text-[10px] ml-auto shrink-0">
          {STATUS_LABEL[member.status]}
        </span>
        {member.blockedReason && (
          <span className="shrink-0 text-[10px] text-yellow-300 bg-yellow-500/20 border border-yellow-500/40 rounded px-1 py-0.5 font-medium">
            🚨
          </span>
        )}
      </div>
    </button>
  );
}

function KanbanColumn({
  col,
  tasks,
  watchStatus,
  setWatchStatus,
  selectedId,
  taskCodes,
  onSelect,
  allTasks,
}: {
  col: { id: KanbanTask['status']; label: string };
  tasks: KanbanTask[];
  watchStatus: string | null;
  setWatchStatus: (status: string | null) => void;
  selectedId: string | null;
  taskCodes: Map<string, string>;
  onSelect: (taskId: string) => void;
  allTasks: KanbanTask[];
}) {
  // skipped tasks share the "done" column since they unblock dependents
  // exactly like a successful task would — this keeps the board honest about
  // what is still outstanding without introducing a seventh column.
  const colTasks = tasks.filter((task) =>
    col.id === 'done' ? task.status === 'done' || task.status === 'skipped' : task.status === col.id,
  );
  const isWatched = watchStatus === col.id;
  const handleWatchToggle = useCallback(() => {
    setWatchStatus(isWatched ? null : col.id);
  }, [isWatched, setWatchStatus, col.id]);

  return (
    <div className="panel flex flex-col min-h-[200px]">
      <div className="panel-header">
        <span>{col.label}</span>
        <div className="flex items-center gap-2 text-text-faint">
          <button
            type="button"
            onClick={handleWatchToggle}
            className={cn(
              'px-2 py-1 rounded text-xs transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
              isWatched
                ? 'bg-accent/20 text-accent hover:bg-accent/30'
                : 'hover:bg-border/40 text-text-faint/60',
            )}
            title={isWatched ? 'Stop watching' : 'Watch this category'}
          >
            👁
          </button>
          <span>{colTasks.length}</span>
        </div>
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-auto">
        {groupColumnTasks(colTasks, allTasks).map((group) =>
          group.members.length > 1 ? (
            <ChainGroupCard
              key={group.root.id}
              group={group}
              selectedId={selectedId}
              onSelect={onSelect}
              taskCodes={taskCodes}
            />
          ) : (
            <TaskCard
              key={group.root.id}
              task={group.root}
              code={getTaskCode(group.root.id, taskCodes, group.root.role)}
              isSelected={selectedId === group.root.id}
              onSelect={onSelect}
              allTasks={allTasks}
              taskCodes={taskCodes}
            />
          ),
        )}
        {colTasks.length === 0 && (
          <div className="text-xs text-text-faint italic px-2 py-4 text-center">empty</div>
        )}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  code,
  isSelected,
  onSelect,
  allTasks,
  taskCodes,
}: {
  task: KanbanTask;
  code: string;
  isSelected: boolean;
  onSelect: (taskId: string) => void;
  allTasks: KanbanTask[];
  taskCodes: Map<string, string>;
}) {
  const color = isRole(task.role) ? ROLE_COLOR[task.role] : '#666';
  const label = roleLabel(task.role);
  const claimedLabel =
    task.claimedBy === null
      ? null
      : `${roleLabel(task.claimedBy)} · ${formatWhen(task.claimedAt)}`;

  const parentTask = task.parentTaskId ? allTasks.find((t) => t.id === task.parentTaskId) : null;
  const parentCode = parentTask ? getTaskCode(parentTask.id, taskCodes, parentTask.role) : '';

  const handleClick = useCallback(() => onSelect(task.id), [onSelect, task.id]);
  const handleParentClick = useCallback(
    (event: React.MouseEvent | React.KeyboardEvent) => {
      event.stopPropagation();
      if (parentTask) onSelect(parentTask.id);
    },
    [parentTask, onSelect],
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'w-full rounded border bg-bg-sunken p-2 text-xs leading-snug text-left transition-colors',
        'hover:border-border-strong hover:bg-bg-raised/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
        task.status === 'blocked-needs-input' && 'border-yellow-400 attention-glow',
        task.status === 'pending-review' && 'border-accent/50',
        task.status !== 'blocked-needs-input' &&
          task.status !== 'pending-review' &&
          'border-border',
        isSelected && 'ring-1 ring-accent border-accent/60 bg-bg-raised/50',
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <TaskCodeBadge code={code} />
        <span className="text-text-muted truncate">{label}</span>
      </div>
      <div className="text-text font-medium">{task.title}</div>
      {task.description && (
        <div className="text-text-faint mt-1 line-clamp-2">{task.description}</div>
      )}
      {parentTask && task.role === 'reviewer' && (
        <div className="mt-2 pt-2 border-t border-border/60">
          <div
            role="button"
            tabIndex={0}
            onClick={handleParentClick}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') handleParentClick(event);
            }}
            className={cn(
              'w-full text-left rounded border border-border bg-bg-raised/40 px-1.5 py-1 transition-colors cursor-pointer',
              'hover:border-border-strong hover:bg-bg-raised/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
            )}
          >
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-0.5">
              Reviewing
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: isRole(parentTask.role) ? ROLE_COLOR[parentTask.role] : '#666' }}
              />
              <TaskCodeBadge code={parentCode} />
              <span className="text-text truncate text-[11px] font-medium">{parentTask.title}</span>
              <span className="ml-auto text-text-muted text-[9px] shrink-0">→</span>
            </div>
          </div>
        </div>
      )}
      <div className="mt-2 pt-2 border-t border-border/60 space-y-0.5 text-text-faint">
        <div>{STATUS_LABEL[task.status]}</div>
        {task.blockedReason && (
          <div className="text-xs bg-yellow-500/20 text-yellow-300 rounded px-1.5 py-0.5 border border-yellow-500/40 font-medium">
            🚨 Escalated
          </div>
        )}
        {claimedLabel && <div className="truncate">Taken by {claimedLabel}</div>}
      </div>
    </button>
  );
}

// strip json code fences and raw top-level json objects so the reviewer's
// prose survives but the structured verdict (already rendered above) does not
// duplicate as raw text.
function stripReviewJson(text: string | null): string | null {
  if (!text) return null;

  let cleaned = text.replace(/```(?:json)?\s*[\s\S]*?```/gi, '').trim();
  cleaned = removeBalancedJsonBlocks(cleaned).trim();

  const reviewKeyPattern = /"(?:verdict|incidents|summary)"\s*:/;
  if (reviewKeyPattern.test(cleaned)) return null;

  return cleaned.length > 0 ? cleaned : null;
}

// remove top-level {...} blocks that look like review JSON. we only peel off
// balanced braces at the outermost level so prose that happens to mention
// {curly} phrases survives untouched.
function removeBalancedJsonBlocks(text: string): string {
  const reviewKeyPattern = /"(?:verdict|incidents|summary)"\s*:/;
  let cursor = 0;
  let output = '';

  while (cursor < text.length) {
    const openIdx = text.indexOf('{', cursor);
    if (openIdx === -1) {
      output += text.slice(cursor);
      break;
    }
    output += text.slice(cursor, openIdx);

    let depth = 0;
    let closeIdx = -1;
    for (let i = openIdx; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }

    if (closeIdx === -1) {
      output += text.slice(openIdx);
      break;
    }

    const block = text.slice(openIdx, closeIdx + 1);
    if (!reviewKeyPattern.test(block)) {
      output += block;
    }
    cursor = closeIdx + 1;
  }

  return output;
}

function extractBulletPoints(text: string | null): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  return lines
    .filter(
      (line) =>
        line.trim().match(/^[-•*]\s+/) || // bullet points: -, •, *
        line.trim().match(/^\d+\.\s+/), // numbered list: 1. 2. etc
    )
    .map((line) => line.trim().replace(/^[-•*]\s+/, '').replace(/^\d+\.\s+/, ''));
}

function ReviewerTaskDetails({
  task,
  allTasks,
}: {
  task: KanbanTask;
  allTasks: KanbanTask[];
}) {
  const trail = useMemo(() => buildReviewTrail(task, allTasks), [task, allTasks]);
  const reviewerStops = trail.filter((entry) => entry.role === 'reviewer');
  const latestReview = reviewerStops.length > 0 ? reviewerStops[reviewerStops.length - 1] : task;
  const review = extractReview(latestReview);

  if (!review) {
    return (
      <section className="rounded border border-border/50 bg-bg-sunken/50 p-3 mb-4">
        <div className="text-text-faint text-xs italic">Review in progress, waiting for results…</div>
      </section>
    );
  }

  const bulletPoints = extractBulletPoints(review.summary);

  const verdictBgColor =
    review.verdict === 'approved'
      ? 'bg-emerald-500/15 border-emerald-500/40'
      : review.verdict === 'changes-requested'
        ? 'bg-yellow-500/15 border-yellow-500/40'
        : 'bg-gray-500/15 border-gray-500/40';

  const verdictTextColor =
    review.verdict === 'approved'
      ? 'text-emerald-300'
      : review.verdict === 'changes-requested'
        ? 'text-yellow-200'
        : 'text-text-muted';

  const verdictLabel =
    review.verdict === 'approved'
      ? '✓ APPROVED'
      : review.verdict === 'changes-requested'
        ? '⚠ CHANGES REQUESTED'
        : 'UNKNOWN';

  return (
    <section className={cn('rounded-lg border-2 p-4 mb-4 space-y-3', verdictBgColor)}>
      <div className="space-y-3">
        <div className={cn('text-lg font-bold tracking-wide', verdictTextColor)}>
          {verdictLabel}
        </div>

        {(review.incidents.length > 0 || bulletPoints.length > 0) && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              ⚠️ Issues & Concerns to Address
              {review.incidents.length > 0 && ` (${review.incidents.length})`}
            </div>
            {review.incidents.length > 0 ? (
              <ul className="space-y-2">
                {review.incidents.map((incident, index) => (
                  <li
                    key={index}
                    className={cn(
                      'text-xs leading-snug rounded border-l-3 border-current pl-2.5 py-2',
                      incident.severity === 'error'
                        ? 'border-red-400/60 bg-red-400/10'
                        : incident.severity === 'warn'
                          ? 'border-yellow-400/60 bg-yellow-400/10'
                          : 'border-blue-400/60 bg-blue-400/10',
                    )}
                  >
                    <div className="flex items-start gap-1.5">
                      <ReviewIncidentSeverity severity={incident.severity} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-text">{incident.title ?? '(untitled)'}</div>
                        {incident.description && (
                          <div className="text-text-faint mt-1 text-xs leading-relaxed whitespace-pre-wrap">
                            {incident.description}
                          </div>
                        )}
                        {incident.role && (
                          <div className="text-text-muted text-[9px] mt-1.5 font-medium">
                            → Assign to: {roleLabel(incident.role)}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="space-y-1.5">
                {bulletPoints.map((point, index) => (
                  <li
                    key={index}
                    className="text-xs leading-relaxed text-text flex items-start gap-2 border-l-2 border-current border-opacity-30 pl-2 py-1"
                  >
                    <span className="text-current text-opacity-50 mt-0.5">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {review.summary && (
          <div className="space-y-1.5 pt-2 border-t border-current border-opacity-20">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              {bulletPoints.length > 0 ? '📝 Additional Feedback' : '📝 Reviewer Summary'}
            </div>
            <div className="text-text text-xs leading-relaxed whitespace-pre-wrap bg-black/20 rounded p-2.5 border border-current border-opacity-10">
              {review.summary}
            </div>
          </div>
        )}

        {!!review.findings && (
          <details className="cursor-pointer pt-2 border-t border-current border-opacity-20">
            <summary className="text-xs font-semibold uppercase tracking-wider text-text-muted hover:text-text transition-colors cursor-pointer">
              🔍 Raw Findings (details)
            </summary>
            <pre className="text-text text-[9px] whitespace-pre-wrap font-mono bg-black/40 border border-current border-opacity-20 rounded mt-2 p-2 overflow-auto max-h-40">
              {typeof review.findings === 'string'
                ? review.findings
                : JSON.stringify(review.findings, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </section>
  );
}

function TaskDetailSplit({
  projectId,
  task,
  allTasks,
  taskCodes,
  onClose,
  onSelectTask,
}: {
  projectId: string;
  task: KanbanTask;
  allTasks: KanbanTask[];
  taskCodes: Map<string, string>;
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
}) {
  const color = isRole(task.role) ? ROLE_COLOR[task.role] : '#666';
  const code = getTaskCode(task.id, taskCodes, task.role);

  return (
    <div className="flex flex-col h-full min-h-0 text-left">
      <div className="panel-header shrink-0 border-t-0 border-x-0 rounded-none">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
          <TaskCodeBadge code={code} />
          <span className="truncate text-text font-medium">{task.title}</span>
        </div>
        <button type="button" className="btn shrink-0 text-[10px]" onClick={onClose}>
          Close
        </button>
      </div>

      <PanelGroup direction="horizontal" className="flex-1 min-h-0">
        <Panel defaultSize={55} minSize={30}>
          <TaskDetailPane
            task={task}
            allTasks={allTasks}
            taskCodes={taskCodes}
            onSelectTask={onSelectTask}
          />
        </Panel>
        <PanelResizeHandle className="w-1 hover:bg-accent/50 transition-colors bg-border/40" />
        <Panel defaultSize={45} minSize={25}>
          <TaskChat
            projectId={projectId}
            taskId={task.id}
            taskCode={code}
            taskRole={task.claimedBy ?? task.role}
            taskStatus={task.status}
          />
        </Panel>
      </PanelGroup>
    </div>
  );
}

interface ReviewSummary {
  verdict: 'approved' | 'changes-requested' | 'unknown';
  summary: string | null;
  incidents: ReviewIncidentRow[];
  findings: unknown;
}

interface ReviewIncidentRow {
  severity?: 'error' | 'warn' | 'info';
  title?: string;
  description?: string;
  role?: string;
}

function extractReview(task: KanbanTask): ReviewSummary | null {
  if (task.role !== 'reviewer') return null;
  const review = task.result?.review;
  if (!review || typeof review !== 'object' || Array.isArray(review)) return null;
  const obj = review as {
    verdict?: string;
    summary?: string;
    incidents?: unknown[];
    findings?: unknown;
  };
  const verdict: ReviewSummary['verdict'] =
    obj.verdict === 'approved'
      ? 'approved'
      : obj.verdict === 'changes-requested'
        ? 'changes-requested'
        : 'unknown';
  const incidents: ReviewIncidentRow[] = Array.isArray(obj.incidents)
    ? obj.incidents.map((row) =>
        row && typeof row === 'object' ? (row as ReviewIncidentRow) : {},
      )
    : [];
  return {
    verdict,
    summary: typeof obj.summary === 'string' ? obj.summary : null,
    incidents,
    findings: obj.findings,
  };
}

function buildReviewTrail(root: KanbanTask, allTasks: KanbanTask[]): KanbanTask[] {
  const byId = new Map(allTasks.map((task) => [task.id, task]));
  const ancestors: KanbanTask[] = [];
  const seen = new Set<string>([root.id]);
  let cursor: KanbanTask | undefined = root;
  while (cursor?.parentTaskId && !seen.has(cursor.parentTaskId)) {
    const parent = byId.get(cursor.parentTaskId);
    if (!parent) break;
    seen.add(parent.id);
    ancestors.unshift(parent);
    cursor = parent;
  }

  const anchor = ancestors[0] ?? root;
  const descendants: KanbanTask[] = [];
  const queue: string[] = [anchor.id];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    if (visited.has(parentId)) continue;
    visited.add(parentId);
    for (const candidate of allTasks) {
      if (candidate.parentTaskId === parentId) {
        descendants.push(candidate);
        queue.push(candidate.id);
      }
    }
  }
  descendants.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const chain: KanbanTask[] = [anchor, ...descendants];
  const deduped: KanbanTask[] = [];
  const used = new Set<string>();
  for (const entry of chain) {
    if (used.has(entry.id)) continue;
    used.add(entry.id);
    deduped.push(entry);
  }
  return deduped;
}

function TaskDetailPane({
  task,
  allTasks,
  taskCodes,
  onSelectTask,
}: {
  task: KanbanTask;
  allTasks: KanbanTask[];
  taskCodes: Map<string, string>;
  onSelectTask: (taskId: string) => void;
}) {
  const dependencyEntries = task.dependsOn.map((depId) => {
    const dep = allTasks.find((t) => t.id === depId);
    return {
      id: depId,
      title: dep?.title ?? `Task ${depId.slice(0, 8)}…`,
      code: getTaskCode(depId, taskCodes, dep?.role),
    };
  });

  const trail = useMemo(() => buildReviewTrail(task, allTasks), [task, allTasks]);
  const reviewerStops = trail.filter((entry) => entry.role === 'reviewer');
  const approvedCount = reviewerStops.filter((entry) => {
    const review = extractReview(entry);
    return review?.verdict === 'approved';
  }).length;
  const changesRequestedCount = reviewerStops.filter((entry) => {
    const review = extractReview(entry);
    return review?.verdict === 'changes-requested';
  }).length;
  const pendingReviewerCount = reviewerStops.filter((entry) => entry.status !== 'done').length;

  const reviewerParent = useMemo(() => {
    if (task.role !== 'reviewer' || !task.parentTaskId) return null;
    return allTasks.find((entry) => entry.id === task.parentTaskId) ?? null;
  }, [task, allTasks]);

  const reviewChildren = useMemo(
    () =>
      allTasks
        .filter((entry) => entry.parentTaskId === task.id && entry.role === 'reviewer')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [task.id, allTasks],
  );

  const rawSummary =
    task.result && typeof task.result.summary === 'string' ? task.result.summary : null;

  // reviewer summaries always wrap the structured review (which we already
  // render above). stripping the json fence/object leaves only narrative prose
  // — if nothing remains we hide the section so users never see raw json.
  const summary =
    task.role === 'reviewer' ? stripReviewJson(rawSummary) : rawSummary;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto p-4 text-xs space-y-4">
        {trail.length > 1 && (
          <section className="flex flex-wrap gap-2">
            <ReviewBadge label="Iterations" count={trail.length} tone="accent" />
            <ReviewBadge label="Reviews" count={reviewerStops.length} tone="accent" />
            {approvedCount > 0 && (
              <ReviewBadge label="Approved" count={approvedCount} tone="success" />
            )}
            {changesRequestedCount > 0 && (
              <ReviewBadge label="Changes requested" count={changesRequestedCount} tone="warn" />
            )}
            {pendingReviewerCount > 0 && (
              <ReviewBadge label="Pending review" count={pendingReviewerCount} tone="pending" />
            )}
          </section>
        )}

        <section>
          <h3 className="text-text-muted uppercase tracking-wider text-[10px] mb-1.5">
            Assignment
          </h3>
          <dl className="grid gap-1.5 text-text">
            <div className="flex gap-2">
              <dt className="text-text-faint w-28 shrink-0">Role</dt>
              <dd>{roleLabel(task.role)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-faint w-28 shrink-0">Status</dt>
              <dd>{STATUS_LABEL[task.status]}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-faint w-28 shrink-0">Iteration</dt>
              <dd>#{task.iteration}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-faint w-28 shrink-0">Taken by</dt>
              <dd>
                {task.claimedBy === null
                  ? '—'
                  : `${roleLabel(task.claimedBy)} (${formatWhen(task.claimedAt)})`}
              </dd>
            </div>
            {task.modelTier && (
              <div className="flex gap-2">
                <dt className="text-text-faint w-28 shrink-0">Model Type</dt>
                <dd className="font-mono text-xs text-accent">{task.modelTier}</dd>
              </div>
            )}
            {task.modelName && (
              <div className="flex gap-2">
                <dt className="text-text-faint w-28 shrink-0">Model</dt>
                <dd className="font-mono text-xs text-text-muted break-all">{task.modelName}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="text-text-faint w-28 shrink-0">Created</dt>
              <dd>{formatWhen(task.createdAt)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-faint w-28 shrink-0">Updated</dt>
              <dd>{formatWhen(task.updatedAt)}</dd>
            </div>
          </dl>
        </section>

        {task.role === 'reviewer' && <ReviewerTaskDetails task={task} allTasks={allTasks} />}

        {task.description && (
          <section>
            <h3 className="text-text-muted uppercase tracking-wider text-[10px] mb-1.5">
              Description
            </h3>
            <p className="text-text whitespace-pre-wrap">{task.description}</p>
          </section>
        )}

        {task.blockedReason && (
          <section>
            <h3 className="text-text-muted uppercase tracking-wider text-[10px] mb-1.5">
              Blocked
            </h3>
            <p className="text-yellow-200/90 whitespace-pre-wrap">{task.blockedReason}</p>
          </section>
        )}

        {task.status === 'failed' && <FailedTaskActions task={task} />}
        {task.status === 'done' && <DoneTaskActions task={task} />}

        {dependencyEntries.length > 0 && (
          <section>
            <h3 className="text-text-muted uppercase tracking-wider text-[10px] mb-1.5">
              Depends on
            </h3>
            <ul className="space-y-1">
              {dependencyEntries.map((dep) => (
                <li key={dep.id} className="flex items-center gap-1.5 text-text">
                  <TaskCodeBadge code={dep.code} />
                  <span className="truncate">{dep.title}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {reviewChildren.length > 0 && (
          <ReviewResultSnippets
            reviews={reviewChildren}
            taskCodes={taskCodes}
            onSelectTask={onSelectTask}
          />
        )}

        {trail.length > 1 && (
          <ReviewTrail
            trail={trail}
            activeTaskId={task.id}
            taskCodes={taskCodes}
            onSelectTask={onSelectTask}
          />
        )}

        {summary && (
          <section>
            <h3 className="text-text-muted uppercase tracking-wider text-[10px] mb-1.5">
              {task.role === 'reviewer' ? 'Reviewer narrative' : 'Result summary'}
            </h3>
            {task.role === 'reviewer' ? (
              <div className="text-text whitespace-pre-wrap text-xs leading-relaxed bg-bg-sunken border border-border rounded p-2.5">
                {summary}
              </div>
            ) : (
              <pre className="text-text whitespace-pre-wrap font-mono text-[11px] bg-bg-sunken border border-border rounded p-2">
                {summary}
              </pre>
            )}
          </section>
        )}
      </div>

      {reviewerParent && (
        <ReviewingAssociation
          parent={reviewerParent}
          code={getTaskCode(reviewerParent.id, taskCodes, reviewerParent.role)}
          onSelectTask={onSelectTask}
        />
      )}
    </div>
  );
}

function ReviewTrail({
  trail,
  activeTaskId,
  taskCodes,
  onSelectTask,
}: {
  trail: KanbanTask[];
  activeTaskId: string;
  taskCodes: Map<string, string>;
  onSelectTask: (taskId: string) => void;
}) {
  return (
    <section>
      <h3 className="text-text-muted uppercase tracking-wider text-[10px] mb-1.5">
        Review trail
      </h3>
      <p className="text-text-faint mb-2">
        Full self-healing history: original work → reviewer pass → fix iterations. Click any step to
        open it.
      </p>
      <ol className="space-y-2">
        {trail.map((entry, index) => (
          <ReviewTrailStep
            key={entry.id}
            entry={entry}
            index={index}
            code={getTaskCode(entry.id, taskCodes, entry.role)}
            isActive={entry.id === activeTaskId}
            onSelectTask={onSelectTask}
          />
        ))}
      </ol>
    </section>
  );
}

function ReviewTrailStep({
  entry,
  index,
  code,
  isActive,
  onSelectTask,
}: {
  entry: KanbanTask;
  index: number;
  code: string;
  isActive: boolean;
  onSelectTask: (taskId: string) => void;
}) {
  const color = isRole(entry.role) ? ROLE_COLOR[entry.role] : '#666';
  const review = extractReview(entry);
  const stepLabel = describeStep(entry, index);

  const handleClick = useCallback(() => onSelectTask(entry.id), [entry.id, onSelectTask]);

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'w-full text-left rounded border p-2 bg-bg-sunken space-y-1 transition-colors',
          'hover:border-border-strong hover:bg-bg-raised/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
          isActive ? 'ring-1 ring-accent border-accent/60 bg-bg-raised/60' : 'border-border',
        )}
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
          <TaskCodeBadge code={code} />
          <span className="text-text-faint uppercase tracking-wider text-[9px]">
            {stepLabel}
          </span>
          <span className="text-text-faint text-[10px]">iter #{entry.iteration}</span>
          <span className="text-text-faint text-[10px]">· {STATUS_LABEL[entry.status]}</span>
          {review && <ReviewVerdictPill verdict={review.verdict} />}
          {review && review.incidents.length > 0 && (
            <span className="text-[10px] font-mono text-yellow-200">
              {review.incidents.length} incident{review.incidents.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="text-text font-medium">{entry.title}</div>
        {review?.summary && (
          <div className="text-text-faint">{review.summary}</div>
        )}
        {review && review.incidents.length > 0 && (
          <ul className="mt-1 space-y-1">
            {review.incidents.slice(0, 3).map((incident, i) => (
              <li key={i} className="text-[10px] leading-snug">
                <ReviewIncidentSeverity severity={incident.severity} />
                <span className="text-text">{incident.title ?? '(untitled)'}</span>
                {incident.role && (
                  <span className="text-text-faint"> → {roleLabel(incident.role)}</span>
                )}
                {incident.description && (
                  <div className="text-text-faint pl-3">{incident.description}</div>
                )}
              </li>
            ))}
            {review.incidents.length > 3 && (
              <li className="text-[10px] text-text-faint">
                +{review.incidents.length - 3} more — click to open full review
              </li>
            )}
          </ul>
        )}
        {!review && entry.role === 'reviewer' && entry.status === 'todo' && (
          <div className="text-[10px] text-text-faint italic">waiting to start…</div>
        )}
      </button>
    </li>
  );
}

function describeStep(entry: KanbanTask, index: number): string {
  if (index === 0) return 'original';
  if (entry.role === 'reviewer') return 'review';
  if (entry.title.toLowerCase().startsWith('fix #')) return 'fix';
  if (entry.title.toLowerCase().startsWith('[bug]')) return 'bug fix';
  return 'follow-up';
}

function ReviewVerdictPill({ verdict }: { verdict: ReviewSummary['verdict'] }) {
  if (verdict === 'unknown') return null;
  const tone =
    verdict === 'approved'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
      : 'bg-yellow-500/15 text-yellow-200 border-yellow-500/40';
  const label = verdict === 'approved' ? 'approved' : 'changes requested';
  return (
    <span className={cn('border rounded px-1 text-[9px] uppercase tracking-wider', tone)}>
      {label}
    </span>
  );
}

function ReviewIncidentSeverity({ severity }: { severity?: 'error' | 'warn' | 'info' }) {
  if (!severity) return null;
  const tone =
    severity === 'error'
      ? 'text-red-300'
      : severity === 'warn'
        ? 'text-yellow-200'
        : 'text-text-faint';
  return (
    <span className={cn('uppercase text-[9px] font-mono mr-1', tone)}>
      [{severity}]
    </span>
  );
}

interface ReviewBadgeProps {
  label: string;
  count: number;
  tone: 'accent' | 'warn' | 'success' | 'pending';
}

function ReviewBadge({ label, count, tone }: ReviewBadgeProps) {
  const toneClass =
    tone === 'warn'
      ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200'
      : tone === 'success'
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
        : tone === 'pending'
          ? 'border-border bg-bg-sunken text-text-muted'
          : 'border-accent/40 bg-accent-soft text-accent';
  return (
    <div className={cn('rounded border px-2 py-1 text-[10px]', toneClass)}>
      <span className="uppercase tracking-wider">{label}</span>
      <span className="ml-2 font-mono">{count}</span>
    </div>
  );
}

function DoneTaskActions({ task }: { task: KanbanTask }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleRedo = useCallback(async () => {
    setPending(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch(`/api/tasks/${task.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'redo' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        const message =
          body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
        throw new Error(message);
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'redo failed');
    } finally {
      setPending(false);
    }
  }, [task.id]);

  return (
    <section className="rounded border border-border bg-bg-raised/50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-text-muted uppercase tracking-wider text-[10px] font-semibold">
          Task actions
        </h3>
        {done && !pending && !error && (
          <span className="text-emerald-300 text-[10px]">Requeued.</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={handleRedo}
          className="border border-accent/50 text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed rounded px-3 py-1.5 text-[11px] font-medium transition-colors"
        >
          {pending ? 'Requesting…' : 'Redo'}
        </button>
        <p className="text-text-faint text-[11px] leading-relaxed">
          Reset this task and run it again from scratch.
        </p>
      </div>
      {error && (
        <div className="text-red-300 text-[11px] bg-red-500/10 border border-red-500/40 rounded px-2 py-1">
          {error}
        </div>
      )}
    </section>
  );
}

type FailedTaskAction = 'retry' | 'regenerate' | 'skip';

interface FailedTaskActionDescriptor {
  id: FailedTaskAction;
  label: string;
  caption: string;
  tone: 'primary' | 'neutral' | 'danger';
}

const FAILED_TASK_ACTIONS: FailedTaskActionDescriptor[] = [
  {
    id: 'retry',
    label: 'Retry',
    caption: 'Extend the review budget by 10 and requeue as todo. Good for rate-limit / flaky failures.',
    tone: 'primary',
  },
  {
    id: 'regenerate',
    label: 'Regenerate',
    caption: 'Send the ticket back to the PM to re-plan using the failure history.',
    tone: 'neutral',
  },
  {
    id: 'skip',
    label: 'Skip',
    caption: 'Unblock dependents as if this chain had succeeded. No further work is attempted.',
    tone: 'danger',
  },
];

function FailedTaskActions({ task }: { task: KanbanTask }) {
  const [pendingAction, setPendingAction] = useState<FailedTaskAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<FailedTaskAction | null>(null);

  const handleAction = useCallback(
    async (action: FailedTaskAction) => {
      setPendingAction(action);
      setError(null);
      try {
        const res = await fetch(`/api/tasks/${task.id}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
          const message =
            body && typeof body.error === 'string'
              ? body.error
              : `Request failed (${res.status})`;
          throw new Error(message);
        }
        setLastAction(action);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'action failed');
      } finally {
        setPendingAction(null);
      }
    },
    [task.id],
  );

  return (
    <section className="rounded border border-red-500/40 bg-red-500/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-red-300 uppercase tracking-wider text-[10px] font-semibold">
          Recovery actions
        </h3>
        {lastAction && !pendingAction && !error && (
          <span className="text-emerald-300 text-[10px]">
            {lastAction === 'retry' && 'Requeued.'}
            {lastAction === 'regenerate' && 'Regeneration queued.'}
            {lastAction === 'skip' && 'Marked skipped.'}
          </span>
        )}
      </div>
      <p className="text-text-faint text-[11px] leading-relaxed">
        This task failed. Pick how to recover — dependents stay blocked until you do.
      </p>
      <div className="grid gap-2">
        {FAILED_TASK_ACTIONS.map((descriptor) => (
          <FailedTaskActionRow
            key={descriptor.id}
            descriptor={descriptor}
            pendingAction={pendingAction}
            onClick={handleAction}
          />
        ))}
      </div>
      {error && (
        <div className="text-red-300 text-[11px] bg-red-500/10 border border-red-500/40 rounded px-2 py-1">
          {error}
        </div>
      )}
    </section>
  );
}

function FailedTaskActionRow({
  descriptor,
  pendingAction,
  onClick,
}: {
  descriptor: FailedTaskActionDescriptor;
  pendingAction: FailedTaskAction | null;
  onClick: (action: FailedTaskAction) => void;
}) {
  const isPending = pendingAction === descriptor.id;
  const isDisabled = pendingAction !== null;

  const toneClass =
    descriptor.tone === 'primary'
      ? 'border-accent/50 text-accent hover:bg-accent/10'
      : descriptor.tone === 'danger'
        ? 'border-red-500/50 text-red-300 hover:bg-red-500/10'
        : 'border-border text-text hover:bg-bg-raised';

  const handleClick = useCallback(() => onClick(descriptor.id), [onClick, descriptor.id]);

  return (
    <div className="flex items-start gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        className={cn(
          'shrink-0 min-w-[92px] rounded border px-2.5 py-1.5 text-xs font-medium transition-colors',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          toneClass,
        )}
      >
        {isPending ? 'Working…' : descriptor.label}
      </button>
      <p className="text-text-faint text-[11px] leading-snug pt-1">{descriptor.caption}</p>
    </div>
  );
}

export function TaskCodeBadge({ code, className }: { code: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border border-border bg-bg-sunken/70 px-1 py-0 font-mono text-[10px] text-text-muted shrink-0',
        className,
      )}
    >
      {code}
    </span>
  );
}

function ReviewingAssociation({
  parent,
  code,
  onSelectTask,
}: {
  parent: KanbanTask;
  code: string;
  onSelectTask: (taskId: string) => void;
}) {
  const color = isRole(parent.role) ? ROLE_COLOR[parent.role] : '#666';
  const handleClick = useCallback(() => onSelectTask(parent.id), [parent.id, onSelectTask]);

  return (
    <div className="shrink-0 border-t border-border bg-bg-sunken/60 px-3 py-2">
      <div className="text-text-faint uppercase tracking-wider text-[9px] mb-1">Reviewing</div>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'w-full text-left rounded border border-border bg-bg-raised px-2 py-1.5 flex items-center gap-2 transition-colors',
          'hover:border-border-strong hover:bg-bg-raised/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
        )}
      >
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <TaskCodeBadge code={code} />
        <span className="truncate text-text text-xs">{parent.title}</span>
        <span className="ml-auto text-text-faint text-[10px] shrink-0">open →</span>
      </button>
    </div>
  );
}

function ReviewResultSnippets({
  reviews,
  taskCodes,
  onSelectTask,
}: {
  reviews: KanbanTask[];
  taskCodes: Map<string, string>;
  onSelectTask: (taskId: string) => void;
}) {
  return (
    <section>
      <h3 className="text-text-muted uppercase tracking-wider text-[10px] mb-1.5">
        Review results
      </h3>
      <ul className="space-y-2">
        {reviews.map((review) => (
          <ReviewResultCard
            key={review.id}
            review={review}
            code={getTaskCode(review.id, taskCodes, review.role)}
            onSelectTask={onSelectTask}
          />
        ))}
      </ul>
    </section>
  );
}

function ReviewResultCard({
  review,
  code,
  onSelectTask,
}: {
  review: KanbanTask;
  code: string;
  onSelectTask: (taskId: string) => void;
}) {
  const color = isRole(review.role) ? ROLE_COLOR[review.role] : '#666';
  const summary = extractReview(review);
  const handleClick = useCallback(() => onSelectTask(review.id), [review.id, onSelectTask]);

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'w-full text-left rounded border border-border bg-bg-sunken px-2 py-2 space-y-1 transition-colors',
          'hover:border-border-strong hover:bg-bg-raised/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
        )}
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="inline-block w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
          <TaskCodeBadge code={code} />
          <span className="text-text-faint text-[10px]">iter #{review.iteration}</span>
          <span className="text-text-faint text-[10px]">· {STATUS_LABEL[review.status]}</span>
          {summary && <ReviewVerdictPill verdict={summary.verdict} />}
          {summary && summary.incidents.length > 0 && (
            <span className="text-[10px] font-mono text-yellow-200">
              {summary.incidents.length} incident{summary.incidents.length === 1 ? '' : 's'}
            </span>
          )}
          <span className="ml-auto text-text-faint text-[10px]">open full review →</span>
        </div>
        {summary?.summary && (
          <div className="text-text-faint text-[11px] line-clamp-3">{summary.summary}</div>
        )}
        {summary && summary.incidents.length > 0 && (
          <ul className="space-y-0.5">
            {summary.incidents.slice(0, 2).map((incident, index) => (
              <li key={index} className="text-[10px] leading-snug">
                <ReviewIncidentSeverity severity={incident.severity} />
                <span className="text-text">{incident.title ?? '(untitled)'}</span>
              </li>
            ))}
            {summary.incidents.length > 2 && (
              <li className="text-[10px] text-text-faint">
                +{summary.incidents.length - 2} more
              </li>
            )}
          </ul>
        )}
        {!summary && review.status === 'todo' && (
          <div className="text-[10px] text-text-faint italic">waiting to start…</div>
        )}
        {!summary && review.status === 'in-progress' && (
          <div className="text-[10px] text-text-faint italic">review in progress…</div>
        )}
      </button>
    </li>
  );
}
