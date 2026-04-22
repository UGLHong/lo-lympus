import { isRole, type Role } from './roles';

const ROLE_CODE_PREFIX: Record<Role, string> = {
  pm: 'PM',
  architect: 'ARC',
  techlead: 'TL',
  'backend-dev': 'BE',
  'frontend-dev': 'FE',
  devops: 'DO',
  reviewer: 'REV',
  qa: 'QA',
  tester: 'TST',
  security: 'SEC',
  release: 'REL',
  writer: 'DOC',
  cto: 'CTO',
};

const FALLBACK_PREFIX = 'TASK';

export interface TaskCodeSource {
  id: string;
  role: string;
  createdAt: string;
}

export function rolePrefix(role: string): string {
  return isRole(role) ? ROLE_CODE_PREFIX[role] : FALLBACK_PREFIX;
}

// stable per-role sequence, numbered by createdAt order within the project.
export function buildTaskCodeMap(tasks: TaskCodeSource[]): Map<string, string> {
  const sorted = [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const counters = new Map<string, number>();
  const codes = new Map<string, string>();
  for (const task of sorted) {
    const prefix = rolePrefix(task.role);
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    codes.set(task.id, `${prefix}-${next}`);
  }
  return codes;
}

export function getTaskCode(
  taskId: string,
  codes: Map<string, string> | undefined,
  fallbackRole?: string,
): string {
  const mapped = codes?.get(taskId);
  if (mapped) return mapped;
  const prefix = fallbackRole ? rolePrefix(fallbackRole) : FALLBACK_PREFIX;
  return `${prefix}-${taskId.slice(0, 6)}`;
}
