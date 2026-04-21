import { NextResponse } from 'next/server';
import { removeProject } from '@/lib/workspace/remove-project';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  const result = await removeProject(id);
  if (!result.ok) {
    const status = result.error === 'Project not found' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
