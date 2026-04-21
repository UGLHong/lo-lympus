import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { emit } from '@/lib/events/bus';
import { appendEvent } from '@/lib/workspace/fs';
import { projectDir, softwareHouseDir } from './paths';

type RuntimeState = {
  child: ChildProcess;
  port: number;
  startedAt: string;
  logPath: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __olympus_runtimes__: Map<string, RuntimeState> | undefined;
}

function registry(): Map<string, RuntimeState> {
  if (!globalThis.__olympus_runtimes__) {
    globalThis.__olympus_runtimes__ = new Map();
  }
  return globalThis.__olympus_runtimes__;
}

const ALLOWED_SCRIPTS = new Set(['dev', 'start', 'build', 'test']);

type PortRange = { from: number; to: number };

function parsePortRange(): PortRange {
  const raw = process.env.OLYMPUS_RUNTIME_PORT_RANGE ?? '4100-4199';
  const [fromRaw, toRaw] = raw.split('-');
  const from = Number(fromRaw);
  const to = Number(toRaw);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    return { from: 4100, to: 4199 };
  }
  return { from, to };
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.unref();
    tester.once('error', () => resolve(false));
    tester.listen(port, () => {
      tester.close(() => resolve(true));
    });
  });
}

async function pickFreePort(taken: Set<number>): Promise<number | null> {
  const { from, to } = parsePortRange();
  for (let port = from; port <= to; port += 1) {
    if (taken.has(port)) continue;
    if (await isPortFree(port)) return port;
  }
  return null;
}

function isValidScript(script: string): boolean {
  return ALLOWED_SCRIPTS.has(script);
}

export type StartRuntimeOptions = {
  projectId: string;
  script?: 'dev' | 'start' | 'build' | 'test';
  packageManager?: 'pnpm' | 'npm' | 'yarn';
};

export type StartRuntimeResult = {
  started: boolean;
  port?: number;
  pid?: number;
  logPath?: string;
  reason?: string;
};

export async function startRuntime(options: StartRuntimeOptions): Promise<StartRuntimeResult> {
  const { projectId } = options;
  const script = options.script ?? 'dev';
  const packageManager = options.packageManager ?? 'pnpm';

  if (!isValidScript(script)) {
    return { started: false, reason: `script "${script}" not in allow-list` };
  }

  const existing = registry().get(projectId);
  if (existing) {
    return {
      started: false,
      reason: 'runtime already running for this project',
      port: existing.port,
      pid: existing.child.pid,
      logPath: existing.logPath,
    };
  }

  const projectRoot = projectDir(projectId);
  try {
    await fs.access(path.join(projectRoot, 'package.json'));
  } catch {
    return { started: false, reason: 'package.json not found in project workspace' };
  }

  const takenPorts = new Set<number>();
  for (const state of registry().values()) takenPorts.add(state.port);

  const port = await pickFreePort(takenPorts);
  if (port === null) {
    return { started: false, reason: 'no free port available in OLYMPUS_RUNTIME_PORT_RANGE' };
  }

  const startedAt = new Date().toISOString();
  const logDir = path.join(softwareHouseDir(projectId), 'logs');
  await fs.mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, `server-${startedAt.replace(/[:.]/g, '-')}.log`);

  const logStream = await fs.open(logPath, 'a');

  const child = spawn(packageManager, ['run', script], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!child.pid) {
    await logStream.close();
    return { started: false, reason: `failed to spawn ${packageManager} run ${script}` };
  }

  registry().set(projectId, { child, port, startedAt, logPath });

  const pipeToLog = (chunk: Buffer, channel: 'stdout' | 'stderr') => {
    const text = chunk.toString('utf8');
    logStream.appendFile(text).catch(() => {});
    const event = emit({
      projectId,
      kind: 'runtime.log',
      channel,
      text,
    });
    appendEvent(event).catch(() => {});
  };

  child.stdout?.on('data', (chunk) => pipeToLog(chunk, 'stdout'));
  child.stderr?.on('data', (chunk) => pipeToLog(chunk, 'stderr'));

  child.once('exit', (code, signal) => {
    registry().delete(projectId);
    logStream.close().catch(() => {});
    const event = emit({
      projectId,
      kind: 'runtime.stop',
      reason: signal ? `signal:${signal}` : `exit:${code ?? 'unknown'}`,
    });
    appendEvent(event).catch(() => {});
  });

  const startedEvent = emit({
    projectId,
    kind: 'runtime.start',
    port,
    pid: child.pid,
    script,
    packageManager,
    logPath: path.relative(projectRoot, logPath),
  });
  await appendEvent(startedEvent);

  return { started: true, port, pid: child.pid, logPath };
}

export type StopRuntimeResult = {
  stopped: boolean;
  reason?: string;
};

export async function stopRuntime(projectId: string): Promise<StopRuntimeResult> {
  const state = registry().get(projectId);
  if (!state) {
    return { stopped: false, reason: 'no runtime registered for this project' };
  }

  const killed = state.child.kill('SIGTERM');
  if (!killed) {
    return { stopped: false, reason: 'SIGTERM failed' };
  }

  const graceMs = 5_000;
  const gracePromise = new Promise<void>((resolve) => {
    const onExit = () => resolve();
    state.child.once('exit', onExit);
    setTimeout(() => {
      state.child.off('exit', onExit);
      resolve();
    }, graceMs);
  });

  await gracePromise;

  if (!state.child.killed && state.child.exitCode === null) {
    state.child.kill('SIGKILL');
  }

  registry().delete(projectId);
  return { stopped: true };
}

export type RuntimeStatus = {
  running: boolean;
  port?: number;
  pid?: number;
  startedAt?: string;
  logPath?: string;
};

export function getRuntimeStatus(projectId: string): RuntimeStatus {
  const state = registry().get(projectId);
  if (!state) return { running: false };
  return {
    running: true,
    port: state.port,
    pid: state.child.pid,
    startedAt: state.startedAt,
    logPath: state.logPath,
  };
}
