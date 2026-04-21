export const PIPELINE_PHASES = [
  'INTAKE',
  'CLARIFY',
  'SPEC',
  'ARCHITECT',
  'PLAN',
  'IMPLEMENT',
  'REVIEW',
  'INTEGRATE',
  'BRINGUP',
  'QA_MANUAL',
  'SELF_HEAL',
  'SECURITY',
  'RELEASE',
  'DEMO',
] as const;

export type Phase = (typeof PIPELINE_PHASES)[number];

export const PHASE_DESCRIPTIONS: Record<Phase, string> = {
  INTAKE: 'Gather the raw requirement from the human',
  CLARIFY: 'Ask focused clarification questions',
  SPEC: 'Produce SPEC.md with user stories and acceptance criteria',
  ARCHITECT: 'Produce ARCHITECTURE.md and ADRs',
  PLAN: 'Break down into tickets with a dependency DAG',
  IMPLEMENT: 'Devs and reviewers run in parallel per ticket (queue-based)',
  REVIEW: 'Peer review of PRs',
  INTEGRATE: 'Merge approved PRs',
  BRINGUP: 'Local dev server + HTTP probe for manual UI QA (no new infra code)',
  QA_MANUAL: 'Test plan plus Playwright UI smoke against the running app',
  SELF_HEAL: 'Bounded loop of incidents → fixes → re-test',
  SECURITY: 'Security auditor reviews the built product',
  RELEASE: 'Tag version, write changelog, prepare demo',
  DEMO: 'Present the finished product to the human',
};

export function nextPhase(current: Phase): Phase | null {
  const i = PIPELINE_PHASES.indexOf(current);
  if (i < 0 || i === PIPELINE_PHASES.length - 1) return null;
  return PIPELINE_PHASES[i + 1];
}
