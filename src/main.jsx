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
//   - un sitio aparte, solo para consultar inspecciones por patente (sin inventario ni contacto): se abre desde una dirección cuyo
//     nombre empieza con «inspecciones», la ruta «/inspecciones» o un proyecto construido con VITE_SITIO=inspecciones.
const App = lazy(() => import("./App.jsx"));
const SitioPublico = lazy(() => import("./sitio-publico.jsx"));
const SitioInspecciones = lazy(() => import("./sitio-inspecciones.jsx"));

function esSitioInspecciones() {
  const ruta = window.location.pathname.replace(/\/+$/, "");
  return import.meta.env.VITE_SITIO === "inspecciones" || /^inspecciones/i.test(window.location.hostname) || ruta === "/inspecciones" || ruta.startsWith("/inspecciones/");
}

const SitioPista = lazy(() => import("./sitio-pista.jsx"));

// Pista (el CRM como producto): pistacrm.com y www.pistacrm.com muestran la página de presentación; app.pistacrm.com abre el CRM
// en cualquier ruta. «/pista» muestra la presentación en cualquier dirección, para revisarla en local.
const host = window.location.hostname.toLowerCase();
const esAppPista = () => host === "app.pistacrm.com";
function esSitioPista() {
  const ruta = window.location.pathname.replace(/\/+$/, "");
  return host === "pistacrm.com" || host === "www.pistacrm.com" || ruta === "/pista";
}

function esPlataforma() {
  const ruta = window.location.pathname.replace(/\/+$/, "");
  return esAppPista() || ruta === "/plataforma" || ruta.startsWith("/plataforma/");
}

// El CRM y la presentación de Pista llevan el favicon de Pista; el sitio de la automotora queda como está.
if (esSitioPista() || (!esSitioInspecciones() && esPlataforma())) {
  document.documentElement.classList.add("tema-pista");
  import("./marca-pista.jsx").then((m) => { m.ponerIconosPista(); if (esPlataforma() && !esSitioPista()) document.title = "Pista · Plataforma"; });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<p style={{ padding: 24, fontFamily: "system-ui", color: "#57534e" }}>Cargando…</p>}>
        {esSitioPista() ? <SitioPista /> : esSitioInspecciones() ? <SitioInspecciones /> : esPlataforma() ? <App /> : <SitioPublico />}
      </Suspense>
    </ErrorBoundary>
  </React.StrictMode>
);
