// Núcleo de las validaciones del CRM: revisión de documentos de cierres de venta, vehículos y compras.
// JavaScript puro (sin APIs de Deno ni del navegador): lo usan el servidor, la pantalla y las pruebas.
import { horasDesde, mesChile } from "./ventas-core.js";

/* ---------- Catálogos ---------- */
export const TIPOS_VALIDACION = [
  { id: "venta", nombre: "Cierre de venta" },
  { id: "vehiculo", nombre: "Documentos del vehículo" },
  { id: "compra", nombre: "Compra directa" },
];
export const tipoValidacionNombre = (id) => (TIPOS_VALIDACION.find((t) => t.id === id) || {}).nombre || id;

export const ESTADOS_VALIDACION = [
  { id: "pendiente", nombre: "Por tomar" },
  { id: "en_revision", nombre: "En revisión" },
  { id: "observada", nombre: "Con observaciones" },
  { id: "rechazada", nombre: "Rechazada" },
  { id: "aprobada", nombre: "Aprobada" },
  { id: "cancelada", nombre: "Cancelada" },
];
export const validacionNombre = (id) => (ESTADOS_VALIDACION.find((e) => e.id === id) || {}).nombre || id;

export const ESTADOS_DOC = [
  { id: "pendiente", nombre: "Por revisar" },
  { id: "aprobado", nombre: "Aprobado" },
  { id: "observado", nombre: "Observado" },
  { id: "rechazado", nombre: "Rechazado" },
  { id: "no_aplica", nombre: "No aplica" },
];
export const docNombre = (id) => (ESTADOS_DOC.find((e) => e.id === id) || {}).nombre || id;
export const folioValidacion = (n) => `VAL-${String(n || 0).padStart(6, "0")}`;

const texto = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/* ---------- Listas de documentos ---------- */
const D = (clave, nombre, grupo, requerido = true) => ({ clave, nombre, grupo, requerido });
export const DOCS_VEHICULO = [
  D("padron", "Padrón / certificado de anotaciones vigentes (CAV)", "vehiculo"),
  D("permiso_circulacion", "Permiso de circulación al día", "vehiculo"),
  D("revision_tecnica", "Revisión técnica vigente", "vehiculo"),
  D("soap", "SOAP vigente", "vehiculo"),
  D("multas_prendas", "Certificado de multas, prendas y limitaciones", "vehiculo"),
];

/**
 * Qué documentos hay que revisar según el tipo de validación.
 * opciones: { conFinanciamiento, conParteDePago } (solo para ventas).
 */
export function checklistPara(tipo, opciones = {}) {
  if (tipo === "vehiculo") return DOCS_VEHICULO.map((d) => ({ ...d }));
  if (tipo === "compra") {
    return [
      ...DOCS_VEHICULO.map((d) => ({ ...d })),
      D("cedula_vendedor", "Cédula de identidad del vendedor (ambos lados)", "cliente"),
      D("contrato_compra", "Contrato de compraventa o mandato firmado", "cliente"),
      D("comprobante_pago", "Comprobante de pago al vendedor", "cliente", false),
    ];
  }
  if (tipo === "venta") {
    const docs = [
      ...DOCS_VEHICULO.map((d) => ({ ...d })),
      D("cedula_cliente", "Cédula de identidad del cliente (ambos lados)", "cliente"),
      D("domicilio", "Comprobante de domicilio", "cliente"),
      D("comprobante_pago", "Comprobante de pago o transferencia", "cliente"),
    ];
    if (opciones.conFinanciamiento) docs.push(D("renta", "Liquidaciones de sueldo o comprobante de renta", "cliente"), D("antecedentes_credito", "Solicitud de crédito firmada", "cliente"));
    if (opciones.conParteDePago) docs.push(D("docs_parte_pago", "Documentos del vehículo recibido en parte de pago", "cliente"));
    return docs;
  }
  return [];
}

/* ---------- Revisión de un documento ---------- */
export function validarRevision(input) {
  const i = input || {};
  const estado = String(i.estado || "");
  if (!["aprobado", "observado", "rechazado", "no_aplica"].includes(estado)) return { ok: false, error: "estado_doc_invalido" };
  const comentario = texto(i.comentario, 300);
  if (estado !== "aprobado" && comentario.length < 3) return { ok: false, error: "comentario_requerido" };
  return { ok: true, value: { estado, comentario: comentario || null } };
}

/* ---------- Archivos ---------- */
export const MAX_ARCHIVOS_DOC = 3;
export const MAX_BYTES_ARCHIVO = 4 * 1024 * 1024;
const ID_ARCHIVO = /^[A-Za-z0-9]{6,40}$/;
export const TIPOS_ARCHIVO = ["image/jpeg", "application/pdf"];

export function validarArchivo(input) {
  const i = input || {};
  if (!ID_ARCHIVO.test(String(i.id || ""))) return { ok: false, error: "archivo_invalido" };
  if (!TIPOS_ARCHIVO.includes(i.tipo)) return { ok: false, error: "archivo_tipo_invalido" };
  const tam = Number(i.tam);
  if (!Number.isFinite(tam) || tam <= 0 || tam > MAX_BYTES_ARCHIVO) return { ok: false, error: "archivo_muy_grande" };
  return { ok: true, value: { id: String(i.id), nombre: texto(i.nombre, 80) || "documento", tipo: i.tipo, tam: Math.round(tam) } };
}

/** Clave donde se guarda el contenido de un archivo (la validación dueña puede ser otra si se reutilizó). */
export const claveArchivo = (validacionId, archivoId) => `dval::${validacionId}::${archivoId}`;

/* ---------- Estado ---------- */
/** El estado de la validación sale de sus documentos; el supervisor/Validador no lo cambia a mano. */
export function estadoDeValidacion(docs, tieneValidador) {
  const lista = docs || [];
  const requeridos = lista.filter((d) => d.requerido);
  if (requeridos.length > 0 && requeridos.every((d) => d.estado === "aprobado" || d.estado === "no_aplica")) return "aprobada";
  if (lista.some((d) => d.estado === "rechazado")) return "rechazada";
  if (lista.some((d) => d.estado === "observado")) return "observada";
  return tieneValidador ? "en_revision" : "pendiente";
}

export const ESTADOS_ABIERTOS = ["pendiente", "en_revision", "observada", "rechazada"];

/** Cuántos documentos hay en cada estado y cuántos requeridos faltan. */
export function progreso(docs) {
  const lista = docs || [];
  const c = { total: lista.length, aprobados: 0, observados: 0, rechazados: 0, porRevisar: 0, noAplica: 0, sinArchivo: 0 };
  for (const d of lista) {
    if (d.estado === "aprobado") c.aprobados++;
    else if (d.estado === "observado") c.observados++;
    else if (d.estado === "rechazado") c.rechazados++;
    else if (d.estado === "no_aplica") c.noAplica++;
    else c.porRevisar++;
    if (d.requerido && d.estado === "pendiente" && (!d.archivos || d.archivos.length === 0)) c.sinArchivo++;
  }
  return c;
}

/** Documentos del vehículo ya aprobados en otra validación: se reutilizan para no volver a pedirlos. */
export function docsReutilizables(docsOrigen, validacionOrigenId) {
  const out = {};
  for (const d of docsOrigen || []) {
    if (d.grupo === "vehiculo" && d.estado === "aprobado") {
      out[d.clave] = { estado: "aprobado", comentario: d.comentario || null, revisado_por: d.revisado_por || null, revisado_en: d.revisado_en || null, archivos: (d.archivos || []).map((a) => ({ ...a, v: a.v || validacionOrigenId })) };
    }
  }
  return out;
}

/* ---------- Cola y métricas ---------- */
export function colaValidaciones(filas, ahora = new Date(), horasLimite = 8) {
  const pendientes = filas.filter((v) => v.estado === "pendiente");
  const edades = pendientes.map((v) => horasDesde(v.solicitada_en, ahora));
  return {
    pendientes: pendientes.length,
    masAntiguaHoras: edades.length ? Math.round(Math.max(...edades) * 10) / 10 : 0,
    atrasadas: pendientes.filter((v) => horasDesde(v.solicitada_en, ahora) >= horasLimite),
  };
}

const promedio = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** Actividad de un Validador: validaciones aprobadas en el mes, tiempo medio (desde que se pidió) y lo que tiene abierto. */
export function metricasValidador(filas, validadorId, mes) {
  const suyas = filas.filter((v) => v.validador_id === validadorId);
  const aprobadas = suyas.filter((v) => v.estado === "aprobada" && v.resuelta_en && mesChile(v.resuelta_en) === mes);
  const horas = aprobadas.map((v) => (Date.parse(v.resuelta_en) - Date.parse(v.solicitada_en)) / 3_600_000).filter((h) => Number.isFinite(h) && h >= 0);
  return {
    aprobadas: aprobadas.length,
    tiempoMedioHoras: Math.round(promedio(horas) * 10) / 10,
    abiertas: suyas.filter((v) => ESTADOS_ABIERTOS.includes(v.estado)).length,
    conObservaciones: suyas.filter((v) => v.estado === "observada" || v.estado === "rechazada").length,
  };
}

/** Transiciones de la cola. */
const PERMITIDAS = {
  tomar: ["pendiente"],
  liberar: ["en_revision", "observada", "rechazada"],
  asignar: ["pendiente", "en_revision", "observada", "rechazada"],
  revisar: ["en_revision", "observada", "rechazada"],
};
export function validarTransicionValidacion(estado, accion) {
  return (PERMITIDAS[accion] || []).includes(estado) ? { ok: true } : { ok: false, error: "validacion_estado_invalido" };
}
