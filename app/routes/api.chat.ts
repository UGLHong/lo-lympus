import { z } from 'zod';

import { emit } from '../lib/event-bus.server';
import { kanbanTaskPayload } from '../../server/lib/kanban-task-payload';
import {
  appendToTaskDescription,
  appendUserNote,
  createTask,
  findOpenCtoOverseerTask,
  getTaskById,
  unblockTask,
} from '../../server/db/queries';
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
  let mergedTaskId: string | null = null;
  if (scope === 'overseer' && !taskId) {
    const openCtoTask = await findOpenCtoOverseerTask(projectId);

    if (openCtoTask) {
      const followup = [
        `## Follow-up from overseer (${new Date().toISOString()})`,
        message,
      ].join('\n');
      const updated = await appendToTaskDescription(openCtoTask.id, followup);

      // status-aware handoff: abort an in-progress run so it restarts with the
      // appended follow-up, or unblock a blocked-needs-input task so the claim
      // loop picks it up again (otherwise the follow-up sits in the description
      // forever and the user sees nothing happen).
      let mergeNote = 'Added your follow-up to the active CTO ticket — CTO will pick it up on the next pass.';
      if (openCtoTask.status === 'in-progress') {
        abortRunningTask(openCtoTask.id);
        mergeNote = 'Interrupted the active CTO run with your follow-up — CTO will restart with the updated instructions.';
      } else if (openCtoTask.status === 'blocked-needs-input') {
        await unblockTask(openCtoTask.id);
        mergeNote = 'Unblocked the CTO ticket with your follow-up — CTO will resume shortly.';
      }

      const refreshed = await getTaskById(openCtoTask.id);
      if (refreshed) {
        emit({
          projectId,
          role: 'cto',
          taskId: refreshed.id,
          type: 'task-update',
          payload: kanbanTaskPayload(refreshed),
        });
      } else if (updated) {
        emit({
          projectId,
          role: 'cto',
          taskId: updated.id,
          type: 'task-update',
          payload: kanbanTaskPayload(updated),
        });
      }
      emit({
        projectId,
        role: 'cto',
        type: 'chat',
        payload: {
          from: 'cto',
          direction: 'from-agent',
          text: mergeNote,
          scope: 'overseer',
        },
      });
      mergedTaskId = openCtoTask.id;
    } else {
      const ctoTask = await createTask({
        projectId,
        role: 'cto',
        title: `Overseer request: ${message.slice(0, 60)}${message.length > 60 ? '…' : ''}`,
        description: [
          'The human overseer sent a new instruction via the overseer chat.',
          'Read the existing spec / plan / generated code and decide how to act:',
          '- If it is a question you can answer from evidence, reply via a chat event.',
          '- If it is a requirement change or follow-up work, use `create_task` to delegate concrete tickets to the right role(s).',
          '- If it is an incident or strategic decision, document the rationale in the task description and queue fixes via `create_task`.',
          'Never write code yourself — always delegate.',
          '',
          'Overseer message:',
          message,
        ].join('\n'),
      });
      spawnedTaskId = ctoTask.id;
      emit({
        projectId,
        role: 'cto',
        taskId: ctoTask.id,
        type: 'task-update',
        payload: kanbanTaskPayload(ctoTask),
      });
      emit({
        projectId,
        role: 'cto',
        type: 'chat',
        payload: {
          from: 'cto',
          direction: 'from-agent',
          text: 'CTO picking up your request — will investigate and either answer or delegate the work.',
          scope: 'overseer',
        },
      });
    }
  }

  return Response.json({ ok: true, threadId, spawnedTaskId, mergedTaskId });
}
