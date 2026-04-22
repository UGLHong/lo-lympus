import { Agent } from '@mastra/core/agent';

import { modelForRole } from './model';
import { promptFor } from './prompts';
import { getMemory } from './runtime';
import { buildToolsForRole } from '../tools';

import type { Role } from '../const/roles';

export interface AgentBuildCtx {
  projectId: string;
  projectSlug: string;
  role: Role;
  taskId?: string;
}

export function createRoleAgent(ctx: AgentBuildCtx): Agent {
  const tools = buildToolsForRole(ctx);
  return new Agent({
    id: `${ctx.role}-${ctx.taskId ?? 'generic'}`,
    name: ctx.role,
    instructions: promptFor(ctx.role),
    model: modelForRole(ctx.role),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: tools as any,
    memory: getMemory(),
  });
}
