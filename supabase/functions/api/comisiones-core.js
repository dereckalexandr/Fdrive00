// Motor de comisiones: tramos por módulo y cálculo de la producción mensual de un ejecutivo.
// JavaScript puro (sin APIs de Deno ni del navegador): lo usan el servidor, la pantalla y las pruebas.
//
// Reproduce EXACTAMENTE las fórmulas del perfil de Ejecutivo actual (src/App.jsx: computeTotals):
//   - compras, ventas, seguros, inspecciones: unidades del mes × monto del tramo en que cae esa cantidad.
//     El tramo se elige por el TOTAL de unidades del mes y su monto se aplica a TODAS ellas.
//   - créditos: suma de las comisiones de las financieras × porcentaje del tramo (según cuántos créditos hubo).
//   - consignaciones: suma de los márgenes netos (margen bruto × 25 %). Los tramos de consignaciones existen
//     en el perfil pero hoy NO se aplican al cálculo; se mantiene igual para que los números coincidan.
// Una prueba compara los tramos estándar de este archivo con los de App.jsx para que no se desfasen.

export const MODULOS_COMISION = [
  { key: "compras", label: "Compra de vehículos", tipo: "monto", unidad: "$ por unidad" },
  { key: "ventas", label: "Ventas", tipo: "monto", unidad: "$ por unidad" },
  { key: "seguros", label: "Seguros", tipo: "monto", unidad: "$ por unidad" },
  { key: "creditos", label: "Créditos", tipo: "porcentaje", unidad: "% sobre comisión" },
  { key: "consignaciones", label: "Consignaciones", tipo: "porcentaje", unidad: "% sobre margen" },
  { key: "inspecciones", label: "Inspecciones", tipo: "monto", unidad: "$ por unidad" },
];
export const MODULO_KEYS = MODULOS_COMISION.map((m) => m.key);
export const MARGEN_NETO_PCT = 0.25;
export const FINANCIERAS = ["Autofin", "BK", "Global", "Dily", "Otros"];

const T = (min, max, rate) => ({ min, max, rate });
/** Tramos estándar de la plataforma (los que se usan si el ejecutivo no tiene tramos propios). */
export const TRAMOS_ESTANDAR = {
  compras: [T(1, 5, 100000), T(6, null, 200000)],
  ventas: [T(1, 3, 75000), T(4, 10, 90000), T(11, null, 110000)],
  seguros: [T(1, 3, 35000), T(4, 10, 50000), T(11, null, 65000)],
  creditos: [T(1, 3, 0.15), T(4, 6, 0.25), T(7, null, 0.28)],
  consignaciones: [T(1, 3, 0.15), T(4, 8, 0.2), T(9, null, 0.25)],
  inspecciones: [T(1, 10, 35000)],
};

/** "1 a 3" / "11 o más". */
export const etiquetaTramo = (t) => (t.max === null || t.max === undefined || t.max === Infinity ? `${t.min} o más` : `${t.min} a ${t.max}`);
const tope = (t) => (t.max === null || t.max === undefined ? Infinity : t.max);

/**
 * Tramo que corresponde a `n` unidades. Con n ≤ 0 no hay tramo. Si n supera el último, rige el último
 * (igual que el perfil actual).
 */
export function getTramo(n, tramos) {
  if (!n || n <= 0 || !tramos || tramos.length === 0) return null;
  return tramos.find((t) => n >= t.min && n <= tope(t)) || tramos[tramos.length - 1];
}

/** Cuántas unidades más hacen falta para llegar al siguiente tramo (o null si ya está en el último). */
export function proximoTramo(n, tramos) {
  if (!tramos || tramos.length === 0) return null;
  const actual = getTramo(Math.max(n, 0), tramos);
  const orden = [...tramos].sort((a, b) => a.min - b.min);
  const siguiente = orden.find((t) => t.min > Math.max(n, 0) && (!actual || t.min > actual.min));
  return siguiente ? { faltan: siguiente.min - n, tramo: siguiente } : null;
}

/**
 * Valida los tramos de UN módulo que llegan del formulario.
 * Cada fila: { min, max (vacío = sin tope), rate }. `tipo` = "monto" ($ por unidad) o "porcentaje" (0 a 1).
 * Devuelve { ok, value } con las filas limpias y ordenadas, o { ok:false, error }.
 */
export function validarTramos(filas, tipo) {
  if (!Array.isArray(filas) || filas.length === 0 || filas.length > 12) return { ok: false, error: "tramos_invalidos" };
  const out = [];
  for (const f of filas) {
    const min = Number(f && f.min);
    const sinTope = f && (f.max === null || f.max === undefined || String(f.max).trim() === "");
    const max = sinTope ? null : Number(f.max);
    const rate = Number(f && f.rate);
    if (!Number.isInteger(min) || min < 1 || min > 100000) return { ok: false, error: "tramos_invalidos" };
    if (!sinTope && (!Number.isInteger(max) || max < min || max > 100000)) return { ok: false, error: "tramos_invalidos" };
    if (!Number.isFinite(rate) || rate < 0) return { ok: false, error: "tramos_invalidos" };
    if (tipo === "porcentaje" && rate > 1) return { ok: false, error: "tramos_invalidos" };
    if (tipo === "monto" && (rate > 100_000_000 || !Number.isInteger(rate))) return { ok: false, error: "tramos_invalidos" };
    out.push({ min, max, rate: tipo === "porcentaje" ? Math.round(rate * 10000) / 10000 : rate });
  }
  out.sort((a, b) => a.min - b.min);
  for (let i = 0; i < out.length; i++) {
    // Sin superposiciones; solo el último puede quedar sin tope.
    if (i < out.length - 1 && out[i].max === null) return { ok: false, error: "tramos_invalidos" };
    if (i > 0 && out[i].min <= out[i - 1].max) return { ok: false, error: "tramos_invalidos" };
  }
  return { ok: true, value: out };
}

/**
 * Valida la comisión personalizada de una persona: { tramos: { <módulo>: [filas] } }.
 * Un módulo sin filas (o ausente) usa los tramos estándar. Ignora módulos desconocidos.
 */
export function validarComision(input) {
  const tramos = {};
  const entrada = input && input.tramos && typeof input.tramos === "object" ? input.tramos : {};
  for (const m of MODULOS_COMISION) {
    const filas = entrada[m.key];
    if (filas === undefined || (Array.isArray(filas) && filas.length === 0)) continue;
    const v = validarTramos(filas, m.tipo);
    if (!v.ok) return { ok: false, error: "tramos_invalidos", modulo: m.key };
    tramos[m.key] = v.value;
  }
  return { ok: true, value: { tramos } };
}

/** Los tramos de un módulo para una persona: los suyos si los tiene (y son válidos), si no los estándar. */
export function tramosDe(comision, key) {
  const propios = comision && comision.tramos && comision.tramos[key];
  const modulo = MODULOS_COMISION.find((m) => m.key === key);
  if (Array.isArray(propios) && propios.length > 0 && modulo) {
    const v = validarTramos(propios, modulo.tipo);
    if (v.ok) return v.value;
  }
  return TRAMOS_ESTANDAR[key] || [];
}

/** Todos los tramos efectivos de una persona. */
export function tramosEfectivos(comision) {
  return Object.fromEntries(MODULO_KEYS.map((k) => [k, tramosDe(comision, k)]));
}

/** Cantidad de módulos con tramos propios (para mostrar "personalizado"). */
export const modulosPersonalizados = (comision) => MODULO_KEYS.filter((k) => comision && comision.tramos && Array.isArray(comision.tramos[k]) && comision.tramos[k].length > 0);

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

/**
 * Producción del mes de un ejecutivo.
 * @param datos  { ventasN, segurosN, comprasN, inspeccionesN, creditosN, creditosComision (suma $), consigRows: [{precioVenta, precioPiso, descuentos}] }
 * @param tramos tramos efectivos (ver tramosEfectivos)
 */
export function calcularProduccion(datos, tramos) {
  const d = datos || {};
  const unidades = (n, key) => {
    const cantidad = Math.max(0, Math.floor(num(n)));
    const tramo = getTramo(cantidad, tramos[key]);
    const rate = tramo ? tramo.rate : 0;
    return { n: cantidad, rate, tramo: tramo ? etiquetaTramo(tramo) : null, total: cantidad * rate, proximo: proximoTramo(cantidad, tramos[key]) };
  };
  const compras = unidades(d.comprasN, "compras");
  const ventas = unidades(d.ventasN, "ventas");
  const seguros = unidades(d.segurosN, "seguros");
  const inspecciones = unidades(d.inspeccionesN, "inspecciones");

  const creditosN = Math.max(0, Math.floor(num(d.creditosN)));
  const tramoCred = getTramo(creditosN, tramos.creditos);
  const sumaComisiones = num(d.creditosComision);
  const creditos = { n: creditosN, rate: tramoCred ? tramoCred.rate : 0, tramo: tramoCred ? etiquetaTramo(tramoCred) : null, base: sumaComisiones, total: sumaComisiones * (tramoCred ? tramoCred.rate : 0), proximo: proximoTramo(creditosN, tramos.creditos) };

  const margenesBrutos = (d.consigRows || []).map((r) => num(r.precioVenta) - num(r.precioPiso) - num(r.descuentos));
  const sumaMargenBruto = margenesBrutos.reduce((a, b) => a + b, 0);
  const sumaMargenNeto = margenesBrutos.map((m) => Math.round(m * MARGEN_NETO_PCT)).reduce((a, b) => a + b, 0);
  const consignaciones = { n: (d.consigRows || []).length, total: sumaMargenNeto, sumaMargenBruto, sumaMargenNeto };

  const total = compras.total + ventas.total + seguros.total + creditos.total + consignaciones.total + inspecciones.total;
  return { compras, ventas, seguros, creditos, consignaciones, inspecciones, total };
}

/* ---------- Conversión para el editor de la pantalla ---------- */
/** De lo guardado en la persona a filas editables { min, max, rate } (los porcentajes se escriben como 25, no 0,25). */
export function tramosAUi(comision) {
  const ui = {};
  for (const m of MODULOS_COMISION) {
    const filas = comision && comision.tramos && comision.tramos[m.key];
    if (Array.isArray(filas) && filas.length > 0) {
      ui[m.key] = filas.map((f) => ({ min: f.min, max: f.max === null || f.max === undefined ? "" : f.max, rate: m.tipo === "porcentaje" ? Math.round(f.rate * 10000) / 100 : f.rate }));
    }
  }
  return ui;
}

/** De las filas editables al formato que valida y guarda el servidor. */
export function uiAComision(ui) {
  const tramos = {};
  for (const m of MODULOS_COMISION) {
    const filas = ui && ui[m.key];
    if (!filas || filas.length === 0) continue;
    tramos[m.key] = filas.map((f) => ({ min: f.min === "" ? NaN : Number(f.min), max: f.max, rate: m.tipo === "porcentaje" ? Number(f.rate) / 100 : Number(f.rate) }));
  }
  return { tramos };
}

/** Texto de error de las filas editables ("" si están bien). */
export function errorDeTramos(ui) {
  const v = validarComision(uiAComision(ui));
  if (v.ok) return "";
  const m = MODULOS_COMISION.find((x) => x.key === v.modulo);
  return `Revisa los tramos de «${m ? m.label : "comisión"}»: no pueden superponerse, solo el último puede quedar sin tope, y el valor debe ser válido.`;
}
