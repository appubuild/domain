/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#050810',
          900: '#070b16',
          850: '#0a1020',
          800: '#0d1628',
          750: '#111c33',
          700: '#16233d',
          600: '#1e3050',
        },
        holo: {
          50: '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#38bdf8',
          500: '#22d3ee',
          600: '#0891b2',
          700: '#0e7490',
        },
        accent: { DEFAULT: '#38bdf8', soft: '#7dd3fc', deep: '#1d4ed8' },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Code', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(56,189,248,0.18), 0 0 32px -8px rgba(56,189,248,0.35)',
        'glow-lg': '0 0 0 1px rgba(56,189,248,0.25), 0 0 60px -12px rgba(56,189,248,0.5)',
        panel: '0 1px 0 rgba(255,255,255,0.04) inset, 0 18px 40px -24px rgba(0,0,0,0.9)',
      },
      backgroundImage: {
        'holo-grid': 'linear-gradient(rgba(56,189,248,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.06) 1px, transparent 1px)',
        'aurora': 'radial-gradient(1200px 600px at 12% -10%, rgba(56,189,248,0.16), transparent 60%), radial-gradient(900px 500px at 100% 0%, rgba(129,140,248,0.12), transparent 55%)',
      },
      backgroundSize: { 'holo-grid': '44px 44px' },
      animation: {
        'pulse-slow': 'pulse 3.4s cubic-bezier(0.4,0,0.6,1) infinite',
        float: 'float 7s ease-in-out infinite',
        shimmer: 'shimmer 2.4s linear infinite',
        'spin-slow': 'spin 14s linear infinite',
      },
      keyframes: {
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-7px)' } },
        shimmer: { '0%': { backgroundPosition: '0% 0%' }, '100%': { backgroundPosition: '200% 0%' } },
      },
    },
  },
  plugins: [],
};
