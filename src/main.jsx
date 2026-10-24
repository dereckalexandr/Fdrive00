import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "./error-boundary.jsx";
import { installStorageShim } from "./storage-shim.js";
import { installSupabaseStorage, hasSupabaseConfig } from "./supabase-storage.js";
import "./index.css";

// Si hay variables de entorno de Supabase configuradas, usa Supabase
// (datos reales, compartidos entre todos los dispositivos). Si no,
// usa localStorage como respaldo para poder seguir probando localmente.
if (hasSupabaseConfig()) {
  installSupabaseStorage();
  console.info("[Drive Futuro] Almacenamiento: Supabase");
} else {
  installStorageShim();
  console.warn(
    "[Drive Futuro] No se encontraron variables de Supabase (VITE_SUPABASE_*). " +
    "Usando localStorage como respaldo: los datos NO se compartirán entre dispositivos. " +
    "Revisa el README para configurar Supabase."
  );
}

// Dos aplicaciones en un mismo sitio, cada una se descarga solo cuando hace falta:
//   - «/plataforma»: el CRM del personal.
//   - cualquier otra dirección: el sitio web público con el catálogo de vehículos.
const App = lazy(() => import("./App.jsx"));
const SitioPublico = lazy(() => import("./sitio-publico.jsx"));

function esPlataforma() {
  const ruta = window.location.pathname.replace(/\/+$/, "");
  return ruta === "/plataforma" || ruta.startsWith("/plataforma/");
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<p style={{ padding: 24, fontFamily: "system-ui", color: "#57534e" }}>Cargando…</p>}>
        {esPlataforma() ? <App /> : <SitioPublico />}
      </Suspense>
    </ErrorBoundary>
  </React.StrictMode>
);
