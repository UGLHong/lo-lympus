import { NextResponse } from "next/server";
import { z } from "zod";
import { emit } from "@/lib/events/bus";
import { appendEvent, readState, writeState } from "@/lib/workspace/fs";
import { getServerBudgetDefaults } from "@/lib/const/budget-defaults";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const patchSchema = z
  .object({
    tokensHard: z.number().int().min(1_000).max(Number.MAX_SAFE_INTEGER).optional(),
    wallClockMinutes: z.number().min(1).max(10_080).optional(),
    usdHard: z.number().min(0).max(1_000_000).optional(),
    implementAttemptsPerTicket: z.number().int().min(1).max(64).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "at least one field is required",
  });

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const state = await readState(id);
    return NextResponse.json({
      budgets: state.budgets,
      limits: state.limits ?? {},
      serverDefaults: getServerBudgetDefaults(),
    });
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let state;
  try {
    state = await readState(id);
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const patch = parsed.data;
  const nextBudgets = { ...state.budgets };
  if (patch.tokensHard !== undefined) nextBudgets.tokensHard = patch.tokensHard;
  if (patch.wallClockMinutes !== undefined) {
    nextBudgets.wallClockCapMs = Math.round(patch.wallClockMinutes * 60_000);
  }
  if (patch.usdHard !== undefined) nextBudgets.usdHard = patch.usdHard;

  const nextLimits = { ...(state.limits ?? {}) };
  if (patch.implementAttemptsPerTicket !== undefined) {
    nextLimits.implementAttemptsPerTicket = patch.implementAttemptsPerTicket;
  }
  const limitsOut =
    Object.keys(nextLimits).length > 0 ? nextLimits : undefined;

  const now = new Date().toISOString();
  await writeState({
    ...state,
    updatedAt: now,
    budgets: nextBudgets,
    limits: limitsOut,
  });

  await appendEvent(
    emit({
      projectId: id,
      kind: "budget.caps",
      tokensHard: nextBudgets.tokensHard,
      wallClockCapMs: nextBudgets.wallClockCapMs,
      usdHard: nextBudgets.usdHard,
      implementAttemptsPerTicket: limitsOut?.implementAttemptsPerTicket,
    }),
  );

  await appendEvent(
    emit({
      projectId: id,
      kind: "log",
      level: "info",
      message: "budget caps updated via UI",
    }),
  );

  return NextResponse.json({
    ok: true,
    budgets: nextBudgets,
    limits: limitsOut ?? {},
    serverDefaults: getServerBudgetDefaults(),
  });
}
