import { z } from 'zod';

import { getProjectById, listProjectTasks } from '../../server/db/queries';
import { aiDetectRunCommand } from '../../server/lib/ai-run-command';
import { detectRunCommand, type DetectedRunCommand } from '../../server/lib/detect-run-command';
import { openInBrowser, openInZed } from '../../server/lib/host-shell';
import { hasRuntime, startRuntime, stopRuntimeAsync } from '../../server/lib/runtime-process';
import { emit } from '../lib/event-bus.server';

import type { Route } from './+types/api.project-action';

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open-in-zed') }),
  z.object({
    action: z.literal('run-app'),
    command: z.string().trim().min(1).optional(),
  }),
  z.object({ action: z.literal('detect-run-command') }),
]);

const BLOCKING_STATUSES = ['todo', 'in-progress', 'pending-review'] as const;

export async function loader({ params }: Route.LoaderArgs) {
  const projectId = params.id;
  if (!projectId) return Response.json({ error: 'projectId required' }, { status: 400 });
  const project = await getProjectById(projectId);
  if (!project) return Response.json({ error: 'project not found' }, { status: 404 });
  return Response.json(await combinedDetection(project.workspaceDir));
}

export async function action({ params, request }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const projectId = params.id;
  if (!projectId) return Response.json({ error: 'projectId required' }, { status: 400 });

  const json = await request.json();
  const parsed = ActionSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const project = await getProjectById(projectId);
  if (!project) return Response.json({ error: 'project not found' }, { status: 404 });

  if (parsed.data.action === 'open-in-zed') {
    const result = openInZed(project.workspaceDir);
    if (!result.ok) {
      return Response.json(
        {
          ok: false,
          error: `failed to launch zed (${result.error ?? 'unknown error'}). make sure the \`zed\` CLI is on PATH.`,
        },
        { status: 500 },
      );
    }
    return Response.json({ ok: true, command: result.command, workspaceDir: project.workspaceDir });
  }

  if (parsed.data.action === 'detect-run-command') {
    return Response.json(await combinedDetection(project.workspaceDir));
  }

  return runApplication(project.id, project.slug, project.workspaceDir, parsed.data.command);
}

interface CombinedDetection {
  primary: DetectedRunCommand | null;
  candidates: DetectedRunCommand[];
}

// run the heuristic detector and the AI detector in parallel, dedupe by
// exact command string, and put the AI result on top if it exists (the
// model sees the full workspace context and can chain commands with &&,
// which the static rules can't).
async function combinedDetection(workspaceDir: string): Promise<CombinedDetection> {
  const [heuristic, aiCandidate] = await Promise.all([
    Promise.resolve(detectRunCommand(workspaceDir)),
    aiDetectRunCommand(workspaceDir).catch(() => null),
  ]);

  const ordered: DetectedRunCommand[] = [];
  if (aiCandidate) ordered.push(aiCandidate);
  for (const candidate of heuristic.candidates) {
    if (ordered.some((existing) => existing.command === candidate.command)) continue;
    ordered.push(candidate);
  }

  return { primary: ordered[0] ?? null, candidates: ordered };
}

async function runApplication(
  projectId: string,
  projectSlug: string,
  workspaceDir: string,
  explicitCommand: string | undefined,
): Promise<Response> {
  const tasks = await listProjectTasks(projectId);
  const blocking = tasks.filter((task) =>
    (BLOCKING_STATUSES as readonly string[]).includes(task.status),
  );
  if (blocking.length > 0) {
    return Response.json(
      {
        ok: false,
        error: `cannot run: ${blocking.length} task(s) still active (todo / in-progress / pending-review).`,
      },
      { status: 409 },
    );
  }

  const resolved = await resolveRunCommand(workspaceDir, explicitCommand);

  // always reclaim the runtime slot before starting so a second click
  // doesn't short-circuit on the stale "already-running" record and also
  // so we don't leave vite/uvicorn/etc. orphaned on the previous port.
  const restarted = hasRuntime(projectSlug);
  if (restarted) {
    emit({
      projectId,
      role: 'system',
      type: 'log',
      payload: {
        stream: 'stdout',
        line: '[runtime] previous dev server detected — stopping it first',
      },
    });
    const stopResult = await stopRuntimeAsync(projectSlug, { timeoutMs: 5000 });
    if (stopResult.escalatedToKill) {
      emit({
        projectId,
        role: 'system',
        type: 'log',
        payload: {
          stream: 'stdout',
          line: '[runtime] previous process ignored SIGTERM — sent SIGKILL',
        },
      });
    }
    // brief pause so the OS fully releases the old port/socket before we
    // let the new dev server try to bind it.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  emit({
    projectId,
    role: 'system',
    type: 'log',
    payload: {
      stream: 'stdout',
      line: `[runtime] launching generated application via: ${resolved.command} (${resolved.source})`,
    },
  });

  const runtime = await startRuntime({
    projectId,
    projectSlug,
    role: 'system',
    command: resolved.command,
    waitMs: 25_000,
  });

  if (!runtime.port) {
    return Response.json({
      ok: true,
      status: runtime.status,
      command: resolved.command,
      source: resolved.source,
      port: null,
      url: null,
      restarted,
      message:
        'dev server starting — no port detected yet. check the Terminal panel; if it never appears you may need a different run command.',
    });
  }

  const url = `http://localhost:${runtime.port}`;
  const opener = openInBrowser(url);
  emit({
    projectId,
    role: 'system',
    type: 'log',
    payload: {
      stream: 'stdout',
      line: opener.ok
        ? `[runtime] opened ${url} in your default browser`
        : `[runtime] dev server ready at ${url} but failed to auto-open a browser (${opener.error ?? 'unknown error'})`,
    },
  });

  return Response.json({
    ok: true,
    status: runtime.status,
    command: resolved.command,
    source: resolved.source,
    port: runtime.port,
    url,
    openedInBrowser: opener.ok,
    restarted,
  });
}

async function resolveRunCommand(
  workspaceDir: string,
  override: string | undefined,
): Promise<DetectedRunCommand> {
  if (override) return { command: override, source: 'human override' };
  const detection = await combinedDetection(workspaceDir);
  if (detection.primary) return detection.primary;
  return { command: 'pnpm dev', source: 'fallback (no run command detected)' };
}
