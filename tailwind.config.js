/*
 * The `accent` scale is the color picked in Settings > Preferences. Each shade reads an "r g b"
 * triplet that applyUiThemeColor() in src/components/theme/systemTheme.js rewrites, so a class like
 * `bg-accent-600` or `ring-accent-500/15` follows the selection with its opacity modifier intact.
 */
const accentShade = (shade) => `rgb(var(--accent-${shade}-rgb) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./public/index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: Object.fromEntries(
          [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((shade) => [shade, accentShade(shade)])
        ),
        gov: {
          navy: '#1E3A8A',
          gold: '#F59E0B',
          gray: '#F3F4F6',
          border: '#D1D5DB',
          text: {
            primary: '#1F2937',
            secondary: '#6B7280',
          },
        },
      },
      fontFamily: {
        serif: ['Georgia', 'Times New Roman', 'serif'],
      },
    },
  },
  plugins: [],
}
