import { NextResponse } from 'next/server';
import { z } from 'zod';
import { focusFileInZed } from '@/lib/workspace/zed';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
});

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const result = await focusFileInZed(id, parsed.data.path, parsed.data.line ?? 1);
  return NextResponse.json(result);
}
