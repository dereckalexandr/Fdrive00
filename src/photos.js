/**
 * FOTOS DE LA TASACIÓN
 * ----------------------------------------------------------------
 * Cada foto se reduce en el dispositivo (JPEG, máx. 1280 px) y se guarda como
 * un registro APARTE (`foto::<inspector>::<id>`), no dentro de la tasación: así
 * el historial sigue liviano y la misma foto se ve desde el computador y desde
 * el celular. La tasación solo guarda los identificadores en
 * `checklist[<ítem>].fotos = [id, ...]`.
 *
 * Las funciones puras (ids, tamaños, claves) se prueban en Node; `compressImage`
 * usa el DOM y solo corre en el navegador.
 * ----------------------------------------------------------------
 */
export const MAX_PHOTOS_PER_ITEM = 6;
export const MAX_PHOTOS_PER_TASACION = 60;
export const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024; // foto original que aceptamos leer
export const MAX_STORED_CHARS = 1_500_000; // tope de la foto ya comprimida (data URL)

export const photoKey = (inspectorId, photoId) => `foto::${inspectorId}::${photoId}`;
export const photoPrefix = (inspectorId) => `foto::${inspectorId}::`;

export function makePhotoId() {
  const r = new Uint8Array(6);
  globalThis.crypto.getRandomValues(r);
  return `${Date.now().toString(36)}${Array.from(r, (b) => b.toString(36).padStart(2, "0")).join("")}`;
}

/** Escala (w, h) para que el lado mayor no pase de `max`, sin agrandar. */
export function fitSize(w, h, max) {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Todos los ids de foto de un checklist. */
export function collectPhotoIds(checklist) {
  const ids = [];
  for (const st of Object.values(checklist || {})) {
    if (st && Array.isArray(st.fotos)) ids.push(...st.fotos);
  }
  return ids;
}

/** Ids de `current` que no están en `saved` (fotos aún sin guardar con la tasación). */
export function diffIds(current, saved) {
  const keep = new Set(saved);
  return current.filter((id) => !keep.has(id));
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) { /* cae al <img> */ }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("imagen_no_legible")); };
    img.src = url;
  });
}

/** Lee la foto, respeta su orientación, la reduce y devuelve un data URL JPEG. */
export async function compressImage(file, { maxDim = 1280, quality = 0.72 } = {}) {
  if (!file || !String(file.type || "").startsWith("image/")) throw new Error("no_es_imagen");
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error("imagen_muy_grande");
  const bitmap = await loadBitmap(file);
  const { width, height } = fitSize(bitmap.width, bitmap.height, maxDim);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // los PNG con transparencia no deben quedar negros en JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === "function") bitmap.close();
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  if (dataUrl.length > MAX_STORED_CHARS) dataUrl = canvas.toDataURL("image/jpeg", 0.5); // segundo intento, más comprimido
  if (dataUrl.length > MAX_STORED_CHARS) throw new Error("imagen_muy_grande");
  return dataUrl;
}
