import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('routes/_index.tsx'),
  route('projects', 'routes/projects._index.tsx'),
  route('projects/new', 'routes/projects.new.tsx'),
  route('projects/:id', 'routes/projects.$id.tsx'),

  route('settings', 'routes/settings.tsx'),

  route('api/events', 'routes/api.events.ts'),
  route('api/events/history', 'routes/api.events.history.ts'),
  route('api/chat', 'routes/api.chat.ts'),
  route('api/tasks', 'routes/api.tasks.ts'),
  route('api/tasks/:taskId/action', 'routes/api.task-action.ts'),
  route('api/tasks/:taskId/activity', 'routes/api.task-activity.ts'),
  route('api/projects', 'routes/api.projects.ts'),
  route('api/projects/:id/action', 'routes/api.project-action.ts'),
  route('api/agents', 'routes/api.agents.ts'),
  route('api/settings', 'routes/api.settings.ts'),
  route('api/workspace/*', 'routes/api.workspace.ts'),
] satisfies RouteConfig;
