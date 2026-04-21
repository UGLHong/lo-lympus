import { readTicketsIndex } from '@/lib/workspace/tickets';
import { listTasks } from '@/lib/task-pool/store';
import type { GateCheck, GatePlugin } from '../registry';

// the "everyone finishes before manual UI testing" gate: IMPLEMENT can only
// hand off once every ticket is done AND no dev/review tasks remain live in
// the pool. This is the generic fan-in barrier the user asked for.
export const allTicketsDoneGate: GatePlugin = {
  id: 'all-tickets-done',
  description: 'Every ticket is done, no blocked tickets, no live dev/review tasks in the pool.',
  targetPhase: 'INTEGRATE',
  async evaluate(projectId) {
    const index = await readTicketsIndex(projectId);
    const hasIndex = index !== null && index.tickets.length > 0;

    const checks: GateCheck[] = [
      {
        label: 'tickets/index.json exists with at least one ticket',
        ok: hasIndex,
      },
    ];

    if (hasIndex) {
      const nonDone = index.tickets.filter((t) => t.status !== 'done');
      checks.push({
        label: 'All tickets are done',
        ok: nonDone.length === 0,
        note:
          nonDone.length === 0
            ? undefined
            : `pending: ${nonDone.map((t) => `${t.code} (${t.status})`).join(', ')}`,
      });

      const blocked = index.tickets.filter((t) => t.status === 'blocked');
      checks.push({
        label: 'No blocked tickets',
        ok: blocked.length === 0,
        note: blocked.length === 0 ? undefined : blocked.map((t) => t.code).join(', '),
      });
    }

    const liveImplement = listTasks(projectId, {
      phase: 'IMPLEMENT',
      statuses: ['pending', 'in-progress'],
    });
    checks.push({
      label: 'No live IMPLEMENT tasks in the pool',
      ok: liveImplement.length === 0,
      note:
        liveImplement.length === 0
          ? undefined
          : `${liveImplement.length} live task(s): ${liveImplement
              .map((t) => `${t.slug} (${t.status})`)
              .join(', ')}`,
    });

    return checks;
  },
};
