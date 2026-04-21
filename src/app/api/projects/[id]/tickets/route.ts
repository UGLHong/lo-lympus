import { NextResponse } from 'next/server';
import { readTicketsIndex } from '@/lib/workspace/tickets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const index = await readTicketsIndex(id);
  if (!index) {
    return NextResponse.json({ tickets: [] });
  }
  return NextResponse.json({ tickets: index.tickets, updatedAt: index.updatedAt });
}
