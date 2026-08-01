/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./public/index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
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
