/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        'vet-navy': '#0F172A',
        'vet-turquoise': '#0D9488',
        'vet-amber': '#F59E0B',
        'vet-red': '#EF4444',
        navy: {
          50: '#f2f6fa', 100: '#e1eaf3', 200: '#c3d4e6', 300: '#94b2d0', 400: '#5f88b3',
          500: '#3e6895', 600: '#2f527a', 700: '#264263', 800: '#1b3049', 900: '#12233a', 950: '#0b1727',
        },
        teal: {
          50: '#effcfa', 100: '#c8f5ef', 200: '#93eadf', 300: '#57d7ca', 400: '#29bcb0',
          500: '#12a096', 600: '#0b807a', 700: '#0d6663', 800: '#0f5150', 900: '#114443',
        },
        surface: {
          DEFAULT: 'var(--vm-surface)',
          elevated: 'var(--vm-surface-elevated)',
        },
        accent: {
          DEFAULT: 'var(--vm-accent)',
          soft: 'var(--vm-accent-soft)',
          hover: 'var(--vm-accent-hover)',
        },
        danger: 'var(--vm-danger)',
        success: 'var(--vm-success)',
        warning: 'var(--vm-warning)',
        info: 'var(--vm-info)',
      },
      boxShadow: {
        soft: 'var(--vm-shadow)',
      },
      borderRadius: {
        vm: 'var(--vm-radius)',
      },
      keyframes: {
        'slide-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'pay-pop': {
          '0%': { transform: 'scale(0.4)', opacity: '0' },
          '55%': { transform: 'scale(1.12)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'pay-ring': {
          '0%': { transform: 'scale(0.7)', opacity: '0.55' },
          '100%': { transform: 'scale(1.55)', opacity: '0' },
        },
        'pay-check': {
          '0%': { strokeDashoffset: '72' },
          '100%': { strokeDashoffset: '0' },
        },
      },
      animation: {
        'slide-in': 'slide-in .25s ease-out',
        'fade-up': 'fade-up .3s ease-out both',
        'pay-pop': 'pay-pop .55s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pay-ring': 'pay-ring 1.1s ease-out .1s both',
        'pay-check': 'pay-check .5s ease-out .25s both',
      },
    },
  },
  plugins: [],
}
