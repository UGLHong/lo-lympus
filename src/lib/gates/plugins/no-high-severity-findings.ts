import fs from 'node:fs/promises';
import path from 'node:path';
import { softwareHouseDir } from '@/lib/workspace/paths';
import type { GatePlugin } from '../registry';

// scans reviews/*.md for JSON envelopes flagged with severity: high. This
// is the same scan the legacy INTEGRATE gate did; extracted into its own
// plugin so it composes with other INTEGRATE checks.
export const noHighSeverityFindingsGate: GatePlugin = {
  id: 'no-high-severity-findings',
  description: 'Reviewer findings with severity=high must be resolved before advancing.',
  targetPhase: 'INTEGRATE',
  async evaluate(projectId) {
    const count = await countHighSeverityFindings(projectId);
    return [
      {
        label: 'No open high-severity review findings',
        ok: count === 0,
        note: count === 0 ? undefined : `${count} high-severity finding(s)`,
      },
    ];
  },
};

async function countHighSeverityFindings(projectId: string): Promise<number> {
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
    const content = await fs
      .readFile(path.join(reviewsDir, name), 'utf8')
      .catch(() => '');
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
    return findings.filter(
      (f: unknown) =>
        typeof f === 'object' && f !== null && (f as { severity?: string }).severity === 'high',
    ).length;
  } catch {
    return 0;
  }
}
