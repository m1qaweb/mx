/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,js,ts,jsx,tsx,md,astro}",
  ],
  theme: {
    extend: {
      spacing: {
        // Standard 4pt grid system (already default in Tailwind, explicitly reinforced here)
        // 1 = 0.25rem = 4px
        // 4 = 1rem = 16px
      },
      colors: {
        // Basic palette to replace potential hardcoded hex colors
        primary: '#3B82F6', // blue-500
        secondary: '#10B981', // green-500
        danger: '#EF4444', // red-500
        warning: '#F59E0B', // amber-500
        dark: '#1F2937', // gray-800
        light: '#F3F4F6', // gray-100
      }
    },
  },
  plugins: [],
}
