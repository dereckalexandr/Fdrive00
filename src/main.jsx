import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
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

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
