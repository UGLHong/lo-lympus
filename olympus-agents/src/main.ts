import { createSession, type Session } from './session';
import { logJson, sendJson, startJsonRpcLoop } from './jsonrpc';
import { handleDispatch } from './dispatch';
import { startEventsWatcher } from './events-watcher';
import {
  failFsApplyEdit,
  resolveFsApplyEdit,
} from './tools/fs-apply-edit';
import {
  failTerminalRun,
  resolveTerminalRun,
} from './tools/terminal-run';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const PROTOCOL_VERSION = '2024-11-05';

const SERVER_INFO = {
  name: 'olympus-acp-server',
  version: '0.0.1',
};

// subset of ACP methods we intend to support; only initialize + a thin
// session/prompt path are wired in this scaffold.
const CAPABILITIES = {
  agents: [
    {
      id: '@olympus/tech-lead',
      description: 'Picks the next ready ticket from tickets/index.json and dispatches to the owning dev role.',
    },
    {
      id: '@olympus/backend-dev',
      description: 'Implements backend tickets (APIs, services, data layer).',
    },
    {
      id: '@olympus/frontend-dev',
      description: 'Implements UI tickets (components, styles, accessibility).',
    },
    {
      id: '@olympus/reviewer',
      description: 'Reads git diff, runs tests, posts structured review feedback.',
    },
  ],
} as const;

function respond(session: Session, request: JsonRpcRequest, result: unknown): void {
  if (request.id === undefined || request.id === null) return;
  const response: JsonRpcResponse = { jsonrpc: '2.0', id: request.id, result };
  sendJson(response);
  session.recordOutbound(response);
}

function respondError(
  session: Session,
  request: JsonRpcRequest,
  code: number,
  message: string,
  data?: unknown,
): void {
  if (request.id === undefined || request.id === null) return;
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id: request.id,
    error: { code, message, data },
  };
  sendJson(response);
  session.recordOutbound(response);
}

async function handleRequest(session: Session, request: JsonRpcRequest): Promise<void> {
  session.recordInbound(request);

  if (isJsonRpcResponse(request)) {
    dispatchJsonRpcResponse(request as unknown as JsonRpcResponse);
    return;
  }

  switch (request.method) {
    case 'initialize': {
      respond(session, request, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: CAPABILITIES,
      });
      return;
    }
    case 'shutdown': {
      respond(session, request, null);
      return;
    }
    case 'exit': {
      process.exit(0);
    }
    case 'agent/list': {
      respond(session, request, { agents: CAPABILITIES.agents });
      return;
    }
    case 'session/prompt': {
      try {
        const result = await handleDispatch(session, request.params);
        respond(session, request, result);
      } catch (error) {
        respondError(
          session,
          request,
          -32000,
          error instanceof Error ? error.message : String(error),
        );
      }
      return;
    }
    case 'session/notify': {
      await handleSessionNotify(session, request.params);
      respond(session, request, null);
      return;
    }
    default: {
      respondError(session, request, -32601, `Method not found: ${request.method}`);
    }
  }
}

function isJsonRpcResponse(request: JsonRpcRequest): boolean {
  return (
    !request.method &&
    (request.id !== undefined && request.id !== null) &&
    ('result' in (request as object) || 'error' in (request as object))
  );
}

function dispatchJsonRpcResponse(response: JsonRpcResponse): void {
  const id = response.id;
  if (id === null) return;

  const key = String(id);
  if (key.startsWith('fs-apply-')) {
    if (response.error) {
      failFsApplyEdit(id, new Error(response.error.message));
    } else {
      resolveFsApplyEdit(id, true);
    }
    return;
  }

  if (key.startsWith('term-run-')) {
    if (response.error) {
      failTerminalRun(id, new Error(response.error.message));
      return;
    }
    const result = response.result as { exitCode?: number; stdout?: string; stderr?: string } | null;
    resolveTerminalRun(id, {
      exitCode: result?.exitCode ?? 0,
      stdout: result?.stdout ?? '',
      stderr: result?.stderr ?? '',
    });
  }
}

type SessionNotifyParams = {
  context?: string;
  role?: string;
  text?: string;
  note?: string;
};

async function handleSessionNotify(
  session: Session,
  rawParams: unknown,
): Promise<void> {
  const params = (rawParams ?? {}) as SessionNotifyParams;
  await session.appendEventNdjson({
    kind: 'acp.session.notify',
    context: params.context ?? 'generic',
    role: params.role ?? null,
    text: params.text ?? params.note ?? '',
  });
}

async function main(): Promise<void> {
  const session = createSession({
    projectId: process.env.OLYMPUS_PROJECT_ID ?? '',
    workspacePath: process.env.OLYMPUS_WORKSPACE ?? '',
    olympusApi: process.env.OLYMPUS_API ?? '',
  });

  logJson({ kind: 'session.started', projectId: session.projectId });

  const stopWatcher = startEventsWatcher({
    workspacePath: session.workspacePath,
    projectId: session.projectId,
  });

  try {
    await startJsonRpcLoop((request) => handleRequest(session, request as JsonRpcRequest));
  } finally {
    stopWatcher();
  }
}

void main();
