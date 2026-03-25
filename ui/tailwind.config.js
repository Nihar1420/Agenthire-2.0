/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0f172a', // slate-900
        surface: '#1e293b', // slate-800
        border: '#334155', // slate-700
        muted: '#94a3b8', // slate-400
        text: '#e2e8f0', // slate-200
        accent: '#818cf8', // indigo-400
        good: '#4ade80', // green-400
        warn: '#facc15', // yellow-400
        bad: '#f87171', // red-400
      },
    },
  },
  plugins: [],
};
