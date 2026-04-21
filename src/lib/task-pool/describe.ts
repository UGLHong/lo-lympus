import type { TaskKind } from './schema';

// human-readable title + summary for a task, derived deterministically from
// its kind + payload so the Office desk and markdown folder stay
// self-explanatory without bespoke copy per call site.
export function describeTaskKind(kind: TaskKind): string {
  switch (kind) {
    case 'orchestrator-intake':
      return 'Orchestrator — intake';
    case 'orchestrator-clarify':
      return 'Orchestrator — clarify requirements';
    case 'pm-spec':
      return 'Product Manager — write SPEC';
    case 'architect-design':
      return 'Architect — design + ADRs';
    case 'techlead-plan':
      return 'Tech Lead — break down into tickets';
    case 'phase-review':
      return 'Reviewer — phase review';
    case 'ticket-dev':
      return 'Developer — implement ticket';
    case 'ticket-review':
      return 'Reviewer — ticket review';
    case 'devops-bringup':
      return 'DevOps — local bring-up note';
    case 'qa-plan':
      return 'QA — test plan + smoke';
    case 'incident-triage':
      return 'Incident Responder — triage';
    case 'incident-heal':
      return 'Dispatched role — heal incident';
    case 'security-review':
      return 'Security — audit';
    case 'release-notes':
      return 'Release — changelog + demo';
    case 'writer-demo':
      return 'Technical Writer — README + demo';
    default:
      return String(kind);
  }
}

export function describeTaskSummary(
  kind: TaskKind,
  payload: Record<string, unknown>,
): string {
  const code = typeof payload.ticketCode === 'string' ? payload.ticketCode : null;
  const incident = typeof payload.incidentId === 'string' ? payload.incidentId : null;
  const phase = typeof payload.targetPhase === 'string' ? payload.targetPhase : null;
  const attempt =
    typeof payload.attempt === 'number' && Number.isFinite(payload.attempt)
      ? `attempt ${payload.attempt}`
      : null;

  const parts: string[] = [];
  if (code) parts.push(code);
  if (incident) parts.push(incident);
  if (phase) parts.push(`phase=${phase}`);
  if (attempt) parts.push(attempt);
  return parts.length > 0 ? parts.join(' · ') : describeTaskKind(kind);
}

export function buildTaskSlug(index: number, kind: TaskKind): string {
  const padded = String(index).padStart(4, '0');
  return `TSK-${padded}-${kind}`;
}
