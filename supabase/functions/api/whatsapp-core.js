// WhatsApp Business (Cloud API de Meta): reglas puras, compartidas por el servidor, la pantalla y las pruebas.
// Nada aquí habla con Meta ni con la base: solo interpreta, valida y arma.

/** Ventana de atención: después del último mensaje del cliente se puede responder libremente durante 24 horas. */
export const VENTANA_MS = 24 * 3_600_000;
/** Tamaño máximo de un archivo que el CRM guarda o envía (bytes). */
export const MAX_BYTES_MEDIA = 5 * 1024 * 1024;
export const MAX_TEXTO_WA = 4096;
/** Archivos que un ejecutivo puede enviar: fotos (JPG/PNG) y PDF. */
// Audio que WhatsApp acepta (los navegadores graban en ogg/opus o mp4/aac): se envía como nota de voz.
export const TIPOS_AUDIO = ["audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/amr"];
export const TIPOS_ENVIABLES = ["image/jpeg", "image/png", "application/pdf", ...TIPOS_AUDIO];
export const FUENTE_WHATSAPP = "WhatsApp";

const soloDigitos = (s) => String(s ?? "").replace(/\D/g, "");

/**
 * Número en formato internacional (solo dígitos) para WhatsApp. Un celular chileno escrito sin código de país
 * (912345678, o el antiguo de 8 dígitos) se completa con 56. Devuelve null si no parece un número.
 */
export function telefonoWa(raw) {
  let d = soloDigitos(raw);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 9 && d.startsWith("9")) return `56${d}`;
  if (d.length === 8) return `569${d}`;
  if (d.length === 11 && d.startsWith("56")) return d;
  if (d.length >= 10 && d.length <= 15) return d;
  return null;
}

/** ¿Dos números escritos de distinta forma son el mismo teléfono? */
export function mismoTelefono(a, b) {
  const x = telefonoWa(a);
  return !!x && x === telefonoWa(b);
}

/** Número para mostrar: +56 9 1234 5678. */
export function telefonoVisible(t) {
  const d = telefonoWa(t) || soloDigitos(t);
  if (d.length === 11 && d.startsWith("569")) return `+56 9 ${d.slice(3, 7)} ${d.slice(7)}`;
  return d ? `+${d}` : "";
}

/** Nombre con el que se crea el cliente que escribió por primera vez. */
export function nombreDesdePerfil(perfil, telefono) {
  const n = String(perfil ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return n.length >= 2 ? n : `WhatsApp ${telefonoVisible(telefono)}`.trim();
}

const ESTADOS = { sent: "enviado", delivered: "entregado", read: "leido", failed: "fallido" };
const RANGO = { enviado: 1, entregado: 2, leido: 3 };

/** Los avisos de estado pueden llegar desordenados: un mensaje leído no vuelve a «entregado». Un fallo siempre se anota. */
export function estadoSiguiente(actual, nuevo) {
  if (!nuevo) return actual;
  if (nuevo === "fallido") return "fallido";
  if (actual === "fallido") return actual;
  return (RANGO[nuevo] || 0) > (RANGO[actual] || 0) ? nuevo : actual;
}

const isoDe = (ts) => {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
};

/** Interpreta un mensaje entrante del aviso de Meta. */
function mensajeEntrante(m, nombres, phoneNumberId) {
  const tipo = String(m.type || "otro");
  let texto = "";
  let media = null;
  const conMedia = (o, extra = {}) => (o && o.id ? { id: String(o.id), mime: String(o.mime_type || ""), ...extra } : null);
  if (tipo === "text") texto = (m.text && m.text.body) || "";
  else if (tipo === "image") { media = conMedia(m.image); texto = (m.image && m.image.caption) || ""; }
  else if (tipo === "document") { media = conMedia(m.document, { nombre: String((m.document && m.document.filename) || "documento").slice(0, 120) }); texto = (m.document && m.document.caption) || ""; }
  else if (tipo === "audio") media = conMedia(m.audio);
  else if (tipo === "video") { media = conMedia(m.video); texto = (m.video && m.video.caption) || ""; }
  else if (tipo === "sticker") media = conMedia(m.sticker);
  else if (tipo === "location") {
    const l = m.location || {};
    texto = [l.name, l.address, l.latitude != null && l.longitude != null ? `https://maps.google.com/?q=${l.latitude},${l.longitude}` : ""].filter(Boolean).join(" · ");
  } else if (tipo === "button") texto = (m.button && (m.button.text || m.button.payload)) || "";
  else if (tipo === "interactive") {
    const i = m.interactive || {};
    texto = (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || "";
  } else if (tipo === "reaction") texto = m.reaction && m.reaction.emoji ? `Reaccionó ${m.reaction.emoji}` : "Quitó una reacción";
  else if (tipo === "contacts") texto = (m.contacts || []).map((c) => (c.name && c.name.formatted_name) || "").filter(Boolean).join(", ") || "Compartió un contacto";
  else texto = "Mensaje no compatible (ábrelo en el teléfono)";
  const telefono = telefonoWa(m.from) || soloDigitos(m.from);
  return {
    wamid: String(m.id || ""), telefono, nombre: nombres[soloDigitos(m.from)] || "", ts: isoDe(m.timestamp),
    tipo: ["text", "image", "document", "audio", "video", "sticker", "location", "reaction"].includes(tipo) ? tipo : tipo === "button" || tipo === "interactive" ? "text" : "otro",
    texto: String(texto).slice(0, MAX_TEXTO_WA), media, phoneNumberId,
  };
}

/**
 * Lo que trae un aviso (webhook) de WhatsApp: mensajes entrantes y cambios de estado de los mensajes enviados.
 * Ignora cualquier otro campo.
 */
export function parsearWebhook(payload) {
  const mensajes = [];
  const estados = [];
  for (const e of (payload && payload.entry) || []) {
    for (const ch of e.changes || []) {
      if (ch.field !== "messages" || !ch.value) continue;
      const v = ch.value;
      const phoneNumberId = String((v.metadata && v.metadata.phone_number_id) || "");
      const nombres = {};
      for (const c of v.contacts || []) nombres[soloDigitos(c.wa_id)] = (c.profile && c.profile.name) || "";
      for (const m of v.messages || []) if (m && m.id && m.from) mensajes.push(mensajeEntrante(m, nombres, phoneNumberId));
      for (const s of v.statuses || []) {
        if (!s || !s.id) continue;
        const err = (s.errors || [])[0];
        estados.push({
          wamid: String(s.id), estado: ESTADOS[s.status] || null, ts: isoDe(s.timestamp), phoneNumberId,
          error: err ? String(`${err.title || err.message || "Error"}${err.error_data && err.error_data.details ? `: ${err.error_data.details}` : ""} (${err.code ?? ""})`).slice(0, 300) : null,
        });
      }
    }
  }
  return { mensajes, estados };
}

/** ¿Sigue abierta la ventana de 24 horas para responder sin plantilla? */
export function ventanaAbierta(ultimoEntrante, ahora = new Date()) {
  const t = Date.parse(ultimoEntrante || "");
  return Number.isFinite(t) && ahora.getTime() - t < VENTANA_MS;
}
/** Hasta cuándo se puede responder sin plantilla (o null). */
export function venceVentana(ultimoEntrante) {
  const t = Date.parse(ultimoEntrante || "");
  return Number.isFinite(t) ? new Date(t + VENTANA_MS).toISOString() : null;
}

export function validarTextoWa(t) {
  const s = String(t ?? "").replace(/\r\n/g, "\n").trim();
  if (!s) return { ok: false, error: "mensaje_vacio" };
  if (s.length > MAX_TEXTO_WA) return { ok: false, error: "mensaje_muy_largo" };
  return { ok: true, value: s };
}

/** Texto corto para la lista de conversaciones. */
export function resumenMensaje(m) {
  const t = String((m && m.texto) || "").replace(/\s+/g, " ").trim();
  const pre = { image: "📷 Foto", document: `📄 ${(m && m.media && m.media.nombre) || "Documento"}`, audio: "🎤 Audio", video: "🎬 Video", sticker: "Sticker", location: "📍 Ubicación", template: "Plantilla" }[m && m.tipo];
  const s = pre ? (t && m.tipo !== "template" ? `${pre}: ${t}` : m.tipo === "template" && t ? t : pre) : t;
  return s.slice(0, 120);
}

/** Variables de un texto de plantilla: {{1}}, {{2}}… o con nombre {{nombre_cliente}}, en el orden en que aparecen. */
export function variablesDe(texto) {
  const out = [];
  for (const m of String(texto || "").matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/**
 * Plantillas que se pueden enviar desde el CRM: aprobadas y con variables solo en el cuerpo
 * (encabezado de texto fijo o sin encabezado; botones sin variables). Las demás se envían desde WhatsApp Manager.
 */
export function plantillasUsables(lista) {
  const out = [];
  for (const t of lista || []) {
    if (!t || t.status !== "APPROVED") continue;
    const comps = t.components || [];
    const body = comps.find((c) => c.type === "BODY");
    if (!body || !body.text) continue;
    const header = comps.find((c) => c.type === "HEADER");
    if (header && (header.format !== "TEXT" || variablesDe(header.text).length > 0)) continue;
    const botones = (comps.find((c) => c.type === "BUTTONS") || {}).buttons || [];
    if (botones.some((b) => variablesDe(b.url || "").length > 0)) continue;
    const footer = comps.find((c) => c.type === "FOOTER");
    const variables = variablesDe(body.text);
    out.push({
      nombre: String(t.name), idioma: String(t.language || "es"), categoria: String(t.category || ""),
      encabezado: header ? String(header.text || "") : "", cuerpo: String(body.text), pie: footer ? String(footer.text || "") : "",
      botones: botones.map((b) => String(b.text || "")).filter(Boolean),
      variables, nombradas: variables.some((v) => !/^\d+$/.test(v)),
    });
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * Arma el envío de una plantilla con los valores que escribió el ejecutivo.
 * WhatsApp no acepta saltos de línea, tabulaciones ni más de 4 espacios seguidos en las variables.
 */
export function armarPlantilla(p, valores) {
  const vals = (valores || []).map((v) => String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {5,}/g, "    ").trim());
  if (vals.length < p.variables.length || p.variables.some((_, i) => !vals[i])) return { ok: false, error: "plantilla_variables" };
  if (vals.some((v) => v.length > 1024)) return { ok: false, error: "plantilla_variables" };
  const componentes = p.variables.length === 0 ? [] : [{
    type: "body",
    parameters: p.variables.map((nombre, i) => (p.nombradas ? { type: "text", parameter_name: nombre, text: vals[i] } : { type: "text", text: vals[i] })),
  }];
  let texto = p.cuerpo;
  p.variables.forEach((nombre, i) => { texto = texto.split(new RegExp(`\\{\\{\\s*${nombre}\\s*\\}\\}`)).join(vals[i]); });
  return { ok: true, componentes, texto: [p.encabezado, texto, p.pie].filter(Boolean).join("\n").slice(0, MAX_TEXTO_WA) };
}

/** Archivo que el ejecutivo quiere enviar: { nombre, tipo, dataUrl }. */
export function validarArchivoWa(a) {
  if (!a || typeof a.dataUrl !== "string") return { ok: false, error: "archivo_invalido" };
  // Se acepta «data:audio/ogg;codecs=opus;base64,…»: los parámetros del tipo se descartan.
  const m = /^data:([^;,]+)((?:;[^;,]*)*?);base64,([A-Za-z0-9+/=]+)$/.exec(a.dataUrl);
  if (!m) return { ok: false, error: "archivo_invalido" };
  const mime = m[1].toLowerCase();
  if (!TIPOS_ENVIABLES.includes(mime)) return { ok: false, error: "archivo_tipo_invalido" };
  const base64 = m[3];
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes > MAX_BYTES_MEDIA) return { ok: false, error: "archivo_muy_grande" };
  const tipo = mime === "application/pdf" ? "document" : TIPOS_AUDIO.includes(mime) ? "audio" : "image";
  const porDefecto = tipo === "document" ? "documento.pdf" : tipo === "audio" ? (mime === "audio/ogg" ? "nota-de-voz.ogg" : "nota-de-voz.m4a") : "foto.jpg";
  const nombre = String(a.nombre || porDefecto).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
  return { ok: true, value: { mime, base64, bytes, nombre, tipo } };
}

/* ---------- Plantillas creadas desde el CRM (se envían a Meta para su aprobación) ---------- */
export const CATEGORIAS_PLANTILLA = [
  { id: "UTILITY", nombre: "Servicio (avisos de una gestión en curso: visitas, cotizaciones, documentos)" },
  { id: "MARKETING", nombre: "Marketing (ofertas, nuevos vehículos, promociones)" },
];
export const ESTADOS_PLANTILLA = { APPROVED: "Aprobada", PENDING: "En revisión", IN_APPEAL: "En apelación", REJECTED: "Rechazada", PAUSED: "Pausada", DISABLED: "Deshabilitada", PENDING_DELETION: "Borrándose" };

/** Nombre técnico de la plantilla: minúsculas, números y guion bajo (Meta no acepta otra cosa). */
export function nombrePlantilla(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

/**
 * Valida una plantilla nueva y la arma como la pide la API de Meta.
 * input: { nombre, categoria, encabezado?, cuerpo, pie?, botones?: string[], ejemplos?: string[] }
 * Las variables van numeradas {{1}}, {{2}}… en el cuerpo, en orden, y cada una necesita un ejemplo (Meta lo exige para revisarla).
 */
export function validarPlantillaNueva(input) {
  const i = input || {};
  const name = nombrePlantilla(i.nombre);
  if (name.length < 3) return { ok: false, error: "plantilla_nombre" };
  const category = String(i.categoria || "");
  if (!CATEGORIAS_PLANTILLA.some((c) => c.id === category)) return { ok: false, error: "plantilla_categoria" };
  const cuerpo = String(i.cuerpo || "").replace(/\r\n/g, "\n").trim();
  if (cuerpo.length < 10 || cuerpo.length > 1024) return { ok: false, error: "plantilla_cuerpo" };
  const vars = variablesDe(cuerpo);
  if (vars.some((v) => !/^\d+$/.test(v))) return { ok: false, error: "plantilla_variables_numeradas" };
  // Numeradas desde 1 y sin saltos, en el orden en que aparecen.
  if (vars.some((v, k) => Number(v) !== k + 1)) return { ok: false, error: "plantilla_variables_numeradas" };
  // Meta rechaza plantillas que empiezan o terminan con una variable.
  if (/^\{\{\s*\d+\s*\}\}/.test(cuerpo) || /\{\{\s*\d+\s*\}\}[.!?\s]*$/.test(cuerpo)) return { ok: false, error: "plantilla_variable_borde" };
  const ejemplos = (i.ejemplos || []).map((e) => String(e || "").replace(/[\r\n\t]+/g, " ").trim());
  if (vars.length && (ejemplos.length < vars.length || vars.some((_, k) => !ejemplos[k]))) return { ok: false, error: "plantilla_ejemplos" };
  const encabezado = String(i.encabezado || "").replace(/\s+/g, " ").trim();
  if (encabezado.length > 60 || variablesDe(encabezado).length) return { ok: false, error: "plantilla_encabezado" };
  const pie = String(i.pie || "").replace(/\s+/g, " ").trim();
  if (pie.length > 60 || variablesDe(pie).length) return { ok: false, error: "plantilla_pie" };
  const botones = (i.botones || []).map((b) => String(b || "").trim()).filter(Boolean);
  if (botones.length > 3 || botones.some((b) => b.length > 25)) return { ok: false, error: "plantilla_botones" };

  const components = [];
  if (encabezado) components.push({ type: "HEADER", format: "TEXT", text: encabezado });
  components.push({ type: "BODY", text: cuerpo, ...(vars.length ? { example: { body_text: [ejemplos.slice(0, vars.length)] } } : {}) });
  if (pie) components.push({ type: "FOOTER", text: pie });
  if (botones.length) components.push({ type: "BUTTONS", buttons: botones.map((text) => ({ type: "QUICK_REPLY", text })) });
  return { ok: true, value: { name, language: "es", category, parameter_format: "POSITIONAL", components } };
}

/** Lista para la pantalla de administración: todas las plantillas con su estado y, si fue rechazada, el motivo. */
export function plantillasParaAdmin(lista) {
  return (lista || []).map((t) => {
    const comps = t.components || [];
    const parte = (tipo) => (comps.find((c) => c.type === tipo) || {}).text || "";
    return {
      id: String(t.id || ""), nombre: String(t.name || ""), idioma: String(t.language || ""), categoria: String(t.category || ""),
      estado: String(t.status || ""), estadoNombre: ESTADOS_PLANTILLA[t.status] || String(t.status || ""), motivo: t.rejected_reason && t.rejected_reason !== "NONE" ? String(t.rejected_reason) : "",
      encabezado: parte("HEADER"), cuerpo: parte("BODY"), pie: parte("FOOTER"), botones: ((comps.find((c) => c.type === "BUTTONS") || {}).buttons || []).map((b) => String(b.text || "")),
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/* ---------- Respuestas rápidas (textos guardados que el ejecutivo inserta en la conversación) ---------- */
export const MAX_RESPUESTAS = 40;
/** Sugeridas mientras el local no guarde las suyas. */
export const RESPUESTAS_SUGERIDAS = [
  { titulo: "Saludo", texto: "Hola {cliente}, soy {ejecutivo} de Drive Futuro. ¿En qué te puedo ayudar?" },
  { titulo: "Ubicación del local", texto: "Te esperamos en nuestro local. ¿Quieres que te envíe la ubicación en el mapa?" },
  { titulo: "Horario de atención", texto: "Atendemos de lunes a viernes de 10:00 a 19:00 y los sábados de 10:00 a 14:00." },
  { titulo: "Pedir datos para cotizar", texto: "Para enviarte una cotización necesito tu nombre completo, RUT y si tienes un auto para dejar en parte de pago." },
  { titulo: "Agendar visita", texto: "¿Qué día y hora te acomoda para venir a ver el vehículo? Te lo dejo reservado para ese momento." },
  { titulo: "Gracias", texto: "¡Gracias {cliente}! Cualquier duda, escríbeme por aquí." },
];

/** Valida la lista completa que guarda el Administrador o el Jefe Local. */
export function validarRespuestas(lista) {
  if (!Array.isArray(lista)) return { ok: false, error: "respuestas_invalidas" };
  if (lista.length > MAX_RESPUESTAS) return { ok: false, error: "respuestas_demasiadas" };
  const out = [];
  for (const r of lista) {
    const titulo = String((r && r.titulo) || "").replace(/\s+/g, " ").trim();
    const texto = String((r && r.texto) || "").replace(/\r\n/g, "\n").trim();
    if (titulo.length < 2 || titulo.length > 40) return { ok: false, error: "respuesta_titulo" };
    if (texto.length < 2 || texto.length > 1000) return { ok: false, error: "respuesta_texto" };
    out.push({ titulo, texto });
  }
  return { ok: true, value: out };
}

/** Reemplaza {cliente} (su primer nombre) y {ejecutivo} en el texto de una respuesta rápida. */
export function aplicarRespuesta(texto, { cliente = "", ejecutivo = "" } = {}) {
  const primero = (s) => String(s || "").trim().split(/\s+/)[0] || "";
  return String(texto || "")
    .replace(/\{cliente\}/gi, primero(cliente) || "")
    .replace(/\{ejecutivo\}/gi, primero(ejecutivo) || "")
    .replace(/ +([,.!?])/g, "$1")
    .replace(/ {2,}/g, " ");
}

/* ---------- Etiquetas de las conversaciones ---------- */
export const MAX_ETIQUETAS = 5;
export const ETIQUETAS_SUGERIDAS = ["Caliente", "Financiamiento", "Parte de pago", "Pidió fotos", "Visita agendada", "Sin respuesta", "Postventa"];
/** Etiquetas de una conversación: hasta 5, de 2 a 20 caracteres, sin repetir (sin importar mayúsculas). */
export function validarEtiquetas(lista) {
  if (!Array.isArray(lista)) return { ok: false, error: "etiquetas_invalidas" };
  const out = [];
  for (const x of lista) {
    const t = String(x ?? "").replace(/\s+/g, " ").trim();
    if (t.length < 2 || t.length > 20) return { ok: false, error: "etiquetas_invalidas" };
    if (!out.some((y) => y.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  if (out.length > MAX_ETIQUETAS) return { ok: false, error: "etiquetas_invalidas" };
  return { ok: true, value: out };
}
