import type { Phase } from './phases';
import type { RoleKey } from './roles';

// which roles are expected to do the primary work for each phase. Used by the
// software-house supervisor to detect "everyone relevant is idle" before
// promoting to the next phase.
export const PHASE_PRIMARY_ROLES: Record<Phase, readonly RoleKey[]> = {
  INTAKE: ['orchestrator'],
  CLARIFY: ['orchestrator'],
  SPEC: ['pm'],
  ARCHITECT: ['architect'],
  PLAN: ['techlead'],
  IMPLEMENT: ['backend-dev', 'frontend-dev', 'devops', 'reviewer'],
  REVIEW: ['reviewer'],
  INTEGRATE: ['orchestrator'],
  BRINGUP: ['devops'],
  QA_MANUAL: ['qa'],
  SELF_HEAL: ['incident', 'backend-dev', 'frontend-dev', 'devops'],
  SECURITY: ['security'],
  RELEASE: ['release'],
  DEMO: ['writer'],
};

// phases that block on a human response (question block asked) and must not
// auto-advance from the idle buffer alone.
export const HUMAN_GATED_PHASES = new Set<Phase>(['INTAKE', 'CLARIFY']);

// phases that never auto-advance; DEMO is terminal.
export const TERMINAL_PHASES = new Set<Phase>(['DEMO']);

// phases that require a reviewer approve before the supervisor is allowed
// to promote to the next phase. The primary role produces the artifact,
// the reviewer reads it, and either approves (advance ok) or requests
// changes (primary role reruns with findings). Human can still barge in
// at any time to seed another primary turn.
export const PHASE_NEEDS_REVIEW = new Set<Phase>([
  'CLARIFY',
  'SPEC',
  'ARCHITECT',
  'PLAN',
]);

// attempt cap on the reviewer-primary round-trip before we escalate via
// HELP_NEEDED.md and pause the project for a human to intervene.
export const PHASE_REVIEW_ATTEMPTS_BUDGET = (() => {
  const raw = Number(process.env.OLYMPUS_PHASE_REVIEW_ATTEMPTS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 4;
})();

export function rolesForPhase(phase: Phase): readonly RoleKey[] {
  return PHASE_PRIMARY_ROLES[phase];
}
