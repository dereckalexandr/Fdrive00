/** @type {import('tailwindcss').Config} */

// Los grises («stone») y el color de acento («amber») salen de variables CSS (ver src/index.css), para que el CRM
// tome la identidad de Pista (Noche y Naranja) con la clase «tema-pista» y el sitio de la automotora conserve sus colores.
const TONOS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const paleta = (nombre) => Object.fromEntries(TONOS.map((t) => [t, `rgb(var(--${nombre}-${t}) / <alpha-value>)`]));

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        stone: paleta("stone"),
        amber: paleta("amber"),
      },
      fontFamily: {
        sans: ['Inter', "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", "Helvetica", "Arial", "sans-serif"],
        // Títulos: Inter en el sitio de la automotora; Space Grotesk en el CRM con la identidad de Pista.
        serif: ["var(--fuente-titulos)", "Inter", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
      boxShadow: {
        suave: "0 1px 2px rgb(var(--stone-900) / 0.05), 0 1px 3px rgb(var(--stone-900) / 0.06)",
        elevada: "0 8px 24px rgb(var(--stone-900) / 0.10)",
      },
    },
  },
  plugins: [],
};
