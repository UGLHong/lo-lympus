import { z } from 'zod';
import type { RoleKey } from '@/lib/const/roles';
import { contentBlockSchema, type ContentBlock } from '@/lib/schemas/content-blocks';
import { isSourcePathAllowed } from '@/lib/workspace/sources';
import { stripJsonPayload, tolerantJsonParse } from '@/lib/utils/tolerant-json';

// coerces a null/undefined value to undefined so downstream .default() kicks in.
const nullToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === null ? undefined : value), schema);

const sourceWriteSchema = z.object({
  path: z.string(),
  content: z.string(),
});

const writeSchema = z.object({
  path: z.string(),
  content: z.string(),
});

const reviewFindingSchema = z.object({
  severity: z.enum(['low', 'med', 'high']),
  file: z.string(),
  line: nullToUndefined(z.number().int().optional()),
  note: z.string(),
});

export const reviewSchema = z.object({
  decision: z.enum(['approve', 'request-changes', 'block']),
  findings: nullToUndefined(z.array(reviewFindingSchema).default([])),
  rerun: nullToUndefined(z.boolean().default(false)),
  evidence: nullToUndefined(z.array(z.string()).default([])),
});

export const agentEnvelopeSchema = z.object({
  text: nullToUndefined(z.string().default('')),
  blocks: nullToUndefined(z.array(z.unknown()).default([])),
  writes: nullToUndefined(z.array(writeSchema).default([])),
  sourceWrites: nullToUndefined(z.array(sourceWriteSchema).default([])),
  review: reviewSchema.nullish(),
  ticketCode: z.string().nullish(),
  advance: nullToUndefined(z.boolean().default(false)),
});

type RawEnvelope = z.infer<typeof agentEnvelopeSchema>;

export type ReviewPayload = z.infer<typeof reviewSchema>;
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type SourceWrite = z.infer<typeof sourceWriteSchema>;

export type AgentEnvelope = Omit<RawEnvelope, 'blocks'> & {
  blocks: ContentBlock[];
  droppedBlockCount: number;
  parseError?: string;
};

function validateBlocks(blocks: unknown[]): { blocks: ContentBlock[]; dropped: number } {
  const valid: ContentBlock[] = [];
  let dropped = 0;
  for (const candidate of blocks) {
    const result = contentBlockSchema.safeParse(candidate);
    if (result.success) {
      valid.push(result.data);
    } else {
      dropped += 1;
    }
  }
  return { blocks: valid, dropped };
}

export const extractJsonPayload = stripJsonPayload;

function errorEnvelope(reason: string): AgentEnvelope {
  return {
    text: '',
    blocks: [],
    writes: [],
    sourceWrites: [],
    review: undefined,
    ticketCode: undefined,
    advance: false,
    droppedBlockCount: 0,
    parseError: reason,
  };
}

export function parseEnvelope(raw: string): AgentEnvelope {
  const trimmed = raw.trim();
  if (!trimmed) {
    return errorEnvelope('empty response');
  }

  const parsed = tolerantJsonParse(trimmed);
  if (!parsed.ok) {
    return errorEnvelope('response was not valid JSON');
  }

  const schemaResult = agentEnvelopeSchema.safeParse(parsed.value);
  if (schemaResult.success) {
    const envelope = schemaResult.data;
    const { blocks, dropped } = validateBlocks(envelope.blocks);
    return {
      text: envelope.text,
      writes: envelope.writes,
      sourceWrites: envelope.sourceWrites,
      review: envelope.review ?? undefined,
      ticketCode: envelope.ticketCode ?? undefined,
      advance: envelope.advance,
      blocks,
      droppedBlockCount: dropped,
    };
  }

  // salvage what we can so blocks, writes and text aren't silently discarded
  // when a single optional field fails validation.
  const salvaged = salvageEnvelope(parsed.value);
  const { blocks, dropped } = validateBlocks(salvaged.blocks);
  return {
    text: salvaged.text,
    writes: salvaged.writes,
    sourceWrites: salvaged.sourceWrites,
    review: undefined,
    ticketCode: salvaged.ticketCode,
    advance: salvaged.advance,
    blocks,
    droppedBlockCount: dropped,
    parseError: formatSchemaError(schemaResult.error),
  };
}

type SalvagedEnvelope = {
  text: string;
  blocks: unknown[];
  writes: { path: string; content: string }[];
  sourceWrites: { path: string; content: string }[];
  ticketCode: string | undefined;
  advance: boolean;
};

function salvageEnvelope(raw: unknown): SalvagedEnvelope {
  const record = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) ?? {};
  return {
    text: typeof record.text === 'string' ? record.text : '',
    blocks: Array.isArray(record.blocks) ? record.blocks : [],
    writes: salvageWrites(record.writes),
    sourceWrites: salvageWrites(record.sourceWrites),
    ticketCode: typeof record.ticketCode === 'string' ? record.ticketCode : undefined,
    advance: record.advance === true,
  };
}

function salvageWrites(value: unknown): { path: string; content: string }[] {
  if (!Array.isArray(value)) return [];
  const out: { path: string; content: string }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.path !== 'string' || typeof record.content !== 'string') continue;
    out.push({ path: record.path, content: record.content });
  }
  return out;
}

function formatSchemaError(error: z.ZodError): string {
  const first = error.errors[0];
  if (!first) return 'response did not match the expected envelope shape';
  const pathLabel = first.path.length > 0 ? first.path.join('.') : '(root)';
  return `envelope field "${pathLabel}" ${first.message.toLowerCase()}`;
}

export function safePath(relative: string): string | null {
  const cleaned = relative.replace(/^\/+/, '').replace(/\\+/g, '/');
  if (!cleaned) return null;
  if (cleaned.includes('..')) return null;
  return cleaned;
}

export type DevEnvelopeIssue =
  | { code: 'no-source-writes'; message: string }
  | { code: 'path-denied'; path: string; message: string }
  | { code: 'empty-content'; path: string; message: string };

// dev-role envelope must carry at least one source write under an
// allow-listed path; flags everything wrong so the caller can decide
// whether to retry or escalate.
export function validateDevEnvelope(
  envelope: AgentEnvelope,
  role: RoleKey,
): DevEnvelopeIssue[] {
  const issues: DevEnvelopeIssue[] = [];

  if (envelope.sourceWrites.length === 0) {
    issues.push({
      code: 'no-source-writes',
      message: 'Dev envelope must include at least one entry in `sourceWrites[]`.',
    });
    return issues;
  }

  for (const write of envelope.sourceWrites) {
    const cleaned = safePath(write.path);
    if (!cleaned || !isSourcePathAllowed(role, cleaned)) {
      issues.push({
        code: 'path-denied',
        path: write.path,
        message: `Role ${role} is not allowed to write to "${write.path}".`,
      });
      continue;
    }
    if (write.content.trim().length === 0) {
      issues.push({
        code: 'empty-content',
        path: write.path,
        message: `Source write "${write.path}" has empty content.`,
      });
    }
  }

  return issues;
}

export type ReviewerEnvelopeIssue =
  | { code: 'missing-review'; message: string }
  | { code: 'empty-evidence'; message: string }
  | { code: 'missing-findings'; message: string };

// reviewer envelope must carry a structured `review` object; empty
// evidence arrays are rejected to prevent rubber-stamp approvals.
export function validateReviewerEnvelope(envelope: AgentEnvelope): ReviewerEnvelopeIssue[] {
  const issues: ReviewerEnvelopeIssue[] = [];

  if (!envelope.review) {
    issues.push({
      code: 'missing-review',
      message: 'Reviewer envelope must include a top-level `review` object.',
    });
    return issues;
  }

  if (envelope.review.evidence.length === 0) {
    issues.push({
      code: 'empty-evidence',
      message:
        'Reviewer `review.evidence[]` is empty — list the files read or commands run before deciding.',
    });
  }

  if (envelope.review.decision === 'request-changes' && envelope.review.findings.length === 0) {
    issues.push({
      code: 'missing-findings',
      message:
        'Reviewer asked for changes but listed no findings — every `request-changes` must cite at least one finding.',
    });
  }

  return issues;
}
