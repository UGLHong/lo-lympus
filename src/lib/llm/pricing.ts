// model → USD cost mapping. values are "USD per 1M tokens" to match
// every public price sheet we've seen (OpenAI, Anthropic, OpenRouter).
// the USD cap pathway treats a missing model as $0/1M tokens (quiet
// under-count) so a stale pricing table never blows the budget early —
// operators who care about hard cost limits should ship a full
// OLYMPUS_MODEL_PRICES override for every model they let agents pick.

export type ModelPrice = {
  prompt: number;
  completion: number;
};

// built-in defaults. the shape is [provider/model] → { prompt, completion }
// per 1 000 000 tokens. keep this list short and opinionated; the
// `OLYMPUS_MODEL_PRICES` env var is the escape hatch for new models.
const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'openai/gpt-5-mini': { prompt: 0.6, completion: 2.4 },
  'openai/gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
  'openai/gpt-4o': { prompt: 2.5, completion: 10 },
  'openai/o1-mini': { prompt: 1.1, completion: 4.4 },
  'anthropic/claude-3-5-sonnet': { prompt: 3, completion: 15 },
  'anthropic/claude-3-5-haiku': { prompt: 0.8, completion: 4 },
  'google/gemini-1.5-flash': { prompt: 0.075, completion: 0.3 },
  'google/gemini-1.5-pro': { prompt: 1.25, completion: 5 },
  mock: { prompt: 0, completion: 0 },
};

// OLYMPUS_MODEL_PRICES="openai/gpt-5-mini=0.6:2.4,anthropic/claude=3:15"
function parseEnvOverrides(raw: string | undefined): Record<string, ModelPrice> {
  if (!raw) return {};

  const result: Record<string, ModelPrice> = {};
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const [key, value] = trimmed.split('=');
    if (!key || !value) continue;

    const [promptStr, completionStr] = value.split(':');
    const prompt = Number(promptStr);
    const completion = Number(completionStr);
    if (Number.isFinite(prompt) && Number.isFinite(completion)) {
      result[key.trim()] = { prompt, completion };
    }
  }
  return result;
}

export function getModelPrice(model: string, env: NodeJS.ProcessEnv = process.env): ModelPrice {
  const overrides = parseEnvOverrides(env.OLYMPUS_MODEL_PRICES);
  if (overrides[model]) return overrides[model]!;
  if (DEFAULT_PRICES[model]) return DEFAULT_PRICES[model]!;
  return { prompt: 0, completion: 0 };
}

// usage → USD. values are per-1M-tokens so we divide once at the end.
export function computeUsdCost(
  model: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number },
  env: NodeJS.ProcessEnv = process.env,
): number {
  const price = getModelPrice(model, env);
  const prompt = usage.promptTokens ?? 0;
  const completion = usage.completionTokens ?? Math.max(0, (usage.totalTokens ?? 0) - prompt);

  return ((prompt * price.prompt) + (completion * price.completion)) / 1_000_000;
}
