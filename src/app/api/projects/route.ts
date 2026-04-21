import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createProject, listProjects } from '@/lib/workspace/fs';
import { driveProject } from '@/lib/pipeline/driver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  requirement: z.string().min(1).max(10_000),
});

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
  }

  const state = await createProject(parsed.data);

  driveProject({ projectId: state.projectId, humanMessage: parsed.data.requirement }).catch((err) => {
    console.error('[driveProject:onCreate]', err);
  });

  return NextResponse.json({ projectId: state.projectId });
}
