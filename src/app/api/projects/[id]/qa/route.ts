import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runQaPlaywright } from '@/lib/workspace/qa';
import { readState } from '@/lib/workspace/fs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z
  .object({
    baseUrl: z.string().url().optional(),
    timeoutMs: z.number().int().min(10_000).max(30 * 60_000).optional(),
  })
  .partial();

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  try {
    await readState(id);
  } catch {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const summary = await runQaPlaywright({
    projectId: id,
    baseUrl: parsed.data.baseUrl,
    timeoutMs: parsed.data.timeoutMs,
  });

  return NextResponse.json({ ok: summary.ok, summary });
}
