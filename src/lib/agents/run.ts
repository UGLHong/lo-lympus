import { nanoid } from 'nanoid';
import type { RoleKey, RoleState } from '@/lib/const/roles';
import { emit } from '@/lib/events/bus';
import type { ResolvedModel } from '@/lib/llm/types';
import { getProvider, resolveRoleCandidates } from '@/lib/llm/router';
import type { ChatMessage } from '@/lib/llm/types';
import {
  appendEvent,
  appendMessage,
  readArtifact,
  readState,
  updateMessage,
  writeArtifact,
} from '@/lib/workspace/fs';
import type { Message } from '@/lib/schemas/messages';
import type { OlympusEvent } from '@/lib/schemas/events';
import { bumpUsage, bumpWallClock } from '@/lib/pipeline/budget';
import { buildContextBlock, buildSystemPrompt } from './prompts';
import { parseEnvelope, safePath, type AgentEnvelope } from './envelope';

const MASTER_THREAD_ID = 'master';

type DistributedOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
type LocalEventInput = DistributedOmit<OlympusEvent, 'id' | 'ts' | 'projectId'>;

type RunAgentOptions = {
  projectId: string;
  role: RoleKey;
  userPrompt: string;
  threadId?: string;
  includeSpec?: boolean;
  includeArchitecture?: boolean;
  contextExtra?: string;
  skipPersistUserMessage?: boolean;
};

export type AgentTurnResult = {
  message: Message;
  envelopeText: string;
  envelope: AgentEnvelope;
  advance: boolean;
};

export async function runAgentTurn(options: RunAgentOptions): Promise<AgentTurnResult> {
  const threadId = options.threadId ?? MASTER_THREAD_ID;
  const { projectId, role, userPrompt } = options;

  const state = await readState(projectId);
  const requirements = await readArtifact(projectId, 'REQUIREMENTS.md');
  const spec = options.includeSpec ? await readArtifact(projectId, 'SPEC.md') : null;
  const architecture = options.includeArchitecture ? await readArtifact(projectId, 'ARCHITECTURE.md') : null;

  const candidates = resolveRoleCandidates(role);
  const initialResolved = candidates[0];
  if (!initialResolved) {
    throw new Error(`No LLM model candidates resolved for role ${role}`);
  }

  const systemPrompt = buildSystemPrompt(role);
  const context = buildContextBlock({
    state: JSON.stringify(state, null, 2),
    requirements,
    spec,
    architecture,
    extra: options.contextExtra,
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `${context}\n\n---\n\n${userPrompt}` },
  ];

  const messageId = nanoid();
  const now = new Date().toISOString();
  const openMessage: Message = {
    id: messageId,
    projectId,
    threadId,
    author: { kind: 'role', role },
    text: '',
    blocks: [],
    createdAt: now,
    phase: state.phase,
    meta: {
      model: `${initialResolved.provider}:${initialResolved.model}`,
      tier: initialResolved.tier,
      streaming: true,
    },
  };

  emitAndRecord(projectId, { kind: 'role.state', role, state: 'thinking' });
  emit({ projectId, kind: 'message.created', message: openMessage });
  await appendMessage(openMessage);

  emitAndRecord(projectId, { kind: 'role.state', role, state: 'typing' });

  let raw = '';
  const startedAt = Date.now();
  let resolvedUsed: ResolvedModel | null = null;

  outer: for (const resolved of candidates) {
    try {
      const provider = getProvider(resolved.provider);
      for await (const chunk of provider.streamChat({
        model: resolved.model,
        messages,
        temperature: 0.3,
        maxTokens: 4096,
        responseFormat: 'json',
      })) {
        if (chunk.kind === 'token') {
          raw += chunk.text;
          emit({ projectId, kind: 'message.token', messageId, delta: chunk.text });
        } else if (chunk.kind === 'usage') {
          await bumpUsage(projectId, resolved.model, chunk.usage);
        }
      }
      resolvedUsed = resolved;
      break outer;
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      if (raw.length > 0) {
        emitAndRecord(projectId, {
          kind: 'log',
          level: 'warn',
          message: `LLM stream failed mid-response (${role}): ${errMessage}`,
        });
        resolvedUsed = resolved;
        break outer;
      }
      emitAndRecord(projectId, {
        kind: 'log',
        level: 'warn',
        message: `LLM error (${role}) on ${resolved.provider}:${resolved.model}: ${errMessage}`,
      });
    }
  }

  if (!raw.trim() && resolvedUsed === null) {
    const lastErr = 'all configured models failed before returning tokens';
    raw = JSON.stringify({ text: `LLM error: ${lastErr}`, blocks: [], writes: [], advance: false });
    emitAndRecord(projectId, { kind: 'log', level: 'error', message: `LLM error (${role}): ${lastErr}` });
  }

  const envelope = parseEnvelope(raw);

  for (const write of envelope.writes) {
    const rel = safePath(write.path);
    if (!rel) continue;
    await writeArtifact(projectId, rel, write.content);
    emitAndRecord(projectId, { kind: 'artifact.written', path: rel, role });
  }

  // when the envelope parsed cleanly we show its text; when it partially failed
  // but we still salvaged text we keep it so the human sees the response. only
  // fall back to the warning if there's literally nothing to display.
  const finalText = envelope.parseError && !envelope.text.trim()
    ? `⚠️ ${role} response could not be parsed (${envelope.parseError}). The agent will retry on the next turn.`
    : envelope.text;

  const modelMeta = resolvedUsed ?? initialResolved;
  const updated = await updateMessage(projectId, messageId, (m) => ({
    ...m,
    text: finalText,
    blocks: envelope.blocks,
    meta: {
      ...m.meta,
      model: `${modelMeta.provider}:${modelMeta.model}`,
      tier: modelMeta.tier,
      streaming: false,
      durationMs: Date.now() - startedAt,
      ...(envelope.parseError ? { parseError: envelope.parseError, rawResponse: raw } : {}),
    },
  }));

  if (envelope.parseError) {
    emitAndRecord(projectId, {
      kind: 'log',
      level: 'warn',
      message: `Envelope parse failed for ${role}: ${envelope.parseError}. Raw length=${raw.length}.`,
    });
  }

  const finalMessage = updated ?? { ...openMessage, text: finalText, blocks: envelope.blocks };

  emit({ projectId, kind: 'message.created', message: finalMessage });
  emit({ projectId, kind: 'message.done', messageId });

  const nextRoleState: RoleState = envelope.advance ? 'celebrating' : 'idle';
  emitAndRecord(projectId, { kind: 'role.state', role, state: nextRoleState });

  await bumpWallClock(projectId, Date.now() - startedAt);

  return { message: finalMessage, envelopeText: raw, envelope, advance: envelope.advance };
}

function emitAndRecord(projectId: string, partial: LocalEventInput) {
  const event = emit({ projectId, ...partial } as Parameters<typeof emit>[0]);
  appendEvent(event).catch(() => {});
  return event;
}

export { MASTER_THREAD_ID };
