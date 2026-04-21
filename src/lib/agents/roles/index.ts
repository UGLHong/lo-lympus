import { ROLES, type RoleKey } from '@/lib/const/roles';
import type { RoleDefinition } from './define';

import { orchestrator } from './orchestrator';
import { pm } from './pm';
import { architect } from './architect';
import { techlead } from './techlead';
import { backendDev } from './backend-dev';
import { frontendDev } from './frontend-dev';
import { devops } from './devops';
import { qa } from './qa';
import { reviewer } from './reviewer';
import { security } from './security';
import { incident } from './incident';
import { release } from './release';
import { writer } from './writer';

export { defineRole, type RoleDefinition } from './define';

export const ROLE_DEFINITIONS: Record<RoleKey, RoleDefinition> = {
  orchestrator,
  pm,
  architect,
  techlead,
  'backend-dev': backendDev,
  'frontend-dev': frontendDev,
  devops,
  qa,
  reviewer,
  security,
  incident,
  release,
  writer,
};

// guard against drift between the role catalog's tier (used for UI +
// runtime routing) and each role module's declared tier. Runs once at
// module load; throws loudly in dev/build so the mismatch cannot ship.
function assertTiersConsistent(): void {
  const mismatches: string[] = [];
  for (const key of Object.keys(ROLE_DEFINITIONS) as RoleKey[]) {
    const definition = ROLE_DEFINITIONS[key];
    const catalog = ROLES[key];
    if (definition.key !== key) {
      mismatches.push(`${key}: role module key "${definition.key}" does not match registry key`);
    }
    if (definition.tier !== catalog.tier) {
      mismatches.push(`${key}: tier "${definition.tier}" != ROLES.tier "${catalog.tier}"`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Role definitions drift detected:\n  - ${mismatches.join('\n  - ')}\n` +
        `Update either src/lib/const/roles.ts or src/lib/agents/roles/*.ts so they agree.`,
    );
  }
}

assertTiersConsistent();

export function getRoleDefinition(role: RoleKey): RoleDefinition {
  return ROLE_DEFINITIONS[role];
}
