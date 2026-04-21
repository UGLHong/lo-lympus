import { z } from 'zod';
import { ROLE_KEYS } from '@/lib/const/roles';

export const ticketStatusValues = [
  'todo',
  'in-progress',
  'review',
  'changes-requested',
  'done',
  'blocked',
] as const;

export const ticketsIndexEntrySchema = z.object({
  code: z.string(),
  title: z.string(),
  assigneeRole: z.enum(ROLE_KEYS).nullable(),
  dependsOn: z.array(z.string()).default([]),
  status: z.enum(ticketStatusValues).default('todo'),
  attempts: z.number().int().nonnegative().default(0),
  lastAttemptAt: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  reviewPath: z.string().nullable().default(null),
  pendingSourcePaths: z.array(z.string()).nullable().default(null),
  path: z.string(),
});

export const ticketsIndexSchema = z.object({
  version: z.literal(1).default(1),
  projectId: z.string(),
  tickets: z.array(ticketsIndexEntrySchema),
  updatedAt: z.string(),
});

export type TicketsIndex = z.infer<typeof ticketsIndexSchema>;
export type TicketsIndexEntry = z.infer<typeof ticketsIndexEntrySchema>;
export type TicketStatus = (typeof ticketStatusValues)[number];
