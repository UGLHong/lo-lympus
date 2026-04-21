import fs from 'node:fs/promises';
import path from 'node:path';
import type { Phase } from '@/lib/const/phases';
import { readState } from '@/lib/workspace/fs';
import { readTicketsIndex } from '@/lib/workspace/tickets';
import { softwareHouseDir } from '@/lib/workspace/paths';

export type GateCheck = {
  label: string;
  ok: boolean;
  note?: string;
};

export type GateResult = {
  targetPhase: Phase;
  ok: boolean;
  checks: GateCheck[];
};

// central gate validator. Today implements INTEGRATE; other phases
// fall through to a stub that returns ok=true so the planning chain
// can keep advancing via its existing artifact-based checks.
export async function validateGate(
  projectId: string,
  targetPhase: Phase,
): Promise<GateResult> {
  switch (targetPhase) {
    case 'INTEGRATE':
      return validateIntegrateGate(projectId);
    default:
      return {
        targetPhase,
        ok: true,
        checks: [{ label: `No gate checks implemented for ${targetPhase}`, ok: true }],
      };
  }
}

async function validateIntegrateGate(projectId: string): Promise<GateResult> {
  const checks: GateCheck[] = [];

  const state = await readState(projectId).catch(() => null);
  checks.push({
    label: 'Project state readable',
    ok: state !== null,
  });

  const index = await readTicketsIndex(projectId);
  const hasIndex = index !== null && index.tickets.length > 0;
  checks.push({
    label: 'tickets/index.json exists with at least one ticket',
    ok: hasIndex,
  });

  if (hasIndex) {
    const nonDone = index.tickets.filter((t) => t.status !== 'done');
    checks.push({
      label: 'All tickets are done',
      ok: nonDone.length === 0,
      note: nonDone.length === 0
        ? undefined
        : `pending: ${nonDone.map((t) => `${t.code} (${t.status})`).join(', ')}`,
    });

    const blocked = index.tickets.filter((t) => t.status === 'blocked');
    checks.push({
      label: 'No blocked tickets',
      ok: blocked.length === 0,
      note: blocked.length === 0 ? undefined : blocked.map((t) => t.code).join(', '),
    });
  }

  const highFindings = await countHighSeverityReviewFindings(projectId);
  checks.push({
    label: 'No open high-severity review findings',
    ok: highFindings === 0,
    note: highFindings === 0 ? undefined : `${highFindings} high-severity finding(s)`,
  });

  const openIncidents = await countOpenIncidents(projectId);
  checks.push({
    label: 'No open incidents',
    ok: openIncidents === 0,
    note: openIncidents === 0 ? undefined : `${openIncidents} open incident(s)`,
  });

  return {
    targetPhase: 'INTEGRATE',
    ok: checks.every((c) => c.ok),
    checks,
  };
}

async function countHighSeverityReviewFindings(projectId: string): Promise<number> {
  const reviewsDir = path.join(softwareHouseDir(projectId), 'reviews');
  let files: string[];
  try {
    files = await fs.readdir(reviewsDir);
  } catch {
    return 0;
  }

  let count = 0;
  for (const name of files) {
    if (!name.endsWith('.md')) continue;
    const content = await fs.readFile(path.join(reviewsDir, name), 'utf8').catch(() => '');
    count += extractHighSeverityCount(content);
  }
  return count;
}

function extractHighSeverityCount(markdown: string): number {
  const fenceMatch = markdown.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (!fenceMatch) return 0;

  try {
    const parsed = JSON.parse(fenceMatch[1]!);
    if (parsed?.decision === 'approve') return 0;

    const findings = Array.isArray(parsed?.findings) ? parsed.findings : [];
    return findings.filter((f: unknown) => {
      return typeof f === 'object' && f !== null && (f as { severity?: string }).severity === 'high';
    }).length;
  } catch {
    return 0;
  }
}

async function countOpenIncidents(projectId: string): Promise<number> {
  const incidentsDir = path.join(softwareHouseDir(projectId), 'incidents');
  let files: string[];
  try {
    files = await fs.readdir(incidentsDir);
  } catch {
    return 0;
  }

  let count = 0;
  for (const name of files) {
    if (!name.endsWith('.md')) continue;
    const content = await fs.readFile(path.join(incidentsDir, name), 'utf8').catch(() => '');
    if (!/^status:\s*(resolved|closed)/im.test(content)) count += 1;
  }
  return count;
}
