/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // Diseño: grises fríos (azulados) en lugar de los grises cálidos de Tailwind; el ámbar queda como color de marca.
      colors: {
        stone: {
          50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0", 300: "#cbd5e1", 400: "#94a3b8",
          500: "#64748b", 600: "#475569", 700: "#334155", 800: "#1e293b", 900: "#0f172a", 950: "#020617",
        },
      },
      fontFamily: {
        sans: ['Inter', "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", "Helvetica", "Arial", "sans-serif"],
        // Los títulos usaban una tipografía con serifa; ahora comparten la tipografía de la interfaz.
        serif: ['Inter', "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
      boxShadow: {
        suave: "0 1px 2px rgb(15 23 42 / 0.05), 0 1px 3px rgb(15 23 42 / 0.06)",
        elevada: "0 8px 24px rgb(15 23 42 / 0.10)",
      },
    },
  },
  plugins: [],
};
