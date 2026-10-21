/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        navy: {
          50: '#f2f6fa', 100: '#e1eaf3', 200: '#c3d4e6', 300: '#94b2d0', 400: '#5f88b3',
          500: '#3e6895', 600: '#2f527a', 700: '#264263', 800: '#1b3049', 900: '#12233a', 950: '#0b1727',
        },
        teal: {
          50: '#effcfa', 100: '#c8f5ef', 200: '#93eadf', 300: '#57d7ca', 400: '#29bcb0',
          500: '#12a096', 600: '#0b807a', 700: '#0d6663', 800: '#0f5150', 900: '#114443',
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(16,35,58,0.04), 0 4px 16px rgba(16,35,58,0.06)',
      },
      keyframes: {
        'slide-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        'slide-in': 'slide-in .25s ease-out',
        'fade-up': 'fade-up .3s ease-out both',
      },
    },
  },
  plugins: [],
}
