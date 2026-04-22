import { z } from 'zod';

import { emit } from '../lib/event-bus.server';
import { kanbanTaskPayload } from '../../server/lib/kanban-task-payload';
import {
  createTask,
  getTaskById,
  getTaskChain,
  getTaskChainRoot,
  redoTask,
  retryFailedTaskWithBudgetBonus,
  skipTaskSubtree,
} from '../../server/db/queries';

import type { Route } from './+types/api.task-action';
import type { Task } from '../../server/db/schema';

const RETRY_BUDGET_BONUS = 10;

const Schema = z.object({
  action: z.enum(['retry', 'regenerate', 'skip', 'redo']),
});

export async function action({ params, request }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const taskId = params.taskId;
  if (!taskId) return Response.json({ error: 'taskId required' }, { status: 400 });

  const json = await request.json();
  const parsed = Schema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await getTaskById(taskId);
  if (!existing) return Response.json({ error: 'task not found' }, { status: 404 });

  if (parsed.data.action === 'redo') {
    if (existing.status !== 'done') {
      return Response.json(
        { error: `redo only available on done tasks (current: ${existing.status})` },
        { status: 409 },
      );
    }
    return redoDoneTask(existing);
  }

  if (existing.status !== 'failed') {
    return Response.json(
      { error: `action only available on failed tasks (current: ${existing.status})` },
      { status: 409 },
    );
  }

  if (parsed.data.action === 'retry') return retryFailedTask(existing);
  if (parsed.data.action === 'skip') return skipFailedTask(existing);
  return regenerateFailedTask(existing);
}

async function redoDoneTask(task: Task) {
  const updated = await redoTask(task.id);
  if (!updated) return Response.json({ error: 'redo failed' }, { status: 500 });

  emit({
    projectId: updated.projectId,
    role: updated.role,
    taskId: updated.id,
    type: 'task-update',
    payload: kanbanTaskPayload(updated),
  });
  emit({
    projectId: updated.projectId,
    role: updated.role,
    taskId: updated.id,
    type: 'chat',
    payload: {
      from: 'system',
      direction: 'from-agent',
      text: `Redo requested by human — queued back to todo to run again from scratch.`,
      scope: 'task',
    },
  });

  return Response.json({ ok: true, task: kanbanTaskPayload(updated) });
}

async function retryFailedTask(task: Task) {
  const updated = await retryFailedTaskWithBudgetBonus(task.id, RETRY_BUDGET_BONUS);
  if (!updated) return Response.json({ error: 'retry failed' }, { status: 500 });

  emit({
    projectId: updated.projectId,
    role: updated.role,
    taskId: updated.id,
    type: 'task-update',
    payload: kanbanTaskPayload(updated),
  });
  emit({
    projectId: updated.projectId,
    role: updated.role,
    taskId: updated.id,
    type: 'chat',
    payload: {
      from: 'system',
      direction: 'from-agent',
      text: `Retry requested. Review budget extended by ${RETRY_BUDGET_BONUS} — queued back to todo.`,
      scope: 'task',
    },
  });

  return Response.json({ ok: true, task: kanbanTaskPayload(updated) });
}

async function skipFailedTask(task: Task) {
  const root = (await getTaskChainRoot(task.id)) ?? task;
  const skipped = await skipTaskSubtree(root.id);

  for (const row of skipped) {
    emit({
      projectId: row.projectId,
      role: row.role,
      taskId: row.id,
      type: 'task-update',
      payload: kanbanTaskPayload(row),
    });
  }

  emit({
    projectId: task.projectId,
    role: task.role,
    taskId: task.id,
    type: 'chat',
    payload: {
      from: 'system',
      direction: 'from-agent',
      text: `Task skipped by human. ${skipped.length} task(s) in the review chain marked as skipped; dependent work will proceed as if the chain succeeded.`,
      scope: 'task',
    },
  });

  return Response.json({ ok: true, skippedCount: skipped.length });
}

async function regenerateFailedTask(task: Task) {
  const root = (await getTaskChainRoot(task.id)) ?? task;
  const chain = await getTaskChain(root.id);
  const chainTasks: Task[] = [root, ...chain.descendants];

  const brief = buildRegenerationBrief(root, chainTasks);

  const skipped = await skipTaskSubtree(root.id);
  for (const row of skipped) {
    emit({
      projectId: row.projectId,
      role: row.role,
      taskId: row.id,
      type: 'task-update',
      payload: kanbanTaskPayload(row),
    });
  }

  const orchestratorTask = await createTask({
    projectId: task.projectId,
    role: 'orchestrator',
    title: `Regenerate: ${root.title}`,
    description: brief,
  });

  emit({
    projectId: orchestratorTask.projectId,
    role: 'orchestrator',
    taskId: orchestratorTask.id,
    type: 'task-update',
    payload: kanbanTaskPayload(orchestratorTask),
  });
  emit({
    projectId: task.projectId,
    role: task.role,
    taskId: task.id,
    type: 'chat',
    payload: {
      from: 'system',
      direction: 'from-agent',
      text: `Task sent back to the Orchestrator for regeneration based on the failure history. ${skipped.length} task(s) in the failed chain marked as skipped.`,
      scope: 'task',
    },
  });

  return Response.json({
    ok: true,
    skippedCount: skipped.length,
    orchestratorTaskId: orchestratorTask.id,
  });
}

function buildRegenerationBrief(root: Task, chainTasks: Task[]): string {
  const lines = [
    'A previously planned ticket failed to complete successfully. The human has asked you to REGENERATE it.',
    '',
    '## Original ticket',
    `Role: ${root.role}`,
    `Title: ${root.title}`,
    'Description:',
    root.description || '(no description)',
    '',
    '## Failure history',
  ];

  if (chainTasks.length === 0) {
    lines.push('(no recorded attempts)');
  } else {
    chainTasks.forEach((entry, index) => {
      lines.push(
        `${index + 1}. [${entry.role}] ${entry.title} — status: ${entry.status}${
          entry.blockedReason ? ` — note: ${entry.blockedReason}` : ''
        }`,
      );
      const summary =
        entry.result && typeof (entry.result as Record<string, unknown>).summary === 'string'
          ? ((entry.result as Record<string, unknown>).summary as string).slice(0, 400)
          : '';
      if (summary) lines.push(`   summary: ${summary}`);
    });
  }

  lines.push(
    '',
    '## Your job',
    'Re-examine the original intent and the failure history above. Decide whether the ticket still belongs in this project.',
    '- If it does, emit ONE fresh subtask (or a small set) that replaces the failed work and fits the current state of the codebase. Do not re-emit the exact same brief — incorporate lessons from the failure history.',
    '- If the ticket no longer fits the project, emit an empty array.',
    '',
    'Respond with the usual orchestration JSON array of subtasks.',
  );

  return lines.join('\n');
}
