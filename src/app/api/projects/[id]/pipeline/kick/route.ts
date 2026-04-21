import { NextResponse } from "next/server";
import { driveProject } from "@/lib/pipeline/driver";
import {
  clearPipelineProjectBusy,
  isPipelineProjectBusy,
  markPipelineProjectBusy,
} from "@/lib/pipeline/in-flight-projects";
import { unstickOperatorPipelineState } from "@/lib/pipeline/operator-unstick";
import { stopSoftwareHouse } from "@/lib/pipeline/software-house";
import { appendEvent, readState } from "@/lib/workspace/fs";
import { emit } from "@/lib/events/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const url = new URL(request.url);
  const restart = url.searchParams.get("restart") === "true";

  let state;
  try {
    state = await readState(id);
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (state.phase === "DEMO") {
    return NextResponse.json(
      { error: "Pipeline is complete (DEMO). Restart is disabled." },
      { status: 400 },
    );
  }

  if (isPipelineProjectBusy(id)) {
    return NextResponse.json(
      { error: "Another pipeline operation is still running for this project." },
      { status: 409 },
    );
  }

  markPipelineProjectBusy(id);

  const kickedFromPhase = state.phase;

  void (async (): Promise<void> => {
    try {
      if (restart) {
        await stopSoftwareHouse(id);
        await appendEvent(
          emit({
            projectId: id,
            kind: "log",
            level: "info",
            message: "pipeline kick: stopped running house, rebuilding",
          }),
        );
      }
      await unstickOperatorPipelineState(id);
      await appendEvent(
        emit({
          projectId: id,
          kind: "log",
          level: "info",
          message: `pipeline kick: running driveProject from phase ${kickedFromPhase}`,
        }),
      );
      await driveProject({ projectId: id });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[pipeline/kick]", err);
    } finally {
      clearPipelineProjectBusy(id);
    }
  })();

  return NextResponse.json({ ok: true, kickedFromPhase, restart });
}
