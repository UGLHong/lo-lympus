export const ROLE_KEYS = [
  'orchestrator',
  'pm',
  'architect',
  'techlead',
  'backend-dev',
  'frontend-dev',
  'devops',
  'qa',
  'reviewer',
  'security',
  'incident',
  'release',
  'writer',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export type RoleState =
  | 'off-duty'
  | 'idle'
  | 'thinking'
  | 'typing'
  | 'reviewing'
  | 'testing'
  | 'blocked'
  | 'celebrating';

export type ModelTier = 'fast' | 'reasoning' | 'coding' | 'vision';

type RoleDef = {
  key: RoleKey;
  displayName: string;
  color: string;
  tier: ModelTier;
  initial: string;
};

export const ROLES: Record<RoleKey, RoleDef> = {
  orchestrator: { key: 'orchestrator', displayName: 'Orchestrator', color: '#f5c451', tier: 'reasoning', initial: 'O' },
  pm: { key: 'pm', displayName: 'Product Manager', color: '#5aa9ff', tier: 'reasoning', initial: 'P' },
  architect: { key: 'architect', displayName: 'Architect', color: '#a78bfa', tier: 'reasoning', initial: 'A' },
  techlead: { key: 'techlead', displayName: 'Tech Lead', color: '#22d3ee', tier: 'reasoning', initial: 'T' },
  'backend-dev': { key: 'backend-dev', displayName: 'Backend Dev', color: '#5fd39a', tier: 'coding', initial: 'B' },
  'frontend-dev': { key: 'frontend-dev', displayName: 'Frontend Dev', color: '#f472b6', tier: 'coding', initial: 'F' },
  devops: { key: 'devops', displayName: 'DevOps', color: '#fb923c', tier: 'coding', initial: 'D' },
  qa: { key: 'qa', displayName: 'QA Engineer', color: '#eab308', tier: 'vision', initial: 'Q' },
  reviewer: { key: 'reviewer', displayName: 'Reviewer', color: '#94a3b8', tier: 'fast', initial: 'R' },
  security: { key: 'security', displayName: 'Security', color: '#ef4444', tier: 'reasoning', initial: 'S' },
  incident: { key: 'incident', displayName: 'Incident Responder', color: '#f97316', tier: 'reasoning', initial: 'I' },
  release: { key: 'release', displayName: 'Release Manager', color: '#14b8a6', tier: 'fast', initial: 'L' },
  writer: { key: 'writer', displayName: 'Technical Writer', color: '#cbd5e1', tier: 'fast', initial: 'W' },
};

export const ROLE_LIST = ROLE_KEYS.map((k) => ROLES[k]);
