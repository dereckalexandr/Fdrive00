// Sueldo mínimo (ingreso mínimo mensual, de 18 a 65 años) para la calculadora de sueldo del sitio público.
// No existe una API oficial que lo entregue, así que el servidor lo lee de dos páginas de referencia y se queda con el valor más alto
// que parezca razonable (el sueldo mínimo solo sube, así que el más alto es el más reciente). Si nada responde, se usa el de respaldo.

/** Vigente desde el 1 de mayo de 2026 (Ley 21.830). Se usa si las páginas no responden o no se entienden. */
export const SUELDO_MINIMO_RESPALDO = 553553;
const MINIMO_RAZONABLE = 400_000;

/** Páginas donde se busca. */
export const FUENTES_SUELDO_MINIMO = ["https://www.calcular.cl/sueldo-minimo-chile.html", "https://finclaro.cl/sueldo-minimo"];

/**
 * Busca el sueldo mínimo en el texto de una página: el monto en pesos que sigue a «sueldo/ingreso/salario mínimo» y que más se repite.
 * @returns {number | null}
 */
export function extraerSueldoMinimo(html, respaldo = SUELDO_MINIMO_RESPALDO) {
  const texto = String(html || "").replace(/&nbsp;|&#160;/g, " ").replace(/<[^>]+>/g, " ");
  const cuentas = new Map();
  const re = /(?:sueldo|ingreso|salario)\s+m[ií]nimo[^$]{0,140}\$\s?(\d{3}(?:\.\d{3})+)/gi;
  let m;
  while ((m = re.exec(texto))) {
    const valor = Number(m[1].replace(/\./g, ""));
    if (valor >= MINIMO_RAZONABLE && valor <= respaldo * 1.25) cuentas.set(valor, (cuentas.get(valor) || 0) + 1);
  }
  let mejor = null;
  for (const [valor, n] of cuentas) if (mejor === null || n > mejor[1]) mejor = [valor, n];
  return mejor ? mejor[0] : null;
}

/** De los valores leídos de las distintas páginas, el más alto; si no hay ninguno, el de respaldo (nunca baja del respaldo). */
export function elegirSueldoMinimo(valores, respaldo = SUELDO_MINIMO_RESPALDO) {
  const buenos = (valores || []).filter((v) => Number.isFinite(v) && v >= MINIMO_RAZONABLE);
  return buenos.length ? Math.max(respaldo, ...buenos) : respaldo;
}
