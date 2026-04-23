/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./App.tsx",
    "./index.tsx",
    "./components/**/*.{ts,tsx}",
    "./pages/**/*.{ts,tsx}",
    "./contexts/**/*.{ts,tsx}",
    "./services/**/*.{ts,tsx}",
    "./config/**/*.{ts,tsx}"
  ],
  theme: { extend: {} },
  plugins: [],
};