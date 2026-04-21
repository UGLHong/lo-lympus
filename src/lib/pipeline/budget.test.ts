import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectState } from '@/lib/schemas/state';
import { bumpUsage, bumpWallClock, enforceBudgets, evaluateBudget } from './budget';
import { createProject, readState } from '@/lib/workspace/fs';

function stateWith(overrides: Partial<ProjectState['budgets']> = {}): ProjectState {
  return {
    projectId: 'test',
    name: 'test',
    slug: 'test',
    phase: 'INTAKE',
    paused: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    budgets: {
      tokensUsed: 0,
      tokensHard: 1000,
      wallClockMs: 0,
      wallClockCapMs: 60_000,
      usdUsed: 0,
      usdHard: 0,
      ...overrides,
    },
    phaseHistory: [{ phase: 'INTAKE', startedAt: '2026-01-01T00:00:00.000Z', status: 'running' }],
    clarifications: [],
    assumptions: [],
  };
}

describe('evaluateBudget', () => {
  it('returns ok when both caps have headroom', () => {
    expect(evaluateBudget(stateWith())).toEqual({ ok: true });
  });

  it('trips on tokens when at or above the hard cap', () => {
    const check = evaluateBudget(stateWith({ tokensUsed: 1000 }));
    expect(check).toEqual({ ok: false, reason: 'tokens', usage: 1000, cap: 1000 });
  });

  it('trips on wall-clock when at or above the cap', () => {
    const check = evaluateBudget(stateWith({ wallClockMs: 60_000 }));
    expect(check).toEqual({ ok: false, reason: 'wallclock', usage: 60_000, cap: 60_000 });
  });

  it('prefers tokens over wall-clock when both caps are breached', () => {
    const check = evaluateBudget(stateWith({ tokensUsed: 9_999, wallClockMs: 9_999_999 }));
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('tokens');
  });

  it('is permissive when caps are disabled (zero)', () => {
    expect(
      evaluateBudget(stateWith({ tokensHard: 0, wallClockCapMs: 0, tokensUsed: 9_999, wallClockMs: 9_999 })),
    ).toEqual({ ok: true });
  });

  it('trips on USD when spend reaches the cap', () => {
    const check = evaluateBudget(stateWith({ usdUsed: 5, usdHard: 5 }));
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe('usd');
      expect(check.usage).toBe(5);
      expect(check.cap).toBe(5);
    }
  });

  it('ignores USD when cap is zero (cap disabled)', () => {
    const check = evaluateBudget(stateWith({ usdUsed: 99, usdHard: 0 }));
    expect(check).toEqual({ ok: true });
  });

  it('prefers tokens over USD when both trip', () => {
    const check = evaluateBudget(stateWith({ tokensUsed: 1000, usdUsed: 10, usdHard: 5 }));
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('tokens');
  });
});

describe('enforceBudgets + bumpWallClock (integration against temp fs)', () => {
  let tmpRoot: string;
  const originalEnv = process.env.OLYMPUS_WORKSPACES_DIR;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'olympus-budget-'));
    process.env.OLYMPUS_WORKSPACES_DIR = tmpRoot;
  });

  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.OLYMPUS_WORKSPACES_DIR;
    else process.env.OLYMPUS_WORKSPACES_DIR = originalEnv;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('bumpWallClock accumulates across calls', async () => {
    process.env.BUDGET_TOKENS_HARD = '10000';
    process.env.BUDGET_WALLCLOCK_MINUTES = '1';
    const state = await createProject({ name: 'budget-test', requirement: 'hello' });

    await bumpWallClock(state.projectId, 400);
    await bumpWallClock(state.projectId, 600);

    const after = await readState(state.projectId);
    expect(after.budgets.wallClockMs).toBe(1000);
  });

  it('enforceBudgets flips state.paused and emits a pause reason when wall-clock is exhausted', async () => {
    process.env.BUDGET_TOKENS_HARD = '10000';
    process.env.BUDGET_WALLCLOCK_MINUTES = '1';
    const state = await createProject({ name: 'budget-test-2', requirement: 'hello' });

    await bumpWallClock(state.projectId, 60_000);

    const check = await enforceBudgets(state.projectId);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('wallclock');

    const after = await readState(state.projectId);
    expect(after.paused).toBe(true);
  });

  it('bumpUsage records both tokens and USD for a priced model', async () => {
    process.env.BUDGET_TOKENS_HARD = '10000000';
    process.env.BUDGET_WALLCLOCK_MINUTES = '120';
    const state = await createProject({ name: 'usd-test', requirement: 'hello' });

    await bumpUsage(state.projectId, 'openai/gpt-4o-mini', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
    });

    const after = await readState(state.projectId);
    expect(after.budgets.tokensUsed).toBe(2_000_000);
    expect(after.budgets.usdUsed).toBeCloseTo(0.15 + 0.6, 4);
  });

  it('bumpUsage records tokens but $0 when the model is unknown', async () => {
    process.env.BUDGET_TOKENS_HARD = '10000000';
    process.env.BUDGET_WALLCLOCK_MINUTES = '120';
    const state = await createProject({ name: 'usd-test-2', requirement: 'hello' });

    await bumpUsage(state.projectId, 'unknown/xyz', {
      promptTokens: 500,
      completionTokens: 500,
      totalTokens: 1000,
    });

    const after = await readState(state.projectId);
    expect(after.budgets.tokensUsed).toBe(1000);
    expect(after.budgets.usdUsed).toBe(0);
  });

  it('enforceBudgets pauses on USD cap and reports reason=usd', async () => {
    process.env.BUDGET_TOKENS_HARD = '10000000';
    process.env.BUDGET_WALLCLOCK_MINUTES = '120';
    process.env.BUDGET_USD_HARD = '0.10';
    const state = await createProject({ name: 'usd-test-3', requirement: 'hello' });

    await bumpUsage(state.projectId, 'openai/gpt-4o-mini', {
      promptTokens: 1_000_000,
      completionTokens: 0,
      totalTokens: 1_000_000,
    });

    const check = await enforceBudgets(state.projectId);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('usd');

    const after = await readState(state.projectId);
    expect(after.paused).toBe(true);

    delete process.env.BUDGET_USD_HARD;
  });

  it('enforceBudgets is a no-op the second time (idempotent pause)', async () => {
    process.env.BUDGET_TOKENS_HARD = '10000';
    process.env.BUDGET_WALLCLOCK_MINUTES = '1';
    const state = await createProject({ name: 'budget-test-3', requirement: 'hello' });

    await bumpWallClock(state.projectId, 60_000);
    await enforceBudgets(state.projectId);
    const firstCheck = await enforceBudgets(state.projectId);

    expect(firstCheck.ok).toBe(false);
    const after = await readState(state.projectId);
    expect(after.paused).toBe(true);
  });
});
