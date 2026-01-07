/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}', './index.html'],
  theme: {
    extend: {
      colors: {
        marstek: {
          dark: '#0f172a',
          card: '#1e293b',
          border: '#334155',
          accent: '#06b6d4',
          green: '#22c55e',
          yellow: '#eab308',
          red: '#ef4444',
        }
      }
    },
  },
  plugins: [],
}
