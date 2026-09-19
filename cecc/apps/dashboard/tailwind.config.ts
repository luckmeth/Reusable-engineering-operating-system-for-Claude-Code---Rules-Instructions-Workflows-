import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // A control-centre palette: near-black surfaces so severity colour is
        // the only thing that competes for attention.
        surface: { DEFAULT: '#0b0d10', raised: '#13161b', border: '#232830', hover: '#1a1e25' },
        ink: { DEFAULT: '#e8eaed', muted: '#9aa3af', faint: '#6b7280' },
        sev: {
          critical: '#f4436c',
          high: '#ff8a3d',
          medium: '#f5c451',
          low: '#5aa9e6',
          info: '#8b93a1',
        },
        ok: '#3ecf8e',
        agent: '#c07cf0',
        cecc: '#4dd0e1',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
