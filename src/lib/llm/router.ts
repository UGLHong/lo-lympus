import { ROLE_DEFINITIONS } from "@/lib/agents/roles";
import { ROLES, type ModelTier, type RoleKey } from "@/lib/const/roles";
import type { LLMProvider, ModelRouter, ResolvedModel } from "./types";
import { createOpenRouterProvider } from "./providers/openrouter";
import { createMockProvider } from "./providers/mock";

type Env = Record<string, string | undefined>;

function parseModelSpec(
  spec: string,
  fallbackProvider: string,
): { provider: string; model: string } {
  const colonIndex = spec.indexOf(":");
  if (colonIndex === -1) return { provider: fallbackProvider, model: spec };

  const head = spec.slice(0, colonIndex);
  const tail = spec.slice(colonIndex + 1);

  const knownProviders = new Set([
    "openrouter",
    "openai",
    "openai-compat",
    "anthropic",
    "google",
    "mock",
  ]);
  if (knownProviders.has(head)) {
    return { provider: head, model: tail };
  }

  return { provider: fallbackProvider, model: spec };
}

function tierEnvKey(tier: ModelTier): string {
  return `MODEL_TIER_${tier.toUpperCase()}`;
}

function roleEnvKey(role: RoleKey): string {
  return `ROLE_MODEL_${role.toUpperCase().replace(/-/g, "_")}`;
}

function splitModelSpecs(raw: string): string[] {
  return raw
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function resolveTierFromEnv(tier: ModelTier, env: Env, defaultProvider: string): ResolvedModel {
  const spec = env[tierEnvKey(tier)] ?? "openai/gpt-4-mini";
  const { provider, model } = parseModelSpec(spec, defaultProvider);
  return { provider, model, tier };
}

function resolveSpecToModel(
  spec: string,
  roleTier: ModelTier,
  env: Env,
  defaultProvider: string,
): ResolvedModel {
  if (spec.startsWith("tier:")) {
    const tier = spec.slice("tier:".length) as ModelTier;
    return resolveTierFromEnv(tier, env, defaultProvider);
  }
  const { provider, model } = parseModelSpec(spec, defaultProvider);
  return { provider, model, tier: roleTier };
}

export function resolveRoleCandidates(
  role: RoleKey,
  env: Env = process.env,
): ResolvedModel[] {
  const defaultProvider = env.LLM_PROVIDER ?? "openrouter";
  const roleTier = ROLES[role].tier;
  const def = ROLE_DEFINITIONS[role];
  const fromEnv = env[roleEnvKey(role)];
  const specs: string[] = [];
  if (fromEnv?.trim()) {
    specs.push(...splitModelSpecs(fromEnv));
  } else if (def.modelSpec?.trim()) {
    specs.push(def.modelSpec.trim());
  } else {
    specs.push(`tier:${roleTier}`);
  }
  if (def.modelFallbackSpecs?.length) {
    for (const fallback of def.modelFallbackSpecs) {
      if (fallback?.trim()) specs.push(fallback.trim());
    }
  }
  const seen = new Set<string>();
  const out: ResolvedModel[] = [];
  for (const spec of specs) {
    const resolved = resolveSpecToModel(spec, roleTier, env, defaultProvider);
    const key = `${resolved.provider}:${resolved.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

export function createModelRouter(env: Env = process.env): ModelRouter {
  const defaultProvider = env.LLM_PROVIDER ?? "openrouter";

  function resolveTier(tier: ModelTier): ResolvedModel {
    return resolveTierFromEnv(tier, env, defaultProvider);
  }

  function resolveRole(role: RoleKey): ResolvedModel {
    const candidates = resolveRoleCandidates(role, env);
    return candidates[0] ?? resolveTierFromEnv(ROLES[role].tier, env, defaultProvider);
  }

  return { resolveTier, resolveRole };
}

const providerCache = new Map<string, LLMProvider>();

export function getProvider(id: string, env: Env = process.env): LLMProvider {
  const cached = providerCache.get(id);
  if (cached) return cached;

  let provider: LLMProvider;
  if (id === "openrouter") {
    provider = createOpenRouterProvider({
      apiKey: env.OPENROUTER_API_KEY ?? "",
      baseURL: env.OPENROUTER_BASE_URL,
      httpReferer: env.OPENROUTER_HTTP_REFERER,
      appTitle: env.OPENROUTER_APP_TITLE,
    });
  } else if (id === "mock") {
    provider = createMockProvider();
  } else {
    throw new Error(
      `Unsupported LLM provider "${id}" (only openrouter + mock are built-in for MVP).`,
    );
  }

  providerCache.set(id, provider);
  return provider;
}
