import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import matter from 'gray-matter';
import { ROLE_KEYS, type RoleKey } from '@/lib/const/roles';
import type { TicketBlock } from '@/lib/schemas/content-blocks';
import {
  ticketsIndexSchema,
  type TicketsIndex,
  type TicketsIndexEntry,
  type TicketStatus,
} from '@/lib/schemas/tickets';
import { softwareHouseDir } from './paths';

const ROLE_KEY_SET = new Set<RoleKey>(ROLE_KEYS);

function ticketsDir(projectId: string): string {
  return path.join(softwareHouseDir(projectId), 'tickets');
}

function ticketsIndexPath(projectId: string): string {
  return path.join(ticketsDir(projectId), 'index.json');
}

async function atomicWrite(filePath: string, data: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${nanoid(6)}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, filePath);
}

function asRoleKey(value: unknown): RoleKey | null {
  if (typeof value !== 'string') return null;
  return ROLE_KEY_SET.has(value as RoleKey) ? (value as RoleKey) : null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

async function listTicketFiles(projectId: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(ticketsDir(projectId));
    return entries
      .filter((name) => /^T-\d{4}.*\.md$/.test(name))
      .sort();
  } catch {
    return [];
  }
}

async function parseTicketFile(
  projectId: string,
  fileName: string,
): Promise<TicketsIndexEntry | null> {
  const abs = path.join(ticketsDir(projectId), fileName);
  const raw = await fs.readFile(abs, 'utf8');
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;

  const codeMatch = fileName.match(/^(T-\d{4})/);
  const code = typeof data.ticket === 'string' && data.ticket.length > 0
    ? data.ticket
    : codeMatch?.[1];
  if (!code) return null;

  const title = extractTitle(parsed.content, code);
  const assignee = asRoleKey(data.assignee) ?? asRoleKey(data.role);
  const dependsOn = asStringList(data.depends_on ?? data.dependsOn);

  return {
    code,
    title,
    assigneeRole: assignee,
    dependsOn,
    status: 'todo',
    attempts: 0,
    lastAttemptAt: null,
    branch: null,
    reviewPath: null,
    pendingSourcePaths: null,
    path: `tickets/${fileName}`,
  };
}

function extractTitle(markdown: string, fallbackCode: string): string {
  const match = markdown.match(/^#\s+(.+?)\s*$/m);
  if (!match) return fallbackCode;
  const heading = match[1]!.trim();
  return heading.replace(/^T-\d{4}:\s*/, '');
}

export async function readTicketsIndex(projectId: string): Promise<TicketsIndex | null> {
  try {
    const raw = await fs.readFile(ticketsIndexPath(projectId), 'utf8');
    return ticketsIndexSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeTicketsIndex(index: TicketsIndex): Promise<void> {
  const validated = ticketsIndexSchema.parse(index);
  await atomicWrite(
    ticketsIndexPath(validated.projectId),
    JSON.stringify(validated, null, 2),
  );
}

function buildPlaceholderContent(entry: TicketsIndexEntry): string {
  const dependsOnYaml =
    entry.dependsOn.length > 0
      ? `depends_on:\n${entry.dependsOn.map((dep) => `  - ${dep}`).join('\n')}`
      : 'depends_on: []';

  return [
    '---',
    'role: techlead',
    'phase: PLAN',
    `ticket: ${entry.code}`,
    `assignee: ${entry.assigneeRole ?? 'tbd'}`,
    dependsOnYaml,
    'status: pending-review',
    '---',
    '',
    `# ${entry.code}: ${entry.title}`,
    '',
    '_Full ticket spec pending Tech Lead plan approval._',
  ].join('\n');
}

// write a placeholder .md for each index entry that has no file on disk yet.
// returns relative paths (relative to .software-house/) of newly created files.
export async function writePlaceholderTicketFiles(
  projectId: string,
  index: TicketsIndex,
): Promise<string[]> {
  const created: string[] = [];

  for (const entry of index.tickets) {
    const absPath = path.join(softwareHouseDir(projectId), entry.path);
    try {
      await fs.access(absPath);
    } catch {
      await atomicWrite(absPath, buildPlaceholderContent(entry));
      created.push(entry.path);
    }
  }

  return created;
}

type DeriveOptions = {
  ticketBlocks?: TicketBlock[];
  previous?: TicketsIndex | null;
};

// rebuild tickets/index.json from the ticket markdown files on disk;
// overlay any envelope ticket blocks (for assignee/status hints) and
// preserve run-state (attempts, status, branch) from the previous index.
export async function deriveTicketsIndex(
  projectId: string,
  options: DeriveOptions = {},
): Promise<TicketsIndex> {
  const files = await listTicketFiles(projectId);
  const parsed = await Promise.all(files.map((file) => parseTicketFile(projectId, file)));
  const fromFiles = parsed.filter((entry): entry is TicketsIndexEntry => entry !== null);

  const blocksByCode = new Map<string, TicketBlock>();
  for (const block of options.ticketBlocks ?? []) {
    blocksByCode.set(block.code, block);
  }

  const previousByCode = new Map<string, TicketsIndexEntry>();
  for (const entry of options.previous?.tickets ?? []) {
    previousByCode.set(entry.code, entry);
  }

  const merged = fromFiles.map((entry) => {
    const block = blocksByCode.get(entry.code);
    const prior = previousByCode.get(entry.code);
    return mergeEntry(entry, block, prior);
  });

  for (const [code, block] of blocksByCode) {
    if (merged.some((entry) => entry.code === code)) continue;
    merged.push({
      code,
      title: block.title,
      assigneeRole: block.assigneeRole ?? null,
      dependsOn: block.dependsOn,
      status: normalizeBlockStatus(block.status),
      attempts: 0,
      lastAttemptAt: null,
      branch: null,
      reviewPath: null,
      pendingSourcePaths: null,
      path: `tickets/${code}.md`,
    });
  }

  merged.sort((a, b) => a.code.localeCompare(b.code));

  return {
    version: 1,
    projectId,
    tickets: merged,
    updatedAt: new Date().toISOString(),
  };
}

function mergeEntry(
  base: TicketsIndexEntry,
  block: TicketBlock | undefined,
  prior: TicketsIndexEntry | undefined,
): TicketsIndexEntry {
  const assigneeRole = block?.assigneeRole ?? base.assigneeRole ?? prior?.assigneeRole ?? null;
  const dependsOn = block?.dependsOn?.length ? block.dependsOn : base.dependsOn.length ? base.dependsOn : prior?.dependsOn ?? [];
  const status = prior?.status ?? normalizeBlockStatus(block?.status);

  return {
    code: base.code,
    title: block?.title ?? base.title,
    assigneeRole,
    dependsOn,
    status,
    attempts: prior?.attempts ?? 0,
    lastAttemptAt: prior?.lastAttemptAt ?? null,
    branch: prior?.branch ?? null,
    reviewPath: prior?.reviewPath ?? null,
    pendingSourcePaths: prior?.pendingSourcePaths ?? null,
    path: base.path,
  };
}

function normalizeBlockStatus(status: string | undefined): TicketStatus {
  switch (status) {
    case 'in-progress':
    case 'review':
    case 'changes-requested':
    case 'done':
    case 'blocked':
      return status;
    default:
      return 'todo';
  }
}

export async function ensureTicketsIndex(projectId: string): Promise<TicketsIndex | null> {
  const existing = await readTicketsIndex(projectId);
  if (existing) return existing;

  const files = await listTicketFiles(projectId);
  if (files.length === 0) return null;

  const derived = await deriveTicketsIndex(projectId);
  await writeTicketsIndex(derived);
  return derived;
}

type TicketPatch = Partial<Omit<TicketsIndexEntry, 'code' | 'path'>>;

// atomically mutate a single ticket entry and persist the full index.
// no-op if the ticket is not found; returns the updated index for callers
// that want to observe the result.
export async function updateTicketEntry(
  projectId: string,
  code: string,
  patch: TicketPatch,
): Promise<TicketsIndex | null> {
  const index = await readTicketsIndex(projectId);
  if (!index) return null;

  const target = index.tickets.findIndex((t) => t.code === code);
  if (target === -1) return index;

  const existing = index.tickets[target]!;
  const next: TicketsIndexEntry = { ...existing, ...patch };
  const updatedTickets = [...index.tickets];
  updatedTickets[target] = next;

  const nextIndex: TicketsIndex = {
    ...index,
    tickets: updatedTickets,
    updatedAt: new Date().toISOString(),
  };

  await writeTicketsIndex(nextIndex);
  return nextIndex;
}

// reset every `blocked` ticket back to `changes-requested` with a fresh
// attempts counter so the implement loop picks them up again. Used when the
// operator explicitly resumes a help-needed pause: staying `blocked` would
// make `pickNextReadyForDev` skip them forever along with every downstream
// dependent. Returns the codes that were reset.
export async function resetBlockedTickets(projectId: string): Promise<string[]> {
  const index = await readTicketsIndex(projectId);
  if (!index) return [];

  const resetCodes: string[] = [];
  const nextTickets = index.tickets.map((ticket) => {
    if (ticket.status !== 'blocked') return ticket;
    resetCodes.push(ticket.code);
    return {
      ...ticket,
      status: 'changes-requested' as const,
      attempts: 0,
      lastAttemptAt: null,
      pendingSourcePaths: null,
    };
  });

  if (resetCodes.length === 0) return [];

  await writeTicketsIndex({
    ...index,
    tickets: nextTickets,
    updatedAt: new Date().toISOString(),
  });
  return resetCodes;
}

// `in-progress` blocks starting another dev turn; `review` is handled by
// `pickNextPendingReview`. If a run
// crashes mid-ticket, the DAG stays wedged until we reset these to
// `changes-requested` (same fresh-attempts policy as blocked tickets).
export async function resetStuckInFlightTickets(projectId: string): Promise<string[]> {
  const index = await readTicketsIndex(projectId);
  if (!index) return [];

  const resetCodes: string[] = [];
  const nextTickets = index.tickets.map((ticket) => {
    if (ticket.status !== 'in-progress' && ticket.status !== 'review') return ticket;
    resetCodes.push(ticket.code);
    return {
      ...ticket,
      status: 'changes-requested' as const,
      attempts: 0,
      lastAttemptAt: null,
      pendingSourcePaths: null,
    };
  });

  if (resetCodes.length === 0) return [];

  await writeTicketsIndex({
    ...index,
    tickets: nextTickets,
    updatedAt: new Date().toISOString(),
  });
  return resetCodes;
}

const doneCodeSet = (index: TicketsIndex) =>
  new Set(index.tickets.filter((t) => t.status === 'done').map((t) => t.code));

function depsSatisfied(ticket: TicketsIndexEntry, doneCodes: Set<string>): boolean {
  return ticket.dependsOn.every((dep) => doneCodes.has(dep));
}

/** Oldest review queue item (stable ticket code order). */
export function pickNextPendingReview(index: TicketsIndex): TicketsIndexEntry | null {
  const pending = index.tickets.filter((t) => t.status === 'review');
  if (pending.length === 0) return null;
  return pending.slice().sort((a, b) => a.code.localeCompare(b.code))[0] ?? null;
}

/**
 * All tickets that can receive a developer turn: `todo` or `changes-requested`,
 * dependencies satisfied. Sorted: `changes-requested` first, then by code.
 */
export function pickAllReadyForDev(index: TicketsIndex): TicketsIndexEntry[] {
  const doneCodes = doneCodeSet(index);

  return index.tickets
    .filter((ticket) => {
      if (ticket.status !== 'todo' && ticket.status !== 'changes-requested') return false;
      return depsSatisfied(ticket, doneCodes);
    })
    .sort((a, b) => {
      if (a.status === 'changes-requested' && b.status !== 'changes-requested') return -1;
      if (a.status !== 'changes-requested' && b.status === 'changes-requested') return 1;
      return a.code.localeCompare(b.code);
    });
}

/**
 * Next ticket that can receive a developer turn: `todo` or `changes-requested`,
 * dependencies satisfied. Other tickets may be `in-progress`, `review`, etc. —
 * multiple dev turns can overlap across tickets (subject to orchestrator
 * concurrency and budgets).
 */
export function pickNextReadyForDev(index: TicketsIndex): TicketsIndexEntry | null {
  const doneCodes = doneCodeSet(index);

  const eligible = index.tickets.filter((ticket) => {
    if (ticket.status !== 'todo' && ticket.status !== 'changes-requested')
      return false;
    return depsSatisfied(ticket, doneCodes);
  });

  if (eligible.length === 0) return null;

  const changesRequested = eligible.find((t) => t.status === 'changes-requested');
  if (changesRequested) return changesRequested;

  return eligible.slice().sort((a, b) => a.code.localeCompare(b.code))[0] ?? null;
}

export function hasPendingImplementWork(index: TicketsIndex): boolean {
  return pickNextPendingReview(index) !== null || pickNextReadyForDev(index) !== null;
}

/** @deprecated Use pickNextReadyForDev — kept for older call sites/tests name. */
export function pickNextReadyTicket(index: TicketsIndex): TicketsIndexEntry | null {
  return pickNextReadyForDev(index);
}
