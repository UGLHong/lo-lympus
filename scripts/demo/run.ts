#!/usr/bin/env tsx
// reproducible end-to-end demo runner. expects the web app to already be
// running (pnpm dev), so this script is a thin HTTP client around the API
// routes the UI itself calls. keeps the demo invariant: every path an
// operator can exercise from the UI must also be exercisable from the CLI.
//
// usage:
//   pnpm demo                       # seed "hello-readme" and watch auto-drive
//   pnpm demo --fixture=todo-list   # pick a different fixture
//   pnpm demo --project=<id>        # resume / drive an existing project
//   pnpm demo --stage=implement     # just run the IMPLEMENT loop
//   pnpm demo --answer="no auth"    # reply to the first clarification
//   pnpm demo --trace               # stream events.ndjson after each step

import { setTimeout as delay } from 'node:timers/promises';
import { demoFixtures, findFixture, type DemoFixture } from './fixtures';

type Args = {
  fixture: string;
  project: string | null;
  stage: 'full' | 'seed' | 'implement' | 'qa' | 'self-heal';
  answer: string | null;
  watchMs: number;
  trace: boolean;
  baseUrl: string;
  maxSteps: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    fixture: 'hello-readme',
    project: null,
    stage: 'full',
    answer: null,
    watchMs: 60_000,
    trace: false,
    baseUrl: process.env.OLYMPUS_API ?? 'http://localhost:3100',
    maxSteps: 12,
  };

  for (const raw of argv) {
    const [key, value] = raw.replace(/^-+/, '').split('=');
    switch (key) {
      case 'fixture':
        args.fixture = value ?? args.fixture;
        break;
      case 'project':
        args.project = value ?? null;
        break;
      case 'stage':
        args.stage = (value as Args['stage']) ?? args.stage;
        break;
      case 'answer':
        args.answer = value ?? null;
        break;
      case 'watch-ms':
        args.watchMs = Number(value) || args.watchMs;
        break;
      case 'base-url':
        args.baseUrl = value ?? args.baseUrl;
        break;
      case 'max-steps':
        args.maxSteps = Number(value) || args.maxSteps;
        break;
      case 'trace':
        args.trace = true;
        break;
      case 'help':
        printUsage();
        process.exit(0);
    }
  }

  return args;
}

function printUsage(): void {
  const fixtureList = demoFixtures.map((f) => `    ${f.slug.padEnd(16)} — ${f.notes}`).join('\n');
  console.log(
    [
      'Usage: pnpm demo [--fixture=<slug>] [--project=<id>] [--stage=<stage>]',
      '                 [--answer="<text>"] [--watch-ms=<ms>] [--trace]',
      '',
      'Stages:',
      '    full (default)  — seed, watch auto-drive, answer, implement, qa, self-heal',
      '    seed            — only POST /api/projects (auto-drive continues in background)',
      '    implement       — only POST /api/projects/<id>/implement',
      '    qa              — only POST /api/projects/<id>/qa',
      '    self-heal       — only POST /api/projects/<id>/self-heal',
      '',
      'Fixtures:',
      fixtureList,
    ].join('\n'),
  );
}

async function httpJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${url} → ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function seed(args: Args, fixture: DemoFixture): Promise<string> {
  console.log(`\n[seed] creating project from fixture "${fixture.slug}"…`);
  const res = await httpJson<{ projectId: string }>('POST', `${args.baseUrl}/api/projects`, {
    name: fixture.name,
    requirement: fixture.requirement,
  });
  console.log(`[seed] → projectId=${res.projectId}`);
  return res.projectId;
}

async function sendMessage(args: Args, projectId: string, text: string): Promise<void> {
  console.log(`\n[message] ${projectId} ← "${text.slice(0, 80)}"`);
  await httpJson('POST', `${args.baseUrl}/api/projects/${projectId}/messages`, { text });
}

async function readState(args: Args, projectId: string): Promise<{ phase: string; paused: boolean }> {
  const res = await httpJson<{ state: { phase: string; paused: boolean } }>(
    'GET',
    `${args.baseUrl}/api/projects/${projectId}/messages`,
  );
  return res.state;
}

async function waitForPhaseChange(
  args: Args,
  projectId: string,
  from: string,
  timeoutMs: number,
): Promise<string> {
  const start = Date.now();
  let lastPhase = from;
  while (Date.now() - start < timeoutMs) {
    const { phase, paused } = await readState(args, projectId);
    if (phase !== lastPhase) {
      console.log(`[watch] phase ${lastPhase} → ${phase}${paused ? ' (paused)' : ''}`);
      lastPhase = phase;
    }
    if (paused) return phase;
    await delay(1500);
  }
  return lastPhase;
}

async function implement(args: Args, projectId: string): Promise<void> {
  console.log(`\n[implement] running up to ${args.maxSteps} ticket steps…`);
  const res = await httpJson<{ summary: unknown }>(
    'POST',
    `${args.baseUrl}/api/projects/${projectId}/implement`,
    { maxSteps: args.maxSteps, resume: true },
  );
  console.log('[implement] summary:', res.summary);
}

async function qa(args: Args, projectId: string): Promise<void> {
  console.log('\n[qa] running playwright on host…');
  const res = await httpJson<{ summary: unknown }>(
    'POST',
    `${args.baseUrl}/api/projects/${projectId}/qa`,
    { timeoutMs: 120_000 },
  );
  console.log('[qa] summary:', res.summary);
}

async function selfHeal(args: Args, projectId: string): Promise<void> {
  console.log('\n[self-heal] dispatching open incidents…');
  const res = await httpJson<{ summary: unknown }>(
    'POST',
    `${args.baseUrl}/api/projects/${projectId}/self-heal`,
    { maxSteps: 6 },
  );
  console.log('[self-heal] summary:', res.summary);
}

async function traceEvents(args: Args, projectId: string, label: string): Promise<void> {
  if (!args.trace) return;
  const res = await httpJson<{ count: number; events: unknown[] }>(
    'GET',
    `${args.baseUrl}/api/projects/${projectId}/events`,
  );
  console.log(`[trace:${label}] ${res.count} events on disk (last 5):`);
  for (const event of res.events.slice(-5)) {
    console.log('   ', JSON.stringify(event));
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fixture = findFixture(args.fixture);
  if (!fixture) {
    console.error(`unknown fixture "${args.fixture}"`);
    printUsage();
    process.exit(1);
  }

  const projectId = args.project ?? (await seed(args, fixture));
  await traceEvents(args, projectId, 'after-seed');

  if (args.stage === 'seed') return;

  if (args.stage === 'full') {
    console.log(`\n[watch] watching phase transitions for up to ${Math.round(args.watchMs / 1000)}s…`);
    let phase = await waitForPhaseChange(args, projectId, 'INTAKE', args.watchMs);
    await traceEvents(args, projectId, 'after-intake-watch');

    if (args.answer && phase === 'CLARIFY') {
      await sendMessage(args, projectId, args.answer);
      phase = await waitForPhaseChange(args, projectId, 'CLARIFY', args.watchMs);
      await traceEvents(args, projectId, 'after-clarify');
    }
  }

  if (args.stage === 'full' || args.stage === 'implement') {
    await implement(args, projectId);
    await traceEvents(args, projectId, 'after-implement');
  }

  if (args.stage === 'full' || args.stage === 'qa') {
    await qa(args, projectId).catch((err) => {
      console.warn('[qa] skipped:', (err as Error).message);
    });
  }

  if (args.stage === 'full' || args.stage === 'self-heal') {
    await selfHeal(args, projectId).catch((err) => {
      console.warn('[self-heal] skipped:', (err as Error).message);
    });
  }

  console.log(`\ndone. open the UI at ${args.baseUrl}/projects/${projectId} to inspect.`);
}

main().catch((err) => {
  console.error('\ndemo failed:', err);
  process.exitCode = 1;
});
