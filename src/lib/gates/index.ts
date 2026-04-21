import { registerGatePlugin } from './registry';
import { allTicketsDoneGate } from './plugins/all-tickets-done';
import { noHighSeverityFindingsGate } from './plugins/no-high-severity-findings';
import { noOpenIncidentsGate } from './plugins/no-open-incidents';

let registered = false;

export function ensureGatePluginsRegistered(): void {
  if (registered) return;
  registered = true;
  registerGatePlugin(allTicketsDoneGate);
  registerGatePlugin(noHighSeverityFindingsGate);
  registerGatePlugin(noOpenIncidentsGate);
}

export {
  evaluateGatesForPhase,
  registerGatePlugin,
  type GateCheck,
  type GatePlugin,
  type GateResult,
} from './registry';
