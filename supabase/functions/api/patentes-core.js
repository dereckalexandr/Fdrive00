// Consulta de datos de un vehículo por patente (API de Boostr): reglas puras, sin acceso a red ni a datos.
// Lo usan el servidor (ventas.ts) y las pruebas.

export const normalizarPatente = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
/** Patente chilena: 4 letras + 2 dígitos (actual) o 2 letras + 4 dígitos (antigua). */
export const patenteValida = (p) => /^([A-Z]{4}\d{2}|[A-Z]{2}\d{4})$/.test(String(p || ""));

/** Cuánto tiempo se reutiliza una consulta ya hecha (la marca, el modelo y el año de un vehículo no cambian). */
export const DIAS_CACHE = 60;
/** Cupo diario por defecto de consultas reales a Boostr (el plan gratuito permite 5 al día). */
export const LIMITE_DIARIO_DEFECTO = 5;
/** Consultas por minuto que puede hacer una misma persona (frena el uso abusivo del cupo). */
export const LIMITE_POR_MINUTO = 8;

const SIGLAS = new Set(["BMW", "MG", "GMC", "JAC", "BYD", "DFSK", "GAC", "RAM", "KTM", "SEAT", "FAW", "JMC", "UAZ", "DS", "MINI"]);
/** "SUBARU" -> "Subaru", "BMW" -> "BMW", "MERCEDES BENZ" -> "Mercedes Benz". */
export function marcaLegible(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).map((w) => (SIGLAS.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");
}

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export function combustibleLegible(s) {
  const t = sinTildes(s);
  if (!t) return "";
  if (/gasolina|bencina/.test(t)) return "Bencina";
  if (/diesel|petroleo/.test(t)) return "Diesel";
  if (/hibrid/.test(t)) return "Híbrido";
  if (/electric/.test(t)) return "Eléctrico";
  return "";
}
export function transmisionLegible(s) {
  const t = sinTildes(s);
  if (!t) return "";
  if (/manual|mecanic/.test(t)) return "Mecánica";
  if (/auto|cvt|secuencial|dct/.test(t)) return "Automática";
  return "";
}

const texto = (v, max) => (typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * Convierte la respuesta de Boostr en lo que usa el CRM. Nunca devuelve datos del dueño ni el número de chasis.
 * Boostr responde 200 incluso cuando no encuentra la patente (status "error"), así que se mira `status`.
 * @returns {{ ok: true, vehiculo: object } | { ok: false, error: "no_encontrada" | "respuesta_invalida" }}
 */
export function normalizarRespuestaBoostr(json, patente) {
  if (!json || typeof json !== "object") return { ok: false, error: "respuesta_invalida" };
  if (json.status !== "success") {
    const msg = sinTildes(json.message);
    return /no encontramos|no encontrad|no existe|sin datos/.test(msg) || json.code === "V-02" ? { ok: false, error: "no_encontrada" } : { ok: false, error: "respuesta_invalida" };
  }
  const d = json.data;
  if (!d || typeof d !== "object") return { ok: false, error: "no_encontrada" };
  const marca = marcaLegible(texto(d.make, 40));
  const modelo = texto(d.model, 80);
  const anio = Number.parseInt(d.year, 10);
  if (!marca || !modelo) return { ok: false, error: "no_encontrada" };
  const hoy = new Date().getFullYear();
  const v = {
    patente: normalizarPatente(d.plate || patente),
    marca,
    modeloCompleto: modelo,
    anio: Number.isFinite(anio) && anio >= 1900 && anio <= hoy + 1 ? anio : null,
    tipo: texto(d.type, 40),
  };
  // Datos de los planes de pago (si el plan los incluye): se guardan solo los que ayudan a completar formularios.
  const combustible = combustibleLegible(d.gas_type || d.fuel);
  const transmision = transmisionLegible(d.transmission || d.transmision);
  const color = texto(d.color, 30);
  const version = texto(d.version, 80);
  const km = Number.parseInt(d.kilometers, 10);
  if (combustible) v.combustible = combustible;
  if (transmision) v.transmision = transmision;
  if (color) v.color = color;
  if (version) v.version = version;
  if (Number.isFinite(km) && km > 0) v.kmRevisionTecnica = km;
  return { ok: true, vehiculo: v };
}

/** ¿Sigue vigente una consulta guardada? */
export function cacheVigente(registro, ahora = Date.now()) {
  if (!registro || typeof registro !== "object" || !registro.consultadoEn || !registro.vehiculo) return false;
  const t = Date.parse(registro.consultadoEn);
  return Number.isFinite(t) && ahora - t < DIAS_CACHE * 86_400_000 && ahora >= t - 60_000;
}

/** Límite diario efectivo a partir de lo configurado (texto del secreto): entero entre 1 y 10.000; si no es válido, el del plan gratuito. */
export function limiteDiario(valor) {
  const n = Number.parseInt(String(valor ?? ""), 10);
  return Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : LIMITE_DIARIO_DEFECTO;
}
