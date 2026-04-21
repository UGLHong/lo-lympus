import type { Phase } from '@/lib/const/phases';

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

export type GatePlugin = {
  id: string;
  description: string;
  targetPhase: Phase;
  evaluate: (projectId: string) => Promise<GateCheck[]>;
};

const registry = new Map<string, GatePlugin>();

export function registerGatePlugin(plugin: GatePlugin): void {
  registry.set(plugin.id, plugin);
}

export function listGatePluginsForPhase(targetPhase: Phase): GatePlugin[] {
  return [...registry.values()].filter((plugin) => plugin.targetPhase === targetPhase);
}

export async function evaluateGatesForPhase(
  projectId: string,
  targetPhase: Phase,
): Promise<GateResult> {
  const plugins = listGatePluginsForPhase(targetPhase);
  if (plugins.length === 0) {
    return {
      targetPhase,
      ok: true,
      checks: [{ label: `No gate checks registered for ${targetPhase}`, ok: true }],
    };
  }

  const checks: GateCheck[] = [];
  for (const plugin of plugins) {
    const pluginChecks = await plugin.evaluate(projectId);
    checks.push(...pluginChecks);
  }
  return { targetPhase, ok: checks.every((c) => c.ok), checks };
}
