// Formato de montos en pesos para los campos de ingreso (sin dependencias de pantalla: lo usan los campos y las pruebas).

/** Deja solo los dígitos. */
export const soloDigitos = (s) => String(s ?? "").replace(/\D/g, "");

/**
 * Lo que llega del programa (número, "9890000", "9890000.00") como dígitos enteros.
 * Un punto decimal solo puede venir de la base de datos (lo que escribe la persona nunca lo lleva: se le quitan los puntos de miles).
 */
export function aDigitos(v) {
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.max(0, Math.round(v))) : "";
  const t = String(v ?? "").trim();
  if (/^\d+\.\d+$/.test(t)) return String(Math.round(Number(t)));
  return soloDigitos(t);
}

/** "1250000" -> "1.250.000" (vacío si no hay dígitos). */
export const conMiles = (v) => {
  const limpio = aDigitos(v).replace(/^0+(?=\d)/, "");
  return limpio === "" ? "" : limpio.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};
