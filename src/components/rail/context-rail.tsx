'use client';

import type { ProjectViewState } from '@/lib/client/project-store';
import { ROLE_LIST } from '@/lib/const/roles';
import { useProjectNavigation } from '@/components/layout/project-navigation';
import { DotLottieRoleAvatar } from '@/components/ui/dotlottie-role-avatar';

export function ContextRail({ view }: { view: ProjectViewState }) {
  const { openTab } = useProjectNavigation();
  const { tokensUsed, tokensHard, wallClockMs, wallClockCapMs, usdUsed, usdHard } = view.state.budgets;
  const tokenPercent = Math.min(100, (tokensUsed / Math.max(1, tokensHard)) * 100);
  const wallPercent = Math.min(100, (wallClockMs / Math.max(1, wallClockCapMs)) * 100);
  const usdPercent = usdHard > 0 ? Math.min(100, (usdUsed / usdHard) * 100) : 0;
  const implementAttempts = view.state.limits?.implementAttemptsPerTicket;

  const handleOpenBudgets = () => openTab('budgets');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-olympus-border px-3 py-2 text-xs uppercase tracking-wider text-olympus-dim">
        Context
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-5 text-sm">
        <section>
          <div className="mb-2 text-[11px] uppercase tracking-wider text-olympus-dim">Phase</div>
          <div className="rounded-md border border-olympus-border bg-olympus-muted/30 px-3 py-2">
            <div className="font-mono text-sm text-olympus-ink">{view.state.phase}</div>
            <div className="text-[11px] text-olympus-dim">
              started {new Date(view.state.phaseHistory[view.state.phaseHistory.length - 1]?.startedAt ?? view.state.createdAt).toLocaleTimeString()}
            </div>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wider text-olympus-dim">Budgets</span>
            <button
              type="button"
              onClick={handleOpenBudgets}
              className="rounded border border-olympus-border px-2 py-0.5 text-[10px] text-olympus-dim hover:bg-olympus-muted/40 hover:text-olympus-ink"
            >
              all · edit
            </button>
          </div>
          <div className="space-y-2">
            <BudgetBar
              label="tokens"
              percent={tokenPercent}
              detail={`${tokensUsed.toLocaleString()} / ${tokensHard.toLocaleString()}`}
            />
            <BudgetBar
              label="wall time"
              percent={wallPercent}
              detail={`${formatShortDuration(wallClockMs)} / ${formatShortDuration(wallClockCapMs)}`}
            />
            <BudgetBar
              label="usd"
              percent={usdHard > 0 ? usdPercent : 0}
              detail={
                usdHard > 0
                  ? `$${usdUsed.toFixed(2)} / $${usdHard.toFixed(2)}`
                  : `$${usdUsed.toFixed(2)} · no cap`
              }
            />
            <div className="rounded-md border border-olympus-border/60 bg-olympus-muted/15 px-2 py-1.5 text-[10px] text-olympus-dim">
              <div className="flex justify-between gap-1 text-olympus-ink/85">
                <span>implement / ticket</span>
                <span className="font-mono">{implementAttempts ?? 'env'} max</span>
              </div>
              <p className="mt-0.5 text-[9px] leading-snug text-olympus-dim">
                Dev+review rounds before pause. Set on Budgets tab or in project state.
              </p>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-2 text-[11px] uppercase tracking-wider text-olympus-dim">Mini-map</div>
          <div className="grid grid-cols-4 gap-2">
            {ROLE_LIST.map((role) => {
              const state = view.roleStates[role.key] ?? 'idle';
              return (
                <div
                  key={role.key}
                  className="flex flex-col items-center gap-1"
                  title={`${role.displayName} — ${state}`}
                >
                  <DotLottieRoleAvatar 
                    role={role.key} 
                    state={state}
                    size={32}
                    bgColor={`linear-gradient(135deg, ${role.color}50, ${role.color}30)`}
                  />
                  <span className="text-[9px] text-olympus-dim truncate w-full text-center" title={role.displayName}>
                    {role.key}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-2 text-[11px] uppercase tracking-wider text-olympus-dim">Last event</div>
          <div className="rounded-md border border-olympus-border bg-olympus-muted/20 p-2 font-mono text-[10px] text-olympus-dim">
            {view.lastEventTs ?? 'no events yet'}
          </div>
        </section>
      </div>
    </div>
  );
}

function BudgetBar({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  const color = percent < 60 ? 'bg-olympus-green' : percent < 85 ? 'bg-olympus-amber' : 'bg-olympus-red';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[11px] text-olympus-dim">{label}</span>
        <span className="text-right text-[10px] text-olympus-dim">{detail}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-olympus-muted/60">
        <div className={`h-full transition-all ${color}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function formatShortDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 120) return `${Math.round(m / 60)}h`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
