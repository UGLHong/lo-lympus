import type { Phase } from '@/lib/const/phases';
import { PIPELINE_PHASES } from '@/lib/const/phases';
import type { RoleKey } from '@/lib/const/roles';
import { ROLE_KEYS } from '@/lib/const/roles';
import type { ChatMessage, ChatRequest, LLMProvider, StreamChunk } from '../types';
import { pickEnvelope } from './mock-envelopes';

// offline mock provider used by `pnpm demo`. it reads the phase out of the
// context block and the role out of the system prompt, picks a canned
// envelope, and streams it back token-by-token so the rest of the pipeline
// (parseEnvelope → writes → gates) runs exactly as it would against a real
// LLM. when no envelope is canned for a (role, phase) pair, we fall back
// to a benign advance=false stub that keeps the project paused rather than
// advancing on garbage.

const PHASE_SET = new Set<Phase>(PIPELINE_PHASES);
const ROLE_SET = new Set<RoleKey>(ROLE_KEYS);

export function createMockProvider(): LLMProvider {
  return {
    id: 'mock',
    async *streamChat(req: ChatRequest): AsyncIterable<StreamChunk> {
      const { role, phase, userPrompt, projectName, slug } = deriveRequestContext(req.messages);
      const envelope = pickEnvelope({ role, phase, userPrompt, projectName, slug });

      // ~60 char chunks keeps the UI responsive without spamming events.
      for (let index = 0; index < envelope.length; index += 64) {
        yield { kind: 'token', text: envelope.slice(index, index + 64) };
      }

      const promptTokens = estimateTokens(req.messages.map((m) => m.content).join('\n'));
      const completionTokens = estimateTokens(envelope);
      yield {
        kind: 'usage',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
      };
      yield { kind: 'done' };
    },
  };
}

type DerivedContext = {
  role: RoleKey;
  phase: Phase;
  userPrompt: string;
  projectName: string;
  slug: string;
};

function deriveRequestContext(messages: ChatMessage[]): DerivedContext {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const user = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');

  return {
    role: extractRole(system) ?? 'orchestrator',
    phase: extractPhase(user) ?? 'INTAKE',
    userPrompt: user,
    projectName: extractProjectName(user) ?? 'Olympus project',
    slug: extractSlug(user) ?? 'olympus',
  };
}

function extractRole(systemPrompt: string): RoleKey | null {
  const match = systemPrompt.match(/^#\s*Role:\s*([a-z-]+)/im);
  if (match && ROLE_SET.has(match[1] as RoleKey)) {
    return match[1] as RoleKey;
  }
  return null;
}

function extractPhase(userPrompt: string): Phase | null {
  const match = userPrompt.match(/"phase"\s*:\s*"([A-Z_]+)"/);
  if (match && PHASE_SET.has(match[1] as Phase)) {
    return match[1] as Phase;
  }
  return null;
}

function extractProjectName(userPrompt: string): string | null {
  const match = userPrompt.match(/"name"\s*:\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

function extractSlug(userPrompt: string): string | null {
  const match = userPrompt.match(/"slug"\s*:\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

// rough token estimate (~4 chars/token) so the budget rail moves during a
// mock run without hitting a real tokenizer.
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
