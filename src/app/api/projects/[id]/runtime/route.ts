import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getRuntimeStatus,
  startRuntime,
  stopRuntime,
} from '@/lib/workspace/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const postBodySchema = z
  .object({
    action: z.enum(['start', 'stop']),
    script: z.enum(['dev', 'start', 'build', 'test']).optional(),
    packageManager: z.enum(['pnpm', 'npm', 'yarn']).optional(),
  })
  .strict();

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  return NextResponse.json(getRuntimeStatus(id));
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = postBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  if (parsed.data.action === 'start') {
    const result = await startRuntime({
      projectId: id,
      script: parsed.data.script,
      packageManager: parsed.data.packageManager,
    });
    return NextResponse.json(result, { status: result.started ? 200 : 409 });
  }

  const result = await stopRuntime(id);
  return NextResponse.json(result, { status: result.stopped ? 200 : 409 });
}
