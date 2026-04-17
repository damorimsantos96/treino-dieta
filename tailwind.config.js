/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Emerald — richer, more premium than flat green
        brand: {
          50:  "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
        },
        // Zinc-tinted dark — deeper and less blue than slate
        surface: {
          950: "#09090c",
          900: "#0f1014",
          800: "#1c1d23",
          700: "#2c2d36",
          600: "#4a4b58",
          500: "#72737f",
          400: "#a0a1aa",
        },
      },
    },
  },
  plugins: [],
};
