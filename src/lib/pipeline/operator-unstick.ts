import { emit } from "@/lib/events/bus";
import {
  appendEvent,
  deleteArtifact,
  readState,
  writeState,
} from "@/lib/workspace/fs";
import { resetBlockedTickets, resetStuckInFlightTickets } from "@/lib/workspace/tickets";

/** Clears pause + blocked/stuck tickets so the driver can make progress again. */
export async function unstickOperatorPipelineState(projectId: string): Promise<void> {
  const state = await readState(projectId);
  if (state.paused) {
    await writeState({ ...state, paused: false });
    await appendEvent(
      emit({
        projectId,
        kind: "log",
        level: "info",
        message: "pipeline: cleared paused flag (operator)",
      }),
    );
  }

  const reopened = await resetBlockedTickets(projectId);
  if (reopened.length > 0) {
    await deleteArtifact(projectId, "HELP_NEEDED.md");
    await appendEvent(
      emit({
        projectId,
        kind: "log",
        level: "info",
        message: `pipeline: reopened blocked ticket(s): ${reopened.join(", ")}`,
      }),
    );
    for (const code of reopened) {
      await appendEvent(
        emit({
          projectId,
          kind: "ticket.status",
          code,
          status: "changes-requested",
          attempts: 0,
        }),
      );
    }
  }

  const unstuck = await resetStuckInFlightTickets(projectId);
  if (unstuck.length > 0) {
    await appendEvent(
      emit({
        projectId,
        kind: "log",
        level: "info",
        message: `pipeline: reset stuck in-flight ticket(s): ${unstuck.join(", ")}`,
      }),
    );
    for (const code of unstuck) {
      await appendEvent(
        emit({
          projectId,
          kind: "ticket.status",
          code,
          status: "changes-requested",
          attempts: 0,
        }),
      );
    }
  }
}
