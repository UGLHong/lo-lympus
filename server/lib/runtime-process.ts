import { type ChildProcess, spawn } from "node:child_process";

import { emit } from "../../app/lib/event-bus.server";
import { projectWorkspace } from "../workspace/paths";

// keep a single global map of running dev-servers across the server process,
// so both the `runtime` agent tool and the human-facing "run application"
// button talk to the same supervised child.
const globalForRuntime = globalThis as unknown as {
  __olympusRuntimeProcesses?: Map<string, RuntimeProcess>;
  __olympusLogBuffers?: Map<string, string[]>;
};

interface RuntimeProcess {
  child: ChildProcess;
  port?: number;
  command: string;
  startedAt: number;
  exited: boolean;
}

const processes = (globalForRuntime.__olympusRuntimeProcesses ??= new Map());

// ring-buffer of recent stdout+stderr lines per project slug, capped at 500
const logBuffers = (globalForRuntime.__olympusLogBuffers ??= new Map<
  string,
  string[]
>());

const PORT_REGEX = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/;

const IS_POSIX = process.platform !== "win32";

interface StartOptions {
  projectId: string;
  projectSlug: string;
  role: string;
  taskId?: string;
  command?: string;
  waitMs?: number;
}

export interface RuntimeStartResult {
  status: "running" | "already-running" | "starting" | "port-ready";
  pid?: number;
  port?: number;
  command: string;
}

export function getRuntimeStatus(projectSlug: string): {
  status: "running" | "stopped";
  pid?: number;
  port?: number;
} {
  const existing = processes.get(projectSlug);
  if (!existing || existing.exited) return { status: "stopped" };
  return {
    status: "running",
    pid: existing.child.pid,
    port: existing.port,
  };
}

export function hasRuntime(projectSlug: string): boolean {
  const existing = processes.get(projectSlug);
  return Boolean(existing && !existing.exited);
}

// send a signal to the child's process group on POSIX so the dev server's
// grandchildren (vite workers, esbuild, uvicorn reloader, etc.) don't
// outlive the shell we spawned.
function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  if (!IS_POSIX) {
    try {
      child.kill(signal);
    } catch {
      // already exited
    }
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already exited
    }
  }
}

export function stopRuntime(projectSlug: string): boolean {
  const existing = processes.get(projectSlug);
  if (!existing) return false;
  if (!existing.exited) signalTree(existing.child, "SIGTERM");
  processes.delete(projectSlug);
  return true;
}

// graceful shutdown: SIGTERM the whole process tree, wait briefly for exit,
// then escalate to SIGKILL. used before starting a new dev server so the
// port / socket has actually been released and there are no orphans.
export async function stopRuntimeAsync(
  projectSlug: string,
  options: { timeoutMs?: number } = {},
): Promise<{ stopped: boolean; escalatedToKill: boolean }> {
  const existing = processes.get(projectSlug);
  if (!existing) return { stopped: false, escalatedToKill: false };

  const timeoutMs = options.timeoutMs ?? 4000;

  if (existing.exited) {
    processes.delete(projectSlug);
    return { stopped: true, escalatedToKill: false };
  }

  const exited = new Promise<void>((resolve) => {
    if (existing.exited) {
      resolve();
      return;
    }
    existing.child.once("exit", () => resolve());
  });

  signalTree(existing.child, "SIGTERM");

  const timedOut = await raceWithTimeout(exited, timeoutMs);
  let escalatedToKill = false;
  if (timedOut && !existing.exited) {
    escalatedToKill = true;
    signalTree(existing.child, "SIGKILL");
    await raceWithTimeout(exited, 1500);
  }

  processes.delete(projectSlug);
  return { stopped: true, escalatedToKill };
}

async function raceWithTimeout(
  task: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const winner = await Promise.race([
    task.then(() => "done" as const),
    timeout,
  ]);
  if (timer) clearTimeout(timer);
  return winner === "timeout";
}

export async function startRuntime(
  options: StartOptions,
): Promise<RuntimeStartResult> {
  const { projectId, projectSlug, role, taskId } = options;
  const command = options.command ?? "pnpm dev";
  const waitMs = options.waitMs ?? 4000;

  const existing = processes.get(projectSlug);
  if (existing && !existing.exited) {
    return {
      status: "already-running",
      pid: existing.child.pid,
      port: existing.port,
      command: existing.command,
    };
  }

  const cwd = projectWorkspace(projectSlug);
  const child = spawn(command, {
    cwd,
    shell: true,
    env: process.env,
    detached: IS_POSIX,
  });
  const record: RuntimeProcess = {
    child,
    command,
    startedAt: Date.now(),
    exited: false,
  };
  processes.set(projectSlug, record);

  child.stdout?.on("data", (chunk: Buffer) => {
    const line = chunk.toString();
    emit({
      projectId,
      role,
      taskId,
      type: "log",
      payload: { stream: "stdout", line },
    });
    pushLog(projectSlug, line);
    const match = line.match(PORT_REGEX);
    if (match && !record.port) record.port = Number(match[1]);
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString();
    emit({
      projectId,
      role,
      taskId,
      type: "log",
      payload: { stream: "stderr", line },
    });
    pushLog(projectSlug, line);
  });

  child.on("exit", (code) => {
    record.exited = true;
    if (processes.get(projectSlug) === record) processes.delete(projectSlug);
    emit({
      projectId,
      role,
      taskId,
      type: "log",
      payload: { stream: "stdout", line: `[runtime] exited ${code}` },
    });
  });

  await waitForPort(record, waitMs);

  return {
    status: record.port ? "port-ready" : "starting",
    pid: child.pid,
    port: record.port,
    command,
  };
}

async function waitForPort(
  record: RuntimeProcess,
  waitMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    if (record.port) return;
    if (record.exited) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function pushLog(projectSlug: string, line: string): void {
  const buf = logBuffers.get(projectSlug) ?? [];
  buf.push(line);
  if (buf.length > 500) buf.splice(0, buf.length - 500);
  logBuffers.set(projectSlug, buf);
}

export function getRecentLogs(projectSlug: string, n: number): string[] {
  const buf = logBuffers.get(projectSlug) ?? [];
  return buf.slice(-Math.min(n, 500));
}
