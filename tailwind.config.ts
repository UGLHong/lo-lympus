import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        olympus: {
          bg: '#0b0d12',
          panel: '#12151d',
          border: '#1f2430',
          muted: '#2a3142',
          ink: '#e6ebf2',
          dim: '#8a93a6',
          accent: '#f5c451',
          blue: '#5aa9ff',
          green: '#5fd39a',
          red: '#ff6a7a',
          amber: '#f7b955',
        },
      },
      fontFamily: {
        sans: ['system-ui', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'soft': '0 1px 0 rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.3)',
      },
      keyframes: {
        'pulse-dot': {
          '0%,100%': { opacity: '0.6', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.2)' },
        },
        'shimmer-line': {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.4s ease-in-out infinite',
        'shimmer-line': 'shimmer-line 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
