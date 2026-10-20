/** Iconos de línea (24x24) para las tarjetas y menús. Sin dependencias: cada uno es un trazo SVG. */
import React from "react";

const TRAZOS = {
  ventas: "M3 8h18v11H3z M8 8V5.5A1.5 1.5 0 019.5 4h5A1.5 1.5 0 0116 5.5V8 M3 13h18",
  tasaciones: "M20.5 12.5l-8 8-9-9V4h7.5l9.5 8.5z M7.5 8h.01",
  validacion: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z M8.5 12l2.5 2.5 4.5-5",
  anuncios: "M3 11v3l12 5V6L3 11z M15 9.5a3 3 0 010 5 M7 15.5V19",
  marketing: "M4 20V11 M10 20V4 M16 20v-7 M21 20H3",
  inspector: "M9 4h6v3H9z M7 5.5H5.5V21h13V5.5H17 M9 14l2 2 4-4.5",
  compra: "M3 17v-4l2-6h14l2 6v4 M3 17h18 M7 17v2 M17 17v2 M5.5 13h13",
  usuarios: "M16 19v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 17.5V19 M10 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7 M20 19v-1.5a3.5 3.5 0 00-2.5-3.3 M16 4.3a3.5 3.5 0 010 6.4",
  salir: "M10 4H5v16h5 M15 8l4 4-4 4 M19 12H9",
  flecha: "M5 12h14 M13 6l6 6-6 6",
};

export function Icono({ nombre, className = "w-5 h-5" }) {
  const d = TRAZOS[nombre] || TRAZOS.ventas;
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(" M").map((t, i) => <path key={i} d={(i === 0 ? "" : "M") + t} />)}
    </svg>
  );
}

/** Círculo con las iniciales de una persona. */
export function Iniciales({ nombre = "", className = "w-10 h-10 text-sm" }) {
  const t = String(nombre).trim().split(/\s+/).slice(0, 2).map((x) => x[0] || "").join("").toUpperCase() || "?";
  return <span className={`inline-flex items-center justify-center rounded-full bg-amber-500 text-stone-900 font-semibold shrink-0 ${className}`}>{t}</span>;
}
