export type ServerBudgetDefaults = {
  tokensSoft: number;
  tokensHard: number;
  wallClockMinutes: number;
  usdHard: number;
  implementAttemptsPerTicket: number;
};

export function getServerBudgetDefaults(): ServerBudgetDefaults {
  const rawAttempts = process.env.BUDGET_IMPLEMENT_ATTEMPTS_PER_TICKET;
  const parsedAttempts = rawAttempts === undefined ? NaN : Number(rawAttempts);
  return {
    tokensSoft: Number(process.env.BUDGET_TOKENS_SOFT ?? 2_000_000),
    tokensHard: Number(process.env.BUDGET_TOKENS_HARD ?? 5_000_000),
    wallClockMinutes: Number(process.env.BUDGET_WALLCLOCK_MINUTES ?? 180),
    usdHard: Number(process.env.BUDGET_USD_HARD ?? 0),
    implementAttemptsPerTicket:
      Number.isFinite(parsedAttempts) && parsedAttempts > 0
        ? Math.floor(parsedAttempts)
        : 6,
  };
}
