import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ChatRequest, LLMProvider, StreamChunk } from "../types";

type OpenRouterOptions = {
  apiKey: string;
  baseURL?: string;
  httpReferer?: string;
  appTitle?: string;
};

type RetryableError = Error & { status?: number };

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1500;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isTransient(error: unknown): boolean {
  const err = error as RetryableError;
  const status = err?.status;
  if (typeof status === "number") {
    return (
      status === 408 ||
      status === 409 ||
      status === 425 ||
      status === 429 ||
      status >= 500
    );
  }
  return false;
}

export function createOpenRouterProvider(
  options: OpenRouterOptions,
): LLMProvider {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL ?? "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": options.httpReferer ?? "http://localhost:3000",
      "X-Title": options.appTitle ?? "Olympus",
    },
  });

  return {
    id: "openrouter",
    async *streamChat(req: ChatRequest): AsyncIterable<StreamChunk> {
      let stream: Awaited<
        ReturnType<typeof client.chat.completions.create>
      > | null = null;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          stream = await client.chat.completions.create({
            model: req.model,
            messages: req.messages as ChatCompletionMessageParam[],
            temperature: req.temperature ?? 0.4,
            top_p: req.topP,
            max_tokens: req.maxTokens,
            stream: true,
          });
          break;
        } catch (error) {
          lastError = error;
          if (attempt === MAX_ATTEMPTS || !isTransient(error)) {
            throw error;
          }
          const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
          await sleep(delay);
        }
      }

      if (!stream) {
        throw lastError ?? new Error("OpenRouter stream could not be opened.");
      }

      let totalUsage: StreamChunk | null = null;

      for await (const chunk of stream as AsyncIterable<{
        choices?: { delta?: { content?: string } }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      }>) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          yield { kind: "token", text: delta };
        }
        if (chunk.usage) {
          totalUsage = {
            kind: "usage",
            usage: {
              promptTokens: chunk.usage.prompt_tokens,
              completionTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
            },
          };
        }
      }

      if (totalUsage) yield totalUsage;
      yield { kind: "done" };
    },
  };
}
