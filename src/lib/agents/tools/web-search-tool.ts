import type { Tool } from '@/lib/llm/types';

export const webSearchTool: Tool = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Search the web for current information, best practices, documentation, and trends. Use this to ground your decisions in current industry standards and common practices.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'The search query. Be specific and include relevant context (e.g., "React 18 performance best practices 2026", "Docker Compose patterns for microservices", "authentication patterns Node.js 2026")',
        },
        limit: {
          type: 'integer',
          description: 'Number of results to return (1-5, default 3)',
          default: 3,
        },
      },
      required: ['query'],
    },
  },
};
