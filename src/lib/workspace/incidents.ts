import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import matter from 'gray-matter';
import { ROLE_KEYS, type RoleKey } from '@/lib/const/roles';
import {
  incidentClassifications,
  incidentStatusValues,
  incidentsIndexSchema,
  type IncidentClassification,
  type IncidentEntry,
  type IncidentStatus,
  type IncidentsIndex,
} from '@/lib/schemas/incidents';
import { softwareHouseDir } from './paths';

const MAX_HEAL_ATTEMPTS = 3;

const ROLE_KEY_SET = new Set<RoleKey>(ROLE_KEYS);
const CLASSIFICATION_SET = new Set<IncidentClassification>(incidentClassifications);
const STATUS_SET = new Set<IncidentStatus>(incidentStatusValues);

function incidentsDir(projectId: string): string {
  return path.join(softwareHouseDir(projectId), 'incidents');
}

function incidentsIndexPath(projectId: string): string {
  return path.join(incidentsDir(projectId), 'index.json');
}

async function atomicWrite(filePath: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${nanoid(6)}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, filePath);
}

function asRoleKey(value: unknown): RoleKey | null {
  if (typeof value !== 'string') return null;
  return ROLE_KEY_SET.has(value as RoleKey) ? (value as RoleKey) : null;
}

function asClassification(value: unknown): IncidentClassification {
  if (typeof value !== 'string') return 'unknown';
  return CLASSIFICATION_SET.has(value as IncidentClassification)
    ? (value as IncidentClassification)
    : 'unknown';
}

function asStatus(value: unknown): IncidentStatus {
  if (typeof value !== 'string') return 'open';
  return STATUS_SET.has(value as IncidentStatus) ? (value as IncidentStatus) : 'open';
}

async function listIncidentFiles(projectId: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(incidentsDir(projectId));
    return entries
      .filter((name) => /^I-.+\.md$/.test(name))
      .sort();
  } catch {
    return [];
  }
}

type IncidentFrontMatter = Partial<{
  id: string;
  incident: string;
  title: string;
  classification: string;
  dispatch: string;
  dispatch_target: string;
  dispatchRole: string;
  status: string;
  attempts: number;
  ticket: string;
  ticket_code: string;
  ticketCode: string;
  last_attempt_at: string;
  resolution: string;
  resolutionNote: string;
}>;

async function parseIncidentFile(
  projectId: string,
  fileName: string,
): Promise<IncidentEntry | null> {
  const abs = path.join(incidentsDir(projectId), fileName);
  const raw = await fs.readFile(abs, 'utf8');
  const parsed = matter(raw);
  const data = parsed.data as IncidentFrontMatter;

  const codeMatch = fileName.match(/^(I-[A-Za-z0-9-]+)/);
  const id = (typeof data.id === 'string' && data.id) ||
    (typeof data.incident === 'string' && data.incident) ||
    codeMatch?.[1] ||
    fileName.replace(/\.md$/, '');

  const title = extractTitle(parsed.content, id) ?? (typeof data.title === 'string' ? data.title : id);

  const dispatchRaw = data.dispatch ?? data.dispatch_target ?? data.dispatchRole;
  const dispatch = asRoleKey(dispatchRaw);

  const ticketCodeRaw = data.ticket ?? data.ticket_code ?? data.ticketCode;
  const ticketCode = typeof ticketCodeRaw === 'string' && ticketCodeRaw.length > 0 ? ticketCodeRaw : null;

  return {
    id,
    title,
    classification: asClassification(data.classification),
    dispatch,
    status: asStatus(data.status),
    attempts: Number.isFinite(data.attempts) ? Number(data.attempts) : 0,
    ticketCode,
    path: `incidents/${fileName}`,
    lastAttemptAt: typeof data.last_attempt_at === 'string' ? data.last_attempt_at : null,
    resolutionNote:
      (typeof data.resolution === 'string' && data.resolution) ||
      (typeof data.resolutionNote === 'string' && data.resolutionNote) ||
      null,
  };
}

function extractTitle(markdown: string, fallback: string): string | null {
  const match = markdown.match(/^#\s+(.+?)\s*$/m);
  if (!match) return fallback;
  return match[1]!.trim();
}

export async function readIncidentsIndex(projectId: string): Promise<IncidentsIndex | null> {
  try {
    const raw = await fs.readFile(incidentsIndexPath(projectId), 'utf8');
    return incidentsIndexSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeIncidentsIndex(index: IncidentsIndex): Promise<void> {
  const validated = incidentsIndexSchema.parse(index);
  await atomicWrite(
    incidentsIndexPath(validated.projectId),
    JSON.stringify(validated, null, 2),
  );
}

// rebuild incidents/index.json from the incident markdown files on disk,
// preserving attempts/status from the previous index when the file exists.
export async function deriveIncidentsIndex(projectId: string): Promise<IncidentsIndex> {
  const files = await listIncidentFiles(projectId);
  const parsed = await Promise.all(files.map((file) => parseIncidentFile(projectId, file)));
  const fromFiles = parsed.filter((entry): entry is IncidentEntry => entry !== null);

  const previous = await readIncidentsIndex(projectId);
  const previousById = new Map<string, IncidentEntry>();
  for (const entry of previous?.incidents ?? []) previousById.set(entry.id, entry);

  const merged = fromFiles.map((entry) => {
    const prior = previousById.get(entry.id);
    if (!prior) return entry;
    return {
      ...entry,
      status: entry.status === 'resolved' || entry.status === 'escalated'
        ? entry.status
        : prior.status,
      attempts: Math.max(entry.attempts, prior.attempts),
      lastAttemptAt: entry.lastAttemptAt ?? prior.lastAttemptAt,
      resolutionNote: entry.resolutionNote ?? prior.resolutionNote,
    } satisfies IncidentEntry;
  });

  return {
    version: 1,
    projectId,
    incidents: merged,
    updatedAt: new Date().toISOString(),
  };
}

export async function ensureIncidentsIndex(projectId: string): Promise<IncidentsIndex | null> {
  const files = await listIncidentFiles(projectId);
  if (files.length === 0) return readIncidentsIndex(projectId);
  const derived = await deriveIncidentsIndex(projectId);
  await writeIncidentsIndex(derived);
  return derived;
}

type IncidentPatch = Partial<Omit<IncidentEntry, 'id' | 'path'>>;

export async function updateIncidentEntry(
  projectId: string,
  incidentId: string,
  patch: IncidentPatch,
): Promise<IncidentsIndex | null> {
  const index = await readIncidentsIndex(projectId);
  if (!index) return null;

  const target = index.incidents.findIndex((entry) => entry.id === incidentId);
  if (target === -1) return index;

  const existing = index.incidents[target]!;
  const next: IncidentEntry = { ...existing, ...patch };
  const updatedIncidents = [...index.incidents];
  updatedIncidents[target] = next;

  const nextIndex: IncidentsIndex = {
    ...index,
    incidents: updatedIncidents,
    updatedAt: new Date().toISOString(),
  };

  await writeIncidentsIndex(nextIndex);
  return nextIndex;
}

// pick the next incident eligible for a heal attempt: prioritizes in-flight
// fixing incidents over fresh open ones so the 3-attempt budget is walked
// deterministically.
export function pickNextOpenIncident(index: IncidentsIndex): IncidentEntry | null {
  const eligible = index.incidents.filter((entry) => {
    if (entry.status === 'resolved' || entry.status === 'escalated') return false;
    return entry.attempts < MAX_HEAL_ATTEMPTS;
  });

  if (eligible.length === 0) return null;

  const inflight = eligible.find((entry) => entry.status === 'fixing');
  if (inflight) return inflight;

  return eligible.find((entry) => entry.status === 'open') ?? null;
}

export function isDispatchableRole(role: RoleKey | null): role is 'backend-dev' | 'frontend-dev' | 'devops' {
  return role === 'backend-dev' || role === 'frontend-dev' || role === 'devops';
}

export function inferDispatchFromClassification(
  classification: IncidentClassification,
): RoleKey | null {
  switch (classification) {
    case 'frontend':
      return 'frontend-dev';
    case 'backend':
    case 'data':
      return 'backend-dev';
    case 'infra':
      return 'devops';
    case 'spec-gap':
    case 'unknown':
    default:
      return null;
  }
}

export async function readIncidentFile(
  projectId: string,
  relativePath: string,
): Promise<string | null> {
  try {
    return await fs.readFile(path.join(softwareHouseDir(projectId), relativePath), 'utf8');
  } catch {
    return null;
  }
}

export const MAX_HEAL_ATTEMPTS_PER_INCIDENT = MAX_HEAL_ATTEMPTS;
