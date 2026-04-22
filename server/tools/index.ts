import { buildAnswerTaskQuestionTool } from './answer-task-question';
import { buildAskClarifyingQuestionsTool } from './ask-clarifying-questions';
import { buildCreateTaskTool } from './create-task';
import { buildDatabaseQueryTool } from './database-query';
import { buildFileSystemTool } from './file-system';
import { buildPlaywrightBrowserTool } from './playwright-browser';
import { buildRequestHumanInputTool } from './request-human-input';
import { buildRuntimeTool } from './runtime';
import { buildStreamCodeTool } from './stream-code';

import { isPlanningRole, type Role } from '../const/roles';

export interface ToolBuildCtx {
  projectId: string;
  projectSlug: string;
  role: Role;
  taskId?: string;
}

export function buildToolsForRole(ctx: ToolBuildCtx): Record<string, unknown> {
  // reviewer is a pure quality gate. it never interacts with the human
  // directly — any ambiguity or missing info becomes an incident in the
  // verdict JSON, which queues a fix task back to the original employee.
  // that employee (or their task creator) is responsible for escalating
  // further if human input is truly required.
  const isReviewer = ctx.role === 'reviewer';

  const base: Record<string, unknown> = {
    file_system: buildFileSystemTool(ctx),
  };

  if (!isReviewer) {
    base.request_human_input = buildRequestHumanInputTool(ctx);
  }

  if (isPlanningRole(ctx.role) && !isReviewer) {
    base.ask_clarifying_questions = buildAskClarifyingQuestionsTool(ctx);
  }

  switch (ctx.role) {
    case 'backend-dev':
    case 'frontend-dev':
      return {
        ...base,
        stream_code: buildStreamCodeTool(ctx),
        database_query: buildDatabaseQueryTool(ctx),
      };
    case 'devops':
      return {
        ...base,
        runtime: buildRuntimeTool(ctx),
      };
    case 'qa':
      return {
        ...base,
        playwright_browser: buildPlaywrightBrowserTool(ctx),
      };
    case 'tester':
      return {
        ...base,
        playwright_browser: buildPlaywrightBrowserTool(ctx),
        runtime: buildRuntimeTool(ctx),
      };
    // CTO has access to every inspection tool in the house plus the exclusive
    // answer_task_question tool so it can resolve other agents' blocked-needs-input
    // questions on behalf of the human after investigating. stream_code is
    // intentionally omitted — the CTO must never write code directly and must
    // delegate all implementation work to the appropriate role via a new task.
    case 'cto':
      return {
        ...base,
        database_query: buildDatabaseQueryTool(ctx),
        runtime: buildRuntimeTool(ctx),
        playwright_browser: buildPlaywrightBrowserTool(ctx),
        create_task: buildCreateTaskTool(ctx),
        answer_task_question: buildAnswerTaskQuestionTool(ctx),
      };
    case 'reviewer':
    case 'security':
    case 'writer':
    case 'release':
      return base;
    // techlead owns the work breakdown. after reading REQUIREMENTS / ARCHITECTURE
    // / PLAN and the current task list, it can inspect the project via
    // database_query and file off additional coding tasks via create_task when
    // the original breakdown missed scope or needs to be split further.
    case 'techlead':
      return {
        ...base,
        database_query: buildDatabaseQueryTool(ctx),
        create_task: buildCreateTaskTool(ctx),
      };
    // pm is the entry point of the planning chain. on both kickoff and
    // mid-stream updates it writes REQUIREMENTS.md and hands off to architect
    // via create_task. it needs database_query to inspect the current board
    // so it can distinguish kickoff vs update mode and avoid duplicate
    // architect hand-offs when responding to a rapid burst of overseer asks.
    case 'pm':
      return {
        ...base,
        database_query: buildDatabaseQueryTool(ctx),
        create_task: buildCreateTaskTool(ctx),
      };
    // architect participates in the trickle-down chain: when PM/CTO queues an
    // architecture update, it must be able to hand off the next planning step
    // to techlead so the chain keeps moving without human involvement. the
    // per-creator allowlist inside create_task keeps it routing only to the
    // next planning layer (techlead / writer), never to coders.
    case 'architect':
      return {
        ...base,
        create_task: buildCreateTaskTool(ctx),
      };
  }
}
