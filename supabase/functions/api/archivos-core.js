// Archivos pesados (fotos, documentos, audios de WhatsApp): reglas puras compartidas por el servidor, las pruebas y la migración.
//
// Antes todo se guardaba como texto base64 dentro de kv_store (118 de 121 MB de la base). Ahora el CONTENIDO vive en Supabase Storage
// (bucket privado «archivos») y en kv_store queda solo una fila liviana con un marcador «@archivo:<ruta>». Así no cambia nada para el
// resto del sistema: las claves, los permisos, las listas por prefijo y los borrados siguen funcionando igual.

export const BUCKET_ARCHIVOS = "archivos";
/** Claves de kv_store que son archivos (el resto de kv_store es configuración pequeña y se queda en la base). */
export const PREFIJOS_ARCHIVO = ["ifoto", "dval", "foto", "vfoto", "wamedia"];
export const MARCADOR = "@archivo:";
/** Tope por archivo. Hoy el mayor es de 1,6 MB; WhatsApp ya limita lo suyo aparte. */
export const MAX_BYTES_ARCHIVO = 12 * 1024 * 1024;
/** Carpeta raíz del primer cliente. Las rutas quedan guardadas en el marcador, así que al sumar empresas no hay que mover nada. */
export const ESPACIO_INICIAL = "df";

export const esClaveArchivo = (key) => typeof key === "string" && PREFIJOS_ARCHIVO.some((p) => key.startsWith(`${p}::`));
export const esMarcador = (valor) => typeof valor === "string" && valor.startsWith(MARCADOR) && valor.length < 600 && !/\s/.test(valor);
export const rutaDeMarcador = (valor) => (esMarcador(valor) ? valor.slice(MARCADOR.length) : null);
export const marcadorDe = (ruta) => `${MARCADOR}${ruta}`;

// Hash corto y estable (FNV-1a) para que dos claves distintas nunca terminen en la misma ruta al limpiar caracteres raros.
function hashCorto(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
function segmento(s) {
  const limpio = String(s).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  const cambio = limpio !== s || limpio === "" || limpio === "." || limpio === "..";
  return cambio ? `${limpio || "x"}-${hashCorto(String(s))}` : limpio;
}

/** Ruta del objeto en Storage para una clave de kv_store: <espacio>/<prefijo>/<resto de la clave por carpetas>. */
export function rutaArchivo(key, espacio = ESPACIO_INICIAL) {
  const partes = String(key).split("::");
  const prefijo = partes.shift();
  if (!PREFIJOS_ARCHIVO.includes(prefijo) || partes.length === 0) throw new Error("clave_no_es_archivo");
  return [segmento(espacio), prefijo, ...partes.map(segmento)].join("/");
}

/** «data:image/jpeg;base64,AAAA…» -> { mime, bytes } (o null si no es una dirección data: en base64). */
export function leerDataUrl(valor) {
  const m = /^data:([\w/+.-]+)(?:;[\w=.+-]+)*;base64,([A-Za-z0-9+/=\s]*)$/s.exec(String(valor || ""));
  if (!m) return null;
  let bin;
  try { bin = atob(m[2].replace(/\s+/g, "")); } catch { return null; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1].toLowerCase(), bytes };
}

/** Bytes -> «data:<mime>;base64,…» (por trozos, para no romper la pila con archivos grandes). */
export function aDataUrl(bytes, mime) {
  let bin = "";
  const TROZO = 0x8000;
  for (let i = 0; i < bytes.length; i += TROZO) bin += String.fromCharCode(...bytes.subarray(i, i + TROZO));
  return `data:${String(mime || "application/octet-stream").split(";")[0].trim().toLowerCase()};base64,${btoa(bin)}`;
}

/** ¿Este valor de kv_store es un archivo que todavía vive dentro de la base y se puede mover? */
export const archivoEnLaBase = (key, valor) => esClaveArchivo(key) && typeof valor === "string" && !esMarcador(valor) && /^data:/i.test(valor);
