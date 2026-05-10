/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: { 0: '#0a0a0a', 1: '#141414', 2: '#1c1c1c', 3: '#262626' },
        ink: { 0: '#fafafa', 1: '#d4d4d4', 2: '#a3a3a3', 3: '#737373' },
        accent: { DEFAULT: '#7c9eff', dim: '#5b78cc' },
        ok: '#34d399',
        warn: '#fbbf24',
        bad: '#f87171'
      },
      fontFamily: {
        sans: ['-apple-system','BlinkMacSystemFont','SF Pro Text','Segoe UI','Roboto','sans-serif']
      }
    }
  },
  plugins: []
};
