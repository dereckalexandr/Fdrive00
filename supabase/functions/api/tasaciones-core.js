// Núcleo de las tasaciones del CRM: solicitudes de los ejecutivos y tasaciones directas del Tasador.
// JavaScript puro (sin APIs de Deno ni del navegador): lo usan el servidor, la pantalla y las pruebas.
import { normalizarPatente, patenteValida, soloDigitos, TRANSMISIONES, COMBUSTIBLES, mesChile, horasDesde } from "./ventas-core.js";

/* ---------- Catálogos ---------- */
export const ESTADOS_TASACION = [
  { id: "pendiente", nombre: "Por tomar" },
  { id: "en_proceso", nombre: "En proceso" },
  { id: "completada", nombre: "Completada" },
  { id: "cancelada", nombre: "Cancelada" },
];
export const tasacionNombre = (id) => (ESTADOS_TASACION.find((e) => e.id === id) || {}).nombre || id;
export const TIPOS_TASACION = [
  { id: "parte_pago", nombre: "Parte de pago" },
  { id: "directa", nombre: "Directa" },
];
export const folioTasacion = (n) => `TAS-${String(n || 0).padStart(6, "0")}`;

const texto = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const entero = (v, min, max) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};

/* ---------- Datos del vehículo ---------- */
export function validarVehiculoTasacion(input) {
  const i = input || {};
  const patente = normalizarPatente(i.patente);
  if (!patenteValida(patente)) return { ok: false, error: "patente_invalida" };
  const marca = texto(i.marca, 40);
  const modelo = texto(i.modelo, 60);
  if (marca.length < 2 || modelo.length < 1) return { ok: false, error: "marca_modelo_requeridos" };
  const anio = entero(i.anio, 1950, new Date().getFullYear() + 1);
  if (anio === null || Number.isNaN(anio)) return { ok: false, error: "anio_invalido" };
  const km = entero(i.km, 0, 2_000_000);
  if (km === null || Number.isNaN(km)) return { ok: false, error: "km_invalido" };
  const transmision = texto(i.transmision, 20);
  const combustible = texto(i.combustible, 20);
  if (transmision && !TRANSMISIONES.includes(transmision)) return { ok: false, error: "transmision_invalida" };
  if (combustible && !COMBUSTIBLES.includes(combustible)) return { ok: false, error: "combustible_invalido" };
  return { ok: true, value: { patente, marca, modelo, version: texto(i.version, 60) || null, anio, km, color: texto(i.color, 30) || null, transmision: transmision || null, combustible: combustible || null } };
}

/** Solicitud de un ejecutivo: el vehículo y una nota para el Tasador. */
export function validarSolicitudTasacion(input) {
  const v = validarVehiculoTasacion(input && input.vehiculo);
  if (!v.ok) return v;
  return { ok: true, value: { vehiculo: v.value, notas: texto(input && input.notas, 300) || null } };
}

/** Tasación directa del Tasador: el vehículo, y opcionalmente quién lo ofrece. */
export function validarTasacionDirecta(input) {
  const v = validarVehiculoTasacion(input && input.vehiculo);
  if (!v.ok) return v;
  const c = (input && input.contacto) || {};
  const nombre = texto(c.nombre, 80);
  const telefono = texto(c.telefono, 30);
  if (nombre && nombre.length < 3) return { ok: false, error: "nombre_invalido" };
  if (telefono && soloDigitos(telefono).length < 8) return { ok: false, error: "telefono_invalido" };
  return { ok: true, value: { vehiculo: v.value, contacto: nombre || telefono ? { nombre: nombre || null, telefono: telefono || null } : {}, notas: texto(input && input.notas, 300) || null } };
}

/* ---------- Resultado ---------- */
const FOTO_ID = /^[A-Za-z0-9]{6,40}$/;
const CLAVE_INSPECCION = /^inspeccion::[A-Za-z0-9_-]+::[A-Za-z0-9_-]+$/;
export const MAX_FOTOS_TASACION = 6;

/** Deja solo los datos conocidos de la estimación de Chileautos (nada de lo que mande la pantalla se guarda sin revisar). */
export function limpiarEstimacion(e) {
  if (!e || typeof e !== "object") return {};
  const n = (v, max = 2_000_000_000) => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x <= max ? Math.round(x) : null; };
  const out = {};
  for (const k of ["promedio", "publicacion", "compra", "margenBruto"]) { const x = n(e[k]); if (x !== null) out[k] = x; }
  for (const k of ["nAvisos", "nValidos", "nDescartados"]) { const x = n(e[k], 5000); if (x !== null) out[k] = x; }
  for (const k of ["anioMin", "anioMax"]) { const x = n(e[k], 2200); if (x !== null) out[k] = x; }
  const km = n(e.kmMax, 5_000_000); if (km !== null) out.kmMax = km;
  for (const k of ["transmision", "combustible"]) if (e[k]) out[k] = texto(e[k], 30);
  if (typeof e.url === "string" && /^https:\/\/www\.chileautos\.cl\//.test(e.url)) out.url = e.url.slice(0, 600);
  if (typeof e.capturadaEn === "string" && !Number.isNaN(Date.parse(e.capturadaEn))) out.capturadaEn = new Date(e.capturadaEn).toISOString();
  if (Array.isArray(e.avisos)) {
    out.avisos = e.avisos.slice(0, 5).map((a) => ({
      titulo: texto(a && a.titulo, 80), anio: n(a && a.anio, 2200), km: n(a && a.km, 5_000_000), precio: n(a && a.precio),
      href: typeof (a && a.href) === "string" && a.href.startsWith("/") ? a.href.slice(0, 200) : null,
    }));
  }
  return out;
}

/** Referencia a una inspección ya hecha (solo su clave y datos del vehículo, nunca del propietario). */
export function limpiarInspeccionRef(r) {
  if (!r || typeof r !== "object" || !CLAVE_INSPECCION.test(String(r.key || ""))) return {};
  return { key: r.key, fecha: texto(r.fecha, 10) || null, inspector: texto(r.inspector, 80) || null, patente: normalizarPatente(r.patente) || null, marca: texto(r.marca, 40) || null, modelo: texto(r.modelo, 60) || null, anio: texto(r.anio, 4) || null };
}

const limpiarFotos = (f) => (Array.isArray(f) ? Array.from(new Set(f.map(String))).filter((x) => FOTO_ID.test(x)).slice(0, MAX_FOTOS_TASACION) : []);

/** Borrador: lo que el Tasador va guardando antes de terminar. Todo es opcional, pero lo que venga debe ser válido. */
export function validarBorradorTasacion(input) {
  const i = input || {};
  const out = {};
  if (i.vehiculo !== undefined) { const v = validarVehiculoTasacion(i.vehiculo); if (!v.ok) return v; out.vehiculo = v.value; }
  for (const [campo, columna] of [["valorCompra", "valor_compra"], ["valorVenta", "valor_venta"]]) {
    if (i[campo] === undefined) continue;
    const n = entero(i[campo], 0, 2_000_000_000);
    if (Number.isNaN(n)) return { ok: false, error: campo === "valorCompra" ? "valor_compra_invalido" : "valor_venta_invalido" };
    out[columna] = n;
  }
  if (i.observaciones !== undefined) out.observaciones = texto(i.observaciones, 1000) || null;
  if (i.estimacion !== undefined) out.estimacion = limpiarEstimacion(i.estimacion);
  if (i.inspeccion !== undefined) out.inspeccion = limpiarInspeccionRef(i.inspeccion);
  if (i.fotos !== undefined) out.fotos = limpiarFotos(i.fotos);
  return { ok: true, value: out };
}

/** Para completar: el valor de compra y el de venta esperado son obligatorios, y se espera vender por más de lo que se paga. */
export function validarCompletarTasacion(actual) {
  const compra = entero(actual && actual.valor_compra, 1, 2_000_000_000);
  if (compra === null || Number.isNaN(compra)) return { ok: false, error: "valor_compra_invalido" };
  const venta = entero(actual && actual.valor_venta, 1, 2_000_000_000);
  if (venta === null || Number.isNaN(venta)) return { ok: false, error: "valor_venta_invalido" };
  if (venta < compra) return { ok: false, error: "valor_venta_menor" };
  return { ok: true, value: { valor_compra: compra, valor_venta: venta, margen_esperado: venta - compra } };
}

/* ---------- Estados ---------- */
const PERMITIDAS = {
  tomar: ["pendiente"],
  liberar: ["en_proceso"],
  guardar: ["en_proceso"],
  completar: ["en_proceso"],
  asignar: ["pendiente", "en_proceso"],
  cancelar: ["pendiente", "en_proceso"],
};
export function validarTransicionTasacion(estado, accion) {
  return (PERMITIDAS[accion] || []).includes(estado) ? { ok: true } : { ok: false, error: "tasacion_estado_invalido" };
}

/* ---------- Valor reconocido en parte de pago ---------- */
/** Valor máximo que se le puede reconocer al cliente: el de la tasación completada (o null si no hay tasación). */
export const topeParteDePago = (tasacion) => (tasacion && tasacion.estado === "completada" && Number(tasacion.valor_compra) > 0 ? Number(tasacion.valor_compra) : null);

/** El valor del vehículo en parte de pago no puede superar lo tasado. Bajarlo (negociar) sí se puede. */
export function verificarTopeParteDePago(parteDePago, tope) {
  if (tope === null || tope === undefined) return { ok: true };
  if (parteDePago && parteDePago.tiene && Number(parteDePago.valor) > tope) return { ok: false, error: "parte_pago_excede_tasacion" };
  return { ok: true };
}

/** Al editar la parte de pago de un lead se conserva el vínculo con su tasación (la pantalla no lo envía). */
export function fusionarParteDePago(actual, nueva) {
  if (!nueva || !nueva.tiene) return nueva || {};
  return actual && actual.tasacion_id ? { ...nueva, tasacion_id: actual.tasacion_id } : nueva;
}

/* ---------- Métricas ---------- */
const promedio = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/**
 * Actividad de un Tasador en un mes: tasaciones completadas, tiempo medio de respuesta (desde que se pidió hasta que se completó)
 * y lo que tiene en cola. `tasaciones` = todas las del local.
 */
export function metricasTasador(tasaciones, tasadorId, mes, ahora = new Date()) {
  const suyas = tasaciones.filter((t) => t.tasador_id === tasadorId);
  const hechas = suyas.filter((t) => t.estado === "completada" && t.completada_en && mesChile(t.completada_en) === mes);
  const horas = hechas.map((t) => (Date.parse(t.completada_en) - Date.parse(t.solicitada_en)) / 3_600_000).filter((h) => Number.isFinite(h) && h >= 0);
  const margenes = hechas.map((t) => (t.valor_venta != null && t.valor_compra != null ? Number(t.valor_venta) - Number(t.valor_compra) : null)).filter((m) => m !== null);
  return {
    hechas: hechas.length,
    tiempoMedioHoras: Math.round(promedio(horas) * 10) / 10,
    enProceso: suyas.filter((t) => t.estado === "en_proceso").length,
    valorCompraTotal: hechas.reduce((a, t) => a + Number(t.valor_compra || 0), 0),
    margenEsperadoMedio: Math.round(promedio(margenes)),
  };
}

/** Solicitudes sin tomar: cuántas y cuánto lleva esperando la más antigua. */
export function colaTasaciones(tasaciones, ahora = new Date(), horasLimite = 8) {
  const pendientes = tasaciones.filter((t) => t.estado === "pendiente");
  const edades = pendientes.map((t) => horasDesde(t.solicitada_en, ahora));
  return {
    pendientes: pendientes.length,
    masAntiguaHoras: edades.length ? Math.round(Math.max(...edades) * 10) / 10 : 0,
    atrasadas: pendientes.filter((t) => horasDesde(t.solicitada_en, ahora) >= horasLimite),
  };
}
