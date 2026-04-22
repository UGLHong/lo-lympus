'use client';

import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { ProjectState } from '@/lib/schemas/state';
import type { Message } from '@/lib/schemas/messages';
import type { OlympusEvent } from '@/lib/schemas/events';
import type { RoleKey, RoleState } from '@/lib/const/roles';
import type { Phase } from '@/lib/const/phases';

type OlympusSubscriber = (event: OlympusEvent) => void;

const olympusSubscribers = new Map<string, Set<OlympusSubscriber>>();

export function subscribeOlympusEvents(
  projectId: string,
  subscriber: OlympusSubscriber,
): () => void {
  let set = olympusSubscribers.get(projectId);
  if (!set) {
    set = new Set();
    olympusSubscribers.set(projectId, set);
  }
  set.add(subscriber);
  return () => {
    const bucket = olympusSubscribers.get(projectId);
    if (!bucket) return;
    bucket.delete(subscriber);
    if (bucket.size === 0) olympusSubscribers.delete(projectId);
  };
}

function dispatchOlympusToSubscribers(projectId: string, event: OlympusEvent) {
  const bucket = olympusSubscribers.get(projectId);
  if (!bucket) return;
  for (const subscriber of bucket) {
    try {
      subscriber(event);
    } catch {
      // keep other subscribers and the reducer path healthy
    }
  }
}

type RoleStates = Partial<Record<RoleKey, RoleState>>;

type FileEditEvent = {
  ts: string;
  path: string;
  role: RoleKey;
  inserted: string;
};

export type RuntimeView = {
  running: boolean;
  port: number | null;
  pid: number | null;
  startedAt: string | null;
  logTail: { ts: string; channel: 'stdout' | 'stderr'; text: string }[];
  lastStopReason: string | null;
};

export type ProjectViewState = {
  state: ProjectState;
  messages: Message[];
  pendingTokens: Record<string, string>;
  roleStates: RoleStates;
  events: OlympusEvent[];
  lastEventTs: string | null;
  fileEdits: FileEditEvent[];
  connected: boolean;
  activeArtifactPaths: string[];
  /** bumps when project files change on disk (e.g. Zed save) so views refetch */
  workspaceFsRevision: number;
  /** bumps on each `source.written` so the AI Code tab can refetch */
  sourceCodeRevision: number;
  lastAiSourcePath: string | null;
  runtime: RuntimeView;
};

type Action =
  | { type: 'seed'; state: ProjectState; messages: Message[] }
  | { type: 'event'; event: OlympusEvent }
  | { type: 'connected'; value: boolean }
  | { type: 'local-human-message'; message: Message };

function upsertMessage(messages: Message[], message: Message): Message[] {
  const index = messages.findIndex((m) => m.id === message.id);
  if (index === -1) return [...messages, message];
  const next = [...messages];
  next[index] = { ...next[index]!, ...message };
  return next;
}

function reducer(current: ProjectViewState, action: Action): ProjectViewState {
  switch (action.type) {
    case 'seed':
      return { ...current, state: action.state, messages: action.messages };
    case 'connected':
      return { ...current, connected: action.value };
    case 'local-human-message':
      return {
        ...current,
        messages: upsertMessage(current.messages, action.message),
      };
    case 'event': {
      const event = action.event;
      const lastEventTs = event.ts > (current.lastEventTs ?? '') ? event.ts : current.lastEventTs;

      switch (event.kind) {
        case 'message.created': {
          const isStreaming = event.message.meta?.streaming !== false;
          const pendingTokens = isStreaming
            ? { ...current.pendingTokens, [event.message.id]: '' }
            : current.pendingTokens;
          return {
            ...current,
            messages: upsertMessage(current.messages, event.message),
            pendingTokens,
            lastEventTs,
          };
        }
        case 'message.token': {
          const prev = current.pendingTokens[event.messageId] ?? '';
          return {
            ...current,
            pendingTokens: { ...current.pendingTokens, [event.messageId]: prev + event.delta },
            lastEventTs,
          };
        }
        case 'message.block': {
          const messages = current.messages.map((m) =>
            m.id === event.messageId ? { ...m, blocks: [...m.blocks, event.block] } : m,
          );
          return { ...current, messages, lastEventTs };
        }
        case 'message.done': {
          const pending = { ...current.pendingTokens };
          delete pending[event.messageId];
          return { ...current, pendingTokens: pending, lastEventTs };
        }
        case 'role.state': {
          return {
            ...current,
            roleStates: { ...current.roleStates, [event.role]: event.state },
            lastEventTs,
          };
        }
        case 'phase.advanced': {
          const phase = event.toPhase as Phase;
          return {
            ...current,
            state: { ...current.state, phase },
            lastEventTs,
          };
        }
        case 'pipeline.paused': {
          return {
            ...current,
            state: { ...current.state, paused: true },
            lastEventTs,
          };
        }
        case 'artifact.written': {
          const activeArtifactPaths = current.activeArtifactPaths.includes(event.path)
            ? current.activeArtifactPaths
            : [...current.activeArtifactPaths, event.path];
          return { ...current, activeArtifactPaths, lastEventTs };
        }
        case 'source.written': {
          return {
            ...current,
            sourceCodeRevision: current.sourceCodeRevision + 1,
            lastAiSourcePath: event.path,
            events: [...current.events, event].slice(-300),
            lastEventTs,
          };
        }
        case 'workspace.fs.changed': {
          return {
            ...current,
            workspaceFsRevision: current.workspaceFsRevision + 1,
            lastEventTs,
          };
        }
        case 'file.edit': {
          const edit: FileEditEvent = {
            ts: event.ts,
            path: event.path,
            role: event.role,
            inserted: event.inserted,
          };
          const fileEdits = [...current.fileEdits, edit].slice(-200);
          return { ...current, fileEdits, lastEventTs };
        }
        case 'budget.update': {
          return {
            ...current,
            state: {
              ...current.state,
              budgets: {
                ...current.state.budgets,
                tokensUsed: event.tokensUsed,
                wallClockMs: event.wallClockMs,
                usdUsed: event.usdUsed,
              },
            },
            lastEventTs,
          };
        }
        case 'budget.caps': {
          const nextLimits = { ...(current.state.limits ?? {}) };
          if (event.implementAttemptsPerTicket !== undefined) {
            nextLimits.implementAttemptsPerTicket = event.implementAttemptsPerTicket;
          }
          return {
            ...current,
            state: {
              ...current.state,
              budgets: {
                ...current.state.budgets,
                tokensHard: event.tokensHard,
                wallClockCapMs: event.wallClockCapMs,
                usdHard: event.usdHard,
              },
              limits:
                Object.keys(nextLimits).length > 0 ? nextLimits : undefined,
            },
            lastEventTs,
          };
        }
        case 'runtime.start': {
          return {
            ...current,
            runtime: {
              running: true,
              port: event.port,
              pid: event.pid ?? null,
              startedAt: event.ts,
              logTail: current.runtime.logTail,
              lastStopReason: null,
            },
            lastEventTs,
          };
        }
        case 'runtime.stop': {
          return {
            ...current,
            runtime: {
              ...current.runtime,
              running: false,
              lastStopReason: event.reason,
            },
            lastEventTs,
          };
        }
        case 'runtime.log': {
          const nextLog = [
            ...current.runtime.logTail,
            { ts: event.ts, channel: event.channel, text: event.text },
          ].slice(-400);
          return {
            ...current,
            runtime: { ...current.runtime, logTail: nextLog },
            lastEventTs,
          };
        }
        default:
          return {
            ...current,
            events: [...current.events, event].slice(-300),
            lastEventTs,
          };
      }
    }
    default:
      return current;
  }
}

export type AnswerSubmission = { questionId: string; label: string };

export type ProjectActions = {
  sendMessage: (text: string) => Promise<void>;
  submitAnswers: (answers: AnswerSubmission[]) => Promise<void>;
};

export function useProjectStore(
  initialState: ProjectState,
  initialMessages: Message[],
): [ProjectViewState, ProjectActions] {
  const [view, dispatch] = useReducer(reducer, null, (): ProjectViewState => ({
    state: initialState,
    messages: initialMessages,
    pendingTokens: {},
    roleStates: {},
    events: [],
    lastEventTs: null,
    fileEdits: [],
    connected: false,
    activeArtifactPaths: [],
    workspaceFsRevision: 0,
    sourceCodeRevision: 0,
    lastAiSourcePath: null,
    runtime: {
      running: false,
      port: null,
      pid: null,
      startedAt: null,
      logTail: [],
      lastStopReason: null,
    },
  }));

  const projectId = initialState.projectId;
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/stream`);
    sourceRef.current = source;

    source.addEventListener('olympus', (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as OlympusEvent;
        dispatch({ type: 'event', event: parsed });
        dispatchOlympusToSubscribers(projectId, parsed);
      } catch {
        // ignore malformed frames
      }
    });

    source.addEventListener('ready', () => dispatch({ type: 'connected', value: true }));

    source.onerror = () => dispatch({ type: 'connected', value: false });

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [projectId]);

  const actions = useMemo(() => {
    const sendMessage = async (text: string) => {
      const res = await fetch(`/api/projects/${projectId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        console.warn('[sendMessage] failed', res.status);
      }
    };

    const submitAnswers = async (answers: AnswerSubmission[]) => {
      if (answers.length === 0) return;
      const lines = answers.map((answer) => `- ${answer.questionId}: ${answer.label}`);
      const text = ['Answers to clarifications:', ...lines].join('\n');
      return sendMessage(text);
    };

    return { sendMessage, submitAnswers };
  }, [projectId]);

  return [view, actions];
}
