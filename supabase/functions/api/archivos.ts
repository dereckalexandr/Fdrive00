// Archivos pesados en Supabase Storage (ver archivos-core.js). kv_store guarda solo el marcador «@archivo:<ruta>»;
// quien pide el archivo recibe la misma dirección data: de siempre, así que ninguna pantalla cambia.
import {
  BUCKET_ARCHIVOS, MARCADOR, PREFIJOS_ARCHIVO, MAX_BYTES_ARCHIVO, esClaveArchivo, esMarcador, rutaDeMarcador, marcadorDe, rutaArchivo, leerDataUrl, aDataUrl, archivoEnLaBase,
} from "./archivos-core.js";

const TABLE = "kv_store";

/**
 * Guarda una clave de kv_store. Si es un archivo (foto, documento, audio) y llega como dirección data:, sube el contenido a Storage
 * y deja el marcador. Si Storage falla, el archivo queda en la base (como antes): nunca se pierde lo que la persona subió.
 */
export async function guardarArchivo(sb: any, key: string, value: string, shared = false): Promise<{ enStorage: boolean }> {
  let valor = value;
  let enStorage = false;
  if (esClaveArchivo(key) && !esMarcador(value)) {
    const d = leerDataUrl(value);
    if (d && d.bytes.length > 0 && d.bytes.length <= MAX_BYTES_ARCHIVO) {
      const ruta = rutaArchivo(key);
      try {
        const up = await sb.storage.from(BUCKET_ARCHIVOS).upload(ruta, d.bytes, { contentType: d.mime, upsert: true });
        if (up.error) console.error("archivos: no se pudo subir a Storage, queda en la base:", up.error.message);
        else { valor = marcadorDe(ruta); enStorage = true; }
      } catch (e) { console.error("archivos: Storage no responde, queda en la base:", String((e as any)?.message ?? e)); }
    }
  }
  const { error } = await sb.from(TABLE).upsert({ key, value: valor, shared, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
  return { enStorage };
}

/** Convierte lo guardado en kv_store en el contenido real: si es un marcador, lo baja de Storage; si no, devuelve el valor tal cual. */
export async function valorDeArchivo(sb: any, valor: string | null): Promise<string | null> {
  const ruta = rutaDeMarcador(valor);
  if (!ruta) return valor;
  try {
    const r = await sb.storage.from(BUCKET_ARCHIVOS).download(ruta);
    if (r.error || !r.data) { console.error("archivos: no se encontró", ruta, r.error?.message); return null; }
    const bytes = new Uint8Array(await r.data.arrayBuffer());
    return aDataUrl(bytes, r.data.type);
  } catch (e) { console.error("archivos: error al bajar", ruta, String((e as any)?.message ?? e)); return null; }
}

/** Lee una clave de kv_store y devuelve su contenido real (data: para los archivos). */
export async function leerArchivo(sb: any, key: string): Promise<string | null> {
  const { data, error } = await sb.from(TABLE).select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data ? await valorDeArchivo(sb, data.value as string) : null;
}

/** Borra la clave y, si su contenido estaba en Storage, también el objeto. */
export async function borrarArchivo(sb: any, key: string): Promise<void> {
  const { data } = await sb.from(TABLE).select("value").eq("key", key).maybeSingle();
  const ruta = data ? rutaDeMarcador(data.value as string) : null;
  const { error } = await sb.from(TABLE).delete().eq("key", key);
  if (error) throw error;
  if (ruta) {
    try { await sb.storage.from(BUCKET_ARCHIVOS).remove([ruta]); }
    catch (e) { console.error("archivos: no se pudo borrar el objeto", ruta, String((e as any)?.message ?? e)); }
  }
}

/* ---------- migración de lo que ya estaba en la base (solo el Administrador) ---------- */

/** Cuántos archivos hay de cada tipo: los que aún viven como texto dentro de kv_store y los que ya están en Storage. Nunca trae el contenido. */
export async function estadoMigracion(sb: any) {
  let enLaBase = 0, enStorage = 0;
  for (const p of PREFIJOS_ARCHIVO) {
    const a = await sb.from(TABLE).select("key", { count: "exact" }).like("key", p + "::%").ilike("value", "data:%").limit(1);
    if (a.error) throw a.error;
    enLaBase += a.count ?? 0;
    const b = await sb.from(TABLE).select("key", { count: "exact" }).like("key", p + "::%").like("value", MARCADOR + "%").limit(1);
    if (b.error) throw b.error;
    enStorage += b.count ?? 0;
  }
  return { enLaBase, enStorage };
}

/**
 * Mueve hasta `limite` archivos de la base a Storage. Cada uno se sube, se vuelve a bajar para comprobar que quedó igual
 * y recién entonces se reemplaza por el marcador. Si algo no coincide, el archivo se deja intacto en la base.
 */
export async function migrarLote(sb: any, limite = 8) {
  let movidos = 0, bytes = 0, omitidos = 0; const fallos: string[] = [];
  for (const p of PREFIJOS_ARCHIVO) {
    if (movidos + fallos.length >= limite) break;
    const q = await sb.from(TABLE).select("key").like("key", p + "::%").ilike("value", "data:%").limit(limite);
    if (q.error) throw q.error;
    for (const { key } of q.data ?? []) {
      if (movidos + fallos.length >= limite) break;
      const g = await sb.from(TABLE).select("value, updated_at").eq("key", key).maybeSingle();
      const valor = g.data ? (g.data.value as string) : null;
      const version = g.data ? (g.data.updated_at as string | null) : null;
      if (!valor || !archivoEnLaBase(key, valor)) continue;
      const d = leerDataUrl(valor);
      if (!d || d.bytes.length === 0 || d.bytes.length > MAX_BYTES_ARCHIVO) { fallos.push(key + ": no es un archivo válido o es muy grande"); continue; }
      const ruta = rutaArchivo(key);
      try {
        const up = await sb.storage.from(BUCKET_ARCHIVOS).upload(ruta, d.bytes, { contentType: d.mime, upsert: true });
        if (up.error) { fallos.push(key + ": " + up.error.message); continue; }
        const dl = await sb.storage.from(BUCKET_ARCHIVOS).download(ruta);
        const tam = dl.data ? (await dl.data.arrayBuffer()).byteLength : -1;
        if (dl.error || tam !== d.bytes.length) { fallos.push(key + ": la copia en Storage no coincide"); continue; }
        // Nunca se compara el contenido en el filtro (iría dentro de la dirección de la consulta y no cabe): solo la clave, que siga sin moverse y su versión.
        let act = sb.from(TABLE).update({ value: marcadorDe(ruta) }).eq("key", key).ilike("value", "data:%");
        if (version) act = act.eq("updated_at", version);
        const u = await act.select("key");
        if (u.error) { fallos.push(key + ": " + u.error.message); continue; }
        if (!u.data || u.data.length === 0) {
          // Cambió mientras se movía (alguien la volvió a subir o ya se había movido): no se pisa y se descarta la copia sobrante.
          omitidos++;
          try { await sb.storage.from(BUCKET_ARCHIVOS).remove([ruta]); } catch { /* queda sin referencias: se ignora */ }
          continue;
        }
        movidos++; bytes += d.bytes.length;
      } catch (e) { fallos.push(key + ": " + String((e as any)?.message ?? e).slice(0, 120)); }
    }
  }
  return { movidos, bytes, omitidos, fallos };
}
