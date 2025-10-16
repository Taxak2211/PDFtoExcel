/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./App.tsx",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#007aff',
        secondary: '#f2f2f7',
        accent: '#34c759',
      },
    },
  },
  plugins: [],
}
