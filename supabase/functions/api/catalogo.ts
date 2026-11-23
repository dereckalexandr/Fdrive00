// Catálogo de autos para Meta (público, sin sesión, solo lectura):
//   GET ?catalogo=meta-vehiculos | meta-productos  → CSV con los autos disponibles (Meta lo lee solo, cada hora o cada día)
//   GET ?vfoto=<vehículo>&f=<foto>                  → la foto del auto (solo de autos visibles en el sitio web)
// No expone costos ni datos internos: lo mismo que ya muestra el sitio web. Opcional: SITIO_URL (por defecto https://fdrive02.vercel.app).
import { armarCatalogo, FORMATOS_CATALOGO } from "./catalogo-core.js";
import { visibleEnCatalogo } from "./publico-core.js";

const env = (k: string) => (globalThis as any).Deno.env.get(k) ?? "";
const urlSitio = () => (env("SITIO_URL") || "https://fdrive02.vercel.app").replace(/\/$/, "");
const urlApi = () => `${String(env("SUPABASE_URL")).replace(/\/$/, "")}/functions/v1/api`;
const urlFoto = (vid: string, fid: string) => `${urlApi()}?vfoto=${encodeURIComponent(vid)}&f=${encodeURIComponent(fid)}`;
export const urlCatalogo = (formato: string) => `${urlApi()}?catalogo=${formato}`;

/** Autos, avisos publicados (título y descripción) y datos de la empresa (dirección del concesionario). */
async function datosCatalogo(sb: any) {
  const [vq, aq, eq] = await Promise.all([
    sb.from("vehiculos").select("id, marca, modelo, version, anio, km, color, transmision, combustible, precio_lista, estado, activo, fotos, patente, local_id"),
    sb.from("anuncios").select("vehiculo_id, titulo, descripcion, estado"),
    sb.from("kv_store").select("value").eq("key", "empresa::datos").maybeSingle(),
  ]);
  if (vq.error) throw vq.error;
  const avisos: Record<string, any> = {};
  for (const a of aq.data ?? []) if (a.estado !== "baja") avisos[a.vehiculo_id] = { titulo: a.titulo, descripcion: a.descripcion };
  let empresa: any = {};
  try { empresa = eq.data && eq.data.value ? JSON.parse(eq.data.value) : {}; } catch { empresa = {}; }
  return { vehiculos: (vq.data ?? []).filter((v: any) => v.activo !== false && v.estado !== "vendido"), avisos, empresa };
}

/** Atiende las direcciones públicas del catálogo y de las fotos. */
export async function catalogoGet(req: Request, sb: any): Promise<Response> {
  const u = new URL(req.url);
  if (u.searchParams.has("vfoto")) {
    const vid = String(u.searchParams.get("vfoto") || ""); const fid = String(u.searchParams.get("f") || "");
    if (!/^[0-9a-f-]{36}$/.test(vid) || !/^[\w-]{3,60}$/.test(fid)) return new Response("not found", { status: 404 });
    const q = await sb.from("vehiculos").select("id, activo, estado, precio_lista, fotos").eq("id", vid).maybeSingle();
    if (!q.data || !visibleEnCatalogo(q.data) || !(q.data.fotos ?? []).includes(fid)) return new Response("not found", { status: 404 });
    const r = await sb.from("kv_store").select("value").eq("key", `vfoto::${vid}::${fid}`).maybeSingle();
    const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String((r.data && r.data.value) || ""));
    if (!m) return new Response("not found", { status: 404 });
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, { status: 200, headers: { "content-type": m[1], "cache-control": "public, max-age=86400" } });
  }
  const formato = String(u.searchParams.get("catalogo") || "");
  if (!FORMATOS_CATALOGO.some((f) => f.id === formato)) return new Response("formato desconocido", { status: 404 });
  const d = await datosCatalogo(sb);
  const c = armarCatalogo(d.vehiculos, formato, { urlSitio: urlSitio(), urlFoto, avisos: d.avisos, empresa: d.empresa });
  return new Response(c.csv, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "public, max-age=900", "content-disposition": `inline; filename="${formato}.csv"` } });
}

/** Para el módulo Avisos: direcciones del catálogo y qué autos entran (y por qué no entran los demás). */
export async function estadoCatalogo(sb: any) {
  const d = await datosCatalogo(sb);
  const c = armarCatalogo(d.vehiculos, "meta-vehiculos", { urlSitio: urlSitio(), urlFoto, avisos: d.avisos, empresa: d.empresa });
  return {
    formatos: FORMATOS_CATALOGO.map((f) => ({ ...f, url: urlCatalogo(f.id) })),
    incluidos: c.incluidos, excluidos: c.excluidos,
    faltaDireccion: !(d.empresa && d.empresa.domicilio && d.empresa.comuna),
  };
}
