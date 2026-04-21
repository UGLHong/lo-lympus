'use client';

import { useCallback, useEffect, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import type { ProjectViewState } from '@/lib/client/project-store';

type ServerDefaultsPayload = {
  tokensSoft: number;
  tokensHard: number;
  wallClockMinutes: number;
  usdHard: number;
  implementAttemptsPerTicket: number;
};

type BudgetsApiPayload = {
  budgets: ProjectViewState['state']['budgets'];
  limits: { implementAttemptsPerTicket?: number };
  serverDefaults: ServerDefaultsPayload;
};

function pct(used: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, (used / cap) * 100);
}

function barTone(percent: number): string {
  if (percent < 60) return 'bg-olympus-green';
  if (percent < 85) return 'bg-olympus-amber';
  return 'bg-olympus-red';
}

type Props = { view: ProjectViewState };

export function BudgetsView({ view }: Props) {
  const projectId = view.state.projectId;
  const { budgets } = view.state;

  const [serverDefaults, setServerDefaults] = useState<ServerDefaultsPayload | null>(null);
  const [tokensHardInput, setTokensHardInput] = useState(String(budgets.tokensHard));
  const [wallMinutesInput, setWallMinutesInput] = useState(
    String(Math.max(1, Math.round(budgets.wallClockCapMs / 60_000))),
  );
  const [usdHardInput, setUsdHardInput] = useState(
    budgets.usdHard > 0 ? String(budgets.usdHard) : '',
  );
  const [attemptsInput, setAttemptsInput] = useState(
    String(view.state.limits?.implementAttemptsPerTicket ?? 6),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/budgets`);
        if (!res.ok) return;
        const data = (await res.json()) as BudgetsApiPayload;
        if (cancelled) return;
        setServerDefaults(data.serverDefaults);
      } catch {
        // ignore
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    setTokensHardInput(String(budgets.tokensHard));
    setWallMinutesInput(
      String(Math.max(1, Math.round(budgets.wallClockCapMs / 60_000))),
    );
    setUsdHardInput(budgets.usdHard > 0 ? String(budgets.usdHard) : '');
    setAttemptsInput(
      String(
        view.state.limits?.implementAttemptsPerTicket ??
          serverDefaults?.implementAttemptsPerTicket ??
          6,
      ),
    );
  }, [
    budgets.tokensHard,
    budgets.wallClockCapMs,
    budgets.usdHard,
    view.state.limits?.implementAttemptsPerTicket,
    serverDefaults?.implementAttemptsPerTicket,
  ]);

  const tokenPercent = pct(budgets.tokensUsed, budgets.tokensHard);
  const wallPercent = pct(budgets.wallClockMs, budgets.wallClockCapMs);
  const usdPercent =
    budgets.usdHard > 0 ? pct(budgets.usdUsed, budgets.usdHard) : 0;

  const handleSave = useCallback(async () => {
    setSaveError(null);
    setSaveOk(false);
    const tokensHard = Number(tokensHardInput);
    const wallClockMinutes = Number(wallMinutesInput);
    const usdRaw = usdHardInput.trim();
    const usdHard = usdRaw === '' ? 0 : Number(usdRaw);
    const implementAttemptsPerTicket = Number(attemptsInput);

    if (!Number.isFinite(tokensHard) || tokensHard < 1000) {
      setSaveError('Token cap must be at least 1,000.');
      return;
    }
    if (!Number.isFinite(wallClockMinutes) || wallClockMinutes < 1) {
      setSaveError('Wall-clock cap must be at least 1 minute.');
      return;
    }
    if (usdRaw !== '' && (!Number.isFinite(usdHard) || usdHard < 0)) {
      setSaveError('USD cap must be empty (unlimited) or a non-negative number.');
      return;
    }
    if (
      !Number.isFinite(implementAttemptsPerTicket) ||
      implementAttemptsPerTicket < 1 ||
      implementAttemptsPerTicket > 64
    ) {
      setSaveError('Implement attempts per ticket must be between 1 and 64.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/budgets`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokensHard,
          wallClockMinutes,
          usdHard,
          implementAttemptsPerTicket,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        setSaveError(err?.error ?? `HTTP ${res.status}`);
        return;
      }
      setSaveOk(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [
    attemptsInput,
    projectId,
    tokensHardInput,
    usdHardInput,
    wallMinutesInput,
  ]);

  const soft = serverDefaults?.tokensSoft;
  const implementAttemptsEffective =
    view.state.limits?.implementAttemptsPerTicket ??
    serverDefaults?.implementAttemptsPerTicket ??
    6;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-olympus-bg p-4 text-sm">
      <div className="mb-4">
        <h2 className="text-base font-medium text-olympus-ink">Budgets & limits</h2>
        <p className="mt-1 max-w-2xl text-xs text-olympus-dim">
          Usage updates live from the pipeline. Caps below are stored on this project (initialized from server env when
          the project was created). Saving emits a <span className="font-mono text-olympus-ink/80">budget.caps</span>{' '}
          event so all connected tabs stay in sync.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-olympus-border bg-olympus-panel/40 p-4">
          <h3 className="mb-3 text-[11px] uppercase tracking-wider text-olympus-dim">
            Current usage
          </h3>
          <div className="space-y-4">
            <BudgetRow
              label="Tokens"
              percent={tokenPercent}
              detail={`${budgets.tokensUsed.toLocaleString()} used · cap ${budgets.tokensHard.toLocaleString()}`}
              hint={
                soft !== undefined && budgets.tokensUsed >= soft
                  ? `At or above soft guidance (${soft.toLocaleString()} from server env)`
                  : soft !== undefined
                    ? `Soft guidance: ${soft.toLocaleString()} tokens (informational)`
                    : undefined
              }
            />
            <BudgetRow
              label="Wall time"
              percent={wallPercent}
              detail={`${formatDuration(budgets.wallClockMs)} used · cap ${formatDuration(budgets.wallClockCapMs)}`}
            />
            <BudgetRow
              label="USD spend"
              percent={usdPercent}
              detail={
                budgets.usdHard > 0
                  ? `$${budgets.usdUsed.toFixed(4)} used · cap $${budgets.usdHard.toFixed(2)}`
                  : `No hard cap · $${budgets.usdUsed.toFixed(4)} recorded`
              }
            />
            <div>
              <div className="flex justify-between text-[11px] text-olympus-dim">
                <span>Implement / review</span>
                <span className="text-olympus-ink/80">
                  max {implementAttemptsEffective} dev+review attempt(s) per ticket before pause
                </span>
              </div>
              <p className="mt-1 text-[11px] text-olympus-dim">
                Prevents endless request-changes loops. Resume in Implement or chat clears blocked tickets when you are
                ready.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-olympus-border bg-olympus-panel/40 p-4">
          <h3 className="mb-3 text-[11px] uppercase tracking-wider text-olympus-dim">
            Edit caps (this project)
          </h3>
          <div className="space-y-3">
            <label className="block">
              <span className="text-[11px] text-olympus-dim">Token hard cap</span>
              <input
                type="number"
                min={1000}
                value={tokensHardInput}
                onChange={(e) => setTokensHardInput(e.target.value)}
                className="mt-1 w-full rounded-md border border-olympus-border bg-olympus-bg px-3 py-2 font-mono text-sm text-olympus-ink"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-olympus-dim">Wall-clock cap (minutes)</span>
              <input
                type="number"
                min={1}
                value={wallMinutesInput}
                onChange={(e) => setWallMinutesInput(e.target.value)}
                className="mt-1 w-full rounded-md border border-olympus-border bg-olympus-bg px-3 py-2 font-mono text-sm text-olympus-ink"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-olympus-dim">
                USD hard cap (empty = no cap)
              </span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0 = unlimited"
                value={usdHardInput}
                onChange={(e) => setUsdHardInput(e.target.value)}
                className="mt-1 w-full rounded-md border border-olympus-border bg-olympus-bg px-3 py-2 font-mono text-sm text-olympus-ink"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-olympus-dim">
                Implement attempts per ticket (1–64)
              </span>
              <input
                type="number"
                min={1}
                max={64}
                value={attemptsInput}
                onChange={(e) => setAttemptsInput(e.target.value)}
                className="mt-1 w-full rounded-md border border-olympus-border bg-olympus-bg px-3 py-2 font-mono text-sm text-olympus-ink"
              />
            </label>
            {saveError && (
              <p className="text-[11px] text-olympus-red">{saveError}</p>
            )}
            {saveOk && !saveError && (
              <p className="text-[11px] text-olympus-green">Saved. Caps updated.</p>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-olympus-accent px-4 py-2 text-xs font-medium text-olympus-bg disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save caps'}
            </button>
          </div>
        </section>
      </div>

      {serverDefaults && (
        <section className="mt-4 rounded-lg border border-dashed border-olympus-border/80 bg-olympus-muted/20 p-4">
          <h3 className="mb-2 text-[11px] uppercase tracking-wider text-olympus-dim">
            Server defaults (env — new projects)
          </h3>
          <p className="mb-2 text-[11px] text-olympus-dim">
            Changing these requires updating the process environment and restarting the Olympus server. They do not
            retroactively change existing projects unless you edit caps here.
          </p>
          <ul className="grid gap-1 font-mono text-[11px] text-olympus-ink/90 sm:grid-cols-2">
            <li>BUDGET_TOKENS_SOFT ≈ {serverDefaults.tokensSoft.toLocaleString()}</li>
            <li>BUDGET_TOKENS_HARD ≈ {serverDefaults.tokensHard.toLocaleString()}</li>
            <li>BUDGET_WALLCLOCK_MINUTES ≈ {serverDefaults.wallClockMinutes}</li>
            <li>BUDGET_USD_HARD ≈ {serverDefaults.usdHard}</li>
            <li>BUDGET_IMPLEMENT_ATTEMPTS_PER_TICKET ≈ {serverDefaults.implementAttemptsPerTicket}</li>
          </ul>
        </section>
      )}
    </div>
  );
}

function BudgetRow({
  label,
  percent,
  detail,
  hint,
}: {
  label: string;
  percent: number;
  detail: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-olympus-dim">{label}</span>
        <span className="text-right text-[10px] text-olympus-dim">{detail}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-olympus-muted/60">
        <div
          className={twMerge('h-full transition-all', barTone(percent))}
          style={{ width: `${percent}%` }}
        />
      </div>
      {hint && <p className="mt-1 text-[10px] text-olympus-amber/90">{hint}</p>}
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m`;
  }
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}
