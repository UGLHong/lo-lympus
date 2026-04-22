import type { OpenAICompatibleConfig } from '@mastra/core/llm';

import { ROLE_TIER, type Role } from '../const/roles';

type Tier = 'FAST' | 'REASONING' | 'CODING' | 'VISION';

const TIER_ENV_VAR: Record<Tier, string> = {
  FAST: 'MODEL_TIER_FAST',
  REASONING: 'MODEL_TIER_REASONING',
  CODING: 'MODEL_TIER_CODING',
  VISION: 'MODEL_TIER_VISION',
};

export function resolveTierModel(tier: Tier): string {
  const value = process.env[TIER_ENV_VAR[tier]];
  if (!value) {
    throw new Error(`Tier model env var ${TIER_ENV_VAR[tier]} is not set`);
  }
  return value;
}

export function buildOpenRouterConfig(tier: Tier): OpenAICompatibleConfig {
  const modelId = resolveTierModel(tier);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }
  return {
    providerId: 'openrouter',
    modelId,
    url: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    apiKey,
    headers: {
      'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER ?? 'http://localhost:3100',
      'X-Title': process.env.OPENROUTER_APP_TITLE ?? 'Olympus',
    },
  };
}

export function modelForRole(role: Role): OpenAICompatibleConfig {
  return buildOpenRouterConfig(ROLE_TIER[role]);
}
