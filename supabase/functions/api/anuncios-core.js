// Núcleo de los avisos del CRM: cola de vehículos por publicar, avisos por portal, alertas de avisos desactualizados y leads por aviso.
// JavaScript puro (sin APIs de Deno ni del navegador): lo usan el servidor, la pantalla y las pruebas.

/* ---------- Catálogos ---------- */
export const PORTALES = [
  { id: "chileautos", nombre: "Chileautos", url: true },
  { id: "yapo", nombre: "Yapo", url: true },
  { id: "facebook", nombre: "Facebook Marketplace", url: true },
  { id: "sitio_web", nombre: "Sitio web propio", url: false },
  { id: "instagram", nombre: "Instagram", url: true },
  { id: "tiktok", nombre: "TikTok", url: true },
  { id: "otro", nombre: "Otro portal", url: true },
];
export const portalNombre = (id) => (PORTALES.find((p) => p.id === id) || {}).nombre || id;

export const ESTADOS_PORTAL = [
  { id: "pendiente", nombre: "Por publicar" },
  { id: "publicado", nombre: "Publicado" },
  { id: "pausado", nombre: "Pausado" },
  { id: "baja", nombre: "Dado de baja" },
];
export const portalEstadoNombre = (id) => (ESTADOS_PORTAL.find((e) => e.id === id) || {}).nombre || id;

export const ESTADOS_ANUNCIO = [
  { id: "por_publicar", nombre: "Por publicar" },
  { id: "publicado", nombre: "Publicado" },
  { id: "pausado", nombre: "Pausado" },
  { id: "baja", nombre: "Dado de baja" },
];
export const anuncioNombre = (id) => (ESTADOS_ANUNCIO.find((e) => e.id === id) || {}).nombre || id;
export const folioAnuncio = (n) => `AVI-${String(n || 0).padStart(6, "0")}`;

const texto = (v, max) => String(v ?? "").trim().replace(/[ \t]+/g, " ").slice(0, max);
const dinero = (n) => `$${Math.round(Number(n)).toLocaleString("es-CL")}`;
const DIA = 86_400_000;

/* ---------- Texto sugerido desde el inventario ---------- */
export function sugerirAviso(v) {
  const base = [v.marca, v.modelo, v.version, v.anio].filter(Boolean).join(" ");
  const titulo = texto([base, v.km != null ? `${Number(v.km).toLocaleString("es-CL")} km` : "", v.transmision].filter(Boolean).join(" · "), 120);
  const lineas = [`${[v.marca, v.modelo, v.version].filter(Boolean).join(" ")} ${v.anio}`.trim()];
  if (v.km != null) lineas.push(`• Kilometraje: ${Number(v.km).toLocaleString("es-CL")} km`);
  if (v.transmision) lineas.push(`• Transmisión: ${v.transmision}`);
  if (v.combustible) lineas.push(`• Combustible: ${v.combustible}`);
  if (v.color) lineas.push(`• Color: ${v.color}`);
  if (v.precio_lista) lineas.push(`• Precio: ${dinero(v.precio_lista)}`);
  lineas.push("", "Documentos al día. Consulta por financiamiento y recibe tu vehículo en parte de pago. Agenda tu visita.");
  return { titulo, descripcion: lineas.join("\n") };
}

/* ---------- Validaciones ---------- */
export function validarTextoAnuncio(input) {
  const i = input || {};
  const titulo = texto(i.titulo, 120);
  if (titulo.length < 5) return { ok: false, error: "titulo_aviso_invalido" };
  const descripcion = String(i.descripcion ?? "").replace(/\r/g, "").trim().slice(0, 2000);
  if (descripcion.length < 10) return { ok: false, error: "descripcion_invalida" };
  return { ok: true, value: { titulo, descripcion } };
}

export const urlValida = (u) => /^https:\/\/[^\s/$.?#][^\s]*$/i.test(String(u || "")) && String(u).length <= 500;

/** Publicación en un portal: estado, enlace y vencimiento. */
export function validarPortal(input) {
  const i = input || {};
  const portal = PORTALES.find((p) => p.id === i.portal);
  if (!portal) return { ok: false, error: "portal_invalido" };
  const estado = String(i.estado || "");
  if (!ESTADOS_PORTAL.some((e) => e.id === estado)) return { ok: false, error: "estado_portal_invalido" };
  const url = texto(i.url, 500);
  if (estado === "publicado" && portal.url && !urlValida(url)) return { ok: false, error: "url_invalida" };
  if (url && !urlValida(url)) return { ok: false, error: "url_invalida" };
  let venceEn = null;
  if (i.venceEn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(i.venceEn)) || Number.isNaN(Date.parse(`${i.venceEn}T12:00:00Z`))) return { ok: false, error: "fecha_invalida" };
    venceEn = String(i.venceEn);
  }
  return { ok: true, value: { portal: portal.id, estado, url: url || null, venceEn } };
}

/** ¿Puede crearse el aviso de este vehículo? Solo disponibles y activos; con Validadores, solo con documentos aprobados. */
export function elegibleParaAviso(vehiculo, { exigeValidacion, validacionEstado } = {}) {
  if (!vehiculo || vehiculo.activo === false) return { ok: false, error: "vehiculo_no_disponible" };
  if (vehiculo.estado !== "disponible") return { ok: false, error: "vehiculo_no_disponible" };
  if (exigeValidacion && validacionEstado !== "aprobada") return { ok: false, error: "vehiculo_sin_validar" };
  return { ok: true };
}

/** Estado del aviso a partir de sus portales. */
export function estadoDeAnuncio(portales) {
  const l = portales || [];
  if (l.some((p) => p.estado === "publicado")) return "publicado";
  if (l.some((p) => p.estado === "pausado")) return "pausado";
  if (l.length > 0 && l.every((p) => p.estado === "baja")) return "baja";
  return "por_publicar";
}

/* ---------- Alertas de avisos desactualizados ---------- */
/**
 * Cosas que el Anunciante debe corregir. Solo cuentan los portales con el aviso publicado o pausado.
 * Devuelve [{ tipo, portal, texto, grave }].
 */
export function alertasAnuncio(portales, vehiculo, ahora = new Date(), diasAviso = 3) {
  const out = [];
  for (const p of portales || []) {
    if (p.estado !== "publicado" && p.estado !== "pausado") continue;
    const nombre = portalNombre(p.portal);
    const v = vehiculo || {};
    if (p.estado === "publicado") {
      if (v.estado === "vendido" || v.activo === false) out.push({ tipo: "vendido", portal: p.portal, grave: true, texto: `${nombre}: el vehículo ya no está a la venta. Da de baja el aviso.` });
      else if (v.estado === "reservado") out.push({ tipo: "reservado", portal: p.portal, grave: false, texto: `${nombre}: el vehículo está reservado. Pausa el aviso.` });
      else if (v.estado === "preparacion") out.push({ tipo: "reservado", portal: p.portal, grave: false, texto: `${nombre}: el vehículo volvió a preparación. Pausa el aviso.` });
      else if (v.precio_lista != null && p.precio_publicado != null && Number(v.precio_lista) !== Number(p.precio_publicado)) {
        out.push({ tipo: "precio", portal: p.portal, grave: true, texto: `${nombre}: el aviso dice ${dinero(p.precio_publicado)} y el precio de lista es ${dinero(v.precio_lista)}. Corrígelo.` });
      }
    }
    if (p.vence_en) {
      const dias = Math.ceil((Date.parse(`${p.vence_en}T23:59:59Z`) - ahora.getTime()) / DIA);
      if (dias < 0) out.push({ tipo: "vencido", portal: p.portal, grave: true, texto: `${nombre}: el aviso venció hace ${-dias} día(s). Renuévalo.` });
      else if (dias <= diasAviso) out.push({ tipo: "vence", portal: p.portal, grave: false, texto: `${nombre}: el aviso vence ${dias === 0 ? "hoy" : `en ${dias} día(s)`}. Renuévalo.` });
    }
  }
  return out;
}

/* ---------- Consultas por aviso ---------- */
const fuenteDePortal = (fuente) => {
  const f = String(fuente || "").trim().toLowerCase();
  const p = PORTALES.find((x) => x.nombre.toLowerCase() === f || x.id === f || (x.id === "sitio_web" && f === "sitio web"));
  return p ? p.id : null;
};

/** Cuenta los leads de un vehículo, en total y por portal (según la fuente del lead). `desde` = ISO (opcional). */
export function consultasDeVehiculo(leads, vehiculoId, desde = null) {
  const suyos = leads.filter((l) => l.vehiculo_id === vehiculoId && (!desde || l.creado_en >= desde));
  const porPortal = {};
  let otras = 0;
  for (const l of suyos) {
    const p = fuenteDePortal(l.fuente);
    if (p) porPortal[p] = (porPortal[p] || 0) + 1; else otras++;
  }
  return { total: suyos.length, porPortal, otras };
}

/** Resumen del local: avisos por estado, publicaciones por portal y vencimientos próximos. */
export function resumenAvisos(anuncios, portales) {
  const porEstado = { por_publicar: 0, publicado: 0, pausado: 0, baja: 0 };
  for (const a of anuncios) porEstado[a.estado] = (porEstado[a.estado] || 0) + 1;
  const porPortal = {};
  for (const p of portales) {
    if (p.estado !== "publicado") continue;
    porPortal[p.portal] = (porPortal[p.portal] || 0) + 1;
  }
  return { porEstado, porPortal, total: anuncios.length };
}
