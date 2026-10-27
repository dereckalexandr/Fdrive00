// Núcleo de las inspecciones del CRM: solicitudes con cola y agenda, resultado visible para el equipo y producción del Inspector.
// JavaScript puro (sin APIs de Deno ni del navegador): lo usan el servidor, la pantalla y las pruebas.
//
// PRIVACIDAD: el resultado que ven los demás perfiles se arma con una lista cerrada de campos (estado del vehículo,
// observaciones y fotos). Los datos del propietario (nombre y RUN) jamás pasan por aquí: quedan solo en la ficha del Inspector.
import { mesChile, horasDesde, normalizarPatente, patenteValida } from "./ventas-core.js";
import { validarVehiculoTasacion } from "./tasaciones-core.js";

/* ---------- Catálogos ---------- */
export const ESTADOS_INSPECCION = [
  { id: "pendiente", nombre: "Por tomar" },
  { id: "en_proceso", nombre: "Agendada" },
  { id: "completada", nombre: "Realizada" },
  { id: "cancelada", nombre: "Cancelada" },
];
export const inspeccionNombre = (id) => (ESTADOS_INSPECCION.find((e) => e.id === id) || {}).nombre || id;
export const ORIGENES_INSPECCION = [
  { id: "lead", nombre: "Lead" },
  { id: "tasacion", nombre: "Tasación" },
  { id: "vehiculo", nombre: "Inventario" },
  { id: "espontanea", nombre: "Espontánea" },
];
export const origenNombre = (id) => (ORIGENES_INSPECCION.find((o) => o.id === id) || {}).nombre || id;
export const folioInspeccion = (n) => `INS-${String(n || 0).padStart(6, "0")}`;

const texto = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const DIA = 86_400_000;

/* ---------- Solicitud ---------- */
/** Fecha y hora acordadas: válidas, no más de un día en el pasado ni de seis meses hacia adelante. */
export function validarFechaHora(v, ahora = new Date()) {
  const t = Date.parse(v);
  if (Number.isNaN(t)) return { ok: false, error: "fecha_invalida" };
  if (t < ahora.getTime() - DIA || t > ahora.getTime() + 183 * DIA) return { ok: false, error: "fecha_invalida" };
  return { ok: true, value: new Date(t).toISOString() };
}

/** Qué inspeccionar, cuándo y dónde. */
export function validarSolicitudInspeccion(input, ahora = new Date()) {
  const i = input || {};
  const v = validarVehiculoTasacion(i.vehiculo);
  if (!v.ok) return v;
  const direccion = texto(i.direccion, 200);
  if (direccion.length < 5) return { ok: false, error: "direccion_requerida" };
  const f = validarFechaHora(i.fechaHora, ahora);
  if (!f.ok) return f;
  return { ok: true, value: { vehiculo: v.value, direccion, fechaHora: f.value, contactoLugar: texto(i.contactoLugar, 120) || null, notas: texto(i.notas, 300) || null } };
}

/**
 * Dónde se hace la inspección: en un local (casa matriz o sucursal, con la dirección registrada en Configuración) o en terreno (otra dirección).
 * `lugar` = { tipo: "local", localId } | { tipo: "terreno", calle, comuna, referencia? }; `locales` = [{ id, nombre, direccion, activo }].
 * @returns { ok, value: { direccion, lugar: "local" | "terreno" } } o { ok: false, error }
 */
export function resolverLugar(lugar, locales = []) {
  const l = lugar || {};
  if (l.tipo === "terreno") {
    const calle = texto(l.calle, 120);
    const comuna = texto(l.comuna, 60);
    if (calle.length < 3) return { ok: false, error: "calle_requerida" };
    if (comuna.length < 2) return { ok: false, error: "comuna_requerida" };
    const ref = texto(l.referencia, 80);
    return { ok: true, value: { direccion: `${calle}, ${comuna}${ref ? ` (${ref})` : ""}`, lugar: "terreno" } };
  }
  if (l.tipo === "local") {
    const local = (locales || []).find((x) => x.id === l.localId && x.activo !== false);
    if (!local) return { ok: false, error: "lugar_invalido" };
    if (texto(local.direccion, 200).length < 5) return { ok: false, error: "local_sin_direccion" };
    return { ok: true, value: { direccion: `${local.nombre} · ${texto(local.direccion, 200)}`, lugar: "local" } };
  }
  return { ok: false, error: "lugar_requerido" };
}

/** Cambio de fecha, hora o lugar de una inspección ya pedida. */
export function validarReprogramacion(input, ahora = new Date()) {
  const i = input || {};
  const direccion = texto(i.direccion, 200);
  if (direccion.length < 5) return { ok: false, error: "direccion_requerida" };
  const f = validarFechaHora(i.fechaHora, ahora);
  if (!f.ok) return f;
  return { ok: true, value: { direccion, fechaHora: f.value, contactoLugar: texto(i.contactoLugar, 120) || null } };
}

/* ---------- Resultado ---------- */
const FOTO_ID = /^[A-Za-z0-9]{6,40}$/;
const CLAVE_INSPECCION = /^inspeccion::[A-Za-z0-9_-]+::[A-Za-z0-9_-]+$/;
export const MAX_FOTOS_INSPECCION = 12;
export const ESTADOS_ITEM = ["Bueno", "Regular", "Malo", "No aplica"];

/** Id del registro dentro de la clave `inspeccion::<persona>::<id>` (o null si la clave no es válida). */
export const idDeClave = (clave) => (CLAVE_INSPECCION.test(String(clave || "")) ? String(clave).split("::")[2] : null);
/** ¿La clave es de una inspección de esta persona? */
export const claveEsDe = (clave, usuarioId) => CLAVE_INSPECCION.test(String(clave || "")) && String(clave).split("::")[1] === String(usuarioId);

/**
 * Resume el checklist de una inspección: cuántos ítems hay en cada estado y cuáles merecen atención.
 * `secciones` = [{ title, items:[{id,label}] }]; `checklist` = { [itemId]: { estado, observacion } }.
 */
export function resumirInspeccion(checklist, secciones) {
  const cl = checklist || {};
  const cuenta = { buenos: 0, regulares: 0, malos: 0, noAplica: 0, sinRevisar: 0 };
  const destacados = [];
  for (const s of secciones || []) {
    for (const it of s.items || []) {
      const d = cl[it.id] || {};
      const estado = ESTADOS_ITEM.includes(d.estado) ? d.estado : "";
      if (estado === "Bueno") cuenta.buenos++;
      else if (estado === "Regular") cuenta.regulares++;
      else if (estado === "Malo") cuenta.malos++;
      else if (estado === "No aplica") cuenta.noAplica++;
      else cuenta.sinRevisar++;
      const obs = texto(d.observacion, 300);
      if (estado === "Malo" || estado === "Regular" || obs) destacados.push({ seccion: texto(s.title, 60), item: texto(it.label, 80), estado, observacion: obs });
    }
  }
  // Primero lo más grave.
  const peso = { Malo: 0, Regular: 1, "": 2, Bueno: 3, "No aplica": 3 };
  destacados.sort((a, b) => peso[a.estado] - peso[b.estado]);
  return { ...cuenta, destacados };
}

export function veredictoDe(r) {
  if (r.malos > 0) return "con_fallas";
  if (r.regulares > 0 || (r.destacados || []).length > 0) return "con_observaciones";
  return "sin_observaciones";
}
export const VEREDICTOS = {
  sin_observaciones: "Sin observaciones",
  con_observaciones: "Con observaciones",
  con_fallas: "Con fallas",
};

const cnt = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 500 ? n : 0; };

/**
 * Lo que el Inspector informa al registrar su inspección. Se queda solo con los campos conocidos:
 * si la pantalla (o alguien manipulando la petición) enviara el nombre o el RUN del propietario, se descarta.
 */
export function validarResultadoInspeccion(input) {
  const i = input || {};
  const clave = String(i.key || "");
  if (!CLAVE_INSPECCION.test(clave)) return { ok: false, error: "inspeccion_invalida" };
  const r = i.resumen || {};
  const destacados = (Array.isArray(r.destacados) ? r.destacados : []).slice(0, 60).map((d) => ({
    seccion: texto(d && d.seccion, 60), item: texto(d && d.item, 80),
    estado: ESTADOS_ITEM.includes(d && d.estado) ? d.estado : "", observacion: texto(d && d.observacion, 300),
  }));
  const resumen = { buenos: cnt(r.buenos), regulares: cnt(r.regulares), malos: cnt(r.malos), noAplica: cnt(r.noAplica), sinRevisar: cnt(r.sinRevisar), destacados };
  resumen.veredicto = veredictoDe(resumen);
  resumen.observaciones = texto(r.observaciones, 1000) || null;
  const fotos = Array.isArray(i.fotos) ? Array.from(new Set(i.fotos.map(String))).filter((x) => FOTO_ID.test(x)).slice(0, MAX_FOTOS_INSPECCION) : [];
  // El vehículo es el único dato de identificación: patente obligatoria; marca, modelo y año si el Inspector los tiene.
  const iv = i.vehiculo || {};
  const patente = normalizarPatente(iv.patente);
  if (!patenteValida(patente)) return { ok: false, error: "patente_invalida" };
  const anio = Number(iv.anio);
  const vehiculo = { patente, marca: texto(iv.marca, 40) || null, modelo: texto(iv.modelo, 60) || null, anio: Number.isInteger(anio) && anio >= 1950 && anio <= 2200 ? anio : null };
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(i.fecha || "")) ? String(i.fecha) : null;
  return { ok: true, value: { key: clave, vehiculo, resumen, fotos, fecha } };
}

/* ---------- Estados ---------- */
const PERMITIDAS = {
  tomar: ["pendiente"],
  liberar: ["en_proceso"],
  asignar: ["pendiente", "en_proceso"],
  reprogramar: ["pendiente", "en_proceso"],
  cancelar: ["pendiente", "en_proceso"],
  completar: ["en_proceso"],
};
export function validarTransicionInspeccion(estado, accion) {
  return (PERMITIDAS[accion] || []).includes(estado) ? { ok: true } : { ok: false, error: "inspeccion_estado_invalido" };
}

/* ---------- Agenda y métricas ---------- */
/** Día (AAAA-MM-DD) en Chile de una fecha. */
export const diaChile = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

/** Agenda del Inspector: sus inspecciones agendadas por fecha, con las vencidas (fecha ya pasada) marcadas. */
export function ordenarAgenda(filas, ahora = new Date()) {
  return filas
    .filter((x) => x.estado === "en_proceso")
    .slice()
    .sort((a, b) => Date.parse(a.agendada_para) - Date.parse(b.agendada_para))
    .map((x) => ({ ...x, vencida: Date.parse(x.agendada_para) < ahora.getTime() }));
}

/** Otra inspección del mismo Inspector a menos de 90 minutos de la fecha dada (para avisar de un posible choque). */
export function hayChoque(filas, inspectorId, fechaHora, ignorarId = null) {
  const t = Date.parse(fechaHora);
  return filas.some((x) => x.id !== ignorarId && x.inspector_id === inspectorId && x.estado === "en_proceso" && x.agendada_para && Math.abs(Date.parse(x.agendada_para) - t) < 90 * 60_000);
}

const promedio = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** Inspecciones realizadas por un Inspector en el mes (cuentan todas: pedidas y espontáneas). `filas` = todas las del local. */
export function inspeccionesDelMes(filas, inspectorId, mes) {
  return filas.filter((x) => x.inspector_id === inspectorId && x.estado === "completada" && x.completada_en && mesChile(x.completada_en) === mes);
}

export function metricasInspector(filas, inspectorId, mes) {
  const hechas = inspeccionesDelMes(filas, inspectorId, mes);
  const pedidas = hechas.filter((x) => x.origen !== "espontanea");
  const horas = pedidas.map((x) => (Date.parse(x.completada_en) - Date.parse(x.solicitada_en)) / 3_600_000).filter((h) => Number.isFinite(h) && h >= 0);
  const suyas = filas.filter((x) => x.inspector_id === inspectorId);
  return {
    hechas: hechas.length,
    pedidas: pedidas.length,
    espontaneas: hechas.length - pedidas.length,
    conFallas: hechas.filter((x) => x.resultado && x.resultado.veredicto === "con_fallas").length,
    tiempoMedioHoras: Math.round(promedio(horas) * 10) / 10,
    agendadas: suyas.filter((x) => x.estado === "en_proceso").length,
  };
}

/** Solicitudes sin tomar: cuántas, cuánto lleva la más antigua y cuáles pasaron el límite o están por llegar a su fecha. */
export function colaInspecciones(filas, ahora = new Date(), horasLimite = 8) {
  const pendientes = filas.filter((x) => x.estado === "pendiente");
  const edades = pendientes.map((x) => horasDesde(x.solicitada_en, ahora));
  const urgente = (x) => horasDesde(x.solicitada_en, ahora) >= horasLimite || Date.parse(x.agendada_para) - ahora.getTime() < DIA;
  return {
    pendientes: pendientes.length,
    masAntiguaHoras: edades.length ? Math.round(Math.max(...edades) * 10) / 10 : 0,
    atrasadas: pendientes.filter(urgente),
  };
}
