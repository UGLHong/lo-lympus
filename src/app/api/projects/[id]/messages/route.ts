import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readMessages, readState } from '@/lib/workspace/fs';
import { driveProject } from '@/lib/pipeline/driver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  text: z.string().min(1).max(10_000),
});

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  try {
    const [messages, state] = await Promise.all([readMessages(id), readState(id)]);
    return NextResponse.json({ messages, state });
  } catch (err) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  driveProject({ projectId: id, humanMessage: parsed.data.text }).catch((err) => {
    console.error('[driveProject:onMessage]', err);
  });

  return NextResponse.json({ ok: true });
}
