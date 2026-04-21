import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { emit } from '@/lib/events/bus';
import { appendEvent, writeArtifact } from '@/lib/workspace/fs';
import { deriveIncidentsIndex, writeIncidentsIndex } from '@/lib/workspace/incidents';
import { projectDir, softwareHouseDir } from './paths';
import { getRuntimeStatus } from './runtime';

const QA_TIMEOUT_MS = 10 * 60_000;

export type QaFailure = {
  title: string;
  file: string | null;
  message: string;
};

export type QaRunSummary = {
  ok: boolean;
  ran: boolean;
  passed: number;
  failed: number;
  skipped: number;
  reportPath: string | null;
  incidentsOpened: string[];
  failures: QaFailure[];
  reason?: string;
  stdoutTail: string;
  stderrTail: string;
};

export type QaRunOptions = {
  projectId: string;
  baseUrl?: string;
  timeoutMs?: number;
  playwrightMode?: 'workspace' | 'bundled-harness';
};

export async function runQaPlaywright(options: QaRunOptions): Promise<QaRunSummary> {
  const { projectId } = options;
  const timeoutMs = options.timeoutMs ?? QA_TIMEOUT_MS;
  const runId = nanoid(6);
  const startedAt = new Date();

  await emitAndAppend(projectId, { kind: 'qa.run', status: 'started' });

  const playwrightMode = options.playwrightMode ?? 'workspace';
  const bundledHarnessDir = path.join(process.cwd(), 'src/lib/workspace/qa-harness');
  const cwd =
    playwrightMode === 'bundled-harness' ? bundledHarnessDir : projectDir(projectId);
  const baseUrl = options.baseUrl ?? resolveBaseUrlFromRuntime(projectId);
  const resultsDir = path.join(
    softwareHouseDir(projectId),
    'qa',
    'runs',
    `run-${startedAt.toISOString().replace(/[:.]/g, '-')}-${runId}`,
  );
  await fs.mkdir(resultsDir, { recursive: true });
  const resultsJsonPath = path.join(resultsDir, 'playwright-results.json');

  const env = buildPlaywrightEnv(baseUrl, resultsJsonPath);
  const runResult = await spawnPlaywright({ cwd, env, timeoutMs, playwrightMode });

  if (runResult.kind === 'spawn-error') {
    const summary: QaRunSummary = {
      ok: false,
      ran: false,
      passed: 0,
      failed: 0,
      skipped: 0,
      reportPath: null,
      incidentsOpened: [],
      failures: [],
      reason: runResult.reason,
      stdoutTail: '',
      stderrTail: '',
    };
    await emitAndAppend(projectId, { kind: 'qa.run', status: 'error', message: runResult.reason });
    return summary;
  }

  const parsed = await parsePlaywrightReport(resultsJsonPath, runResult.stdout);
  const reportRelative = await writeReportArtifact(projectId, runId, {
    startedAt,
    baseUrl,
    exitCode: runResult.exitCode,
    parsed,
    stdoutTail: tail(runResult.stdout),
    stderrTail: tail(runResult.stderr),
  });

  const incidentsOpened: string[] = [];
  if (parsed.failed > 0) {
    for (const failure of parsed.failures) {
      const incidentId = await openIncidentForFailure(projectId, failure);
      if (incidentId) incidentsOpened.push(incidentId);
    }

    const updatedIndex = await deriveIncidentsIndex(projectId);
    await writeIncidentsIndex(updatedIndex);
    await emitAndAppend(projectId, {
      kind: 'incident.index.updated',
      count: updatedIndex.incidents.length,
    });
  }

  const status: 'passed' | 'failed' | 'error' =
    runResult.exitCode === 0 && parsed.failed === 0
      ? 'passed'
      : parsed.failed > 0
        ? 'failed'
        : 'error';

  await emitAndAppend(projectId, {
    kind: 'qa.run',
    status,
    passed: parsed.passed,
    failed: parsed.failed,
    reportPath: reportRelative,
  });

  return {
    ok: status === 'passed',
    ran: true,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    reportPath: reportRelative,
    incidentsOpened,
    failures: parsed.failures,
    reason: status === 'error' ? `playwright exit code ${runResult.exitCode}` : undefined,
    stdoutTail: tail(runResult.stdout),
    stderrTail: tail(runResult.stderr),
  };
}

export async function runQaPlaywrightBundledHarness(
  options: Omit<QaRunOptions, 'playwrightMode'>,
): Promise<QaRunSummary> {
  return runQaPlaywright({ ...options, playwrightMode: 'bundled-harness' });
}

function resolveBaseUrlFromRuntime(projectId: string): string {
  const status = getRuntimeStatus(projectId);
  if (status.running && status.port) {
    return `http://127.0.0.1:${status.port}`;
  }
  return process.env.OLYMPUS_QA_BASE_URL ?? 'http://127.0.0.1:3000';
}

function buildPlaywrightEnv(baseUrl: string, jsonReportPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PLAYWRIGHT_BASE_URL: baseUrl,
    PLAYWRIGHT_JSON_OUTPUT_NAME: jsonReportPath,
    PW_TEST_HTML_REPORT_OPEN: 'never',
  };
}

type SpawnResult =
  | { kind: 'spawn-error'; reason: string }
  | { kind: 'completed'; exitCode: number; stdout: string; stderr: string };

function spawnPlaywright({
  cwd,
  env,
  timeoutMs,
  playwrightMode,
}: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  playwrightMode: 'workspace' | 'bundled-harness';
}): Promise<SpawnResult> {
  const npxArgs =
    playwrightMode === 'bundled-harness'
      ? [
          'playwright',
          'test',
          '--config',
          path.join(cwd, 'playwright.config.ts'),
          '--reporter=list,json',
        ]
      : ['playwright', 'test', '--reporter=list,json'];

  return new Promise((resolve) => {
    const child = spawn('npx', npxArgs, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (!child.pid) {
      resolve({ kind: 'spawn-error', reason: 'failed to spawn npx playwright test' });
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
      }, 5_000);
    }, timeoutMs);

    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ kind: 'completed', exitCode: code ?? 1, stdout, stderr });
    });

    child.once('error', (err) => {
      clearTimeout(timer);
      resolve({ kind: 'spawn-error', reason: err.message });
    });
  });
}

type ParsedReport = {
  passed: number;
  failed: number;
  skipped: number;
  failures: QaFailure[];
};

async function parsePlaywrightReport(jsonPath: string, stdout: string): Promise<ParsedReport> {
  try {
    const raw = await fs.readFile(jsonPath, 'utf8');
    const json = JSON.parse(raw) as PlaywrightJsonReport;
    return extractFromJson(json);
  } catch {
    return extractFromStdout(stdout);
  }
}

type PlaywrightJsonReport = {
  stats?: { expected?: number; unexpected?: number; skipped?: number };
  suites?: PlaywrightSuite[];
};
type PlaywrightSuite = {
  file?: string;
  title?: string;
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
};
type PlaywrightSpec = {
  title: string;
  file?: string;
  tests?: PlaywrightTest[];
  ok?: boolean;
};
type PlaywrightTest = {
  status?: string;
  results?: PlaywrightTestResult[];
};
type PlaywrightTestResult = {
  status?: string;
  error?: { message?: string; stack?: string };
  errors?: { message?: string }[];
};

function extractFromJson(report: PlaywrightJsonReport): ParsedReport {
  const failures: QaFailure[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  const walk = (suites: PlaywrightSuite[] | undefined, parentFile: string | null) => {
    if (!suites) return;
    for (const suite of suites) {
      const fileHere = suite.file ?? parentFile;
      for (const spec of suite.specs ?? []) {
        const specFile = spec.file ?? fileHere;
        for (const test of spec.tests ?? []) {
          const lastResult = test.results?.[test.results.length - 1];
          const status = lastResult?.status ?? test.status ?? 'unknown';
          if (status === 'passed' || status === 'expected') {
            passed += 1;
          } else if (status === 'skipped') {
            skipped += 1;
          } else {
            failed += 1;
            const message =
              lastResult?.error?.message ??
              lastResult?.errors?.[0]?.message ??
              `status=${status}`;
            failures.push({ title: spec.title, file: specFile ?? null, message });
          }
        }
      }
      walk(suite.suites, fileHere);
    }
  };

  walk(report.suites, null);

  if (report.stats) {
    passed = report.stats.expected ?? passed;
    failed = report.stats.unexpected ?? failed;
    skipped = report.stats.skipped ?? skipped;
  }

  return { passed, failed, skipped, failures };
}

function extractFromStdout(stdout: string): ParsedReport {
  const passedMatch = stdout.match(/(\d+)\s+passed/i);
  const failedMatch = stdout.match(/(\d+)\s+failed/i);
  const skippedMatch = stdout.match(/(\d+)\s+skipped/i);

  const passed = passedMatch ? Number(passedMatch[1]) : 0;
  const failed = failedMatch ? Number(failedMatch[1]) : 0;
  const skipped = skippedMatch ? Number(skippedMatch[1]) : 0;

  const failures: QaFailure[] = [];
  if (failed > 0) {
    const lines = stdout.split('\n');
    for (const line of lines) {
      const failLine = line.match(/✘.*?›\s*(.+)$/);
      if (failLine) failures.push({ title: failLine[1]!.trim(), file: null, message: line.trim() });
    }
  }

  return { passed, failed, skipped, failures };
}

type ReportContext = {
  startedAt: Date;
  baseUrl: string;
  exitCode: number;
  parsed: ParsedReport;
  stdoutTail: string;
  stderrTail: string;
};

async function writeReportArtifact(
  projectId: string,
  runId: string,
  ctx: ReportContext,
): Promise<string> {
  const now = ctx.startedAt.toISOString();
  const relativePath = `qa/reports/R-${now.replace(/[:.]/g, '-')}-${runId}.md`;

  const failuresBlock = ctx.parsed.failures.length > 0
    ? ctx.parsed.failures
        .map((f) => `- **${escape(f.title)}**${f.file ? ` (${f.file})` : ''}\n  - ${escape(f.message)}`)
        .join('\n')
    : '_(none)_';

  const content = [
    '---',
    'role: qa',
    'phase: QA_MANUAL',
    `timestamp: ${now}`,
    `base_url: ${ctx.baseUrl}`,
    `passed: ${ctx.parsed.passed}`,
    `failed: ${ctx.parsed.failed}`,
    `skipped: ${ctx.parsed.skipped}`,
    `exit_code: ${ctx.exitCode}`,
    'status: ' + (ctx.parsed.failed === 0 && ctx.exitCode === 0 ? 'passed' : 'failed'),
    '---',
    '',
    `# QA run ${runId}`,
    '',
    `- Started: ${now}`,
    `- Base URL: ${ctx.baseUrl}`,
    `- Passed: ${ctx.parsed.passed}`,
    `- Failed: ${ctx.parsed.failed}`,
    `- Skipped: ${ctx.parsed.skipped}`,
    '',
    '## Failures',
    '',
    failuresBlock,
    '',
    '## stdout (tail)',
    '',
    '```',
    ctx.stdoutTail,
    '```',
    '',
    '## stderr (tail)',
    '',
    '```',
    ctx.stderrTail,
    '```',
    '',
  ].join('\n');

  await writeArtifact(projectId, relativePath, content);
  return relativePath;
}

async function openIncidentForFailure(
  projectId: string,
  failure: QaFailure,
): Promise<string | null> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = slugifyShort(failure.title);
  const incidentId = `I-${ts}-${slug}`;
  const relativePath = `incidents/${incidentId}.md`;

  const classification = inferClassificationFromFailure(failure);
  const dispatch = dispatchRoleFromClassification(classification);

  const content = [
    '---',
    'role: qa',
    'phase: SELF_HEAL',
    `id: ${incidentId}`,
    `title: ${quote(failure.title)}`,
    `classification: ${classification}`,
    `dispatch: ${dispatch}`,
    'status: open',
    'attempts: 0',
    '---',
    '',
    `# ${failure.title}`,
    '',
    '## Reproduction',
    '',
    failure.file ? `- Playwright spec: \`${failure.file}\`` : '- Playwright spec: _(unknown)_',
    '- Run: `npx playwright test`',
    '',
    '## Observed',
    '',
    '```',
    failure.message,
    '```',
    '',
    '## Expected',
    '',
    '- Scenario completes without the assertion above firing.',
    '',
    '## Dispatch rationale',
    '',
    `- Classified as \`${classification}\`, routed to \`@${dispatch}\`.`,
    '',
  ].join('\n');

  await writeArtifact(projectId, relativePath, content);

  await emitAndAppend(projectId, {
    kind: 'incident.opened',
    incidentId,
    classification,
    path: relativePath,
  });

  return incidentId;
}

function inferClassificationFromFailure(failure: QaFailure): 'frontend' | 'backend' | 'infra' | 'data' | 'spec-gap' | 'unknown' {
  const haystack = `${failure.title} ${failure.message} ${failure.file ?? ''}`.toLowerCase();
  if (/(css|style|layout|render|aria|accessibility|button|page|component)/.test(haystack)) return 'frontend';
  if (/(api|endpoint|500|server|route|database|sql|prisma|drizzle)/.test(haystack)) return 'backend';
  if (/(docker|compose|ci|build|infra|deploy|env)/.test(haystack)) return 'infra';
  if (/(schema|migration|data|seed)/.test(haystack)) return 'data';
  return 'unknown';
}

function dispatchRoleFromClassification(
  classification: 'frontend' | 'backend' | 'infra' | 'data' | 'spec-gap' | 'unknown',
): 'backend-dev' | 'frontend-dev' | 'devops' {
  switch (classification) {
    case 'frontend':
      return 'frontend-dev';
    case 'backend':
    case 'data':
      return 'backend-dev';
    case 'infra':
      return 'devops';
    default:
      return 'backend-dev';
  }
}

function slugifyShort(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'failure';
}

function quote(input: string): string {
  if (/[:"\\\n]/.test(input)) return `"${input.replace(/"/g, '\\"')}"`;
  return input;
}

function escape(input: string): string {
  return input.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function tail(input: string, maxLines = 60): string {
  const lines = input.split('\n');
  return lines.slice(-maxLines).join('\n');
}

type EmitInput = Parameters<typeof emit>[0];
type EmitInputWithoutProject = EmitInput extends infer U
  ? U extends { projectId: string }
    ? Omit<U, 'projectId'>
    : never
  : never;

async function emitAndAppend(projectId: string, payload: EmitInputWithoutProject): Promise<void> {
  const event = emit({ projectId, ...payload } as EmitInput);
  await appendEvent(event);
}
