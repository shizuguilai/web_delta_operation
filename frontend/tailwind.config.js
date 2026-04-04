/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Outfit",
          "Noto Sans SC",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        night: {
          950: "#05080c",
          900: "#0a1018",
          850: "#0f1724",
          800: "#141f2e",
          700: "#1c2a3d",
        },
        mint: {
          400: "#5eead4",
          500: "#2dd4bf",
          600: "#14b8a6",
        },
      },
      boxShadow: {
        glow: "0 0 40px -10px rgba(45, 212, 191, 0.35)",
      },
    },
  },
  plugins: [],
};
