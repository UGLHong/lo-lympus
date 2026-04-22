import { resolveTierModel } from '../mastra/model';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionOptions {
  tier: 'FAST' | 'REASONING' | 'CODING' | 'VISION' | 'COMPLEX' | 'PLANNING';
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json_object' | 'text';
  timeoutMs?: number;
}

export interface ChatCompletionResult {
  content: string;
  modelId: string;
}

// thin OpenRouter client for one-shot, non-agentic prompts (like auto-
// detecting a run command). full agent conversations still go through mastra.
export async function openrouterChatComplete(
  options: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const modelId = resolveTierModel(options.tier);
  const baseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const timeoutMs = options.timeoutMs ?? 20_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER ?? 'http://localhost:3100',
        'X-Title': process.env.OPENROUTER_APP_TITLE ?? 'Olympus',
      },
      body: JSON.stringify({
        model: modelId,
        messages: options.messages,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 400,
        ...(options.responseFormat === 'json_object'
          ? { response_format: { type: 'json_object' } }
          : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`openrouter ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    return { content, modelId };
  } finally {
    clearTimeout(timer);
  }
}
