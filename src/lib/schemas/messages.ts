import { z } from 'zod';
import { ROLE_KEYS } from '@/lib/const/roles';
import { contentBlockSchema } from './content-blocks';

export const messageAuthorSchema = z.union([
  z.object({ kind: z.literal('human') }),
  z.object({ kind: z.literal('role'), role: z.enum(ROLE_KEYS) }),
  z.object({ kind: z.literal('system') }),
]);

export const messageSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  threadId: z.string(),
  author: messageAuthorSchema,
  text: z.string().default(''),
  blocks: z.array(contentBlockSchema).default([]),
  createdAt: z.string(),
  phase: z.string().optional(),
  meta: z.record(z.any()).optional(),
});

export type Message = z.infer<typeof messageSchema>;
export type MessageAuthor = z.infer<typeof messageAuthorSchema>;
