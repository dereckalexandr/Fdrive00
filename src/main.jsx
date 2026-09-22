import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { installStorageShim } from "./storage-shim.js";
import { installFirebaseStorage, hasFirebaseConfig } from "./firebase-storage.js";
import "./index.css";

// Si hay variables de entorno de Firebase configuradas, usa Firestore
// (datos reales, compartidos entre todos los dispositivos). Si no,
// usa localStorage como respaldo para poder seguir probando localmente.
if (hasFirebaseConfig()) {
  installFirebaseStorage();
  console.info("[Drive Futuro] Almacenamiento: Firebase Firestore");
} else {
  installStorageShim();
  console.warn(
    "[Drive Futuro] No se encontraron variables de Firebase (VITE_FIREBASE_*). " +
    "Usando localStorage como respaldo: los datos NO se compartirán entre dispositivos. " +
    "Revisa el README para configurar Firebase."
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
