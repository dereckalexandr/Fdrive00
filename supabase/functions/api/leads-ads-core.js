// Leads que llegan de los formularios de anuncios (Meta Lead Ads y Google Ads): lectura de los avisos y de los datos del formulario.
// Reglas puras (sin red ni base), compartidas por el servidor y las pruebas.
import { telefonoWa } from "./whatsapp-core.js";

export const FUENTE_META = "Meta Ads";
export const FUENTE_GOOGLE = "Google Ads";
export const FUENTES_ANUNCIOS = [FUENTE_META, FUENTE_GOOGLE];

const sinTildes = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const limpio = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const esCorreo = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || ""));

/**
 * Aviso de Meta de un formulario respondido: { object: "page", entry: [{ id: página, changes: [{ field: "leadgen", value: { leadgen_id, form_id, ad_id, page_id } }] }] }.
 * Devuelve los formularios a leer. Ignora otros avisos de la página.
 */
export function parsearAvisoMeta(payload) {
  const out = [];
  if (!payload || payload.object !== "page") return out;
  for (const e of payload.entry || []) {
    for (const c of e.changes || []) {
      if (c.field !== "leadgen" || !c.value) continue;
      const id = String(c.value.leadgen_id || "");
      if (!/^\d{5,30}$/.test(id)) continue;
      out.push({ leadgenId: id, formId: String(c.value.form_id || ""), anuncioId: String(c.value.ad_id || ""), paginaId: String(c.value.page_id || e.id || "") });
    }
  }
  return out;
}

/** Etiqueta legible de una pregunta del formulario: «¿que_auto_te_interesa?» → «¿que auto te interesa?». */
const etiqueta = (nombre) => limpio(String(nombre).replace(/_/g, " "), 80);

function contacto({ nombre, telefono, email }) {
  const tel = telefonoWa(telefono);
  const correo = String(email || "").trim().toLowerCase();
  return { nombre: limpio(nombre, 120), telefono: tel ? `+${tel}` : null, email: esCorreo(correo) ? correo : null };
}

/**
 * Lead de Meta ya leído de la Graph API (/{leadgen_id}): field_data = [{ name, values: [...] }] más los datos del anuncio.
 */
export function datosDeLeadMeta(g) {
  const x = g || {};
  const campos = new Map();
  const extras = [];
  for (const f of x.field_data || []) {
    const nombre = String(f.name || "");
    const valor = limpio(Array.isArray(f.values) ? f.values.join(", ") : f.values, 300);
    if (!nombre || !valor) continue;
    campos.set(sinTildes(nombre), valor);
  }
  const NUCLEO = ["full_name", "first_name", "last_name", "email", "phone_number", "phone", "work_email", "work_phone_number"];
  for (const f of x.field_data || []) {
    const clave = sinTildes(f.name);
    const valor = limpio(Array.isArray(f.values) ? f.values.join(", ") : f.values, 300);
    if (valor && !NUCLEO.includes(clave)) extras.push({ pregunta: etiqueta(f.name), respuesta: valor });
  }
  const nombre = campos.get("full_name") || [campos.get("first_name"), campos.get("last_name")].filter(Boolean).join(" ");
  const c = contacto({ nombre, telefono: campos.get("phone_number") || campos.get("phone") || campos.get("work_phone_number"), email: campos.get("email") || campos.get("work_email") });
  return {
    id: String(x.id || ""), plataforma: "meta", ...c, extras: extras.slice(0, 12),
    campaniaExternaId: x.campaign_id ? String(x.campaign_id) : "", campaniaNombre: limpio(x.campaign_name, 120), anuncio: limpio(x.ad_name, 120), conjunto: limpio(x.adset_name, 120),
    organico: x.is_organic === true, creado: x.created_time || null,
  };
}

const COLUMNAS_GOOGLE = { FULL_NAME: "nombre", FIRST_NAME: "primer", LAST_NAME: "apellido", EMAIL: "email", PHONE_NUMBER: "telefono", WORK_EMAIL: "email", WORK_PHONE: "telefono" };

/** Lead de Google Ads (formulario de clientes potenciales): el aviso trae los datos completos. */
export function datosDeLeadGoogle(b) {
  const x = b || {};
  const base = {}; const extras = [];
  for (const col of x.user_column_data || []) {
    const id = String(col.column_id || "").toUpperCase();
    const valor = limpio(col.string_value, 300);
    if (!valor) continue;
    if (COLUMNAS_GOOGLE[id] && !base[COLUMNAS_GOOGLE[id]]) base[COLUMNAS_GOOGLE[id]] = valor;
    else if (!COLUMNAS_GOOGLE[id]) extras.push({ pregunta: limpio(col.column_name || id.replace(/_/g, " ").toLowerCase(), 80), respuesta: valor });
  }
  const c = contacto({ nombre: base.nombre || [base.primer, base.apellido].filter(Boolean).join(" "), telefono: base.telefono, email: base.email });
  return {
    id: String(x.lead_id || ""), plataforma: "google", ...c, extras: extras.slice(0, 12),
    campaniaExternaId: x.campaign_id ? String(x.campaign_id) : "", campaniaNombre: "", anuncio: "", conjunto: "", organico: false, creado: null,
    prueba: x.is_test === true,
  };
}

/** Un lead sin teléfono ni correo no sirve: no hay cómo contactar a la persona. */
export const tieneContacto = (d) => !!(d.telefono || d.email);

/** Nombre con el que se crea el cliente si el formulario no lo trae. */
export const nombreCliente = (d) => d.nombre || (d.telefono ? `Cliente ${d.telefono.slice(-4)}` : d.email ? d.email.split("@")[0] : "Cliente");

/** Notas del lead: de dónde vino y lo que respondió en el formulario. */
export function notasDeLead(d, plataformaNombre) {
  const lineas = [`Llegó por un formulario de ${plataformaNombre}.`];
  if (d.campaniaNombre) lineas.push(`Campaña: ${d.campaniaNombre}${d.conjunto ? ` · conjunto: ${d.conjunto}` : ""}${d.anuncio ? ` · anuncio: ${d.anuncio}` : ""}.`);
  for (const e of d.extras || []) lineas.push(`${e.pregunta}: ${e.respuesta}`);
  return lineas.join("\n").slice(0, 1000);
}

/** Clave que evita crear dos veces el mismo lead (las plataformas pueden repetir el aviso). */
export const claveLeadExterno = (plataforma, id) => `leadext::${plataforma}::${id}`;
export const claveFalloLead = (plataforma, id) => `leadfallo::${plataforma}::${id}`;
