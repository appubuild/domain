/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f2f6fb',
          100: '#e2eaf4',
          200: '#c4d3e6',
          300: '#93aac8',
          400: '#5c7ba3',
          500: '#3a5c85',
          600: '#2a476b',
          700: '#1d3553',
          800: '#152a41',
          900: '#10243a',
          950: '#0a1726',
        },
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        amber: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        },
        success: {
          50: '#f0fdf4',
          100: '#dcfce7',
          300: '#86efac',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
        // Semantic tokens driven by CSS variables (light + dark themes)
        page: 'rgb(var(--c-page) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        elevated: 'rgb(var(--c-elevated) / <alpha-value>)',
        soft: 'rgb(var(--c-soft) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        display: [
          'Manrope',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 36, 58, 0.04), 0 8px 24px -12px rgba(16, 36, 58, 0.12)',
        'card-hover': '0 2px 4px rgba(16, 36, 58, 0.06), 0 24px 48px -20px rgba(16, 36, 58, 0.24)',
        float: '0 24px 60px -24px rgba(16, 36, 58, 0.35)',
        ring: '0 0 0 1px rgb(var(--c-line))',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      maxWidth: {
        container: '80rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translate3d(0, 18px, 0)' },
          '100%': { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-down': {
          '0%': { opacity: '0', transform: 'translate3d(0, -8px, 0)' },
          '100%': { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },
        'slide-in-right': {
          '0%': { transform: 'translate3d(100%, 0, 0)' },
          '100%': { transform: 'translate3d(0, 0, 0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.65s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 0.4s ease-out both',
        'scale-in': 'scale-in 0.25s cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-down': 'slide-down 0.2s ease-out both',
        'slide-in-right': 'slide-in-right 0.32s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
}
