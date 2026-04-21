import { nanoid } from 'nanoid';
import { emit } from '@/lib/events/bus';
import {
  appendEvent,
  appendMessage,
  readState,
  writeState,
} from '@/lib/workspace/fs';
import type { Message } from '@/lib/schemas/messages';
import { enforceBudgets } from './budget';
import { ensureSoftwareHouse } from './software-house';

export type DriveInput = {
  projectId: string;
  humanMessage?: string;
};

// new entry point: every interaction with the project either starts or
// nudges the long-running software house. The house runs as a shared pool
// of role-workers that continuously pull tasks off the backlog, so there is
// no sequential phase loop here anymore.
export async function driveProject(input: DriveInput): Promise<{ messages: Message[] }> {
  const { projectId, humanMessage } = input;

  const initial = await readState(projectId);
  const messages: Message[] = [];

  if (humanMessage) {
    const m: Message = {
      id: nanoid(),
      projectId,
      threadId: 'master',
      author: { kind: 'human' },
      text: humanMessage,
      blocks: [],
      createdAt: new Date().toISOString(),
      phase: initial.phase,
    };
    await appendMessage(m);
    emit({ projectId, kind: 'message.created', message: m });
    emit({ projectId, kind: 'message.done', messageId: m.id });
    messages.push(m);
  }

  const budget = await enforceBudgets(projectId);
  if (!budget.ok) return { messages };

  await ensureSoftwareHouse({ projectId, humanMessage });
  return { messages };
}

// the old /implement endpoint special-cased INTEGRATE → BRINGUP; keep the
// helper exported so the route keeps compiling, but the supervisor already
// chains that transition automatically now.
export async function advanceIntegrateToBringup(projectId: string): Promise<void> {
  const state = await readState(projectId);
  if (state.phase !== 'INTEGRATE') return;

  const now = new Date().toISOString();
  const history = [...state.phaseHistory];
  const open = history.findIndex(
    (entry) => entry.phase === 'INTEGRATE' && entry.status === 'running',
  );
  if (open >= 0) {
    history[open] = { ...history[open]!, endedAt: now, status: 'done' };
  }
  history.push({ phase: 'BRINGUP', startedAt: now, status: 'running' });

  await writeState({ ...state, phase: 'BRINGUP', phaseHistory: history });
  await appendEvent(
    emit({
      projectId,
      kind: 'phase.advanced',
      fromPhase: 'INTEGRATE',
      toPhase: 'BRINGUP',
    }),
  );
}
