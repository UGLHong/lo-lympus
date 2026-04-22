import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { projectStateSchema, type ProjectState } from '@/lib/schemas/state';
import { messageSchema, type Message } from '@/lib/schemas/messages';
import { eventSchema, type OlympusEvent } from '@/lib/schemas/events';
import { slugify, shortId } from '@/lib/utils/slug';
import {
  artifactPath,
  eventsPath,
  messagesPath,
  metaPath,
  projectDir,
  softwareHouseDir,
  statePath,
  workspacesRoot,
} from './paths';

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function atomicWrite(filePath: string, data: string) {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${nanoid(6)}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, filePath);
}

async function appendNdjson(filePath: string, obj: unknown) {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${JSON.stringify(obj)}\n`, 'utf8');
}

export type CreateProjectInput = {
  name: string;
  requirement: string;
};

export async function createProject(input: CreateProjectInput): Promise<ProjectState> {
  const id = `${slugify(input.name) || 'project'}-${shortId(6)}`;
  const now = new Date().toISOString();

  const tokensHard = Number(process.env.BUDGET_TOKENS_HARD ?? 5_000_000);
  const wallMinutes = Number(process.env.BUDGET_WALLCLOCK_MINUTES ?? 180);
  const usdHard = Number(process.env.BUDGET_USD_HARD ?? 0);
  const rawAttempts = process.env.BUDGET_IMPLEMENT_ATTEMPTS_PER_TICKET;
  const parsedAttempts = rawAttempts === undefined ? NaN : Number(rawAttempts);
  const implementAttemptsPerTicket =
    Number.isFinite(parsedAttempts) && parsedAttempts > 0
      ? Math.min(64, Math.floor(parsedAttempts))
      : 6;

  const state: ProjectState = {
    projectId: id,
    name: input.name,
    slug: slugify(input.name) || id,
    phase: 'INTAKE',
    paused: false,
    createdAt: now,
    updatedAt: now,
    budgets: {
      tokensUsed: 0,
      tokensHard,
      wallClockMs: 0,
      wallClockCapMs: wallMinutes * 60_000,
      usdUsed: 0,
      usdHard,
    },
    phaseHistory: [{ phase: 'INTAKE', startedAt: now, status: 'running' }],
    clarifications: [],
    assumptions: [],
    limits: { implementAttemptsPerTicket },
  };

  await ensureDir(softwareHouseDir(id));
  await atomicWrite(statePath(id), JSON.stringify(state, null, 2));
  await atomicWrite(
    metaPath(id),
    JSON.stringify({ id, name: input.name, createdAt: now, requirement: input.requirement }, null, 2),
  );
  await atomicWrite(
    artifactPath(id, 'REQUIREMENTS.md'),
    buildInitialRequirements(input.name, input.requirement, now),
  );

  return state;
}

function buildInitialRequirements(name: string, requirement: string, now: string): string {
  return `---
role: orchestrator
phase: INTAKE
timestamp: ${now}
status: draft
---

# ${name} — Requirements (draft)

## Raw requirement

${requirement.trim()}

## Clarifications

_(pending — Orchestrator will ask focused clarification questions before producing SPEC.md)_

## Assumptions

_(unanswered clarifications are captured here as assumptions before advancing.)_
`;
}

export async function listProjects(): Promise<{ id: string; name: string; phase: string; updatedAt: string }[]> {
  const root = workspacesRoot();
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const result: { id: string; name: string; phase: string; updatedAt: string }[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const state = await readState(entry.name).catch(() => null);
      if (!state) continue;
      result.push({
        id: state.projectId,
        name: state.name,
        phase: state.phase,
        updatedAt: state.updatedAt,
      });
    }
    result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return result;
  } catch {
    return [];
  }
}

export async function readState(projectId: string): Promise<ProjectState> {
  const raw = await fs.readFile(statePath(projectId), 'utf8');
  return projectStateSchema.parse(JSON.parse(raw));
}

export async function writeState(state: ProjectState): Promise<void> {
  const next = { ...state, updatedAt: new Date().toISOString() };
  await atomicWrite(statePath(state.projectId), JSON.stringify(next, null, 2));
}

export async function appendMessage(message: Message): Promise<void> {
  await appendNdjson(messagesPath(message.projectId), message);
}

export async function readMessages(projectId: string): Promise<Message[]> {
  try {
    const raw = await fs.readFile(messagesPath(projectId), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    return lines
      .map((line) => {
        try {
          return messageSchema.parse(JSON.parse(line));
        } catch {
          return null;
        }
      })
      .filter((m): m is Message => m !== null);
  } catch {
    return [];
  }
}

export async function updateMessage(projectId: string, messageId: string, update: (m: Message) => Message): Promise<Message | null> {
  const messages = await readMessages(projectId);
  const index = messages.findIndex((m) => m.id === messageId);
  if (index === -1) return null;

  const next = update(messages[index]!);
  messages[index] = next;

  const lines = messages.map((m) => JSON.stringify(m)).join('\n');
  await atomicWrite(messagesPath(projectId), `${lines}\n`);
  return next;
}

export async function appendEvent(event: OlympusEvent): Promise<void> {
  await appendNdjson(eventsPath(event.projectId), event);
}

// full-history reader used by the time-travel replay UI. events.ndjson may grow
// large, so callers should prefer the SSE stream for live data and call this
// only when the user explicitly asks to scrub history.
export async function readEvents(projectId: string): Promise<OlympusEvent[]> {
  try {
    const raw = await fs.readFile(eventsPath(projectId), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    return lines
      .map((line) => {
        try {
          return eventSchema.parse(JSON.parse(line));
        } catch {
          return null;
        }
      })
      .filter((event): event is OlympusEvent => event !== null);
  } catch {
    return [];
  }
}

export async function writeArtifact(projectId: string, relativePath: string, content: string): Promise<void> {
  const full = artifactPath(projectId, relativePath);
  const normalized = normalizeArtifactContent(relativePath, content);
  await atomicWrite(full, normalized);
}

// keep ticket files free of a trailing YAML doc terminator so gray-matter
// sees one fence closer and the body reads cleanly in editors.
function normalizeArtifactContent(relativePath: string, content: string): string {
  const isTicket = /^tickets\/T-[^/]+\.md$/.test(relativePath);
  if (!isTicket) return content;

  let trimmed = content.replace(/\s+$/g, '');
  while (trimmed.endsWith('\n---') || trimmed.endsWith('\n...')) {
    trimmed = trimmed.slice(0, -4).replace(/\s+$/g, '');
  }
  return `${trimmed}\n`;
}

export async function readArtifact(projectId: string, relativePath: string): Promise<string | null> {
  try {
    return await fs.readFile(artifactPath(projectId, relativePath), 'utf8');
  } catch {
    return null;
  }
}

// best-effort delete; missing files are silently ignored so callers can use
// this to clean up transient artifacts (e.g. HELP_NEEDED.md on resume).
export async function deleteArtifact(projectId: string, relativePath: string): Promise<boolean> {
  try {
    await fs.unlink(artifactPath(projectId, relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function deleteProjectWorkspace(projectId: string): Promise<void> {
  await fs.rm(projectDir(projectId), { recursive: true, force: true });
}

export type ArtifactTreeEntry = {
  name: string;
  relativePath: string;
  isDir: boolean;
  children?: ArtifactTreeEntry[];
};

export async function readArtifactTree(projectId: string): Promise<ArtifactTreeEntry[]> {
  const root = softwareHouseDir(projectId);
  return walk(root, '');
}

async function walk(absolute: string, relative: string): Promise<ArtifactTreeEntry[]> {
  let entries;
  try {
    entries = await fs.readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }

  const result: ArtifactTreeEntry[] = [];
  for (const entry of entries) {
    if (entry.name === 'messages.ndjson' || entry.name === 'events.ndjson' || entry.name === 'meta.json') continue;
    const entryAbs = path.join(absolute, entry.name);
    const entryRel = relative ? `${relative}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const children = await walk(entryAbs, entryRel);
      result.push({ name: entry.name, relativePath: entryRel, isDir: true, children });
    } else {
      result.push({ name: entry.name, relativePath: entryRel, isDir: false });
    }
  }

  result.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}

export function syncWorkspaceRootExists(): boolean {
  try {
    fssync.mkdirSync(workspacesRoot(), { recursive: true });
    return true;
  } catch {
    return false;
  }
}

export function getProjectDir(projectId: string): string {
  return projectDir(projectId);
}
