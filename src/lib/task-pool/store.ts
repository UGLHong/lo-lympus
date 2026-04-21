import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { RoleKey } from '@/lib/const/roles';
import type { Phase } from '@/lib/const/phases';
import { emit } from '@/lib/events/bus';
import {
  taskPoolDir,
  taskJsonPath,
  taskPoolIndexPath,
  taskPoolSnapshotPath,
  taskContentPath,
  taskDir,
} from './paths';
import {
  buildTaskSlug,
  describeTaskKind,
  describeTaskSummary,
} from './describe';
import {
  taskSchema,
  type Task,
  type TaskKind,
  type TaskStatus,
} from './schema';

type ProjectState = {
  tasks: Map<string, Task>;
  nextIndex: number;
  hydrated: boolean;
  writeChain: Promise<void>;
};

type Store = Map<string, ProjectState>;

declare global {
  // eslint-disable-next-line no-var
  var __olympus_task_pool__: Store | undefined;
}

function getStore(): Store {
  if (!globalThis.__olympus_task_pool__) {
    globalThis.__olympus_task_pool__ = new Map();
  }
  return globalThis.__olympus_task_pool__;
}

function getProjectState(projectId: string): ProjectState {
  const store = getStore();
  let entry = store.get(projectId);
  if (!entry) {
    entry = {
      tasks: new Map(),
      nextIndex: 1,
      hydrated: false,
      writeChain: Promise.resolve(),
    };
    store.set(projectId, entry);
  }
  if (!entry.hydrated) {
    hydrateFromDiskSync(projectId, entry);
    entry.hydrated = true;
  }
  return entry;
}

// hydration runs synchronously on first access so callers reading the pool
// right after a restart see their prior tasks without racing an async boot
// sequence. The snapshot is small (<10KB typical) so this is fine.
function hydrateFromDiskSync(projectId: string, state: ProjectState): void {
  const snapshotPath = taskPoolSnapshotPath(projectId);
  if (!fs.existsSync(snapshotPath)) return;

  try {
    const raw = fs.readFileSync(snapshotPath, 'utf8');
    const parsed = JSON.parse(raw) as { tasks?: unknown[]; nextIndex?: number };
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    for (const entry of tasks) {
      const task = taskSchema.safeParse(entry);
      if (task.success) state.tasks.set(task.data.id, task.data);
    }
    if (typeof parsed.nextIndex === 'number' && parsed.nextIndex > 0) {
      state.nextIndex = parsed.nextIndex;
    } else {
      state.nextIndex = state.tasks.size + 1;
    }
  } catch {
    // corrupt snapshot is not fatal — the pool starts empty and will be
    // rebuilt from the next mutation. The ndjson log still has history.
  }
}

type EnqueueInput = {
  projectId: string;
  kind: TaskKind;
  role: RoleKey;
  phase: Phase;
  payload?: Record<string, unknown>;
  humanMessage?: string | null;
  dependsOn?: string[];
};

function dedupeKey(kind: TaskKind, payload: Record<string, unknown>): string {
  const payloadKey = Object.keys(payload)
    .sort()
    .map((k) => `${k}=${String(payload[k])}`)
    .join('|');
  return `${kind}::${payloadKey}`;
}

export function createTask(input: EnqueueInput): Task {
  const state = getProjectState(input.projectId);
  const payload = input.payload ?? {};
  const key = dedupeKey(input.kind, payload);

  for (const existing of state.tasks.values()) {
    if (existing.status === 'done' || existing.status === 'failed') continue;
    if (existing.kind !== input.kind) continue;
    if (dedupeKey(existing.kind, existing.payload) === key) return existing;
  }

  const index = state.nextIndex;
  state.nextIndex += 1;
  const slug = buildTaskSlug(index, input.kind);

  const now = Date.now();
  const task: Task = {
    id: nanoid(),
    slug,
    projectId: input.projectId,
    kind: input.kind,
    role: input.role,
    phase: input.phase,
    status: 'pending',
    title: describeTaskKind(input.kind),
    summary: describeTaskSummary(input.kind, payload),
    payload,
    humanMessage: input.humanMessage ?? null,
    dependsOn: input.dependsOn ?? [],
    createdAt: now,
    updatedAt: now,
    claimedAt: null,
    claimedBy: null,
    finishedAt: null,
    failureReason: null,
    pauseReason: null,
  };

  state.tasks.set(task.id, task);
  schedulePersist(input.projectId, state, {
    kind: 'task.created',
    task,
  });

  emit({
    projectId: task.projectId,
    kind: 'task.created',
    taskId: task.id,
    taskSlug: task.slug,
    taskKind: task.kind,
    role: task.role,
    phase: task.phase,
    title: task.title,
    summary: task.summary ?? undefined,
  });

  return task;
}

export type ClaimOptions = {
  acceptedKinds?: readonly TaskKind[] | null;
};

export function claimNextForRole(
  projectId: string,
  role: RoleKey,
  workerId: string,
  options: ClaimOptions = {},
): Task | null {
  const state = getProjectState(projectId);
  const accepted = options.acceptedKinds ?? null;
  const pending = [...state.tasks.values()]
    .filter((task) => task.status === 'pending' && task.role === role)
    .filter((task) => (accepted ? accepted.includes(task.kind) : true))
    .filter((task) => dependenciesSatisfied(state, task))
    .sort((a, b) => a.createdAt - b.createdAt);

  const next = pending[0];
  if (!next) return null;

  const now = Date.now();
  next.status = 'in-progress';
  next.claimedAt = now;
  next.claimedBy = workerId;
  next.updatedAt = now;

  schedulePersist(projectId, state, { kind: 'task.claimed', task: next });
  emit({
    projectId,
    kind: 'task.claimed',
    taskId: next.id,
    taskSlug: next.slug,
    workerId,
    role,
  });

  return next;
}

function dependenciesSatisfied(state: ProjectState, task: Task): boolean {
  if (task.dependsOn.length === 0) return true;
  return task.dependsOn.every((id) => {
    const dep = state.tasks.get(id);
    return dep === undefined || dep.status === 'done';
  });
}

export function completeTask(projectId: string, id: string): Task | null {
  const state = getProjectState(projectId);
  const task = state.tasks.get(id);
  if (!task) return null;

  const now = Date.now();
  task.status = 'done';
  task.finishedAt = now;
  task.updatedAt = now;

  schedulePersist(projectId, state, { kind: 'task.completed', task });
  emit({ projectId, kind: 'task.completed', taskId: task.id, taskSlug: task.slug });
  state.tasks.delete(task.id);
  return task;
}

export function failTask(
  projectId: string,
  id: string,
  reason?: string,
): Task | null {
  const state = getProjectState(projectId);
  const task = state.tasks.get(id);
  if (!task) return null;

  const now = Date.now();
  task.status = 'failed';
  task.finishedAt = now;
  task.updatedAt = now;
  task.failureReason = reason ?? null;

  schedulePersist(projectId, state, { kind: 'task.failed', task });
  emit({
    projectId,
    kind: 'task.failed',
    taskId: task.id,
    taskSlug: task.slug,
    reason: reason ?? undefined,
  });
  state.tasks.delete(task.id);
  return task;
}

export function pauseTaskAwaitingHuman(
  projectId: string,
  id: string,
  reason?: string,
): Task | null {
  const state = getProjectState(projectId);
  const task = state.tasks.get(id);
  if (!task) return null;

  const now = Date.now();
  task.status = 'paused-awaiting-human';
  task.updatedAt = now;
  task.pauseReason = reason ?? null;

  schedulePersist(projectId, state, { kind: 'task.paused', task });
  emit({
    projectId,
    kind: 'task.paused',
    taskId: task.id,
    taskSlug: task.slug,
    reason: reason ?? undefined,
  });
  return task;
}

export type TaskFilter = {
  phase?: Phase;
  role?: RoleKey;
  kind?: TaskKind;
  statuses?: readonly TaskStatus[];
};

function matchesFilter(task: Task, filter: TaskFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.phase && task.phase !== filter.phase) return false;
  if (filter.role && task.role !== filter.role) return false;
  if (filter.kind && task.kind !== filter.kind) return false;
  if (filter.statuses && !filter.statuses.includes(task.status)) return false;
  return true;
}

export function listTasks(projectId: string, filter?: TaskFilter): Task[] {
  const state = getProjectState(projectId);
  return [...state.tasks.values()].filter((task) => matchesFilter(task, filter));
}

export function countTasks(projectId: string, filter?: TaskFilter): number {
  return listTasks(projectId, filter).length;
}

export function hasLiveTaskWithPayload(
  projectId: string,
  kind: TaskKind,
  payloadKey: string,
  payloadValue: string,
): boolean {
  return listTasks(projectId, { kind, statuses: ['pending', 'in-progress'] }).some(
    (task) => String(task.payload[payloadKey]) === payloadValue,
  );
}

export function dropPendingTasks(
  projectId: string,
  filter: TaskFilter,
): number {
  const state = getProjectState(projectId);
  let dropped = 0;
  for (const task of [...state.tasks.values()]) {
    if (task.status !== 'pending') continue;
    if (!matchesFilter(task, filter)) continue;
    state.tasks.delete(task.id);
    schedulePersist(projectId, state, { kind: 'task.dropped', task });
    emit({ projectId, kind: 'task.dropped', taskId: task.id, taskSlug: task.slug });
    dropped += 1;
  }
  return dropped;
}

export function clearProjectTasks(projectId: string): void {
  const store = getStore();
  const state = store.get(projectId);
  if (state) state.tasks.clear();
  store.delete(projectId);
}

export function listAllTasksForSnapshot(projectId: string): Task[] {
  const state = getProjectState(projectId);
  return [...state.tasks.values()];
}

// -----------------------------------------------------------------------------
// persistence: every mutation appends to index.ndjson and rewrites _open.json.
// Writes are serialized through a per-project chain so a burst of mutations
// does not interleave file writes.
// -----------------------------------------------------------------------------

type PersistAction =
  | { kind: 'task.created'; task: Task }
  | { kind: 'task.claimed'; task: Task }
  | { kind: 'task.completed'; task: Task }
  | { kind: 'task.failed'; task: Task }
  | { kind: 'task.paused'; task: Task }
  | { kind: 'task.dropped'; task: Task };

function schedulePersist(
  projectId: string,
  state: ProjectState,
  action: PersistAction,
): void {
  state.writeChain = state.writeChain
    .catch(() => undefined)
    .then(() => persist(projectId, state, action));
}

async function persist(
  projectId: string,
  state: ProjectState,
  action: PersistAction,
): Promise<void> {
  await fsp.mkdir(taskPoolDir(projectId), { recursive: true });

  const logLine = {
    kind: action.kind,
    ts: new Date().toISOString(),
    task: action.task,
  };
  await fsp.appendFile(
    taskPoolIndexPath(projectId),
    `${JSON.stringify(logLine)}\n`,
    'utf8',
  );

  if (action.kind === 'task.completed' || action.kind === 'task.dropped') {
    await removeTaskFolder(projectId, action.task.slug);
  } else {
    await writeTaskFolder(projectId, action.task);
  }

  await writeSnapshot(projectId, state);
}

async function writeTaskFolder(projectId: string, task: Task): Promise<void> {
  await fsp.mkdir(taskDir(projectId, task.slug), { recursive: true });
  const target = taskJsonPath(projectId, task.slug);
  const tmp = `${target}.${nanoid(6)}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(task, null, 2), 'utf8');
  await fsp.rename(tmp, target);
}

async function removeTaskFolder(projectId: string, slug: string): Promise<void> {
  const dir = taskDir(projectId, slug);
  await fsp.rm(dir, { recursive: true, force: true });
}

async function writeSnapshot(
  projectId: string,
  state: ProjectState,
): Promise<void> {
  const tasks = [...state.tasks.values()];
  const body = {
    projectId,
    updatedAt: Date.now(),
    nextIndex: state.nextIndex,
    tasks,
  };
  const target = taskPoolSnapshotPath(projectId);
  const tmp = `${target}.${nanoid(6)}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(body, null, 2), 'utf8');
  await fsp.rename(tmp, target);
}

// -----------------------------------------------------------------------------
// content helpers: each task folder can host arbitrary markdown files the LLM
// reads/writes by name. These are the glue between the pool row and the
// free-form content agents produce.
// -----------------------------------------------------------------------------

export async function readTaskContent(
  projectId: string,
  taskId: string,
  filename: string,
): Promise<string | null> {
  const state = getProjectState(projectId);
  const task = state.tasks.get(taskId);
  if (!task) return null;
  try {
    return await fsp.readFile(taskContentPath(projectId, task.slug, filename), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeTaskContent(
  projectId: string,
  taskId: string,
  filename: string,
  body: string,
): Promise<void> {
  const state = getProjectState(projectId);
  const task = state.tasks.get(taskId);
  if (!task) return;
  await fsp.mkdir(taskDir(projectId, task.slug), { recursive: true });
  const target = taskContentPath(projectId, task.slug, filename);
  const tmp = `${target}.${nanoid(6)}.tmp`;
  await fsp.writeFile(tmp, body, 'utf8');
  await fsp.rename(tmp, target);
}

export async function listTaskContent(
  projectId: string,
  taskId: string,
): Promise<string[]> {
  const state = getProjectState(projectId);
  const task = state.tasks.get(taskId);
  if (!task) return [];
  const dir = taskDir(projectId, task.slug);
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name !== 'task.json')
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export { type Task, type TaskKind, type TaskStatus } from './schema';
