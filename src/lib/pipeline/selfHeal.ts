import fs from 'node:fs/promises';
import path from 'node:path';
import type { RoleKey } from '@/lib/const/roles';
import { emit } from '@/lib/events/bus';
import { appendEvent, readState, writeArtifact, writeState } from '@/lib/workspace/fs';
import { artifactPath } from '@/lib/workspace/paths';
import { writeSourceFile } from '@/lib/workspace/sources';
import {
  MAX_HEAL_ATTEMPTS_PER_INCIDENT,
  deriveIncidentsIndex,
  inferDispatchFromClassification,
  isDispatchableRole,
  readIncidentFile,
  updateIncidentEntry,
  writeIncidentsIndex,
} from '@/lib/workspace/incidents';
import type { IncidentEntry, IncidentsIndex } from '@/lib/schemas/incidents';
import { validateDevEnvelope, type AgentEnvelope } from '@/lib/agents/envelope';
import { runAgentTurn } from '@/lib/agents/run';

export type SelfHealOptions = {
  projectId: string;
  maxSteps?: number;
};

export type SelfHealSummary = {
  steps: number;
  dispatched: { incidentId: string; role: RoleKey; attempt: number }[];
  resolved: string[];
  escalated: string[];
  skipped: { incidentId: string; reason: string }[];
  paused: boolean;
  reason?: string;
};

export type IncidentOutcome = {
  status: 'fixing' | 'resolved' | 'escalated';
  attempt: number;
  reason?: string;
};

export function resolveDispatchRole(incident: IncidentEntry): RoleKey | null {
  if (incident.dispatch) return incident.dispatch;
  return inferDispatchFromClassification(incident.classification);
}

// runs ONE heal attempt for an incident. Used by the software-house
// incident-heal worker so multiple incidents can be healed concurrently.
export async function runOneIncidentHeal(
  projectId: string,
  incident: IncidentEntry,
  dispatchRole: RoleKey,
): Promise<IncidentOutcome> {
  const nextAttempt = (incident.attempts ?? 0) + 1;

  await updateIncidentEntry(projectId, incident.id, {
    status: 'fixing',
    attempts: nextAttempt,
    lastAttemptAt: new Date().toISOString(),
    dispatch: dispatchRole,
  });

  await emitEvent(projectId, {
    kind: 'incident.dispatched',
    incidentId: incident.id,
    role: dispatchRole,
    attempt: nextAttempt,
  });

  const incidentBody = await readIncidentFile(projectId, incident.path);

  const devTurn = await runAgentTurn({
    projectId,
    role: dispatchRole,
    userPrompt: buildHealPrompt(incident, incidentBody, nextAttempt),
    includeSpec: true,
    includeArchitecture: true,
    contextExtra: buildHealContext(incident, incidentBody, nextAttempt),
  });

  const issues = validateDevEnvelope(devTurn.envelope, dispatchRole);
  if (issues.length > 0 || devTurn.envelope.sourceWrites.length === 0) {
    return maybeEscalate(projectId, incident, nextAttempt, 'dev envelope invalid or empty');
  }

  await applyHealSourceWrites(projectId, dispatchRole, devTurn.envelope, incident.id);

  const note = devTurn.envelope.text?.slice(0, 500) ?? '';
  await updateIncidentEntry(projectId, incident.id, {
    status: 'resolved',
    resolutionNote: note,
  });

  await emitEvent(projectId, {
    kind: 'incident.status',
    incidentId: incident.id,
    status: 'resolved',
    attempts: nextAttempt,
  });

  return { status: 'resolved', attempt: nextAttempt };
}

async function maybeEscalate(
  projectId: string,
  incident: IncidentEntry,
  attempt: number,
  reason: string,
): Promise<IncidentOutcome> {
  if (attempt >= MAX_HEAL_ATTEMPTS_PER_INCIDENT) {
    await updateIncidentEntry(projectId, incident.id, { status: 'escalated' });
    await emitEvent(projectId, {
      kind: 'incident.status',
      incidentId: incident.id,
      status: 'escalated',
      attempts: attempt,
    });
    return { status: 'escalated', attempt, reason };
  }

  await updateIncidentEntry(projectId, incident.id, { status: 'open' });
  await emitEvent(projectId, {
    kind: 'incident.status',
    incidentId: incident.id,
    status: 'open',
    attempts: attempt,
  });
  return { status: 'fixing', attempt, reason };
}

async function applyHealSourceWrites(
  projectId: string,
  role: RoleKey,
  envelope: AgentEnvelope,
  incidentId: string,
): Promise<void> {
  for (const write of envelope.sourceWrites) {
    try {
      const { bytes } = await writeSourceFile(projectId, write.path, write.content);
      await emitEvent(projectId, {
        kind: 'source.written',
        path: write.path,
        role,
        bytes,
        ticketCode: incidentId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await emitEvent(projectId, {
        kind: 'log',
        level: 'error',
        message: `incident ${incidentId} write failed for ${write.path}: ${message}`,
      });
    }
  }
}

export async function escalateIncidentToHuman(
  projectId: string,
  incident: IncidentEntry,
  reason: string,
): Promise<void> {
  const now = new Date().toISOString();
  const content = [
    '---',
    'role: orchestrator',
    'phase: SELF_HEAL',
    `incident: ${incident.id}`,
    `timestamp: ${now}`,
    'status: help-needed',
    '---',
    '',
    `# Help needed on ${incident.id} — ${incident.title}`,
    '',
    `The SELF_HEAL loop exhausted ${MAX_HEAL_ATTEMPTS_PER_INCIDENT} attempts without resolving this incident.`,
    '',
    '## Last known reason',
    '',
    `- ${reason}`,
    '',
    '## Suggested next steps',
    '',
    '- Open the incident under `incidents/`.',
    "- Inspect the failing scenario's QA report and any relevant review.",
    '- Correct the code directly, or `@incident` / `@backend-dev` / `@frontend-dev` with a new hypothesis.',
    '- Unpause the project once the fix is in.',
    '',
  ].join('\n');

  await writeArtifact(projectId, 'HELP_NEEDED.md', content);

  const state = await readState(projectId);
  await writeState({ ...state, paused: true });

  await emitEvent(projectId, {
    kind: 'pipeline.paused',
    reason: `self-heal exhausted on ${incident.id}: ${reason}`,
  });
}

function buildHealPrompt(
  incident: IncidentEntry,
  incidentBody: string | null,
  attempt: number,
): string {
  return [
    `You are fixing incident ${incident.id}: ${incident.title}.`,
    `This is heal attempt ${attempt} of ${MAX_HEAL_ATTEMPTS_PER_INCIDENT}.`,
    '',
    'Output requirements:',
    '- `sourceWrites[]`: EVERY changed file that addresses the incident root cause. Empty output fails the attempt.',
    '- `blocks[]`: emit a `diff` block per file with `before` / `after`.',
    '- `text`: 2-3 sentences summarising the fix and any tests updated.',
    '- Set `advance: false`.',
    '',
    incidentBody
      ? `## Incident body\n\n${incidentBody}`
      : `Incident file at ${incident.path} could not be read.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildHealContext(
  incident: IncidentEntry,
  incidentBody: string | null,
  attempt: number,
): string {
  const parts: string[] = [];
  parts.push(`## Incident under heal (attempt ${attempt}/${MAX_HEAL_ATTEMPTS_PER_INCIDENT})`);
  parts.push(
    [
      `- id: ${incident.id}`,
      `- title: ${incident.title}`,
      `- classification: ${incident.classification}`,
      `- dispatch: ${incident.dispatch ?? '(none)'}`,
      `- related ticket: ${incident.ticketCode ?? '(none)'}`,
    ].join('\n'),
  );

  if (incidentBody) {
    parts.push('\n### Incident file');
    parts.push('```markdown');
    parts.push(incidentBody);
    parts.push('```');
  }

  return parts.join('\n');
}

type EmitInput = Parameters<typeof emit>[0];
type EmitInputWithoutProject<E extends EmitInput = EmitInput> = E extends infer U
  ? U extends { projectId: string }
    ? Omit<U, 'projectId'>
    : never
  : never;

async function emitEvent(projectId: string, payload: EmitInputWithoutProject): Promise<void> {
  const event = emit({ projectId, ...payload } as EmitInput);
  await appendEvent(event);
}

// materialize the incidents/index.json from the incidents/*.md files the
// incident role just wrote. designed to be called right after the
// SELF_HEAL agent turn so the dispatch queue is ready.
export async function materializeIncidentsIndex(projectId: string): Promise<IncidentsIndex | null> {
  const dir = path.join(artifactPath(projectId, 'incidents'));
  try {
    await fs.access(dir);
  } catch {
    return null;
  }

  const derived = await deriveIncidentsIndex(projectId);
  await writeIncidentsIndex(derived);

  await emitEvent(projectId, {
    kind: 'incident.index.updated',
    count: derived.incidents.length,
  });

  return derived;
}

export { isDispatchableRole };

// legacy entry point: kicks the software house and waits for SELF_HEAL to
// settle. Preserved so the /self-heal HTTP endpoint keeps working.
export async function runSelfHealLoop(options: SelfHealOptions): Promise<SelfHealSummary> {
  const { runSoftwareHouseUntilPhaseLeaves } = await import('./software-house');
  const implementSummary = await runSoftwareHouseUntilPhaseLeaves({
    projectId: options.projectId,
    waitForPhase: 'SELF_HEAL',
    reason: 'self-heal-loop',
  });
  return {
    steps: implementSummary.steps,
    dispatched: [],
    resolved: [],
    escalated: [],
    skipped: [],
    paused: implementSummary.paused,
    reason: implementSummary.reason,
  };
}
