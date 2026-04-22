import { NextResponse } from 'next/server';
import { z } from 'zod';
import matter from 'gray-matter';
import { emit } from '@/lib/events/bus';
import {
  appendEvent,
  deleteArtifact,
  readArtifact,
  readState,
  writeState,
} from '@/lib/workspace/fs';
import { resolveMaxAttemptsForProject } from '@/lib/pipeline/implement';
import { readTicketsIndex, updateTicketEntry } from '@/lib/workspace/tickets';
import { unstickOperatorPipelineState } from '@/lib/pipeline/operator-unstick';
import {
  clearPipelineProjectBusy,
  isPipelineProjectBusy,
  markPipelineProjectBusy,
} from '@/lib/pipeline/in-flight-projects';
import { driveProject } from '@/lib/pipeline/driver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;

  try {
    await readState(id);
  } catch {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const raw = await readArtifact(id, 'HELP_NEEDED.md');
  if (!raw) {
    return NextResponse.json({ helpNeeded: false });
  }

  const parsed = matter(raw);
  const frontmatter = parsed.data as Record<string, unknown>;
  const ticketCode = typeof frontmatter.ticket === 'string' ? frontmatter.ticket : null;

  const reasonMatch = parsed.content.match(/## Last known reason\s*\n+[-*]?\s*(.+)/);
  const reason = reasonMatch?.[1]?.trim() ?? 'unknown';

  const titleMatch = parsed.content.match(/^#\s+(.+)$/m);
  const ticketTitle = titleMatch?.[1]
    ?.replace(/^Help needed on \S+ — /, '')
    .trim() ?? null;

  const maxAttempts = await resolveMaxAttemptsForProject(id);

  let attempts: number | null = null;
  let reviewPath: string | null = null;

  if (ticketCode) {
    const index = await readTicketsIndex(id);
    const ticket = index?.tickets.find((t) => t.code === ticketCode);
    if (ticket) {
      attempts = ticket.attempts ?? null;
      reviewPath = ticket.reviewPath ?? null;
    }
  }

  return NextResponse.json({
    helpNeeded: true,
    ticketCode,
    ticketTitle,
    reason,
    attempts,
    maxAttempts,
    reviewPath,
  });
}

const actionSchema = z.object({
  action: z.enum(['retry', 'double-and-retry', 'skip-and-continue']),
});

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;

  let state;
  try {
    state = await readState(id);
  } catch {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const json = await request.json().catch(() => null);
  const parsed = actionSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const { action } = parsed.data;

  if (action === 'double-and-retry') {
    const current = await resolveMaxAttemptsForProject(id);
    const doubled = Math.min(64, current * 2);
    await writeState({
      ...state,
      limits: { ...(state.limits ?? {}), implementAttemptsPerTicket: doubled },
    });
    await appendEvent(
      emit({
        projectId: id,
        kind: 'budget.caps',
        tokensHard: state.budgets.tokensHard,
        wallClockCapMs: state.budgets.wallClockCapMs,
        usdHard: state.budgets.usdHard,
        implementAttemptsPerTicket: doubled,
      }),
    );
  }

  if (action === 'skip-and-continue') {
    const raw = await readArtifact(id, 'HELP_NEEDED.md');
    if (raw) {
      const frontmatter = matter(raw).data as Record<string, unknown>;
      const ticketCode = typeof frontmatter.ticket === 'string' ? frontmatter.ticket : null;
      if (ticketCode) {
        await updateTicketEntry(id, ticketCode, { status: 'done', pendingSourcePaths: null });
        await appendEvent(
          emit({ projectId: id, kind: 'ticket.status', code: ticketCode, status: 'done' }),
        );
        await deleteArtifact(id, 'HELP_NEEDED.md');
      }
    }
  }

  if (isPipelineProjectBusy(id)) {
    return NextResponse.json({ error: 'Pipeline is busy — try again shortly' }, { status: 409 });
  }

  markPipelineProjectBusy(id);

  void (async () => {
    try {
      if (action !== 'skip-and-continue') {
        await unstickOperatorPipelineState(id);
      } else {
        const currentState = await readState(id);
        await writeState({ ...currentState, paused: false });
      }
      await driveProject({ projectId: id });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[help-needed action]', err);
    } finally {
      clearPipelineProjectBusy(id);
    }
  })();

  return NextResponse.json({ ok: true, action });
}
