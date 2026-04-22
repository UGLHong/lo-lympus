import { taskEventHistory } from '../../server/db/queries';

import type { Route } from './+types/api.events.history';

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const taskId = url.searchParams.get('taskId');
  if (!taskId) return Response.json({ error: 'taskId required' }, { status: 400 });

  const rows = await taskEventHistory(taskId);
  const items = rows.map((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown> & {
      __id?: string;
      __ts?: number;
    };
    const createdAt =
      typeof payload.__ts === 'number' ? payload.__ts : row.createdAt.getTime();
    const id = typeof payload.__id === 'string' ? payload.__id : `evt-${row.id}`;
    const { __id: _id, __ts: _ts, ...rest } = payload;
    void _id;
    void _ts;
    return {
      id,
      projectId: row.projectId,
      role: row.role ?? undefined,
      taskId: row.taskId ?? undefined,
      type: row.type as string,
      payload: rest,
      createdAt,
    };
  });
  return Response.json({ events: items });
}
