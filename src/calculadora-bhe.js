/**
 * CALCULADORA DE BOLETAS DE HONORARIOS (BHE, Chile)
 * ----------------------------------------------------------------
 * Pasa del monto acordado al total de la boleta, la retención del SII y lo que se recibe. La retención es la vigente en la fecha de
 * emisión de la boleta (Ley 21.133: sube de a poco hasta el 17% en 2028). Funciones puras, sin red ni pantalla.
 * ----------------------------------------------------------------
 */

/** Retención por año de emisión, en centésimas de punto (1525 = 15,25%). Hasta 2019: 10%; desde 2028: 17%. */
export const RETENCION_POR_ANIO = { 2019: 1000, 2020: 1075, 2021: 1150, 2022: 1225, 2023: 1300, 2024: 1375, 2025: 1450, 2026: 1525, 2027: 1600, 2028: 1700 };
export const ANIO_MIN = 2019;
export const ANIO_MAX = 2028;

/** Retención (%) de las boletas emitidas ese año. */
export function tasaRetencion(anio) {
  const a = Math.min(ANIO_MAX, Math.max(ANIO_MIN, Math.trunc(Number(anio)) || ANIO_MIN));
  return RETENCION_POR_ANIO[a] / 100;
}

/** Año por defecto de la lista: el actual, dentro de lo que cubre la ley. */
export const anioPorDefecto = (hoy = new Date()) => Math.min(ANIO_MAX, Math.max(2020, hoy.getFullYear()));

/**
 * @param {{ monto: number|string, moneda?: "clp"|"uf", anio?: number, uf?: number }} entrada
 * @returns {{ ok: true, montoPesos: number, tasa: number,
 *   comoLiquido: { liquido: number, bruto: number, retencion: number },
 *   comoBruto: { liquido: number, bruto: number, retencion: number } } | { ok: false, error: "monto_invalido" | "uf_invalida" }}
 */
export function calcularBoleta({ monto, moneda = "clp", anio = anioPorDefecto(), uf = 0 }) {
  const m = Number(monto);
  if (!Number.isFinite(m) || m <= 0 || m > 1e12) return { ok: false, error: "monto_invalido" };
  let montoPesos = m;
  if (moneda === "uf") {
    const valorUf = Number(uf);
    if (!Number.isFinite(valorUf) || valorUf <= 0) return { ok: false, error: "uf_invalida" };
    montoPesos = m * valorUf;
  }
  montoPesos = Math.round(montoPesos);
  if (montoPesos <= 0) return { ok: false, error: "monto_invalido" };
  const centesimas = Math.round(tasaRetencion(anio) * 100);
  // El monto es el total de la boleta: se retiene el porcentaje y el resto es lo que se recibe.
  const retBruto = Math.round((montoPesos * centesimas) / 10000);
  // El monto es lo que se quiere recibir: la boleta se emite por un total mayor, de modo que descontada la retención quede ese monto.
  const brutoDeLiquido = Math.round((montoPesos * 10000) / (10000 - centesimas));
  return {
    ok: true, montoPesos, tasa: centesimas / 100,
    comoLiquido: { liquido: montoPesos, bruto: brutoDeLiquido, retencion: brutoDeLiquido - montoPesos },
    comoBruto: { liquido: montoPesos - retBruto, bruto: montoPesos, retencion: retBruto },
  };
}
