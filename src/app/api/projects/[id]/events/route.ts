import { NextResponse } from 'next/server';
import { readEvents } from '@/lib/workspace/fs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const events = await readEvents(id);
  return NextResponse.json({
    projectId: id,
    count: events.length,
    events,
  });
}
