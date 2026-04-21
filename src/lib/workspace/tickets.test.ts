import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveTicketsIndex,
  pickNextReadyTicket,
  readTicketsIndex,
  resetStuckInFlightTickets,
  updateTicketEntry,
  writeTicketsIndex,
} from './tickets';
import { createProject } from './fs';
import { softwareHouseDir } from './paths';
import type { TicketsIndex, TicketsIndexEntry, TicketStatus } from '@/lib/schemas/tickets';

async function seedTicketFile(projectId: string, fileName: string, body: string): Promise<void> {
  const dir = path.join(softwareHouseDir(projectId), 'tickets');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), body, 'utf8');
}

function entry(
  code: string,
  overrides: Partial<TicketsIndexEntry> & { status?: TicketStatus } = {},
): TicketsIndexEntry {
  return {
    code,
    title: overrides.title ?? code,
    assigneeRole: overrides.assigneeRole ?? 'backend-dev',
    dependsOn: overrides.dependsOn ?? [],
    status: overrides.status ?? 'todo',
    attempts: overrides.attempts ?? 0,
    lastAttemptAt: overrides.lastAttemptAt ?? null,
    branch: overrides.branch ?? null,
    reviewPath: overrides.reviewPath ?? null,
    pendingSourcePaths: overrides.pendingSourcePaths ?? null,
    path: overrides.path ?? `tickets/${code}.md`,
  };
}

describe('tickets workspace helpers', () => {
  let tmpRoot: string;
  const originalEnv = process.env.OLYMPUS_WORKSPACES_DIR;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'olympus-tickets-'));
    process.env.OLYMPUS_WORKSPACES_DIR = tmpRoot;
    process.env.BUDGET_TOKENS_HARD = '10000';
    process.env.BUDGET_WALLCLOCK_MINUTES = '120';
  });

  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.OLYMPUS_WORKSPACES_DIR;
    else process.env.OLYMPUS_WORKSPACES_DIR = originalEnv;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('deriveTicketsIndex parses ticket files and respects envelope hints', async () => {
    const project = await createProject({ name: 'tickets-basic', requirement: 'hello' });
    await seedTicketFile(
      project.projectId,
      'T-0001-bootstrap.md',
      [
        '---',
        'role: techlead',
        'phase: PLAN',
        'ticket: T-0001',
        'assignee: backend-dev',
        'depends_on: []',
        '---',
        '',
        '# T-0001: Bootstrap the server',
        '',
        'Set up the node server.',
      ].join('\n'),
    );
    await seedTicketFile(
      project.projectId,
      'T-0002-ui.md',
      [
        '---',
        'ticket: T-0002',
        'assignee: frontend-dev',
        'depends_on: [T-0001]',
        '---',
        '',
        '# Build the UI shell',
      ].join('\n'),
    );

    const derived = await deriveTicketsIndex(project.projectId, {
      ticketBlocks: [
        {
          kind: 'ticket',
          code: 'T-0001',
          title: 'Bootstrap the server',
          assigneeRole: 'backend-dev',
          dependsOn: [],
          status: 'todo',
        },
        {
          kind: 'ticket',
          code: 'T-0002',
          title: 'Build the UI shell',
          assigneeRole: 'frontend-dev',
          dependsOn: ['T-0001'],
          status: 'todo',
        },
      ],
    });

    expect(derived.tickets.map((t) => t.code)).toEqual(['T-0001', 'T-0002']);
    expect(derived.tickets[0]!.assigneeRole).toBe('backend-dev');
    expect(derived.tickets[0]!.title).toBe('Bootstrap the server');
    expect(derived.tickets[1]!.dependsOn).toEqual(['T-0001']);
    expect(derived.tickets[1]!.assigneeRole).toBe('frontend-dev');
  });

  it('deriveTicketsIndex preserves attempts/status from the previous index', async () => {
    const project = await createProject({ name: 'tickets-preserve', requirement: 'hello' });
    await seedTicketFile(
      project.projectId,
      'T-0001-x.md',
      '---\nticket: T-0001\nassignee: backend-dev\n---\n# T-0001: Thing\n',
    );

    const previous: TicketsIndex = {
      version: 1,
      projectId: project.projectId,
      updatedAt: '2026-01-01T00:00:00.000Z',
      tickets: [entry('T-0001', { status: 'changes-requested', attempts: 2, branch: 'work/T-0001' })],
    };

    const derived = await deriveTicketsIndex(project.projectId, { previous });
    const t = derived.tickets.find((x) => x.code === 'T-0001')!;
    expect(t.status).toBe('changes-requested');
    expect(t.attempts).toBe(2);
    expect(t.branch).toBe('work/T-0001');
  });

  it('updateTicketEntry round-trips through writeTicketsIndex', async () => {
    const project = await createProject({ name: 'tickets-update', requirement: 'hello' });
    const index: TicketsIndex = {
      version: 1,
      projectId: project.projectId,
      updatedAt: '2026-01-01T00:00:00.000Z',
      tickets: [entry('T-0001')],
    };
    await writeTicketsIndex(index);

    const updated = await updateTicketEntry(project.projectId, 'T-0001', {
      status: 'done',
      attempts: 1,
      reviewPath: 'reviews/PR-T-0001-review.md',
    });
    expect(updated?.tickets[0]?.status).toBe('done');
    expect(updated?.tickets[0]?.reviewPath).toBe('reviews/PR-T-0001-review.md');

    const reread = await readTicketsIndex(project.projectId);
    expect(reread?.tickets[0]?.status).toBe('done');
  });

  describe('pickNextReadyForDev / pickNextPendingReview', () => {
    it('returns the first todo with satisfied dependencies', () => {
      const index: TicketsIndex = {
        version: 1,
        projectId: 'test',
        updatedAt: '2026-01-01T00:00:00.000Z',
        tickets: [
          entry('T-0001', { status: 'done' }),
          entry('T-0002', { status: 'todo', dependsOn: ['T-0001'] }),
          entry('T-0003', { status: 'todo', dependsOn: ['T-0002'] }),
        ],
      };
      expect(pickNextReadyTicket(index)?.code).toBe('T-0002');
    });

    it('prefers changes-requested over fresh todos', () => {
      const index: TicketsIndex = {
        version: 1,
        projectId: 'test',
        updatedAt: '2026-01-01T00:00:00.000Z',
        tickets: [
          entry('T-0001', { status: 'changes-requested' }),
          entry('T-0002', { status: 'todo' }),
        ],
      };
      expect(pickNextReadyTicket(index)?.code).toBe('T-0001');
    });

    it('allows a todo ticket for dev while another ticket waits in review', () => {
      const index: TicketsIndex = {
        version: 1,
        projectId: 'test',
        updatedAt: '2026-01-01T00:00:00.000Z',
        tickets: [
          entry('T-0001', { status: 'done' }),
          entry('T-0002', { status: 'review' }),
          entry('T-0003', { status: 'todo', dependsOn: ['T-0001'] }),
        ],
      };
      expect(pickNextReadyTicket(index)?.code).toBe('T-0003');
    });

    it('allows a todo ticket for dev while another ticket is in-progress', () => {
      const index: TicketsIndex = {
        version: 1,
        projectId: 'test',
        updatedAt: '2026-01-01T00:00:00.000Z',
        tickets: [
          entry('T-0001', { status: 'done' }),
          entry('T-0002', { status: 'in-progress', dependsOn: ['T-0001'] }),
          entry('T-0003', { status: 'todo', dependsOn: ['T-0001'] }),
        ],
      };
      expect(pickNextReadyTicket(index)?.code).toBe('T-0003');
    });

    it('returns null when dependencies are not satisfied or tickets are blocked', () => {
      const index: TicketsIndex = {
        version: 1,
        projectId: 'test',
        updatedAt: '2026-01-01T00:00:00.000Z',
        tickets: [
          entry('T-0002', { status: 'blocked' }),
          entry('T-0003', { status: 'todo', dependsOn: ['T-not-done'] }),
        ],
      };
      expect(pickNextReadyTicket(index)).toBeNull();
    });

    it('returns null when everything is done', () => {
      const index: TicketsIndex = {
        version: 1,
        projectId: 'test',
        updatedAt: '2026-01-01T00:00:00.000Z',
        tickets: [entry('T-0001', { status: 'done' }), entry('T-0002', { status: 'done' })],
      };
      expect(pickNextReadyTicket(index)).toBeNull();
    });
  });

  it('resetStuckInFlightTickets moves in-progress and review to changes-requested', async () => {
    const project = await createProject({ name: 'stuck-reset', requirement: 'x' });
    const index: TicketsIndex = {
      version: 1,
      projectId: project.projectId,
      updatedAt: '2026-01-01T00:00:00.000Z',
      tickets: [
        entry('T-0001', { status: 'in-progress', attempts: 6 }),
        entry('T-0002', { status: 'review', attempts: 2 }),
        entry('T-0003', { status: 'done' }),
      ],
    };
    await writeTicketsIndex(index);
    const codes = await resetStuckInFlightTickets(project.projectId);
    expect(codes.sort()).toEqual(['T-0001', 'T-0002']);
    const after = await readTicketsIndex(project.projectId);
    expect(after!.tickets.find((t) => t.code === 'T-0001')!.status).toBe('changes-requested');
    expect(after!.tickets.find((t) => t.code === 'T-0001')!.attempts).toBe(0);
    expect(after!.tickets.find((t) => t.code === 'T-0002')!.status).toBe('changes-requested');
    expect(after!.tickets.find((t) => t.code === 'T-0003')!.status).toBe('done');
  });
});
