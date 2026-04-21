import { nanoid } from 'nanoid';
import { sendJson } from '../jsonrpc';

type TerminalRunRequest = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

type TerminalRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const ALLOWED_COMMANDS = new Set([
  'pnpm',
  'npm',
  'yarn',
  'node',
  'npx',
  'python',
  'python3',
  'pytest',
  'playwright',
  'git',
]);

type PendingTerminalRun = {
  resolve: (result: TerminalRunResult) => void;
  reject: (err: Error) => void;
};

const pending = new Map<string | number, PendingTerminalRun>();

export function resolveTerminalRun(id: string | number, result: TerminalRunResult): void {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  entry.resolve(result);
}

export function failTerminalRun(id: string | number, err: Error): void {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  entry.reject(err);
}

// issues a `terminal/run` JSON-RPC request, subject to a small
// command allow-list. the promise resolves with exitCode/stdout/stderr
// when Zed streams the result back. rejects if the command is not in
// the allow-list so agents cannot run arbitrary shell.
export function requestTerminalRun(
  request: TerminalRunRequest,
  timeoutMs = 120_000,
): Promise<TerminalRunResult> {
  if (!ALLOWED_COMMANDS.has(request.command)) {
    return Promise.reject(
      new Error(`terminal/run denied: command "${request.command}" not in ACP allow-list`),
    );
  }

  const id = `term-run-${nanoid(6)}`;

  const payload = {
    jsonrpc: '2.0' as const,
    id,
    method: 'terminal/run',
    params: {
      command: request.command,
      args: request.args ?? [],
      cwd: request.cwd,
      env: request.env,
    },
  };

  return new Promise<TerminalRunResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    sendJson(payload);

    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`terminal/run timed out after ${timeoutMs}ms (command=${request.command})`));
    }, timeoutMs);
  });
}
