import { buildAskClarifyingQuestionsTool } from './ask-clarifying-questions';
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
    case 'reviewer':
    case 'security':
    case 'writer':
    case 'release':
      return base;
    case 'incident':
    case 'orchestrator':
    case 'pm':
    case 'architect':
    case 'techlead':
      return base;
  }
}
