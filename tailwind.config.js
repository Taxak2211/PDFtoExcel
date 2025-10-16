/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./App.tsx",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    colors: {
      primary: '#007aff',
      secondary: '#f2f2f7',
      accent: '#34c759',
      white: '#ffffff',
      gray: {
        50: '#f9fafb',
        100: '#f3f4f6',
        200: '#e5e7eb',
        300: '#d1d5db',
        400: '#9ca3af',
        500: '#6b7280',
        600: '#4b5563',
        700: '#374151',
        800: '#1f2937',
        900: '#111827',
      },
      red: {
        100: '#fee2e2',
        300: '#fca5a5',
        800: '#991b1b',
      },
      blue: {
        600: '#2563eb',
      },
      green: {
        50: '#f0fdf4',
        300: '#86efac',
      },
    },
  },
  plugins: [],
}
