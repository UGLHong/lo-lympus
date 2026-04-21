import fs from 'node:fs/promises';
import path from 'node:path';
import type { Session } from './session';
import { runImplementOverHttp } from './tools/implement-client';

type PromptParams = {
  agent?: string;
  prompt?: string;
  context?: Record<string, unknown>;
};

type TicketEntry = {
  code: string;
  title: string;
  status: string;
  dependsOn?: string[];
  assigneeRole?: string | null;
  path?: string;
};

type TicketsIndex = {
  version?: number;
  projectId?: string;
  tickets: TicketEntry[];
  updatedAt?: string;
};

type ImplementSummary = {
  completed: string[];
  changesRequested: string[];
  blocked: string[];
  paused: boolean;
  reason?: string;
  steps: number;
};

// each prompt turn in Zed's agent panel translates to a call back into
// the Olympus web app, which runs the real dev/reviewer turns using the
// shared roles + LLMProvider. this keeps a single source of truth for
// agent behavior across both surfaces without duplicating the prompt
// or tier-routing code.
export async function handleDispatch(
  session: Session,
  rawParams: unknown,
): Promise<Record<string, unknown>> {
  const params = (rawParams ?? {}) as PromptParams;
  const agent = typeof params.agent === 'string' ? params.agent : '@olympus/tech-lead';

  await session.appendEventNdjson({
    kind: 'acp.prompt.received',
    agent,
    prompt: params.prompt ?? null,
  });

  if (!session.projectId || !session.workspacePath) {
    return stubReply('Olympus session is missing OLYMPUS_PROJECT_ID / OLYMPUS_WORKSPACE env.');
  }

  const ticketsIndex = await readTicketsIndex(session.workspacePath);
  if (!ticketsIndex) {
    return stubReply('No tickets/index.json yet — run the PLAN phase in the Olympus web app first.');
  }

  const maxSteps = resolveMaxSteps(agent);
  if (maxSteps === 0) {
    return stubReply(`ACP agent "${agent}" is read-only in this turn — choose @olympus/tech-lead or @olympus/backend-dev to drive work.`);
  }

  if (!session.olympusApi) {
    return stubReply(
      `olympus-acp-server: missing OLYMPUS_API env — cannot call the web app's IMPLEMENT endpoint. ` +
        `Set OLYMPUS_API=http://localhost:3100/api (or the port your web app is on) in .zed/settings.json.`,
    );
  }

  try {
    const summary = await runImplementOverHttp({
      apiBase: session.olympusApi,
      projectId: session.projectId,
      maxSteps,
    });

    await session.appendEventNdjson({
      kind: 'acp.prompt.completed',
      agent,
      summary,
    });

    return {
      role: 'assistant',
      content: [{ type: 'text', text: formatImplementSummary(agent, summary) }],
      stopReason: 'end_turn',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await session.appendEventNdjson({
      kind: 'acp.prompt.failed',
      agent,
      error: message,
    });
    return {
      role: 'assistant',
      content: [{ type: 'text', text: `olympus-acp-server: ${message}` }],
      stopReason: 'end_turn',
    };
  }
}

function stubReply(text: string): Record<string, unknown> {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    stopReason: 'end_turn',
  };
}

// the tech-lead agent drains as many tickets as possible in one turn;
// dev agents only take one ticket so the human can review each cycle.
function resolveMaxSteps(agent: string): number {
  switch (agent) {
    case '@olympus/tech-lead':
      return 12;
    case '@olympus/backend-dev':
    case '@olympus/frontend-dev':
    case '@olympus/devops':
      return 1;
    case '@olympus/reviewer':
      return 1;
    default:
      return 1;
  }
}

function formatImplementSummary(agent: string, summary: ImplementSummary): string {
  const lines = [
    `olympus-acp-server — agent: ${agent}`,
    '',
    `Steps walked: ${summary.steps}`,
    `Completed: ${summary.completed.join(', ') || '(none)'}`,
    `Changes requested: ${summary.changesRequested.join(', ') || '(none)'}`,
    `Blocked: ${summary.blocked.join(', ') || '(none)'}`,
  ];

  if (summary.paused) {
    lines.push('', `Paused: ${summary.reason ?? 'see HELP_NEEDED.md'}`);
  } else if (summary.reason) {
    lines.push('', `Stopped: ${summary.reason}`);
  }

  return lines.join('\n');
}

async function readTicketsIndex(workspacePath: string): Promise<TicketsIndex | null> {
  const indexPath = path.join(workspacePath, '.software-house', 'tickets', 'index.json');
  try {
    const raw = await fs.readFile(indexPath, 'utf8');
    const parsed = JSON.parse(raw) as TicketsIndex;
    if (!Array.isArray(parsed.tickets)) return null;
    return parsed;
  } catch {
    return null;
  }
}
