import { emit } from '@/lib/events/bus';
import { appendEvent, readState, writeState } from '@/lib/workspace/fs';
import type { ProjectState } from '@/lib/schemas/state';
import { computeUsdCost } from '@/lib/llm/pricing';
import type { UsageInfo } from '@/lib/llm/types';

export type BudgetReason = 'tokens' | 'wallclock' | 'usd';

export type BudgetCheck =
  | { ok: true }
  | { ok: false; reason: BudgetReason; usage: number; cap: number };

// pure predicate — useful for tests and anywhere we need to reason about
// the budget state without side effects. precedence: tokens → USD → wall-clock,
// because token exhaustion is the least operator-configurable of the three.
export function evaluateBudget(state: ProjectState): BudgetCheck {
  const { budgets } = state;
  if (budgets.tokensHard > 0 && budgets.tokensUsed >= budgets.tokensHard) {
    return { ok: false, reason: 'tokens', usage: budgets.tokensUsed, cap: budgets.tokensHard };
  }

  if (budgets.usdHard > 0 && budgets.usdUsed >= budgets.usdHard) {
    return { ok: false, reason: 'usd', usage: budgets.usdUsed, cap: budgets.usdHard };
  }

  if (budgets.wallClockCapMs > 0 && budgets.wallClockMs >= budgets.wallClockCapMs) {
    return { ok: false, reason: 'wallclock', usage: budgets.wallClockMs, cap: budgets.wallClockCapMs };
  }

  return { ok: true };
}

// stamps state.paused + emits pipeline.paused so the driver, implement loop,
// and self-heal loop all bail out of their current step. idempotent — calling
// it twice only fires the pause event once (we check state.paused first).
export async function enforceBudgets(projectId: string): Promise<BudgetCheck> {
  const state = await readState(projectId);
  const check = evaluateBudget(state);

  if (check.ok || state.paused) return check;

  const reason = formatPauseReason(check);
  await writeState({ ...state, paused: true });

  const event = emit({ projectId, kind: 'pipeline.paused', reason });
  await appendEvent(event);

  const log = emit({
    projectId,
    kind: 'log',
    level: 'error',
    message: `budget exhausted: ${reason}. set state.paused=true.`,
  });
  await appendEvent(log);

  return check;
}

// accumulates the elapsed time of a single agent turn against the project's
// wall-clock budget. token and USD usage are bumped separately by the
// streaming provider hook so we only have to deal with wall-clock here.
export async function bumpWallClock(projectId: string, elapsedMs: number): Promise<ProjectState | null> {
  if (elapsedMs <= 0) return null;
  try {
    const state = await readState(projectId);
    const nextState: ProjectState = {
      ...state,
      budgets: { ...state.budgets, wallClockMs: state.budgets.wallClockMs + elapsedMs },
    };
    await writeState(nextState);
    emit({
      projectId,
      kind: 'budget.update',
      tokensUsed: nextState.budgets.tokensUsed,
      wallClockMs: nextState.budgets.wallClockMs,
      usdUsed: nextState.budgets.usdUsed,
    });
    return nextState;
  } catch {
    return null;
  }
}

// folds a single turn's `UsageInfo` into the budget state. bumps tokensUsed
// by `totalTokens` (falls back to prompt + completion) and usdUsed via the
// model pricing table. one write + one event covers both metrics.
export async function bumpUsage(
  projectId: string,
  model: string,
  usage: UsageInfo,
): Promise<ProjectState | null> {
  const tokenDelta =
    usage.totalTokens ??
    ((usage.promptTokens ?? 0) + (usage.completionTokens ?? 0));
  const usdDelta = computeUsdCost(model, usage);

  if (tokenDelta <= 0 && usdDelta <= 0) return null;

  try {
    const state = await readState(projectId);
    const nextState: ProjectState = {
      ...state,
      budgets: {
        ...state.budgets,
        tokensUsed: state.budgets.tokensUsed + Math.max(0, tokenDelta),
        usdUsed: state.budgets.usdUsed + Math.max(0, usdDelta),
      },
    };
    await writeState(nextState);
    emit({
      projectId,
      kind: 'budget.update',
      tokensUsed: nextState.budgets.tokensUsed,
      wallClockMs: nextState.budgets.wallClockMs,
      usdUsed: nextState.budgets.usdUsed,
    });
    return nextState;
  } catch {
    return null;
  }
}

function formatPauseReason(check: Extract<BudgetCheck, { ok: false }>): string {
  if (check.reason === 'tokens') {
    return `token hard cap hit (${check.usage.toLocaleString()} / ${check.cap.toLocaleString()})`;
  }
  if (check.reason === 'usd') {
    return `USD cost cap hit ($${check.usage.toFixed(2)} / $${check.cap.toFixed(2)})`;
  }
  const usedMin = Math.round(check.usage / 60_000);
  const capMin = Math.round(check.cap / 60_000);
  return `wall-clock cap hit (${usedMin}m / ${capMin}m)`;
}
