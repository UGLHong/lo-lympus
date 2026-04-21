import { z } from 'zod';
import { ROLE_KEYS } from '@/lib/const/roles';

export const incidentClassifications = [
  'frontend',
  'backend',
  'infra',
  'data',
  'spec-gap',
  'unknown',
] as const;

export const incidentStatusValues = [
  'open',
  'fixing',
  'resolved',
  'escalated',
] as const;

export const incidentDispatchRoles = ['backend-dev', 'frontend-dev', 'devops'] as const;

export const incidentEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  classification: z.enum(incidentClassifications).default('unknown'),
  dispatch: z.enum(ROLE_KEYS).nullable().default(null),
  status: z.enum(incidentStatusValues).default('open'),
  attempts: z.number().int().nonnegative().default(0),
  ticketCode: z.string().nullable().default(null),
  path: z.string(),
  lastAttemptAt: z.string().nullable().default(null),
  resolutionNote: z.string().nullable().default(null),
});

export const incidentsIndexSchema = z.object({
  version: z.literal(1).default(1),
  projectId: z.string(),
  incidents: z.array(incidentEntrySchema),
  updatedAt: z.string(),
});

export type IncidentEntry = z.infer<typeof incidentEntrySchema>;
export type IncidentsIndex = z.infer<typeof incidentsIndexSchema>;
export type IncidentClassification = (typeof incidentClassifications)[number];
export type IncidentStatus = (typeof incidentStatusValues)[number];
