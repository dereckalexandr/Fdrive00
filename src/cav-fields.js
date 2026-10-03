/**
 * ANÁLISIS DE CAMPOS DEL CAV (sin dependencias, probable en Node)
 * ----------------------------------------------------------------
 * Recibe el texto ya extraído del PDF (una línea visual por línea) y
 * devuelve los campos que logra identificar.
 *
 * Formatos que soporta (ambos aparecen según cómo pdf.js agrupe el texto):
 *   A) Valor en la misma línea:   "Marca : TOYOTA"
 *   B) Valor en la línea siguiente: "Marca   :  "  /  "TOYOTA"
 * Además tolera espacios múltiples ("STATION   WAGON"), tildes y
 * mayúsculas/minúsculas en las etiquetas, y varias parejas etiqueta:valor
 * en una misma línea ("STATION WAGON  Año : 2025").
 * ----------------------------------------------------------------
 */

// Etiquetas conocidas por campo, de más a menos específicas.
export const CAV_FIELD_DEFS = [
  { key: "inscripcion", labels: ["INSCRIPCION", "N DE INSCRIPCION", "NUMERO DE INSCRIPCION", "PLACA PATENTE UNICA", "PLACA UNICA", "PATENTE", "PPU"] },
  { key: "marca", labels: ["MARCA"] },
  { key: "modelo", labels: ["MODELO"] },
  { key: "nroMotor", labels: ["NRO. MOTOR", "NRO MOTOR", "N DE MOTOR", "NUMERO DE MOTOR", "N MOTOR", "MOTOR N", "MOTOR"], compact: true },
  { key: "nroChasis", labels: ["NRO. CHASIS", "NRO CHASIS", "N DE CHASIS", "NUMERO DE CHASIS", "N CHASIS", "CHASIS N", "CHASIS"], compact: true },
  { key: "nroSerie", labels: ["NRO. SERIE", "NRO SERIE", "N DE SERIE", "NUMERO DE SERIE", "N SERIE", "SERIE N", "SERIE"], compact: true },
  { key: "nroVin", labels: ["NRO. VIN", "NRO VIN", "N DE VIN", "NUMERO DE VIN", "N VIN", "VIN N", "VIN"], compact: true },
  { key: "color", labels: ["COLOR PRINCIPAL", "COLOR DEL VEHICULO", "COLOR"] },
  { key: "propietarioNombre", labels: ["NOMBRE DEL PROPIETARIO", "NOMBRE O RAZON SOCIAL", "NOMBRE COMPLETO", "NOMBRE"] },
  { key: "propietarioRun", labels: ["R.U.N.", "RUN DEL PROPIETARIO", "RUN", "RUT DEL PROPIETARIO", "RUT"], compact: true },
];

// Etiquetas del CAV que NO se capturan, pero sirven para saber dónde termina
// un valor ("STATION WAGON  Año : 2025") o que una línea es una etiqueta.
const STOP_LABELS = [
  "TIPO VEHICULO", "ANO", "COMBUSTIBLE", "PBV", "INSTIT. ASEG.", "NUMERO POLIZA",
  "FEC. VEN. POL.", "FEC. ADQUISICION", "REPERTORIO", "NUMERO", "FOLIO",
  "FECHA EMISION", "CODIGO VERIFICACION", "REGION", "VALOR PAGADO", "IMPRESO EN",
];

/**
 * Normaliza una línea para comparar: sin tildes, en mayúsculas, sin "°/º",
 * con espacios colapsados. Devuelve también `map`: para cada carácter del
 * texto normalizado, su posición en el texto original (para recortar el
 * valor con su capitalización y tildes originales).
 */
function normalizeWithMap(line) {
  const src = String(line).normalize("NFC");
  let norm = "";
  const map = [];
  let lastWasSpace = true; // elimina espacios iniciales
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    if (ch === "°" || ch === "º") continue;
    ch = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      ch = " ";
      lastWasSpace = true;
    } else {
      lastWasSpace = false;
    }
    norm += ch;
    for (let k = 0; k < ch.length; k++) map.push(i);
  }
  return { norm, map, src };
}

const normLabel = (l) => normalizeWithMap(l).norm;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ALL_CAPTURED = CAV_FIELD_DEFS.flatMap((f) => f.labels.map(normLabel));
const ALL_LABELS = [...new Set([...ALL_CAPTURED, ...STOP_LABELS.map(normLabel)])].sort((a, b) => b.length - a.length);

// "<etiqueta> :" donde sea que aparezca dentro de un valor (con borde de palabra delante)
const LABEL_ANYWHERE_RE = new RegExp(`(?:^|\\s)(?:${ALL_LABELS.map(escapeRe).join("|")})\\s*:`);
// Línea que EMPIEZA con una etiqueta conocida seguida de ":"
const LABEL_AT_START_RE = new RegExp(`^(?:${ALL_LABELS.map(escapeRe).join("|")})\\s*:`);

// RUN/RUT chileno con puntos y guión (ej. "15.376.859-5"), usado como respaldo.
const RUN_PATTERN = /\b(\d{1,2}\.\d{3}\.\d{3}-[\dkK])\b/;

// Divide una línea en segmentos donde aparece una etiqueta conocida seguida de ":"
// ("Marca : X Modelo : Y" -> "Marca : X", "Modelo : Y"). El texto previo a la
// primera etiqueta queda como segmento aparte (p. ej. "STATION WAGON").
const LABEL_GLOBAL_RE = new RegExp(LABEL_ANYWHERE_RE.source, "g");
function splitSegments(nl) {
  const cuts = [];
  for (const m of nl.norm.matchAll(LABEL_GLOBAL_RE)) {
    const at = m.index + (nl.norm[m.index] === " " ? 1 : 0);
    if (at > 0) cuts.push(at);
  }
  if (cuts.length === 0) return [nl];
  const bounds = [0, ...cuts, nl.norm.length];
  const out = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = nl.map[bounds[i]];
    const to = bounds[i + 1] >= nl.norm.length ? nl.src.length : nl.map[bounds[i + 1]];
    const seg = normalizeWithMap(nl.src.slice(from, to));
    if (seg.norm.length) out.push(seg);
  }
  return out;
}

const collapse = (s) => s.replace(/\s+/g, " ").trim();

// Texto del valor a partir de una posición de la línea normalizada.
function valueFrom(nl, startNorm) {
  let value = nl.src.slice(nl.map[startNorm] ?? nl.src.length);
  // Corta donde empieza otra etiqueta conocida dentro de la misma línea.
  const rest = nl.norm.slice(startNorm);
  const m = rest.match(LABEL_ANYWHERE_RE);
  if (m && m.index !== undefined) {
    // el borde de palabra puede ser un espacio: apunta al primer carácter de la etiqueta
    const cutNorm = startNorm + m.index + (rest[m.index] === " " ? 1 : 0);
    value = nl.src.slice(nl.map[startNorm] ?? 0, nl.map[cutNorm] ?? nl.src.length);
  }
  return collapse(value);
}

/**
 * Busca los campos de CAV_FIELD_DEFS. Devuelve solo los encontrados.
 */
export function parseCavFields(rawText) {
  if (!rawText) return {};
  const lines = String(rawText).split(/\n+/).map(normalizeWithMap).flatMap(splitSegments).filter((l) => l.norm.length > 0);
  const result = {};

  for (const field of CAV_FIELD_DEFS) {
    const labels = [...field.labels].map(normLabel).sort((a, b) => b.length - a.length);

    search: for (let i = 0; i < lines.length; i++) {
      const nl = lines[i];
      for (const label of labels) {
        if (!nl.norm.startsWith(label)) continue;
        const after = nl.norm.slice(label.length);
        const colon = after.match(/^\s*:/);
        if (!colon) continue; // sin ":" no es un campo (p. ej. un título)

        const startNorm = label.length + colon[0].length;
        let value = valueFrom(nl, startNorm);

        // Formato B: el valor viene en la línea siguiente.
        if (!value && i + 1 < lines.length) {
          const next = lines[i + 1];
          if (!LABEL_AT_START_RE.test(next.norm)) value = valueFrom(next, 0);
        }

        if (!value) continue;
        if (field.compact) value = value.replace(/\s+/g, "");
        if (value.length > 80) value = value.slice(0, 80).trim();
        result[field.key] = value;
        break search;
      }
    }
  }

  // Respaldo del RUN por patrón numérico estricto.
  if (!result.propietarioRun) {
    const runMatch = String(rawText).match(RUN_PATTERN);
    if (runMatch) result.propietarioRun = runMatch[1];
  }

  return result;
}
