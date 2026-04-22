import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface OlympusSettings {
  maxRetries: number;
  maxReviewIterations: number;
  pollMs: number;
  // how long a task may stay in 'blocked-needs-input' before the watcher
  // unblocks it and instructs the agent to proceed with documented assumptions.
  clarificationTimeoutMs: number;
  // ceiling on total time spent across multiple clarification rounds on the
  // same task; once exceeded further questions are short-circuited.
  clarificationTokenBudgetMs: number;
  clarificationWatcherTickMs: number;
  modelTiers: {
    fast: string;
    reasoning: string;
    coding: string;
    vision: string;
    complex: string;
    planning: string;
  };
}

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const DEFAULTS: OlympusSettings = {
  maxRetries: 3,
  maxReviewIterations: 10,
  pollMs: 5000,
  clarificationTimeoutMs: envNumber('OLYMPUS_CLARIFICATION_TIMEOUT_MS', 15 * 60 * 1000),
  clarificationTokenBudgetMs: envNumber('OLYMPUS_CLARIFICATION_TOKEN_BUDGET_MS', 45 * 60 * 1000),
  clarificationWatcherTickMs: envNumber('OLYMPUS_CLARIFICATION_WATCHER_TICK_MS', 30 * 1000),
  modelTiers: {
    fast: process.env.MODEL_TIER_FAST ?? '',
    reasoning: process.env.MODEL_TIER_REASONING ?? '',
    coding: process.env.MODEL_TIER_CODING ?? '',
    vision: process.env.MODEL_TIER_VISION ?? '',
    complex: process.env.MODEL_TIER_COMPLEX ?? '',
    planning: process.env.MODEL_TIER_PLANNING ?? '',
  },
};

const SETTINGS_PATH = resolve(process.cwd(), '.olympus/settings.json');

const globalForSettings = globalThis as unknown as {
  __olympusSettings?: OlympusSettings;
};

function loadFromDisk(): OlympusSettings | null {
  try {
    if (!existsSync(SETTINGS_PATH)) return null;
    const raw = readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<OlympusSettings>;
    return mergeWithDefaults(parsed);
  } catch (err) {
    console.warn('[settings] failed to load', err);
    return null;
  }
}

function mergeWithDefaults(partial: Partial<OlympusSettings>): OlympusSettings {
  return {
    maxRetries: numberOrDefault(partial.maxRetries, DEFAULTS.maxRetries),
    maxReviewIterations: numberOrDefault(partial.maxReviewIterations, DEFAULTS.maxReviewIterations),
    pollMs: numberOrDefault(partial.pollMs, DEFAULTS.pollMs),
    clarificationTimeoutMs: numberOrDefault(
      partial.clarificationTimeoutMs,
      DEFAULTS.clarificationTimeoutMs,
    ),
    clarificationTokenBudgetMs: numberOrDefault(
      partial.clarificationTokenBudgetMs,
      DEFAULTS.clarificationTokenBudgetMs,
    ),
    clarificationWatcherTickMs: numberOrDefault(
      partial.clarificationWatcherTickMs,
      DEFAULTS.clarificationWatcherTickMs,
    ),
    modelTiers: {
      fast: partial.modelTiers?.fast || DEFAULTS.modelTiers.fast,
      reasoning: partial.modelTiers?.reasoning || DEFAULTS.modelTiers.reasoning,
      coding: partial.modelTiers?.coding || DEFAULTS.modelTiers.coding,
      vision: partial.modelTiers?.vision || DEFAULTS.modelTiers.vision,
      complex: partial.modelTiers?.complex || DEFAULTS.modelTiers.complex,
      planning: partial.modelTiers?.planning || DEFAULTS.modelTiers.planning,
    },
  };
}

function numberOrDefault(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function getSettings(): OlympusSettings {
  if (globalForSettings.__olympusSettings) return globalForSettings.__olympusSettings;
  const loaded = loadFromDisk() ?? DEFAULTS;
  globalForSettings.__olympusSettings = loaded;
  return loaded;
}

export function saveSettings(patch: Partial<OlympusSettings>): OlympusSettings {
  const current = getSettings();
  const next = mergeWithDefaults({ ...current, ...patch });
  globalForSettings.__olympusSettings = next;
  try {
    mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
    writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.warn('[settings] failed to persist', err);
  }
  return next;
}
