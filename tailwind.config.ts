import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0b0d10',
          raised: '#12151a',
          sunken: '#070809',
        },
        border: {
          DEFAULT: '#1f242c',
          strong: '#2a313b',
        },
        text: {
          DEFAULT: '#e5e7eb',
          muted: '#9ca3af',
          faint: '#6b7280',
        },
        accent: {
          DEFAULT: '#f59e0b',
          soft: '#fbbf2433',
        },
        role: {
          backend: '#3b82f6',
          frontend: '#22d3ee',
          qa: '#a855f7',
          devops: '#10b981',
          architect: '#f472b6',
          pm: '#f59e0b',
          reviewer: '#8b5cf6',
          security: '#dc2626',
          release: '#14b8a6',
          writer: '#64748b',
          cto: '#f97316',
          techlead: '#6366f1',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
