import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveIncidentsIndex,
  ensureIncidentsIndex,
  inferDispatchFromClassification,
  isDispatchableRole,
  pickNextOpenIncident,
  readIncidentsIndex,
  updateIncidentEntry,
  writeIncidentsIndex,
} from './incidents';
import { createProject } from './fs';
import { softwareHouseDir } from './paths';
import type { IncidentsIndex } from '@/lib/schemas/incidents';

async function seedIncident(projectId: string, fileName: string, body: string): Promise<void> {
  const dir = path.join(softwareHouseDir(projectId), 'incidents');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), body, 'utf8');
}

describe('incidents workspace helpers', () => {
  let tmpRoot: string;
  const originalEnv = process.env.OLYMPUS_WORKSPACES_DIR;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'olympus-incidents-'));
    process.env.OLYMPUS_WORKSPACES_DIR = tmpRoot;
    process.env.BUDGET_TOKENS_HARD = '10000';
    process.env.BUDGET_WALLCLOCK_MINUTES = '120';
  });

  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.OLYMPUS_WORKSPACES_DIR;
    else process.env.OLYMPUS_WORKSPACES_DIR = originalEnv;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('deriveIncidentsIndex parses front-matter into IncidentEntry objects', async () => {
    const project = await createProject({ name: 'incidents-derive', requirement: 'hello' });
    await seedIncident(
      project.projectId,
      'I-2026-01-01-broken-login.md',
      [
        '---',
        'role: incident',
        'phase: SELF_HEAL',
        'id: I-2026-01-01-broken-login',
        'title: Login is broken',
        'classification: backend',
        'dispatch: backend-dev',
        'status: open',
        'attempts: 0',
        'ticket: T-0003',
        '---',
        '',
        '# Login is broken',
        '',
        '## Reproduction',
        'Steps…',
      ].join('\n'),
    );

    const derived = await deriveIncidentsIndex(project.projectId);
    expect(derived.incidents).toHaveLength(1);

    const entry = derived.incidents[0]!;
    expect(entry.id).toBe('I-2026-01-01-broken-login');
    expect(entry.title).toBe('Login is broken');
    expect(entry.classification).toBe('backend');
    expect(entry.dispatch).toBe('backend-dev');
    expect(entry.status).toBe('open');
    expect(entry.attempts).toBe(0);
    expect(entry.ticketCode).toBe('T-0003');
    expect(entry.path).toBe('incidents/I-2026-01-01-broken-login.md');
    expect(entry.resolutionNote).toBeNull();
  });

  it('falls back to filename when front-matter is minimal', async () => {
    const project = await createProject({ name: 'incidents-min', requirement: 'hello' });
    await seedIncident(project.projectId, 'I-raw-crash.md', '# Raw crash\n\nno front matter\n');

    const derived = await deriveIncidentsIndex(project.projectId);
    const entry = derived.incidents[0]!;
    expect(entry.id).toBe('I-raw-crash');
    expect(entry.title).toBe('Raw crash');
    expect(entry.classification).toBe('unknown');
    expect(entry.dispatch).toBeNull();
  });

  it('updateIncidentEntry flips status and records a resolution note', async () => {
    const project = await createProject({ name: 'incidents-update', requirement: 'hello' });
    await seedIncident(
      project.projectId,
      'I-x-flaky.md',
      [
        '---',
        'id: I-x-flaky',
        'classification: frontend',
        'dispatch: frontend-dev',
        'status: open',
        'attempts: 0',
        '---',
        '',
        '# Flaky UI',
      ].join('\n'),
    );

    await ensureIncidentsIndex(project.projectId);

    const updated = await updateIncidentEntry(project.projectId, 'I-x-flaky', {
      status: 'resolved',
      attempts: 2,
      resolutionNote: 'null-check guard added in LoginForm',
      lastAttemptAt: '2026-02-01T10:00:00.000Z',
    });
    expect(updated).not.toBeNull();
    const entry = updated!.incidents.find((i) => i.id === 'I-x-flaky')!;
    expect(entry.status).toBe('resolved');
    expect(entry.attempts).toBe(2);
    expect(entry.resolutionNote).toBe('null-check guard added in LoginForm');
    expect(entry.lastAttemptAt).toBe('2026-02-01T10:00:00.000Z');

    const reread = await readIncidentsIndex(project.projectId);
    expect(reread?.incidents.find((i) => i.id === 'I-x-flaky')?.status).toBe('resolved');
  });

  it('deriveIncidentsIndex preserves prior attempts and keeps terminal statuses', async () => {
    const project = await createProject({ name: 'incidents-preserve', requirement: 'hello' });
    await seedIncident(
      project.projectId,
      'I-reopen.md',
      '---\nid: I-reopen\nstatus: open\nattempts: 0\nclassification: backend\n---\n# Reopen\n',
    );

    const first = await deriveIncidentsIndex(project.projectId);
    await writeIncidentsIndex({
      ...first,
      incidents: first.incidents.map((entry) =>
        entry.id === 'I-reopen' ? { ...entry, status: 'resolved', attempts: 2 } : entry,
      ),
    } satisfies IncidentsIndex);

    const second = await deriveIncidentsIndex(project.projectId);
    const entry = second.incidents.find((e) => e.id === 'I-reopen')!;
    expect(entry.attempts).toBe(2);
    expect(entry.status).toBe('resolved');
  });

  it('pickNextOpenIncident prefers in-flight "fixing" incidents over fresh "open" ones', () => {
    const index: IncidentsIndex = {
      version: 1,
      projectId: 'test',
      updatedAt: '2026-01-01T00:00:00.000Z',
      incidents: [
        {
          id: 'I-open',
          title: 'open',
          classification: 'backend',
          dispatch: 'backend-dev',
          status: 'open',
          attempts: 0,
          ticketCode: null,
          path: 'incidents/I-open.md',
          lastAttemptAt: null,
          resolutionNote: null,
        },
        {
          id: 'I-fixing',
          title: 'fixing',
          classification: 'backend',
          dispatch: 'backend-dev',
          status: 'fixing',
          attempts: 1,
          ticketCode: null,
          path: 'incidents/I-fixing.md',
          lastAttemptAt: null,
          resolutionNote: null,
        },
      ],
    };

    expect(pickNextOpenIncident(index)?.id).toBe('I-fixing');
  });

  it('pickNextOpenIncident returns null once every eligible incident exhausts the attempt budget', () => {
    const index: IncidentsIndex = {
      version: 1,
      projectId: 'test',
      updatedAt: '2026-01-01T00:00:00.000Z',
      incidents: [
        {
          id: 'I-maxed',
          title: 'maxed out',
          classification: 'backend',
          dispatch: 'backend-dev',
          status: 'open',
          attempts: 3,
          ticketCode: null,
          path: 'incidents/I-maxed.md',
          lastAttemptAt: null,
          resolutionNote: null,
        },
      ],
    };

    expect(pickNextOpenIncident(index)).toBeNull();
  });

  it('inferDispatchFromClassification maps each class to a dev role (or null)', () => {
    expect(inferDispatchFromClassification('frontend')).toBe('frontend-dev');
    expect(inferDispatchFromClassification('backend')).toBe('backend-dev');
    expect(inferDispatchFromClassification('data')).toBe('backend-dev');
    expect(inferDispatchFromClassification('infra')).toBe('devops');
    expect(inferDispatchFromClassification('spec-gap')).toBeNull();
    expect(inferDispatchFromClassification('unknown')).toBeNull();
  });

  it('isDispatchableRole narrows to the dev-trio', () => {
    expect(isDispatchableRole('backend-dev')).toBe(true);
    expect(isDispatchableRole('frontend-dev')).toBe(true);
    expect(isDispatchableRole('devops')).toBe(true);
    expect(isDispatchableRole('qa')).toBe(false);
    expect(isDispatchableRole('security')).toBe(false);
    expect(isDispatchableRole(null)).toBe(false);
  });
});
