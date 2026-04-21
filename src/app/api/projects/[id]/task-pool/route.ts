import { NextResponse } from 'next/server';
import { listAllTasksForSnapshot } from '@/lib/task-pool/store';
import { snapshotSoftwareHouse } from '@/lib/pipeline/software-house';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const tasks = listAllTasksForSnapshot(id);
  const house = snapshotSoftwareHouse(id);

  return NextResponse.json({
    projectId: id,
    tasks,
    workers: house.workers,
    running: house.running,
    awaitingHumanForPhase: house.awaitingHumanForPhase,
  });
}
