import { NextResponse } from 'next/server';
import { readProjectSourceFile, readProjectSourceTree } from '@/lib/workspace/source-explorer';
import { readState } from '@/lib/workspace/fs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  try {
    await readState(id);
  } catch {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const url = new URL(request.url);
  const filePath = url.searchParams.get('path');

  if (filePath) {
    const normalized = filePath.replace(/^\/+/, '').replace(/\\+/g, '/');
    if (normalized.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
    const content = await readProjectSourceFile(id, normalized);
    if (content === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ path: normalized, content });
  }

  const tree = await readProjectSourceTree(id);
  return NextResponse.json({ tree });
}
