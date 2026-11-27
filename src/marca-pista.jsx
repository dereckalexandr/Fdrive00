/**
 * MARCA PISTA
 * ----------------------------------------------------------------
 * Piezas de la identidad de Pista (el CRM como producto) que comparten la página de presentación y el CRM.
 * Los archivos viven en public/marca/ (SVG y PNG, generados desde la identidad aprobada el 25-nov-2026):
 *   - Logotipo: solo la palabra «pista» en Space Grotesk Bold, trazada (no depende de la fuente instalada).
 *   - Isotipo «A · Curva de pista»: la P dibujada como una pista con línea central; se usa aparte del logotipo.
 * Colores: Noche #0E1B2C · Naranja #FF6B1A · Marfil #FAF7F2. Eslogan: «De lead a llaves.»
 * ----------------------------------------------------------------
 */
import React from "react";

export const PISTA = { noche: "#0E1B2C", naranja: "#FF6B1A", marfil: "#FAF7F2", asfalto: "#2A3646", grafito: "#5B6573" };
export const ESLOGAN_PISTA = "De lead a llaves.";
export const FUENTE_TITULOS = "'Space Grotesk', Inter, system-ui, sans-serif";

/** Logotipo «pista». tono: "marfil" (sobre fondo oscuro), "noche" (sobre fondo claro) o "naranja".
 *  alto en px; con alto={null} el tamaño lo dan las clases (p. ej. responsivo «h-20 sm:h-32»). */
export function LogotipoPista({ tono = "noche", alto = 28, className = "" }) {
  return <img src={`/marca/pista-logotipo-${tono}.svg`} alt="Pista" style={alto ? { height: alto, width: "auto" } : undefined} className={className} />;
}

/** Isotipo «A · Curva de pista». Bajo 32 px usa la versión simplificada (sin línea central). */
export function IsotipoPista({ tam = 40, invertido = false, className = "", decorativo = true }) {
  const archivo = invertido ? "pista-isotipo-invertido" : tam < 32 ? "pista-isotipo-simple" : "pista-isotipo";
  return <img src={`/marca/${archivo}.svg`} alt={decorativo ? "" : "Pista"} aria-hidden={decorativo ? "true" : undefined} width={tam} height={tam} className={className} />;
}

/** Pone el favicon y el ícono de iPhone de Pista en la pestaña. */
export function ponerIconosPista() {
  const poner = (rel, href, extra = {}) => {
    let l = document.querySelector(`link[rel="${rel}"]`);
    if (!l) { l = document.createElement("link"); l.rel = rel; document.head.appendChild(l); }
    l.href = href;
    Object.entries(extra).forEach(([k, v]) => l.setAttribute(k, v));
  };
  poner("icon", "/marca/pista-isotipo-simple.svg", { type: "image/svg+xml" });
  poner("apple-touch-icon", "/marca/apple-touch-icon.png");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", PISTA.noche);
}
