// Núcleo del módulo comercial (entrega 2A): inventario, clientes, leads de venta y tareas.
// JavaScript puro, sin APIs de Deno ni del navegador: lo usan el servidor, la pantalla y las pruebas.
import { validarRut, normalizarRut } from "./crm-core.js";

/* ---------- Catálogos fijos ---------- */
export const ESTADOS_VEHICULO = [
  { id: "preparacion", nombre: "En preparación" },
  { id: "disponible", nombre: "Disponible" },
  { id: "reservado", nombre: "Reservado" },
  { id: "vendido", nombre: "Vendido" },
];

/** Etapas del embudo. `disponible:false` = se activa en una entrega posterior (cotizaciones, reservas, cierre). */
export const ETAPAS = [
  { id: "nuevo", nombre: "Nuevo", disponible: true },
  { id: "contactado", nombre: "Contactado", disponible: true },
  { id: "seguimiento", nombre: "En seguimiento", disponible: true },
  { id: "cotizado", nombre: "Cotizado", disponible: false },
  { id: "reservado", nombre: "Reservado", disponible: false },
  { id: "ganado", nombre: "Cerrado ganado", disponible: false },
  { id: "perdido", nombre: "Cerrado perdido", disponible: true },
];
export const ETAPAS_ACTIVAS = ETAPAS.filter((e) => e.disponible).map((e) => e.id);
export const ETAPAS_CERRADAS = ["ganado", "perdido"];
export const etapaNombre = (id) => (ETAPAS.find((e) => e.id === id) || {}).nombre || id;

export const TIPOS_CONTACTO = [
  { id: "llamada", nombre: "Llamada" },
  { id: "whatsapp", nombre: "WhatsApp" },
  { id: "visita", nombre: "Visita" },
  { id: "nota", nombre: "Nota" },
];
export const TIPOS_TAREA = [
  { id: "llamada", nombre: "Llamar" },
  { id: "whatsapp", nombre: "Escribir por WhatsApp" },
  { id: "visita", nombre: "Visita" },
  { id: "otro", nombre: "Otro" },
];
export const ESTADOS_FINANCIAMIENTO = [
  { id: "no_aplica", nombre: "No necesita" },
  { id: "por_evaluar", nombre: "Por evaluar" },
  { id: "en_evaluacion", nombre: "En evaluación" },
  { id: "aprobado", nombre: "Aprobado" },
  { id: "rechazado", nombre: "Rechazado" },
];
export const TRANSMISIONES = ["Mecánica", "Automática"];
export const COMBUSTIBLES = ["Bencina", "Diesel", "Híbrido", "Eléctrico"];

/* ---------- Utilidades ---------- */
const texto = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const entero = (v, min, max) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};

/** "ab cd-12" -> "ABCD12". */
export function normalizarPatente(p) {
  return String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export const patenteValida = (p) => /^(?:[A-Z]{4}\d{2}|[A-Z]{2}\d{4})$/.test(normalizarPatente(p));

/** Solo dígitos: "+56 9 1234 5678" -> "56912345678". */
export const soloDigitos = (t) => String(t || "").replace(/\D/g, "");

/* ---------- Vehículos ---------- */
export function validarVehiculo(input) {
  const i = input || {};
  const patente = normalizarPatente(i.patente);
  if (!patenteValida(patente)) return { ok: false, error: "patente_invalida" };
  const marca = texto(i.marca, 40);
  const modelo = texto(i.modelo, 60);
  if (marca.length < 2 || modelo.length < 1) return { ok: false, error: "marca_modelo_requeridos" };
  const anio = entero(i.anio, 1950, new Date().getFullYear() + 1);
  if (anio === null || Number.isNaN(anio)) return { ok: false, error: "anio_invalido" };
  const km = entero(i.km ?? 0, 0, 2_000_000);
  if (km === null || Number.isNaN(km)) return { ok: false, error: "km_invalido" };
  const precio = entero(i.precioLista, 0, 2_000_000_000);
  const costo = entero(i.costo, 0, 2_000_000_000);
  if (Number.isNaN(precio) || Number.isNaN(costo)) return { ok: false, error: "precio_invalido" };
  const estado = i.estado || "disponible";
  if (!ESTADOS_VEHICULO.some((e) => e.id === estado)) return { ok: false, error: "estado_invalido" };
  const transmision = texto(i.transmision, 20);
  const combustible = texto(i.combustible, 20);
  if (transmision && !TRANSMISIONES.includes(transmision)) return { ok: false, error: "transmision_invalida" };
  if (combustible && !COMBUSTIBLES.includes(combustible)) return { ok: false, error: "combustible_invalido" };
  const fotos = Array.isArray(i.fotos) ? Array.from(new Set(i.fotos.map(String))).filter((f) => /^[A-Za-z0-9]{6,40}$/.test(f)).slice(0, 8) : [];
  return {
    ok: true,
    value: {
      patente, marca, modelo, version: texto(i.version, 60) || null, anio, km, color: texto(i.color, 30) || null,
      transmision: transmision || null, combustible: combustible || null, precio_lista: precio, costo, estado,
      notas: texto(i.notas, 500) || null, fotos,
    },
  };
}

/** Quita el costo (dato sensible) si la persona no puede verlo. */
export function ocultarCosto(vehiculo, puedeVerCosto) {
  if (puedeVerCosto) return vehiculo;
  const { costo, ...resto } = vehiculo; // eslint-disable-line no-unused-vars
  return resto;
}

/* ---------- Clientes ---------- */
export function validarCliente(input) {
  const i = input || {};
  const nombre = texto(i.nombre, 80);
  if (nombre.length < 3) return { ok: false, error: "nombre_invalido" };
  let rut = null;
  if (String(i.rut ?? "").trim()) {
    if (!validarRut(i.rut)) return { ok: false, error: "rut_invalido" };
    rut = normalizarRut(i.rut);
  }
  const telefono = texto(i.telefono, 30);
  if (telefono && soloDigitos(telefono).length < 8) return { ok: false, error: "telefono_invalido" };
  const email = texto(i.email, 80).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "email_invalido" };
  if (!telefono && !email) return { ok: false, error: "contacto_requerido" };
  return { ok: true, value: { nombre, rut, telefono: telefono || null, email: email || null, notas: texto(i.notas, 500) || null } };
}

/* ---------- Leads ---------- */
function validarParteDePago(p) {
  if (!p || !p.tiene) return { ok: true, value: {} };
  const anio = entero(p.anio, 1950, new Date().getFullYear() + 1);
  const km = entero(p.km, 0, 2_000_000);
  const valor = entero(p.valor, 0, 2_000_000_000);
  if ([anio, km, valor].some((n) => Number.isNaN(n))) return { ok: false, error: "parte_pago_invalida" };
  const patente = normalizarPatente(p.patente);
  if (patente && !patenteValida(patente)) return { ok: false, error: "patente_invalida" };
  return { ok: true, value: { tiene: true, patente: patente || null, marca: texto(p.marca, 40) || null, modelo: texto(p.modelo, 60) || null, anio, km, valor } };
}

function validarFinanciamiento(f) {
  if (!f || !f.quiere) return { ok: true, value: {} };
  const pie = entero(f.pie, 0, 2_000_000_000);
  if (Number.isNaN(pie)) return { ok: false, error: "financiamiento_invalido" };
  const estado = f.estado || "por_evaluar";
  if (!ESTADOS_FINANCIAMIENTO.some((e) => e.id === estado)) return { ok: false, error: "financiamiento_invalido" };
  return { ok: true, value: { quiere: true, pie, banco: texto(f.banco, 60) || null, estado } };
}

/** Datos editables de un lead (sin etapa ni asignación: esas tienen sus propias operaciones). */
export function validarLead(input) {
  const i = input || {};
  const pp = validarParteDePago(i.parteDePago);
  if (!pp.ok) return pp;
  const fin = validarFinanciamiento(i.financiamiento);
  if (!fin.ok) return fin;
  return {
    ok: true,
    value: {
      vehiculo_id: i.vehiculoId ? String(i.vehiculoId) : null,
      vehiculo_interes: texto(i.vehiculoInteres, 120) || null,
      fuente: texto(i.fuente, 60) || null,
      parte_pago: pp.value,
      financiamiento: fin.value,
      notas: texto(i.notas, 1000) || null,
    },
  };
}

/**
 * ¿Se puede pasar el lead de `desde` a `hacia`?
 * - Solo a etapas disponibles hoy (cotizado/reservado/ganado llegan con sus entregas).
 * - Un lead cerrado solo lo reabre quien puede reasignar (supervisor).
 * - Perder exige un motivo.
 */
export function validarCambioEtapa({ desde, hacia, motivo, puedeReabrir = false }) {
  if (!ETAPAS_ACTIVAS.includes(hacia)) return { ok: false, error: "etapa_no_disponible" };
  if (desde === hacia) return { ok: false, error: "sin_cambio" };
  if (ETAPAS_CERRADAS.includes(desde) && !puedeReabrir) return { ok: false, error: "lead_cerrado" };
  const m = texto(motivo, 80);
  if (hacia === "perdido" && !m) return { ok: false, error: "motivo_requerido" };
  return { ok: true, value: { etapa: hacia, motivo_perdida: hacia === "perdido" ? m : null } };
}

/**
 * Reparto rotativo: elige a quien lleva MÁS tiempo sin recibir un lead (o nunca recibió).
 * `candidatos`: [{id, nombre}]; `ultimaAsignacion`: { [id]: ISO | undefined }.
 */
export function elegirAsignado(candidatos, ultimaAsignacion) {
  if (!candidatos || candidatos.length === 0) return null;
  const orden = [...candidatos].sort((a, b) => {
    const ta = ultimaAsignacion[a.id] ? Date.parse(ultimaAsignacion[a.id]) : -Infinity;
    const tb = ultimaAsignacion[b.id] ? Date.parse(ultimaAsignacion[b.id]) : -Infinity;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : 1; // desempate estable
  });
  return orden[0];
}

/* ---------- Tareas ---------- */
export const ZONA_HORARIA = "America/Santiago";
const diaLocal = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: ZONA_HORARIA }); // AAAA-MM-DD

export function validarTarea(input) {
  const i = input || {};
  const titulo = texto(i.titulo, 120);
  if (titulo.length < 3) return { ok: false, error: "titulo_invalido" };
  const tipo = i.tipo || "llamada";
  if (!TIPOS_TAREA.some((t) => t.id === tipo)) return { ok: false, error: "tipo_invalido" };
  const ms = Date.parse(i.venceEn);
  if (!Number.isFinite(ms)) return { ok: false, error: "fecha_invalida" };
  return { ok: true, value: { titulo, tipo, vence_en: new Date(ms).toISOString() } };
}

/** 'vencida' (día anterior o antes), 'hoy' o 'proxima', según el día en Chile. */
export function claseTarea(venceEn, ahora = new Date()) {
  const v = diaLocal(venceEn);
  const h = diaLocal(ahora);
  return v < h ? "vencida" : v === h ? "hoy" : "proxima";
}

/** Agrupa tareas pendientes en vencidas / hoy / próximas, cada grupo ordenado por fecha. */
export function agruparTareas(tareas, ahora = new Date()) {
  const out = { vencidas: [], hoy: [], proximas: [] };
  for (const t of tareas) {
    if (t.hecha) continue;
    const c = claseTarea(t.vence_en ?? t.venceEn, ahora);
    (c === "vencida" ? out.vencidas : c === "hoy" ? out.hoy : out.proximas).push(t);
  }
  const porFecha = (a, b) => Date.parse(a.vence_en ?? a.venceEn) - Date.parse(b.vence_en ?? b.venceEn);
  out.vencidas.sort(porFecha); out.hoy.sort(porFecha); out.proximas.sort(porFecha);
  return out;
}

/* ---------- Embudo ---------- */
/** Cuenta leads por etapa (todas las etapas, aunque estén en 0). */
export function contarPorEtapa(leads) {
  const out = {};
  for (const e of ETAPAS) out[e.id] = 0;
  for (const l of leads) if (out[l.etapa] !== undefined) out[l.etapa]++;
  return out;
}

/** Leads "nuevos por atender": etapa nueva y todavía sin ningún contacto. */
export const leadsPorAtender = (leads) => leads.filter((l) => l.etapa === "nuevo" && !l.ultimo_contacto);

/* ---------- Permisos del módulo ---------- */
/** Quién puede modificar un lead: quien reasigna (supervisor) o su dueño con permiso de leads propios. Y debe estar habilitado para ventas, salvo el supervisor. */
export function puedeEditarLead({ permisos, esAdmin, usuarioId, lead }) {
  if (esAdmin || permisos.includes("leads.asignar")) return true;
  return permisos.includes("leads.propios") && permisos.includes("ventas.operar") && lead.asignado_a === usuarioId;
}
