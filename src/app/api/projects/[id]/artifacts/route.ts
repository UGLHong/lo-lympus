import { NextResponse } from 'next/server';
import { readArtifact, readArtifactTree } from '@/lib/workspace/fs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const url = new URL(request.url);
  const filePath = url.searchParams.get('path');

  if (filePath) {
    const normalized = filePath.replace(/^\/+/, '').replace(/\\+/g, '/');
    if (normalized.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
    const content = await readArtifact(id, normalized);
    if (content === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ path: normalized, content });
  }

  const tree = await readArtifactTree(id);
  return NextResponse.json({ tree });
}
