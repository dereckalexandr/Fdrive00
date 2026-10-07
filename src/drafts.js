/**
 * BORRADORES AUTOMÁTICOS DEL INSPECTOR
 * ----------------------------------------------------------------
 * Guarda lo que el inspector va escribiendo en el almacenamiento del propio
 * dispositivo (localStorage), para no perderlo si recarga la página, se queda
 * sin conexión o vence su sesión. No va a Supabase: es solo un respaldo local.
 *
 * Privacidad: el borrador incluye datos del propietario (nombre, RUN). Queda en
 * el navegador del inspector hasta que guarde la inspección, lo descarte, o
 * borre los datos del sitio.
 * ----------------------------------------------------------------
 */
const PREFIX = "driveFuturo:draft";

const defaultStorage = () => {
  try { return globalThis.localStorage || null; } catch (e) { return null; }
};

export const draftKey = (inspectorId, kind) => `${PREFIX}::${inspectorId}::${kind}`;

// Quita lo que no cuenta como "trabajo del usuario": la fecha del día y las
// entradas del checklist que siguen vacías.
function normalize(record) {
  const { fecha, checklist, ...rest } = record || {};
  const cl = {};
  for (const [id, st] of Object.entries(checklist || {})) {
    const filled = Object.values(st || {}).some((v) => (Array.isArray(v) ? v.length > 0 : v !== "" && v !== 0 && v != null));
    if (filled) cl[id] = st;
  }
  return { ...rest, checklist: cl };
}

/** ¿El registro tiene algo escrito respecto al formulario vacío? */
export function isMeaningful(record, emptyRecord) {
  return JSON.stringify(normalize(record)) !== JSON.stringify(normalize(emptyRecord));
}

/**
 * Guarda el borrador. Si no cabe (el PDF del CAV puede pesar varios MB), reintenta
 * sin el archivo. Devuelve { ok, sinArchivo }.
 */
export function saveDraft(inspectorId, kind, data, storage = defaultStorage()) {
  if (!storage) return { ok: false, sinArchivo: false };
  const payload = (d) => JSON.stringify({ savedAt: new Date().toISOString(), data: d });
  try {
    storage.setItem(draftKey(inspectorId, kind), payload(data));
    return { ok: true, sinArchivo: false };
  } catch (e) {
    try {
      storage.setItem(draftKey(inspectorId, kind), payload({ ...data, cavFileData: "", cavFileName: "" }));
      return { ok: true, sinArchivo: true };
    } catch (e2) {
      return { ok: false, sinArchivo: false };
    }
  }
}

/** Devuelve { data, savedAt } o null. */
export function loadDraft(inspectorId, kind, storage = defaultStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(draftKey(inspectorId, kind));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.data ? parsed : null;
  } catch (e) { return null; }
}

export function clearDraft(inspectorId, kind, storage = defaultStorage()) {
  if (!storage) return;
  try { storage.removeItem(draftKey(inspectorId, kind)); } catch (e) { /* nada */ }
}
