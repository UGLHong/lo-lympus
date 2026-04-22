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

// prepend a machine-readable runtime context so the agent never has to guess
// what project it is running inside. most tools (database_query, create_task,
// answer_task_question) need `project_id` and `task_id` as inputs — if the
// model has to search the filesystem for them it ends up blocking with a
// request_human_input. bake the values into the system prompt instead.
function buildRuntimeContext(ctx: AgentBuildCtx): string {
  const lines = [
    'RUNTIME CONTEXT (authoritative — use these values when a tool asks)',
    `- project_id: ${ctx.projectId}`,
    `- project_slug: ${ctx.projectSlug}`,
    `- your role: ${ctx.role}`,
  ];
  if (ctx.taskId) {
    lines.push(`- current task_id: ${ctx.taskId}`);
  }
  lines.push(
    '- workspace root on disk: `.` (file_system tools are already rooted at the project workspace)',
    '- planning artifacts live under `.software-house/` (REQUIREMENTS.md, ARCHITECTURE.md, PLAN.md, etc.)',
    '',
    'Do NOT ask the human for project_id or task_id — they are pinned above. Use them verbatim in every tool call that needs them (e.g. `database_query` WHERE project_id = ..., `create_task` dependsOn = [current task_id], `answer_task_question` taskId = ...).',
  );
  return lines.join('\n');
}

export function createRoleAgent(ctx: AgentBuildCtx): Agent {
  const tools = buildToolsForRole(ctx);
  const instructions = `${buildRuntimeContext(ctx)}\n\n${promptFor(ctx.role)}`;
  return new Agent({
    id: `${ctx.role}-${ctx.taskId ?? 'generic'}`,
    name: ctx.role,
    instructions,
    model: modelForRole(ctx.role),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: tools as any,
    memory: getMemory(),
  });
}
