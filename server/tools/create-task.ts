import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { emit } from '../../app/lib/event-bus.server';
import { createTask, getTaskById } from '../db/queries';
import { kanbanTaskPayload } from '../lib/kanban-task-payload';
import { emitToolLog } from '../lib/tool-log';
import { ROLES, type Role } from '../const/roles';

interface ToolCtx {
  projectId: string;
  projectSlug: string;
  role: string;
  taskId?: string;
}

// roles a planner is allowed to delegate work to. reviewer and cto are
// excluded: reviewer is created automatically on task completion, and cto is
// reserved for incidents / escalations via its own pathway.
const DELEGATABLE_ROLES = ROLES.filter(
  (role) => role !== 'reviewer' && role !== 'cto',
) as readonly Role[];

// per-creator allowlist enforces a strict planning trickle-down chain:
//   cto → pm (default — anything that might affect requirements) OR
//         architect (only when the change is STRICTLY architectural — stack
//                    swap, module rearrangement, deploy topology — with zero
//                    user-facing / requirements impact)
//   pm  → architect (always, for both kickoff and mid-stream updates)
//   architect → techlead (always, for both kickoff and mid-stream updates)
//   techlead → every implementation, devops, testing, docs, and security role
//
// anything else falls back to the full DELEGATABLE_ROLES set for safety.
//
// this guarantees that REQUIREMENTS → ARCHITECTURE → PLAN stay in sync before
// a single coder / tester / devops / writer ticket is filed. cto cannot skip
// straight to techlead or any implementation role; architect cannot file a
// writer ticket directly; only the tech lead, sitting at the bottom of the
// chain, writes the actual implementation / test / docs tickets.
const CREATOR_TARGETS: Record<string, readonly Role[]> = {
  cto: ['pm', 'architect'],
  pm: ['architect'],
  architect: ['techlead'],
  techlead: DELEGATABLE_ROLES,
};

function allowedTargetsFor(creatorRole: string): readonly Role[] {
  return CREATOR_TARGETS[creatorRole] ?? DELEGATABLE_ROLES;
}

export function buildCreateTaskTool(ctx: ToolCtx) {
  const allowedTargets = allowedTargetsFor(ctx.role);
  const allowedSummary = allowedTargets.join(', ');
  return createTool({
    id: 'create_task',
    description: [
      'Create a new task in this project and queue it for the named role.',
      `You are ${ctx.role} — you may only delegate to: ${allowedSummary}.`,
      'Use after reading the existing documentation and task list to identify concrete follow-up work that is not yet covered (e.g. a missing backend endpoint, a split of an oversized chunk, a frontend view the plan forgot).',
      'Provide a concrete `description` with target file paths, acceptance criteria, and any context the assignee needs — assume they only read what you wrote.',
      'Pass `dependsOn` with task ids (not titles) for work that must finish before this one can start.',
    ].join(' '),
    inputSchema: z.object({
      role: z
        .enum(DELEGATABLE_ROLES as unknown as [Role, ...Role[]])
        .describe(`Assignee role. Allowed for ${ctx.role}: ${allowedSummary}.`),
      title: z.string().min(4).describe('Short actionable ticket title.'),
      description: z
        .string()
        .min(20)
        .describe('Full brief with file paths, acceptance criteria, and context.'),
      dependsOn: z
        .array(z.string())
        .optional()
        .describe('Task ids (uuid strings) that must complete before this task can start.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      taskId: z.string().optional(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      emitToolLog(ctx, {
        kind: 'agent',
        action: 'create_task',
        summary: `${input.role} · ${input.title}`,
      });

      if (!allowedTargets.includes(input.role)) {
        return {
          ok: false,
          error: `${ctx.role} cannot delegate to ${input.role}. Allowed targets: ${allowedSummary}. Route planning or doc updates through the allowed roles and let the breakdown trickle down.`,
        };
      }

      const explicitDependsOn = input.dependsOn ?? [];

      // always gate the delegate on the creator's own task. the claim loop
      // only starts a task when every entry in depends_on is `done` or
      // `skipped`, so without this injection an agent that forgets to set
      // dependsOn would let its child run in parallel (or ahead of) the
      // parent — e.g. tech lead claiming a "Replan" ticket while the
      // architect ticket that produces ARCHITECTURE.md is still in-progress
      // or awaiting reviewer approval.
      const dependsOn = ctx.taskId
        ? Array.from(new Set([ctx.taskId, ...explicitDependsOn]))
        : explicitDependsOn;

      if (dependsOn.length > 0) {
        const unknownIds: string[] = [];
        for (const depId of dependsOn) {
          const dep = await getTaskById(depId);
          if (!dep || dep.projectId !== ctx.projectId) unknownIds.push(depId);
        }
        if (unknownIds.length > 0) {
          return {
            ok: false,
            error: `unknown or cross-project dependsOn ids: ${unknownIds.join(', ')}`,
          };
        }
      }

      const task = await createTask({
        projectId: ctx.projectId,
        role: input.role,
        title: input.title,
        description: input.description,
        dependsOn,
        status: 'todo',
        parentTaskId: ctx.taskId ?? null,
      });

      emit({
        projectId: ctx.projectId,
        role: input.role,
        taskId: task.id,
        type: 'task-update',
        payload: { ...kanbanTaskPayload(task), source: ctx.role },
      });

      emit({
        projectId: ctx.projectId,
        role: ctx.role,
        taskId: ctx.taskId,
        type: 'chat',
        payload: {
          from: ctx.role,
          direction: 'from-agent',
          text: `Delegated new task to ${input.role}: ${input.title}`,
          scope: 'task',
        },
      });

      return { ok: true, taskId: task.id };
    },
  });
}
