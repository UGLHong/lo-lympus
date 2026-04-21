import type { Phase } from '@/lib/const/phases';
import {
  ensureGatePluginsRegistered,
  evaluateGatesForPhase,
  type GateCheck,
  type GateResult,
} from '@/lib/gates';

export type { GateCheck, GateResult };

// central gate validator — delegates to the modular gate registry so new
// phase transitions can register plugins without patching this switch.
export async function validateGate(
  projectId: string,
  targetPhase: Phase,
): Promise<GateResult> {
  ensureGatePluginsRegistered();
  return evaluateGatesForPhase(projectId, targetPhase);
}
