"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";
import { subscribeOlympusEvents } from "@/lib/client/project-store";
import type { OlympusEvent } from "@/lib/schemas/events";

type Props = {
  projectId: string;
  className?: string;
};

type LaunchOutcome =
  | { kind: "idle" }
  | { kind: "pending" }
  | {
      kind: "success";
      zedLaunched: boolean;
      launchError?: string;
      workspacePath: string;
      ticketsCount: number;
    }
  | { kind: "error"; message: string };

const ZED_SESSION_STORAGE_PREFIX = "olympus:zed-session:v1:";

type PersistedZedSession = {
  v: 1;
  zedLaunched: boolean;
  launchError?: string;
  workspacePath: string;
  ticketsCount: number;
};

function persistZedSession(
  projectId: string,
  payload: Omit<PersistedZedSession, "v">,
) {
  try {
    const body: PersistedZedSession = { v: 1, ...payload };
    sessionStorage.setItem(
      `${ZED_SESSION_STORAGE_PREFIX}${projectId}`,
      JSON.stringify(body),
    );
  } catch {
    // private mode / quota
  }
}

function readPersistedZedOutcome(projectId: string): LaunchOutcome {
  if (typeof window === "undefined") return { kind: "idle" };
  try {
    const raw = sessionStorage.getItem(
      `${ZED_SESSION_STORAGE_PREFIX}${projectId}`,
    );
    if (!raw) return { kind: "idle" };
    const data = JSON.parse(raw) as Partial<PersistedZedSession>;
    if (data.v !== 1 || typeof data.workspacePath !== "string") {
      return { kind: "idle" };
    }
    return {
      kind: "success",
      zedLaunched: Boolean(data.zedLaunched),
      launchError:
        typeof data.launchError === "string" ? data.launchError : undefined,
      workspacePath: data.workspacePath,
      ticketsCount: Number.isFinite(data.ticketsCount)
        ? Number(data.ticketsCount)
        : 0,
    };
  } catch {
    return { kind: "idle" };
  }
}

function focusPathForZed(event: OlympusEvent): string | null {
  if (
    event.kind === "source.written" ||
    event.kind === "artifact.written" ||
    event.kind === "file.edit"
  ) {
    return event.path;
  }
  if (event.kind === "incident.opened") return event.path ?? null;
  return null;
}

export function OpenInZedButton({ projectId, className }: Props) {
  const [outcome, setOutcome] = useState<LaunchOutcome>({ kind: "idle" });
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);

  // settings-written is enough to start following: the server has dropped
  // .zed/settings.json and attempted a launch. even if our spawn reported an
  // error, the user may have Zed open (e.g. WSL+Windows Zed) and file-focus
  // spawns can still land in that window.
  const settingsReady = outcome.kind === "success";

  useEffect(() => {
    setOutcome(readPersistedZedOutcome(projectId));
  }, [projectId]);

  useEffect(() => {
    followingRef.current = following;
  }, [following]);

  useEffect(() => {
    if (!settingsReady) return;
    return subscribeOlympusEvents(projectId, (event) => {
      if (!followingRef.current) return;
      const path = focusPathForZed(event);
      if (!path) return;
      void fetch(`/api/projects/${projectId}/zed/focus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, line: 1 }),
      });
    });
  }, [projectId, settingsReady]);

  const handleOpen = useCallback(async () => {
    setOutcome({ kind: "pending" });
    try {
      const response = await fetch(`/api/projects/${projectId}/open-in-zed`, {
        method: "POST",
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setOutcome({
          kind: "error",
          message:
            typeof body?.error === "string"
              ? body.error
              : "failed to open in Zed",
        });
        return;
      }

      const data = await response.json();
      const successOutcome: Extract<LaunchOutcome, { kind: "success" }> = {
        kind: "success",
        zedLaunched: Boolean(data.zedLaunched),
        launchError:
          typeof data.launchError === "string" ? data.launchError : undefined,
        workspacePath: String(data.workspacePath ?? ""),
        ticketsCount: Number(data.ticketsCount ?? 0),
      };
      setOutcome(successOutcome);
      persistZedSession(projectId, {
        zedLaunched: successOutcome.zedLaunched,
        launchError: successOutcome.launchError,
        workspacePath: successOutcome.workspacePath,
        ticketsCount: successOutcome.ticketsCount,
      });
    } catch (err) {
      setOutcome({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [projectId]);

  const handleFollowToggle = useCallback(() => {
    setFollowing((prev) => !prev);
  }, []);

  const openLabel = outcome.kind === "pending" ? "Opening…" : "Open in Zed";
  const tooltip = buildTooltip(outcome);

  return (
    <div className={twMerge("relative flex items-center gap-1.5", className)}>
      <button
        type="button"
        onClick={handleOpen}
        disabled={outcome.kind === "pending"}
        title={
          tooltip ??
          "Write .zed/settings.json and launch Zed pointing at this workspace"
        }
        className={twMerge(
          "rounded border border-olympus-border bg-olympus-muted px-2.5 py-1 text-xs text-olympus-ink transition hover:bg-olympus-panel disabled:opacity-60",
          outcome.kind === "success" &&
            outcome.zedLaunched &&
            "border-olympus-green/60",
          outcome.kind === "success" &&
            !outcome.zedLaunched &&
            "border-olympus-amber/60",
          outcome.kind === "error" && "border-olympus-red/60",
        )}
      >
        {openLabel}
      </button>

      {settingsReady && (
        <FollowToggle following={following} onChange={handleFollowToggle} />
      )}

      {outcome.kind === "success" && !outcome.zedLaunched && (
        <span className="ml-1 max-w-[240px] truncate text-[11px] text-olympus-amber">
          Zed not found — settings written to {outcome.workspacePath}/.zed
        </span>
      )}
      {outcome.kind === "error" && (
        <span className="ml-1 max-w-[240px] truncate text-[11px] text-olympus-red">
          {outcome.message}
        </span>
      )}
    </div>
  );
}

type FollowToggleProps = {
  following: boolean;
  onChange: () => void;
};

function FollowToggle({ following, onChange }: FollowToggleProps) {
  const tooltip = following
    ? "Zed follows every file the agents write. Click to stop."
    : "Zed is not following edits. Click to resume.";

  return (
    <button
      type="button"
      onClick={onChange}
      title={tooltip}
      className={twMerge(
        "inline-flex items-center gap-1 rounded border px-2 py-1 text-xs transition",
        following
          ? "border-olympus-green/60 bg-olympus-green/10 text-olympus-green hover:bg-olympus-green/15"
          : "border-olympus-border bg-olympus-muted text-olympus-dim hover:bg-olympus-panel",
      )}
    >
      <span
        className={twMerge(
          "inline-block h-1.5 w-1.5 rounded-full",
          following ? "animate-pulse-dot bg-olympus-green" : "bg-olympus-dim",
        )}
      />
      {following ? "following" : "paused"}
    </button>
  );
}

function buildTooltip(outcome: LaunchOutcome): string | null {
  if (outcome.kind === "success") {
    const lines = [
      `workspace: ${outcome.workspacePath}`,
      `tickets indexed: ${outcome.ticketsCount}`,
    ];
    if (outcome.zedLaunched) lines.push("zed launched");
    else
      lines.push(
        `zed not launched: ${outcome.launchError ?? "binary missing"}`,
      );
    return lines.join("\n");
  }
  if (outcome.kind === "error") return outcome.message;
  return null;
}
