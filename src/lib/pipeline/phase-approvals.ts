import type { Phase } from '@/lib/const/phases';
import { PHASE_NEEDS_REVIEW } from '@/lib/const/phase-roles';

type PhaseApprovalStore = Map<string, Map<Phase, boolean>>;

declare global {
  // eslint-disable-next-line no-var
  var __olympus_phase_approvals__: PhaseApprovalStore | undefined;
}

function getStore(): PhaseApprovalStore {
  if (!globalThis.__olympus_phase_approvals__) {
    globalThis.__olympus_phase_approvals__ = new Map();
  }
  return globalThis.__olympus_phase_approvals__;
}

function getProjectApprovals(projectId: string): Map<Phase, boolean> {
  const store = getStore();
  let existing = store.get(projectId);
  if (!existing) {
    existing = new Map();
    store.set(projectId, existing);
  }
  return existing;
}

export function shouldPhaseBeReviewed(phase: Phase): boolean {
  return PHASE_NEEDS_REVIEW.has(phase);
}

export function isPhaseApproved(projectId: string, phase: Phase): boolean {
  return getProjectApprovals(projectId).get(phase) === true;
}

export function markPhaseApproved(projectId: string, phase: Phase): void {
  getProjectApprovals(projectId).set(phase, true);
}

export function clearPhaseApproval(projectId: string, phase: Phase): void {
  getProjectApprovals(projectId).delete(phase);
}

export function clearAllPhaseApprovals(projectId: string): void {
  getStore().delete(projectId);
}
