/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bebas Neue"', 'Impact', 'sans-serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', 'monospace'],
      },
      colors: {
        deck: {
          a: '#2dd4bf',
          b: '#fb7185',
        },
        rbox: {
          bg: '#0a0b0e',
          panel: '#14151a',
          panel2: '#1b1d24',
          panel3: '#22252e',
          line: '#2a2d38',
          text: '#e5e7eb',
          dim: '#6b7280',
          amber: '#fbbf24',
          green: '#22c55e',
          red: '#ef4444',
        },
      },
      boxShadow: {
        'glow-a': '0 0 18px rgba(45, 212, 191, 0.45)',
        'glow-b': '0 0 18px rgba(251, 113, 133, 0.45)',
        'inset-deep': 'inset 0 2px 8px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
};
