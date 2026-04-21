import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ROLE_KEYS } from '@/lib/const/roles';
import { emit } from '@/lib/events/bus';
import { appendEvent, readState } from '@/lib/workspace/fs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  role: z.enum(ROLE_KEYS),
  text: z.string().min(1).max(4_000),
});

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  try {
    await readState(id);
  } catch {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const event = emit({
    projectId: id,
    kind: 'barge.in',
    role: parsed.data.role,
    text: parsed.data.text,
  });
  await appendEvent(event);

  return NextResponse.json({ ok: true });
}
