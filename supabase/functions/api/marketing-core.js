// Núcleo de Marketing y RRSS: calendario de contenido, campañas con presupuesto y aprobación, material por vehículo y rendimiento.
// JavaScript puro (sin APIs de Deno ni del navegador): lo usan el servidor, la pantalla y las pruebas.

/* ---------- Catálogos ---------- */
export const CANALES = [
  { id: "instagram", nombre: "Instagram" },
  { id: "facebook", nombre: "Facebook" },
  { id: "tiktok", nombre: "TikTok" },
  { id: "youtube", nombre: "YouTube" },
  { id: "google", nombre: "Google" },
  { id: "chileautos", nombre: "Chileautos" },
  { id: "yapo", nombre: "Yapo" },
  { id: "whatsapp", nombre: "WhatsApp" },
  { id: "otro", nombre: "Otro" },
];
export const canalNombre = (id) => (CANALES.find((c) => c.id === id) || {}).nombre || id;

export const TIPOS_PUBLICACION = [
  { id: "post", nombre: "Post" }, { id: "reel", nombre: "Reel / video corto" }, { id: "historia", nombre: "Historia" },
  { id: "video", nombre: "Video" }, { id: "carrusel", nombre: "Carrusel" },
];
export const tipoPublicacionNombre = (id) => (TIPOS_PUBLICACION.find((t) => t.id === id) || {}).nombre || id;

export const ESTADOS_PUBLICACION = [
  { id: "idea", nombre: "Idea" }, { id: "produccion", nombre: "En producción" }, { id: "programada", nombre: "Programada" },
  { id: "publicada", nombre: "Publicada" }, { id: "cancelada", nombre: "Cancelada" },
];
export const publicacionNombre = (id) => (ESTADOS_PUBLICACION.find((e) => e.id === id) || {}).nombre || id;

export const ESTADOS_CAMPANIA = [
  { id: "borrador", nombre: "Borrador" }, { id: "pendiente", nombre: "Esperando aprobación" }, { id: "aprobada", nombre: "Aprobada" },
  { id: "rechazada", nombre: "Rechazada" }, { id: "finalizada", nombre: "Finalizada" }, { id: "cancelada", nombre: "Cancelada" },
];
export const campaniaNombre = (id) => (ESTADOS_CAMPANIA.find((e) => e.id === id) || {}).nombre || id;
export const folioCampania = (n) => `CAM-${String(n || 0).padStart(4, "0")}`;
export const folioPublicacion = (n) => `POST-${String(n || 0).padStart(5, "0")}`;

export const TIPOS_MATERIAL = [
  { id: "fotos", nombre: "Fotos profesionales" }, { id: "video", nombre: "Video" }, { id: "reel", nombre: "Reel" }, { id: "historia", nombre: "Historias" },
];
export const materialTipoNombre = (id) => (TIPOS_MATERIAL.find((t) => t.id === id) || {}).nombre || id;
export const ESTADOS_MATERIAL = [
  { id: "pendiente", nombre: "Por hacer" }, { id: "en_proceso", nombre: "En proceso" }, { id: "listo", nombre: "Listo" },
];
export const materialEstadoNombre = (id) => (ESTADOS_MATERIAL.find((e) => e.id === id) || {}).nombre || id;

const texto = (v, max) => String(v ?? "").trim().replace(/[ \t]+/g, " ").slice(0, max);
const entero = (v, min, max) => {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};
const esFecha = (f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || "")) && !Number.isNaN(Date.parse(`${f}T12:00:00Z`));
const urlHttps = (u) => /^https:\/\/[^\s/$.?#][^\s]*$/i.test(String(u || "")) && String(u).length <= 500;
const DIA = 86_400_000;

/* ---------- Campañas ---------- */
export function validarCampania(input) {
  const i = input || {};
  const nombre = texto(i.nombre, 80);
  if (nombre.length < 3) return { ok: false, error: "nombre_campania_invalido" };
  if (!CANALES.some((c) => c.id === i.canal)) return { ok: false, error: "canal_invalido" };
  if (!esFecha(i.desde) || !esFecha(i.hasta)) return { ok: false, error: "fecha_invalida" };
  if (Date.parse(`${i.hasta}T12:00:00Z`) < Date.parse(`${i.desde}T12:00:00Z`)) return { ok: false, error: "fechas_invertidas" };
  if (Date.parse(`${i.hasta}T12:00:00Z`) - Date.parse(`${i.desde}T12:00:00Z`) > 400 * DIA) return { ok: false, error: "fecha_invalida" };
  const presupuesto = entero(i.presupuesto, 0, 2_000_000_000);
  if (Number.isNaN(presupuesto)) return { ok: false, error: "presupuesto_invalido" };
  return { ok: true, value: { nombre, canal: i.canal, objetivo: texto(i.objetivo, 200) || null, desde: i.desde, hasta: i.hasta, presupuesto } };
}

/** Lo que Marketing anota a mano: gasto real, alcance, impresiones y clics. */
export function validarResultadosCampania(input, presupuestoAprobado) {
  const i = input || {};
  const gasto = entero(i.gasto, 0, 2_000_000_000);
  if (Number.isNaN(gasto)) return { ok: false, error: "gasto_invalido" };
  if (gasto > Number(presupuestoAprobado || 0)) return { ok: false, error: "gasto_excede_presupuesto" };
  const alcance = entero(i.alcance, 0, 1_000_000_000);
  const impresiones = entero(i.impresiones, 0, 1_000_000_000);
  const clics = entero(i.clics, 0, 1_000_000_000);
  if ([alcance, impresiones, clics].some((n) => Number.isNaN(n))) return { ok: false, error: "resultado_invalido" };
  return { ok: true, value: { gasto, alcance, impresiones, clics } };
}

/**
 * Estado al guardar una campaña: sin presupuesto sale sola (campañas orgánicas); con presupuesto espera al Jefe Local.
 * Si ya estaba aprobada y se sube el presupuesto por sobre lo aprobado, vuelve a pedir aprobación.
 */
export function estadoTrasGuardar(antes, nuevo) {
  if (!antes) return "borrador";
  if (antes.estado === "aprobada" && Number(nuevo.presupuesto) > Number(antes.presupuesto_aprobado || 0)) return "pendiente";
  if (antes.estado === "rechazada") return "borrador";
  return antes.estado;
}

const PERMITIDAS_CAMPANIA = {
  enviar: ["borrador", "rechazada"],
  aprobar: ["pendiente"],
  rechazar: ["pendiente"],
  editar: ["borrador", "pendiente", "rechazada", "aprobada"],
  resultados: ["aprobada", "finalizada"],
  finalizar: ["aprobada"],
  cancelar: ["borrador", "pendiente", "rechazada", "aprobada"],
};
export function validarTransicionCampania(estado, accion) {
  return (PERMITIDAS_CAMPANIA[accion] || []).includes(estado) ? { ok: true } : { ok: false, error: "campania_estado_invalido" };
}

/** Resultado de una campaña cruzando lo anotado con los leads del CRM. `ventas` = Map lead_id -> { monto }. */
export function metricasCampania(campania, leads, ventas = new Map()) {
  const suyos = leads.filter((l) => l.campania_id === campania.id);
  const vendidos = suyos.filter((l) => ventas.has(l.id));
  const gasto = Number(campania.gasto || 0);
  const monto = vendidos.reduce((a, l) => a + Number(ventas.get(l.id).monto || 0), 0);
  const dividir = (a, b) => (b > 0 ? Math.round(a / b) : null);
  return {
    leads: suyos.length, ventas: vendidos.length, monto,
    costoPorLead: dividir(gasto, suyos.length), costoPorVenta: dividir(gasto, vendidos.length),
    conversion: suyos.length > 0 ? Math.round((vendidos.length / suyos.length) * 1000) / 10 : 0,
    consumo: Number(campania.presupuesto_aprobado) > 0 ? Math.round((gasto / Number(campania.presupuesto_aprobado)) * 100) : null,
  };
}

/* ---------- Calendario de contenido ---------- */
export function validarPublicacion(input) {
  const i = input || {};
  const titulo = texto(i.titulo, 120);
  if (titulo.length < 3) return { ok: false, error: "titulo_publicacion_invalido" };
  if (!CANALES.some((c) => c.id === i.red)) return { ok: false, error: "canal_invalido" };
  const tipo = i.tipo || "post";
  if (!TIPOS_PUBLICACION.some((t) => t.id === tipo)) return { ok: false, error: "tipo_publicacion_invalido" };
  const estado = i.estado || "idea";
  if (!ESTADOS_PUBLICACION.some((e) => e.id === estado)) return { ok: false, error: "estado_publicacion_invalido" };
  let fecha = null;
  if (i.fechaProgramada) {
    const t = Date.parse(i.fechaProgramada);
    if (Number.isNaN(t) || t < Date.now() - 400 * DIA || t > Date.now() + 400 * DIA) return { ok: false, error: "fecha_invalida" };
    fecha = new Date(t).toISOString();
  }
  if ((estado === "programada" || estado === "publicada") && !fecha) return { ok: false, error: "fecha_requerida" };
  const url = texto(i.url, 500);
  if (url && !urlHttps(url)) return { ok: false, error: "url_invalida" };
  if (estado === "publicada" && !url && i.exigirUrl) return { ok: false, error: "url_invalida" };
  return {
    ok: true,
    value: {
      titulo, red: i.red, tipo, estado, fecha_programada: fecha, texto: String(i.texto ?? "").replace(/\r/g, "").trim().slice(0, 2000) || null, url: url || null,
      campania_id: i.campaniaId ? String(i.campaniaId) : null, vehiculo_id: i.vehiculoId ? String(i.vehiculoId) : null,
    },
  };
}

/** Programadas cuya fecha ya pasó sin marcarse como publicadas. */
export const publicacionesAtrasadas = (pubs, ahora = new Date()) => pubs.filter((p) => p.estado === "programada" && p.fecha_programada && Date.parse(p.fecha_programada) < ahora.getTime());

export function resumenPublicaciones(pubs) {
  const porEstado = { idea: 0, produccion: 0, programada: 0, publicada: 0, cancelada: 0 };
  const porRed = {};
  for (const p of pubs) {
    porEstado[p.estado] = (porEstado[p.estado] || 0) + 1;
    if (p.estado !== "cancelada") porRed[p.red] = (porRed[p.red] || 0) + 1;
  }
  return { porEstado, porRed, total: pubs.length };
}

/* ---------- Material por vehículo ---------- */
export function validarMaterial(input) {
  const i = input || {};
  if (!i.vehiculoId) return { ok: false, error: "vehiculo_invalido" };
  if (!TIPOS_MATERIAL.some((t) => t.id === i.tipo)) return { ok: false, error: "tipo_material_invalido" };
  const estado = i.estado || "pendiente";
  if (!ESTADOS_MATERIAL.some((e) => e.id === estado)) return { ok: false, error: "estado_material_invalido" };
  const url = texto(i.url, 500);
  if (url && !urlHttps(url)) return { ok: false, error: "url_invalida" };
  if (estado === "listo" && !url) return { ok: false, error: "url_invalida" };
  return { ok: true, value: { vehiculo_id: String(i.vehiculoId), tipo: i.tipo, estado, url: url || null, notas: texto(i.notas, 300) || null } };
}
