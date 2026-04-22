import { emit } from '../../app/lib/event-bus.server';

export type ToolKind = 'fs' | 'runtime' | 'browser' | 'db' | 'code' | 'agent' | 'review';

interface ToolLogCtx {
  projectId: string;
  role: string;
  taskId?: string;
}

interface ToolLogBody {
  kind: ToolKind;
  action: string;
  path?: string;
  url?: string;
  summary?: string;
  ok?: boolean;
  ms?: number;
  details?: Record<string, unknown>;
}

export function emitToolLog(ctx: ToolLogCtx, body: ToolLogBody): void {
  emit({
    projectId: ctx.projectId,
    role: ctx.role,
    taskId: ctx.taskId,
    type: 'log',
    payload: {
      channel: 'tool',
      ...body,
    },
  });
}
