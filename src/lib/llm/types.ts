import type { ModelTier, RoleKey } from '@/lib/const/roles';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stream?: boolean;
  responseFormat?: 'text' | 'json';
};

export type UsageInfo = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type StreamChunk =
  | { kind: 'token'; text: string }
  | { kind: 'usage'; usage: UsageInfo }
  | { kind: 'done' };

export interface LLMProvider {
  readonly id: string;
  streamChat(req: ChatRequest): AsyncIterable<StreamChunk>;
}

export type ResolvedModel = {
  provider: string;
  model: string;
  tier: ModelTier;
};

export interface ModelRouter {
  resolveTier(tier: ModelTier): ResolvedModel;
  resolveRole(role: RoleKey): ResolvedModel;
}
