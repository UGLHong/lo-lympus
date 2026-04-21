import fs from 'node:fs/promises';
import path from 'node:path';
import { softwareHouseDir } from '@/lib/workspace/paths';
import type { GatePlugin } from '../registry';

// INTEGRATE is also blocked on any open incident — a heal still pending
// means we cannot ship. The heal loop itself lives in SELF_HEAL.
export const noOpenIncidentsGate: GatePlugin = {
  id: 'no-open-incidents',
  description: 'Every incident is resolved or closed.',
  targetPhase: 'INTEGRATE',
  async evaluate(projectId) {
    const count = await countOpenIncidents(projectId);
    return [
      {
        label: 'No open incidents',
        ok: count === 0,
        note: count === 0 ? undefined : `${count} open incident(s)`,
      },
    ];
  },
};

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
    const content = await fs
      .readFile(path.join(incidentsDir, name), 'utf8')
      .catch(() => '');
    if (!/^status:\s*(resolved|closed)/im.test(content)) count += 1;
  }
  return count;
}
