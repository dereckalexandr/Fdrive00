// Prospección en Chileautos: reglas puras compartidas por el servidor, la pantalla y las pruebas.
//
// Cómo funciona: la persona busca en Chileautos con su propio navegador, un marcador copia los avisos de esa página y se pegan en el CRM,
// donde se filtran y se ordenan. Los que interesan se guardan como «prospectos»; cuando el dueño responde por Chileautos, el prospecto se
// convierte en un lead de compra. Nada de esto toca los servidores de Chileautos (que bloquean las consultas automáticas).
//
// Datos del vendedor: además del aviso (auto, año, km, precio, tipo de vendedor y enlace) se guarda el teléfono / WhatsApp y el nombre
// que el aviso publica en Chileautos (son públicos), o el que la persona anote a mano. Se usan solo para contactar por la compra del auto.

import { telefonoWa } from "./whatsapp-core.js";

export const FUENTE_PROSPECTO = "chileautos";
export const FUENTE_LEAD_CHILEAUTOS = "Chileautos";
export const MAX_AVISOS_POR_GUARDADO = 100;

export const ESTADOS_PROSPECTO = [
  { id: "nuevo", nombre: "Nuevo" },
  { id: "contactado", nombre: "Contactado en Chileautos" },
  { id: "respondio", nombre: "Respondió" },
  { id: "descartado", nombre: "Descartado" },
  { id: "convertido", nombre: "Convertido en lead" },
];
export const estadoProspectoNombre = (id) => (ESTADOS_PROSPECTO.find((e) => e.id === id) || {}).nombre || id;

const texto = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const entero = (v, min, max) => {
  const n = Number(String(v ?? "").replace(/[^\d-]/g, ""));
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** Teléfono en formato internacional («+56912345678») o null si no sirve. */
export function telefonoProspecto(v) {
  const t = telefonoWa(String(v ?? "").slice(0, 40));
  return t ? `+${t}` : null;
}

/** Datos de contacto que la persona anota o corrige a mano en un prospecto. */
export function validarContactoProspecto(input) {
  const i = input || {};
  const out = {};
  if (i.telefono !== undefined) {
    const raw = String(i.telefono ?? "").trim();
    if (raw) { const t = telefonoProspecto(raw); if (!t) return { ok: false, error: "telefono_invalido" }; out.vendedor_telefono = t; } else out.vendedor_telefono = null;
  }
  if (i.nombre !== undefined) out.vendedor_nombre = texto(i.nombre, 60) || null;
  if (!Object.keys(out).length) return { ok: false, error: "sin_cambios" };
  return { ok: true, value: out };
}

/**
 * Un aviso de los que copia el marcador, limpio y con solo los campos permitidos. Devuelve null si no sirve
 * (sin identificador de Chileautos, sin enlace válido o sin precio).
 */
export function validarAviso(a) {
  if (!a || typeof a !== "object") return null;
  const id = String(a.id ?? "").trim();
  if (!/^[A-Z]{2}-AD-\d{4,15}$/.test(id)) return null;
  const href = String(a.href ?? "").split("?")[0].split("#")[0];
  if (!/^\/vehiculos\/detalles\/[a-z0-9-]{3,200}\/[A-Z]{2}-AD-\d{4,15}\/?$/i.test(href)) return null;
  const precio = entero(a.precio, 1, 2_000_000_000);
  if (precio === null) return null;
  const anio = entero(a.anio, 1950, new Date().getFullYear() + 1);
  const km = entero(a.km, 0, 2_000_000);
  const vendedorTipo = ["particular", "automotora"].includes(String(a.vendedorTipo)) ? String(a.vendedorTipo) : "";
  return {
    aviso_id: id,
    titulo: texto(a.titulo, 90) || id,
    version: texto(a.version, 90) || null,
    anio: anio === null ? null : anio,
    km: km === null ? null : km,
    precio,
    transmision: texto(a.transmision, 20) || null,
    combustible: texto(a.combustible, 20) || null,
    vendedor_tipo: vendedorTipo || null,
    vendedor_nombre: texto(a.vendedorNombre, 60) || null,
    vendedor_telefono: telefonoProspecto(a.telefono),
    destacado: a.destacado === true,
    href: href.endsWith("/") ? href : `${href}/`,
  };
}

/** Lista de avisos a guardar: válidos, sin repetidos, hasta MAX_AVISOS_POR_GUARDADO. */
export function validarAvisos(lista) {
  if (!Array.isArray(lista) || lista.length === 0) return { ok: false, error: "avisos_invalidos" };
  const vistos = new Set();
  const out = [];
  let descartados = 0;
  for (const a of lista.slice(0, 1000)) {
    const v = validarAviso(a);
    if (!v || vistos.has(v.aviso_id)) { descartados++; continue; }
    vistos.add(v.aviso_id);
    if (out.length < MAX_AVISOS_POR_GUARDADO) out.push(v); else descartados++;
  }
  if (!out.length) return { ok: false, error: "avisos_invalidos" };
  return { ok: true, value: out, descartados };
}

/** Cambio de estado de un prospecto, con notas opcionales. */
export function validarEstadoProspecto(input) {
  const i = input || {};
  if (!ESTADOS_PROSPECTO.some((e) => e.id === i.estado)) return { ok: false, error: "estado_invalido" };
  if (i.estado === "convertido") return { ok: false, error: "estado_invalido" }; // solo lo pone la conversión en lead
  const notas = i.notas === undefined ? undefined : texto(i.notas, 500);
  return { ok: true, value: { estado: i.estado, ...(notas === undefined ? {} : { notas: notas || null }) } };
}

/* ---------- Filtros y orden de la lista ---------- */
const sinTildes = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
// Todos los filtros numéricos son enteros (años, kilómetros y pesos): se aceptan los puntos de miles de Chile («7.000.000») y lo que no trae dígitos se ignora.
const num = (v) => { const d = String(v ?? "").replace(/[^\d]/g, ""); return d ? Number(d) : null; };

export const ORDENES_PROSPECTO = [
  { id: "precio_asc", nombre: "Precio: menor a mayor" },
  { id: "precio_desc", nombre: "Precio: mayor a menor" },
  { id: "anio_desc", nombre: "Año: más nuevo primero" },
  { id: "km_asc", nombre: "Kilometraje: menor primero" },
  { id: "bajo_mediana", nombre: "Más baratos que el promedio" },
];

/** Mediana de los precios (más estable que el promedio ante un aviso con precio raro). */
export function medianaPrecio(lista) {
  const p = (lista || []).map((a) => Number(a.precio)).filter((x) => x > 0).sort((a, b) => a - b);
  if (!p.length) return 0;
  const m = Math.floor(p.length / 2);
  return p.length % 2 ? p[m] : Math.round((p[m - 1] + p[m]) / 2);
}
/** Diferencia porcentual de un precio con la mediana: -12 = 12 % más barato. */
export const diferenciaConMediana = (precio, mediana) => (mediana > 0 && precio > 0 ? Math.round(((precio - mediana) / mediana) * 100) : 0);

/**
 * Filtra y ordena los avisos. filtros: { texto, anioDesde, anioHasta, precioMin, precioMax, kmMax, transmision, combustible,
 * vendedor: "particular"|"automotora"|"", sinDestacados, orden }. Cada aviso devuelto trae `vsMediana` (% frente a la mediana del conjunto filtrado).
 */
export function filtrarAvisos(avisos, filtros) {
  const f = filtros || {};
  const q = sinTildes(f.texto), tr = sinTildes(f.transmision), co = sinTildes(f.combustible);
  const aD = num(f.anioDesde), aH = num(f.anioHasta), pMin = num(f.precioMin), pMax = num(f.precioMax), kMax = num(f.kmMax);
  const lista = (avisos || []).filter((a) => {
    const precio = Number(a.precio) || 0;
    if (q && !sinTildes(`${a.titulo} ${a.version || ""}`).includes(q)) return false;
    if (aD !== null && !(Number(a.anio) >= aD)) return false;
    if (aH !== null && !(Number(a.anio) <= aH)) return false;
    if (pMin !== null && precio < pMin) return false;
    if (pMax !== null && precio > pMax) return false;
    if (kMax !== null && !(Number(a.km) <= kMax)) return false;
    if (tr && !sinTildes(a.transmision).includes(tr.slice(0, 5))) return false;
    if (co && !sinTildes(a.combustible).includes(co.slice(0, 4))) return false;
    const vt = a.vendedor_tipo ?? a.vendedorTipo ?? "";
    if (f.vendedor && vt !== f.vendedor) return false;
    if (f.sinDestacados && (a.destacado === true)) return false;
    return true;
  });
  const mediana = medianaPrecio(lista);
  const conDif = lista.map((a) => ({ ...a, vsMediana: diferenciaConMediana(Number(a.precio) || 0, mediana) }));
  const orden = f.orden || "precio_asc";
  const por = {
    precio_asc: (a, b) => a.precio - b.precio,
    precio_desc: (a, b) => b.precio - a.precio,
    anio_desc: (a, b) => (b.anio || 0) - (a.anio || 0) || a.precio - b.precio,
    km_asc: (a, b) => (a.km ?? 1e9) - (b.km ?? 1e9),
    bajo_mediana: (a, b) => a.vsMediana - b.vsMediana,
  }[orden] || ((a, b) => a.precio - b.precio);
  return conDif.sort(por);
}

/* ---------- Del título del aviso a marca y modelo (para convertirlo en lead) ---------- */
const MARCAS_DE_DOS_PALABRAS = ["great wall", "land rover", "alfa romeo", "mercedes benz", "aston martin", "rolls royce", "mg motor", "ds automobiles", "ssang yong"];
/** «2019 Toyota Yaris» → { marca: "Toyota", modelo: "Yaris" }. Es una sugerencia: la persona la puede corregir. */
export function marcaModeloDeTitulo(titulo) {
  const t = texto(titulo, 90).replace(/^(?:19|20)\d{2}\s+/, "");
  const palabras = t.split(" ").filter(Boolean);
  if (!palabras.length) return { marca: "", modelo: "" };
  const dos = palabras.slice(0, 2).join(" ");
  const n = MARCAS_DE_DOS_PALABRAS.includes(sinTildes(dos)) ? 2 : 1;
  return { marca: palabras.slice(0, n).join(" "), modelo: palabras.slice(n).join(" ") };
}

/* ---------- De prospecto a lead de compra ---------- */
const TRANSMISION_LEAD = (t) => (/^manual/i.test(String(t || "")) ? "Mecánica" : /autom|cvt|secuenc/i.test(String(t || "")) ? "Automática" : "");
const COMBUSTIBLE_LEAD = (c) => {
  const x = String(c || "");
  if (/bencina/i.test(x)) return "Bencina";
  if (/di[eé]sel/i.test(x)) return "Diesel";
  if (/h[ií]brid/i.test(x)) return "Híbrido";
  if (/el[eé]ctric/i.test(x)) return "Eléctrico";
  return "";
};
/** El auto del aviso, con los nombres que usa el lead de compra («Manual» → «Mecánica»). La patente la entrega el dueño: no viene en el aviso. */
export function vehiculoOfrecidoDeProspecto(p, { patente, marca, modelo } = {}) {
  return {
    patente: String(patente ?? "").trim(), marca: texto(marca, 40), modelo: texto(modelo, 60), version: texto(p.version, 60) || undefined,
    anio: p.anio || undefined, km: p.km ?? 0, transmision: TRANSMISION_LEAD(p.transmision) || undefined, combustible: COMBUSTIBLE_LEAD(p.combustible) || undefined,
    precioEsperado: p.precio || undefined,
  };
}
/** Enlace para escribir por WhatsApp a un prospecto con teléfono (con un texto de partida sobre el auto). */
export function enlaceWhatsappProspecto(p) {
  const d = String(p.vendedor_telefono || "").replace(/\D/g, "");
  if (!d) return "";
  const t = `Hola, vi tu ${p.titulo || "auto"} publicado en Chileautos. ¿Sigue disponible?`;
  return `https://wa.me/${d}?text=${encodeURIComponent(t)}`;
}
/** Rebaja fija que se propone sobre el precio publicado para ofertar al dueño. */
export const REBAJA_COMPRA_SUGERIDA = 1_500_000;
/** Precio sugerido de compra: el publicado menos la rebaja (nunca bajo cero). */
export const precioSugeridoCompra = (precioPublicado) => Math.max(0, Math.round(Number(precioPublicado) || 0) - REBAJA_COMPRA_SUGERIDA);

/** Nota del lead: de dónde viene y qué precio tenía el aviso. */
export function notasLeadDeProspecto(p) {
  const v = p.vendedor_tipo === "particular" ? "particular" : p.vendedor_tipo === "automotora" ? `automotora${p.vendedor_nombre ? ` ${p.vendedor_nombre}` : ""}` : "";
  const precio = Math.round(Number(p.precio)).toLocaleString("es-CL");
  return `Prospecto de Chileautos${v ? ` (${v})` : ""}: https://www.chileautos.cl${p.href} · precio publicado $${precio} · compra sugerida $${precioSugeridoCompra(p.precio).toLocaleString("es-CL")}`.slice(0, 1000);
}

/** Lo que copia el marcador de ficha: { fuente: "chileautos-ficha", id, telefono }. */
export function parseFichaPegada(texto) {
  let d = null;
  try { d = JSON.parse(String(texto || "").trim()); } catch (e) { d = null; }
  if (!d || d.fuente !== "chileautos-ficha") return { ok: false, error: "Ese texto no viene del marcador de ficha. Úsalo en la página del aviso y pega de nuevo." };
  if (!/^[A-Z]{2}-AD-\d{4,15}$/.test(String(d.id || ""))) return { ok: false, error: "No pude leer qué aviso es. Abre la ficha del aviso y vuelve a pulsar el marcador." };
  const telefono = telefonoProspecto(d.telefono);
  if (!telefono) return { ok: false, error: "El marcador no encontró el teléfono: pulsa «Ver n° de teléfono» en la ficha antes de usarlo." };
  return { ok: true, id: String(d.id), telefono };
}

/** Prospectos en seguimiento a los que aún les falta el teléfono (más recientes primero), sin los saltados. */
export function pendientesDeTelefono(lista, saltados) {
  const sal = saltados instanceof Set ? saltados : new Set(saltados || []);
  return (lista || []).filter((p) => !p.vendedor_telefono && p.estado !== "descartado" && p.estado !== "convertido" && !sal.has(p.id));
}
