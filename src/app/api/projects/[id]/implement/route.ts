import { NextResponse } from "next/server";
import { z } from "zod";
import { runImplementLoop } from "@/lib/pipeline/implement";
import { appendEvent, readState, writeState } from "@/lib/workspace/fs";
import { emit } from "@/lib/events/bus";
import { enforceBudgets } from "@/lib/pipeline/budget";
import { validateGate } from "@/lib/pipeline/gate";
import { hasPendingImplementWork, readTicketsIndex } from "@/lib/workspace/tickets";
import {
  advanceIntegrateToBringup,
  driveProject,
} from "@/lib/pipeline/driver";
import {
  clearPipelineProjectBusy,
  isPipelineProjectBusy,
  markPipelineProjectBusy,
} from "@/lib/pipeline/in-flight-projects";
import { unstickOperatorPipelineState } from "@/lib/pipeline/operator-unstick";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z
  .object({
    // Cap on attempts for this single HTTP call. The loop also computes a
    // dynamic ticket-count-aware cap internally; leaving this undefined lets
    // that default take over.
    maxSteps: z.number().int().min(1).max(128).optional(),
    resume: z.boolean().optional(),
    // Autotick POSTs come from the client-side poller. We want them to be
    // best-effort and idempotent: skip when the loop is already running for
    // this project, and skip when there's nothing useful to do.
    autotick: z.boolean().optional(),
  })
  .partial();

type Context = { params: Promise<{ id: string }> };

async function advancePhase(
  projectId: string,
  fromPhase: "IMPLEMENT",
  toPhase: "INTEGRATE",
): Promise<void> {
  const state = await readState(projectId);
  if (state.phase !== fromPhase) return;

  const now = new Date().toISOString();
  const history = [...state.phaseHistory];
  const open = history.findIndex(
    (h) => h.phase === fromPhase && h.status === "running",
  );
  if (open >= 0) {
    history[open] = { ...history[open]!, endedAt: now, status: "done" };
  }
  history.push({ phase: toPhase, startedAt: now, status: "running" });

  await writeState({ ...state, phase: toPhase, phaseHistory: history });
  await appendEvent(
    emit({ projectId, kind: "phase.advanced", fromPhase, toPhase }),
  );
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    await readState(id);
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { maxSteps, resume, autotick } = parsed.data;

  // Early exit for autotick: if another implement batch is already running,
  // just report back. The client will poll again later.
  if (isPipelineProjectBusy(id)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "implement loop already running",
    });
  }

  const state = await readState(id);

  if (resume) {
    await unstickOperatorPipelineState(id);
    await appendEvent(
      emit({
        projectId: id,
        kind: "log",
        level: "info",
        message: "implement loop resumed by human",
      }),
    );
  }

  // Autotick guards — don't waste a turn if the project is in no shape to
  // make progress. These checks are cheap and keep budget/USD usage honest
  // when the UI is polling in the background.
  if (autotick) {
    const currentState = await readState(id);
    if (currentState.phase !== "IMPLEMENT") {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: `phase is ${currentState.phase}, not IMPLEMENT`,
      });
    }
    if (currentState.paused) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "project is paused (HELP_NEEDED)",
      });
    }

    const budget = await enforceBudgets(id);
    if (!budget.ok) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: `budget exhausted (${budget.reason})`,
      });
    }

    const index = await readTicketsIndex(id);
    if (!index || index.tickets.length === 0) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "no tickets index yet",
      });
    }
    if (!hasPendingImplementWork(index)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "no implementable ticket or pending review",
      });
    }
  }

  markPipelineProjectBusy(id);
  let summary;
  let gateOk = false;
  let gateFailingCheck: string | undefined;
  let advanced = false;
  try {
    summary = await runImplementLoop({ projectId: id, maxSteps });

    // Mirror runImplementPhase behaviour from the driver: evaluate the
    // INTEGRATE gate after the loop settles and advance when it passes.
    // Without this, autotick/manual runs would leave the project sitting at
    // IMPLEMENT even after all tickets are done.
    if (!summary.paused && summary.blocked.length === 0) {
      const gate = await validateGate(id, "INTEGRATE");
      gateOk = gate.ok;
      gateFailingCheck = gate.checks.find((c) => !c.ok)?.label;

      await appendEvent(
        emit({
          projectId: id,
          kind: "gate.evaluated",
          targetPhase: "INTEGRATE",
          ok: gate.ok,
          failingCheck: gateFailingCheck,
        }),
      );

      if (gate.ok) {
        await advancePhase(id, "IMPLEMENT", "INTEGRATE");
        await advanceIntegrateToBringup(id);
        advanced = true;
        void driveProject({ projectId: id }).catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[implement:drive-after-bringup]", err);
        });
      }
    }
  } finally {
    clearPipelineProjectBusy(id);
  }

  return NextResponse.json({
    ok: true,
    summary,
    gate: { ok: gateOk, failingCheck: gateFailingCheck, advanced },
  });
}
