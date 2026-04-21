import { notFound } from 'next/navigation';
import { readMessages, readState } from '@/lib/workspace/fs';
import { ProjectShell } from '@/components/layout/project-shell';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export default async function ProjectPage({ params }: Props) {
  const { id } = await params;

  try {
    const [state, messages] = await Promise.all([readState(id), readMessages(id)]);
    return <ProjectShell initialState={state} initialMessages={messages} />;
  } catch {
    notFound();
  }
}
