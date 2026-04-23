import { buildAnswerTaskQuestionTool } from "./answer-task-question";
import { buildAskClarifyingQuestionsTool } from "./ask-clarifying-questions";
import { buildCreateTaskTool } from "./create-task";
import { buildDatabaseQueryTool } from "./database-query";
import { buildFileSystemTool } from "./file-system";
import { buildPlaywrightBrowserTool } from "./playwright-browser";
import { buildRequestHumanInputTool } from "./request-human-input";
import { buildRuntimeTool } from "./runtime";
import { buildStreamCodeTool } from "./stream-code";

import { isPlanningRole, type Role } from "../const/roles";

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
  const isReviewer = ctx.role === "reviewer";

  const base: Record<string, unknown> = {
    file_system: buildFileSystemTool(ctx),
  };

  if (!isReviewer) {
    base.request_human_input = buildRequestHumanInputTool(ctx);
  }

  if (isPlanningRole(ctx.role) && !isReviewer) {
    base.ask_clarifying_questions = buildAskClarifyingQuestionsTool(ctx);
  }

  // every role that produces file artifacts (code, docs, Dockerfiles, configs)
  // gets stream_code so its output lands in Follow Mode for humans to watch
  // live. reviewer and cto are excluded — reviewer does not write artifacts,
  // cto must never write code (delegate via create_task instead).
  const writesArtifacts =
    ctx.role !== "reviewer" && ctx.role !== "cto" && ctx.role !== "qa";
  if (writesArtifacts) {
    base.stream_code = buildStreamCodeTool(ctx);
  }

  switch (ctx.role) {
    // backend-dev and frontend-dev write code and need to verify it runs.
    // database_query lets them inspect the board for context; runtime lets
    // them boot the app and confirm their own changes actually work.
    case "backend-dev":
    case "frontend-dev":
      return {
        ...base,
        database_query: buildDatabaseQueryTool(ctx),
        runtime: buildRuntimeTool(ctx),
      };
    // devops manages infrastructure and needs both execution context (runtime)
    // and board visibility (database_query) to understand what was built
    // before writing Dockerfiles, CI configs, or deployment scripts.
    case "devops":
      return {
        ...base,
        database_query: buildDatabaseQueryTool(ctx),
        runtime: buildRuntimeTool(ctx),
      };
    // qa performs exploratory and automated browser testing. runtime lets it
    // boot the app if it's not already running; database_query gives it access
    // to requirements and task history to understand what to test.
    case "qa":
      return {
        ...base,
        database_query: buildDatabaseQueryTool(ctx),
        runtime: buildRuntimeTool(ctx),
        playwright_browser: buildPlaywrightBrowserTool(ctx),
      };
    // tester writes and runs automated test suites. database_query lets it
    // read requirements, architecture, and prior test results from the board.
    case "tester":
      return {
        ...base,
        database_query: buildDatabaseQueryTool(ctx),
        playwright_browser: buildPlaywrightBrowserTool(ctx),
        runtime: buildRuntimeTool(ctx),
      };
    // CTO is the board's orchestrator + HITL filter. it gets every inspection
    // tool plus the exclusive answer_task_question. stream_code is
    // intentionally omitted — CTO must never write code directly and must
    // delegate all implementation work via create_task.
    case "cto":
      return {
        ...base,
        database_query: buildDatabaseQueryTool(ctx),
        runtime: buildRuntimeTool(ctx),
        playwright_browser: buildPlaywrightBrowserTool(ctx),
        create_task: buildCreateTaskTool(ctx),
        answer_task_question: buildAnswerTaskQuestionTool(ctx),
      };
    // reviewer is a pure quality gate — it reads and judges but never writes
    // artifacts. database_query lets it inspect task history, prior review
    // iterations, and what other roles produced before rendering a verdict.
    case "reviewer":
      return {
        ...base,
        database_query: buildDatabaseQueryTool(ctx),
      };
    // security audits what was built and actively probes live behaviour.
    // database_query gives it visibility into the full build history;
    // runtime lets it boot the app and test live behaviour directly.
    case "security":
      return {
        ...base,
        database_query: buildDatabaseQueryTool(ctx),
        runtime: buildRuntimeTool(ctx),
      };
    // writer produces documentation; release prepares changelogs and release
    // notes. both need database_query to read the task board and understand
    // what was actually built before writing about it.
    case "writer":
    case "release":
      return {
        ...base,
        database_query: buildDatabaseQueryTool(ctx),
      };
    // techlead owns the work breakdown. after reading REQUIREMENTS / ARCHITECTURE
    // / PLAN and the current task list, it inspects the board via
    // database_query and files delegation tickets via create_task.
    case "techlead":
      return {
        ...base,
        database_query: buildDatabaseQueryTool(ctx),
        create_task: buildCreateTaskTool(ctx),
      };
    // pm is the entry point of the planning chain. writes REQUIREMENTS.md and
    // hands off to architect. database_query lets it peek at the current board
    // before filing a duplicate architect task when a burst of overseer asks
    // arrive back-to-back.
    case "pm":
      return {
        ...base,
        database_query: buildDatabaseQueryTool(ctx),
        create_task: buildCreateTaskTool(ctx),
      };
    // architect writes ARCHITECTURE.md and hands off to techlead. database_query
    // lets it peek at the current ticket shape so its hand-off description
    // references existing ticket ids rather than titles.
    case "architect":
      return {
        ...base,
        database_query: buildDatabaseQueryTool(ctx),
        create_task: buildCreateTaskTool(ctx),
      };
  }
}
