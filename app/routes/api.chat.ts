import { z } from 'zod';

import { emit } from '../lib/event-bus.server';
import { kanbanTaskPayload } from '../../server/lib/kanban-task-payload';
import { appendUserNote, createTask, getTaskById, unblockTask } from '../../server/db/queries';
import { getMemory } from '../../server/mastra/runtime';
import { abortRunningTask } from '../../server/daemon/task-abort-registry';

import type { Route } from './+types/api.chat';

const Schema = z.object({
  projectId: z.string().uuid(),
  role: z.string().min(1),
  taskId: z.string().uuid().nullable().optional(),
  message: z.string().min(1),
  scope: z.enum(['task', 'overseer']).optional(),
  // client-generated id so the live stream echo can be reconciled with the
  // optimistic bubble the UI already rendered, preventing a duplicate.
  localId: z.string().min(1).max(128).optional(),
});

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const json = await request.json();
  const parsed = Schema.safeParse(json);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const { projectId, role, taskId, message, localId } = parsed.data;
  const scope = parsed.data.scope ?? (taskId ? 'task' : 'overseer');

  if (taskId) {
    const task = await getTaskById(taskId);
    if (task?.status === 'blocked-needs-input') {
      await unblockTask(taskId);
      const unblocked = await getTaskById(taskId);
      if (unblocked) {
        emit({
          projectId,
          role: task.role,
          taskId,
          type: 'task-update',
          payload: kanbanTaskPayload(unblocked),
        });
      }
      emit({
        projectId,
        role: task.role,
        taskId,
        type: 'state',
        payload: { status: 'idle', reason: 'unblocked-by-human' },
      });
    } else if (task) {
      // non-Q&A message: persist it as a human note so it gets injected into
      // the next agent/reviewer prompt for this task.
      await appendUserNote(taskId, message);
      // if the agent is actively running, interrupt it so it restarts with the
      // updated instructions rather than waiting for the current run to finish.
      if (task.status === 'in-progress') {
        abortRunningTask(taskId);
      }
    }
  }

  const threadId = taskId ? `task-${taskId}` : `project-${projectId}-${role}`;
  try {
    const memory = getMemory();
    await memory.saveMessages({
      messages: [
        {
          id: `user-${Date.now()}`,
          threadId,
          resourceId: projectId,
          role: 'user',
          content: { format: 2, parts: [{ type: 'text', text: message }] },
          type: 'text',
          createdAt: new Date(),
        },
      ],
    });
  } catch (err) {
    console.error('[api.chat] memory save failed:', err);
  }

  emit({
    projectId,
    role,
    taskId: taskId ?? undefined,
    type: 'chat',
    payload: {
      from: 'human',
      direction: 'from-human',
      text: message,
      scope,
      ...(localId ? { localId } : {}),
    },
  });

  let spawnedTaskId: string | null = null;
  if (scope === 'overseer' && !taskId) {
    const orchestratorTask = await createTask({
      projectId,
      role: 'orchestrator',
      title: `Overseer requirement: ${message.slice(0, 60)}${message.length > 60 ? '…' : ''}`,
      description: [
        'The human overseer sent a new instruction via the overseer chat.',
        'Reconcile it with the existing project plan and emit fresh subtasks (or amendments) for the appropriate roles.',
        '',
        'Overseer message:',
        message,
      ].join('\n'),
    });
    spawnedTaskId = orchestratorTask.id;
    emit({
      projectId,
      role: 'orchestrator',
      taskId: orchestratorTask.id,
      type: 'task-update',
      payload: kanbanTaskPayload(orchestratorTask),
    });
    emit({
      projectId,
      role: 'orchestrator',
      type: 'chat',
      payload: {
        from: 'orchestrator',
        direction: 'from-agent',
        text: `Queued a re-orchestration ticket for your request.`,
        scope: 'overseer',
      },
    });
  }

  return Response.json({ ok: true, threadId, spawnedTaskId });
}
