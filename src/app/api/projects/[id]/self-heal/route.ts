import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runSelfHealLoop } from '@/lib/pipeline/selfHeal';
import { readState } from '@/lib/workspace/fs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z
  .object({
    maxSteps: z.number().int().min(1).max(16).optional(),
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

  const summary = await runSelfHealLoop({ projectId: id, maxSteps: parsed.data.maxSteps });
  return NextResponse.json({ ok: true, summary });
}
