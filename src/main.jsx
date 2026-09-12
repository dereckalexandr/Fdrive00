import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { installStorageShim } from "./storage-shim.js";
import "./index.css";

// Instala el reemplazo de window.storage antes de montar la app.
installStorageShim();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
