export const ROLES = [
  'orchestrator',
  'pm',
  'architect',
  'techlead',
  'backend-dev',
  'frontend-dev',
  'reviewer',
  'qa',
  'tester',
  'devops',
  'security',
  'release',
  'writer',
  'incident',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_TIER: Record<Role, 'FAST' | 'REASONING' | 'CODING' | 'VISION'> = {
  orchestrator: 'REASONING',
  pm: 'REASONING',
  architect: 'REASONING',
  techlead: 'REASONING',
  reviewer: 'REASONING',
  security: 'REASONING',
  incident: 'REASONING',
  'backend-dev': 'CODING',
  'frontend-dev': 'CODING',
  devops: 'CODING',
  qa: 'VISION',
  tester: 'VISION',
  release: 'FAST',
  writer: 'FAST',
};

export const ROLE_COLOR: Record<Role, string> = {
  orchestrator: '#ef4444',
  pm: '#f59e0b',
  architect: '#f472b6',
  techlead: '#6366f1',
  'backend-dev': '#3b82f6',
  'frontend-dev': '#22d3ee',
  reviewer: '#8b5cf6',
  qa: '#a855f7',
  tester: '#84cc16',
  devops: '#10b981',
  security: '#dc2626',
  release: '#14b8a6',
  writer: '#64748b',
  incident: '#f97316',
};

// roles that lead orchestration/planning work. they are allowed (and
// encouraged) to batch-ask clarifying questions up-front rather than
// silently guessing when requirements are ambiguous.
export const PLANNING_ROLES: ReadonlySet<Role> = new Set<Role>([
  'orchestrator',
  'pm',
  'architect',
  'techlead',
  'reviewer',
  'security',
  'incident',
]);

export function isPlanningRole(role: Role): boolean {
  return PLANNING_ROLES.has(role);
}

export const ROLE_LABEL: Record<Role, string> = {
  orchestrator: 'Orchestrator',
  pm: 'Product Manager',
  architect: 'Architect',
  techlead: 'Tech Lead',
  'backend-dev': 'Backend',
  'frontend-dev': 'Frontend',
  reviewer: 'Reviewer',
  qa: 'QA',
  tester: 'Tester',
  devops: 'DevOps',
  security: 'Security',
  release: 'Release',
  writer: 'Writer',
  incident: 'Incident',
};
