import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROLE_KEYS, type RoleKey } from '@/lib/const/roles';
import { TASK_KINDS, type TaskKind } from '@/lib/task-pool/schema';

const employeeConfigSchema = z.object({
  role: z.enum(ROLE_KEYS),
  enabled: z.boolean().default(true),
  pollMs: z.number().int().min(250).max(120_000).optional(),
  concurrency: z.number().int().min(1).max(16).default(1),
  accepts: z.array(z.enum(TASK_KINDS)).optional(),
  modelSpec: z.string().optional(),
  note: z.string().optional(),
});

export type EmployeeConfig = z.infer<typeof employeeConfigSchema>;

type ResolvedEmployeeConfig = {
  role: RoleKey;
  enabled: boolean;
  pollMs: number;
  concurrency: number;
  accepts: readonly TaskKind[] | null;
  modelSpec: string | null;
  note: string | null;
};

const DEFAULT_POLL_MS = 5_000;

function defaultPollMs(): number {
  const raw = Number(process.env.OLYMPUS_EMPLOYEE_POLL_MS);
  if (Number.isFinite(raw) && raw >= 250) return Math.floor(raw);
  // legacy fallback so existing OLYMPUS_WORKER_POLL_MS keeps working.
  const legacy = Number(process.env.OLYMPUS_WORKER_POLL_MS);
  if (Number.isFinite(legacy) && legacy >= 250) return Math.floor(legacy);
  return DEFAULT_POLL_MS;
}

function configsRoot(): string {
  const raw = process.env.OLYMPUS_EMPLOYEE_CONFIG_DIR ?? './config/employees';
  return path.resolve(process.cwd(), raw);
}

function readConfigForRole(role: RoleKey): EmployeeConfig | null {
  const filePath = path.join(configsRoot(), `${role}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = employeeConfigSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    if (parsed.data.role !== role) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function resolveEmployeeConfig(role: RoleKey): ResolvedEmployeeConfig {
  const fromDisk = readConfigForRole(role);
  const basePoll = defaultPollMs();

  return {
    role,
    enabled: fromDisk?.enabled ?? true,
    pollMs: fromDisk?.pollMs ?? basePoll,
    concurrency: fromDisk?.concurrency ?? 1,
    accepts: fromDisk?.accepts ?? null,
    modelSpec: fromDisk?.modelSpec ?? null,
    note: fromDisk?.note ?? null,
  };
}

export function resolveAllEmployeeConfigs(): ResolvedEmployeeConfig[] {
  return ROLE_KEYS.map((role) => resolveEmployeeConfig(role));
}
