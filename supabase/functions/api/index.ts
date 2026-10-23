// Puerta de entrada de Drive Futuro.
//
// El navegador ya NO accede a la tabla kv_store. Todo pasa por esta función,
// que usa la service_role (solo existe aquí, en el servidor) y decide qué
// puede leer o escribir cada sesión:
//   admin      -> todo, salvo la clave interna "admin_auth"
//   vendor     -> record::<id>::*  (lectura/escritura), afp_config y uf_valor (solo lectura)
//   inspector  -> inspeccion::<id>::*, tasacion::<id>::* y foto::<id>::* (lectura/escritura/eliminación),
//                 afp_config y uf_valor (solo lectura)
//   user       -> persona del CRM (ingresa con RUT y clave). Sus permisos se leen de la base en cada
//                 petición (se pueden cambiar o quitar en el momento): "inspecciones.usar" abre
//                 inspeccion::<id>::*; "tasaciones.usar" abre tasacion::<id>::* y foto::<id>::*.
//   Las operaciones de administración del CRM (acción "crm") solo las puede hacer la cuenta maestra.
//
// Secretos requeridos (supabase secrets set ...):
//   SESSION_SECRET        cadena aleatoria larga para firmar sesiones
//   ADMIN_EMAIL           correo del administrador maestro
//   ADMIN_PASSWORD_HASH   hash PBKDF2 de la clave maestra (scripts/set-admin-password.mjs)
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  ROLES, PERMISO_IDS, permisosDeRol, permisosEfectivos, limpiarExtra,
  normalizarRut, validarRut, claveValida, claveProvisoria, validarUsuario, validarConfig, configCompleta, ROLES_ASIGNABLES,
} from "./crm-core.js";
import { ventasOp } from "./ventas.ts";
import { limiteDiario, limiteWeb } from "./patentes-core.js";
import { publicOp } from "./publico.ts";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const TABLE = "kv_store";
const SESSION_SECRET = Deno.env.get("SESSION_SECRET") ?? "";
const ADMIN_EMAIL = (Deno.env.get("ADMIN_EMAIL") ?? "").trim().toLowerCase();
const ADMIN_PASSWORD_HASH = Deno.env.get("ADMIN_PASSWORD_HASH") ?? "";

const ADMIN_TTL_S = 60 * 60 * 12;
const PROFILE_TTL_S = 60 * 60 * 8;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const PBKDF2_ITER = 150_000;
const READ_ONLY_SHARED = new Set(["afp_config", "uf_valor"]);

const enc = new TextEncoder();

/* ---------- utilidades ---------- */
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

function safeEqual(a: Uint8Array, b: Uint8Array) {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function pbkdf2(secret: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}

async function hashSecret(secret: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(secret, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(hash)}`;
}

async function verifySecret(secret: string, stored: string) {
  const [alg, iter, salt, hash] = (stored || "").split("$");
  if (alg !== "pbkdf2" || !iter || !salt || !hash) return false;
  const got = await pbkdf2(secret, unb64(salt), parseInt(iter, 10));
  return safeEqual(got, unb64(hash));
}

async function hmacKey() {
  return crypto.subtle.importKey("raw", enc.encode(SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

type Session = { role: "admin" | "vendor" | "inspector" | "user"; id: string; exp: number; perms?: string[]; localId?: string | null };

async function signSession(role: Session["role"], id: string, ttl: number) {
  const body = b64url(enc.encode(JSON.stringify({ role, id, exp: Math.floor(Date.now() / 1000) + ttl })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

async function readSession(token: unknown): Promise<Session | null> {
  if (typeof token !== "string" || !SESSION_SECRET) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(), unb64url(sig), enc.encode(body));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(unb64url(body))) as Session;
    return s.exp > Date.now() / 1000 ? s : null;
  } catch {
    return null;
  }
}

function genRecoveryCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rnd = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(rnd, (n) => chars[n % chars.length]).join("");
  return raw.match(/.{1,4}/g)!.join("-");
}

const validAdminPassword = (pw: unknown) =>
  typeof pw === "string" && /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{8,}$/.test(pw);

/* ---------- limitador de intentos (por instancia, mejor esfuerzo) ---------- */
const attempts = new Map<string, { n: number; reset: number }>();
const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function blocked(ip: string, bucket: string) {
  const a = attempts.get(`${bucket}:${ip}`);
  return !!a && a.reset > Date.now() && a.n >= MAX_FAILS;
}
async function fail(ip: string, bucket: string) {
  const k = `${bucket}:${ip}`;
  const a = attempts.get(k);
  if (!a || a.reset < Date.now()) attempts.set(k, { n: 1, reset: Date.now() + WINDOW_MS });
  else a.n++;
  await new Promise((r) => setTimeout(r, 400));
}

/* ---------- acceso a datos ---------- */
async function dbGet(key: string): Promise<string | null> {
  const { data, error } = await sb.from(TABLE).select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data ? (data.value as string) : null;
}
async function dbSet(key: string, value: string, shared = true) {
  const { error } = await sb.from(TABLE).upsert({ key, value, shared, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}
async function dbJsonList(key: string): Promise<any[]> {
  try {
    const v = await dbGet(key);
    const parsed = v ? JSON.parse(v) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ownPrefixes(s: Session): string[] {
  if (s.role === "user") {
    const p = s.perms ?? [];
    const out: string[] = [];
    if (p.includes("inspecciones.usar")) out.push(`inspeccion::${s.id}::`);
    if (p.includes("tasaciones.usar")) out.push(`tasacion::${s.id}::`, `foto::${s.id}::`);
    return out;
  }
  if (s.role === "vendor") return [`record::${s.id}::`];
  // foto::<id>::* son las fotos de las tasaciones (un registro por foto, ya reducida en el dispositivo).
  if (s.role === "inspector") return [`inspeccion::${s.id}::`, `tasacion::${s.id}::`, `foto::${s.id}::`];
  return [];
}

function canKv(s: Session, op: string, key: string): boolean {
  if (key === "admin_auth") return false; // solo uso interno de esta función
  if (s.role === "admin") return true;
  if ((op === "get") && READ_ONLY_SHARED.has(key)) return true;
  // Fotos del inventario (vfoto::<vehiculo>::<foto>): las ve quien ve el inventario; las sube o borra quien lo edita.
  if (s.role === "user" && key.startsWith("vfoto::")) {
    const p = s.perms ?? [];
    if (op === "get") return p.includes("inventario.ver") || p.includes("inventario.editar") || p.includes("leads.propios") || p.includes("leads.local");
    return p.includes("inventario.editar");
  }
  // Fotos de las tasaciones (tfoto::<tasación>::<foto>): las sube y borra quien tasa; las ven quienes tasan, piden tasaciones o miran los leads.
  if (s.role === "user" && key.startsWith("tfoto::")) {
    const p = s.perms ?? [];
    if (op === "get") return p.includes("tasaciones.realizar") || p.includes("tasaciones.pedir") || p.includes("leads.propios") || p.includes("leads.local") || p.includes("leads.asignar");
    return p.includes("tasaciones.realizar");
  }
  // Fotos del resultado de una inspección (ifoto::<ficha>::<foto>): las sube y borra quien inspecciona; las ven quienes piden inspecciones o miran los leads.
  if (s.role === "user" && key.startsWith("ifoto::")) {
    const p = s.perms ?? [];
    if (op === "get") return p.includes("inspecciones.realizar") || p.includes("inspecciones.pedir") || p.includes("leads.propios") || p.includes("leads.local") || p.includes("leads.asignar") || p.includes("tasaciones.realizar");
    return p.includes("inspecciones.realizar");
  }
  // Documentos de una validación (dval::<validación>::<archivo>): el servidor decide quién los registra en cada documento;
  // aquí solo se limita quién puede guardar o leer el contenido (la clave incluye el id de la validación, imposible de adivinar).
  if (s.role === "user" && key.startsWith("dval::")) {
    const p = s.perms ?? [];
    const sube = p.includes("validacion.realizar") || p.includes("leads.propios") || p.includes("leads.asignar") || p.includes("inventario.editar") || p.includes("tasaciones.realizar");
    if (op === "get") return sube || p.includes("validacion.usar") || p.includes("leads.local");
    return sube;
  }
  if (op === "get" || op === "set") return ownPrefixes(s).some((p) => key.startsWith(p));
  // El inspector puede eliminar SUS PROPIAS inspecciones y tasaciones (no las de otros, ni los ejecutivos nada).
  if (op === "delete" && (s.role === "inspector" || s.role === "user")) return ownPrefixes(s).some((p) => key.startsWith(p));
  return false;
}

/** El supervisor (Jefe Local) puede LEER las inspecciones, valorizaciones y fotos de las personas de su propio local. Nunca escribir ni borrar. */
async function supervisorLee(s: Session, claveOPrefijo: string): Promise<boolean> {
  if (s.role !== "user" || !(s.perms ?? []).includes("leads.asignar") || !s.localId) return false;
  const m = /^(inspeccion|tasacion|foto)::([0-9a-f-]{36})::/i.exec(claveOPrefijo);
  if (!m) return false;
  const { data, error } = await sb.from("usuarios").select("local_id").eq("id", m[2]).maybeSingle();
  if (error) throw error;
  return !!data && data.local_id === s.localId;
}

function canList(s: Session, prefix: string): boolean {
  if (s.role === "admin") return true;
  return ownPrefixes(s).some((p) => prefix.startsWith(p));
}

/* ---------- CRM: usuarios, permisos, bitácora ---------- */
const USER_TTL_S = 60 * 60 * 8;
const LIVE_CACHE_MS = 15_000;

// Tablas del CRM no creadas todavía (falta ejecutar supabase-crm-setup.sql).
const isMissingTable = (e: any) => e?.code === "42P01" || e?.code === "PGRST205" || /does not exist|schema cache/i.test(String(e?.message ?? ""));

let rolesCache: { at: number; overrides: Record<string, string[]> } | null = null;
async function rolePermOverrides(): Promise<Record<string, string[]>> {
  if (rolesCache && Date.now() - rolesCache.at < LIVE_CACHE_MS) return rolesCache.overrides;
  const { data, error } = await sb.from("roles_permisos").select("rol, permisos");
  if (error) throw error;
  const overrides: Record<string, string[]> = {};
  for (const r of data ?? []) overrides[r.rol] = r.permisos ?? [];
  rolesCache = { at: Date.now(), overrides };
  return overrides;
}

type VivoUsuario = { activo: boolean; roles: string[]; permisos: string[]; nombre: string; localId: string | null };
const liveUsers = new Map<string, { at: number; value: VivoUsuario | null }>();
const dropLiveCache = () => { liveUsers.clear(); rolesCache = null; };

/** Estado ACTUAL de una persona (activa, roles, permisos). Cache de 15 s para no consultar en cada tecla. */
async function liveUser(id: string) {
  const hit = liveUsers.get(id);
  if (hit && Date.now() - hit.at < LIVE_CACHE_MS) return hit.value;
  const { data, error } = await sb.from("usuarios").select("activo, roles, permisos_extra, nombre, local_id").eq("id", id).maybeSingle();
  if (error) throw error;
  let value: VivoUsuario | null = null;
  if (data && data.activo) {
    const overrides = await rolePermOverrides();
    value = { activo: true, roles: data.roles ?? [], permisos: permisosEfectivos(data.roles ?? [], overrides, data.permisos_extra), nombre: data.nombre, localId: data.local_id ?? null };
  }
  liveUsers.set(id, { at: Date.now(), value });
  return value;
}

const pubUser = (u: any) => ({
  id: u.id, rut: u.rut, nombre: u.nombre, email: u.email, telefono: u.telefono, roles: u.roles ?? [],
  extra: limpiarExtra(u.permisos_extra), comision: u.comision ?? {}, localId: u.local_id, activo: u.activo,
  debeCambiarClave: u.debe_cambiar_clave, ultimoAcceso: u.ultimo_acceso, creadoEn: u.creado_en,
});

async function meOf(u: any) {
  const overrides = await rolePermOverrides();
  let local = null;
  if (u.local_id) {
    const { data } = await sb.from("locales").select("id, nombre").eq("id", u.local_id).maybeSingle();
    local = data ?? null;
  }
  return { ...pubUser(u), permisos: permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra), local };
}

type Actor = { tipo: "admin" | "usuario" | "sistema"; id?: string; nombre?: string };
async function audit(actor: Actor, accion: string, entidad?: string, entidadId?: string, detalle: Record<string, unknown> = {}) {
  try {
    const { error } = await sb.from("bitacora").insert({
      actor_tipo: actor.tipo, actor_id: actor.id ?? null, actor_nombre: actor.nombre ?? null,
      accion, entidad: entidad ?? null, entidad_id: entidadId ?? null, detalle,
    });
    if (error) console.error("bitacora error:", error.message);
  } catch (e) { console.error("bitacora error:", e); }
}

const adminActor = (s: Session): Actor => ({ tipo: "admin", id: s.id, nombre: s.id === "master" ? ADMIN_EMAIL : "Administrador adicional" });

let dummyHash: string | null = null;
async function consumeLoginTime(password: string) {
  dummyHash ??= await hashSecret("relleno-para-igualar-tiempos");
  await verifySecret(password, dummyHash);
}

/** Operaciones del panel de administración del CRM. Solo la cuenta maestra. */
async function crmOp(s: Session, body: any): Promise<Response> {
  if (s.role !== "admin") return json({ error: "forbidden" }, 403);
  const actor = adminActor(s);
  const op = String(body.op ?? "");

  const dbFail = (e: any) => {
    if (isMissingTable(e)) return json({ error: "crm_not_installed" }, 503);
    if (e?.code === "23505") return json({ error: "duplicado" }, 409);
    throw e;
  };

  /* --- locales --- */
  if (op === "locales.list") {
    const { data, error } = await sb.from("locales").select("*").order("creado_en");
    if (error) return dbFail(error);
    return json({ locales: data });
  }
  if (op === "locales.create" || op === "locales.update") {
    const nombre = String(body.nombre ?? "").trim().replace(/\s+/g, " ");
    const direccion = String(body.direccion ?? "").trim().slice(0, 160) || null;
    if (nombre.length < 2 || nombre.length > 60) return json({ error: "nombre_invalido" }, 400);
    if (op === "locales.create") {
      const { data, error } = await sb.from("locales").insert({ nombre, direccion }).select().single();
      if (error) return dbFail(error);
      await audit(actor, "local.crear", "local", data.id, { nombre });
      return json({ local: data });
    }
    const patch: Record<string, unknown> = { nombre, direccion };
    if (typeof body.activo === "boolean") patch.activo = body.activo;
    const { data, error } = await sb.from("locales").update(patch).eq("id", String(body.id)).select().single();
    if (error) return dbFail(error);
    await audit(actor, "local.editar", "local", data.id, patch);
    return json({ local: data });
  }

  /* --- usuarios --- */
  if (op === "usuarios.list") {
    const { data, error } = await sb.from("usuarios").select("*").order("nombre");
    if (error) return dbFail(error);
    return json({ usuarios: (data ?? []).map(pubUser) });
  }
  if (op === "usuarios.create") {
    const v = validarUsuario(body.datos, { esAlta: true });
    if (!v.ok) return json({ error: v.error }, 400);
    if (v.value.localId) {
      const { data: loc } = await sb.from("locales").select("id").eq("id", v.value.localId).maybeSingle();
      if (!loc) return json({ error: "local_invalido" }, 400);
    }
    let clave = String(body.clave ?? "");
    const generada = !clave;
    if (generada) clave = claveProvisoria(crypto.getRandomValues(new Uint8Array(10)));
    else if (!claveValida(clave)) return json({ error: "clave_invalida" }, 400);
    const { data, error } = await sb.from("usuarios").insert({
      rut: v.value.rut, nombre: v.value.nombre, email: v.value.email, telefono: v.value.telefono,
      roles: v.value.roles, permisos_extra: v.value.extra, local_id: v.value.localId, ...(v.value.comision !== undefined ? { comision: v.value.comision } : {}),
      clave_hash: await hashSecret(clave), debe_cambiar_clave: true,
    }).select().single();
    if (error) return dbFail(error);
    await audit(actor, "usuario.crear", "usuario", data.id, { rut: data.rut, nombre: data.nombre, roles: data.roles });
    return json({ usuario: pubUser(data), claveProvisoria: clave });
  }
  if (op === "usuarios.update") {
    const v = validarUsuario(body.datos, { esAlta: false });
    if (!v.ok) return json({ error: v.error }, 400);
    const id = String(body.id ?? "");
    if (v.value.localId) {
      const { data: loc } = await sb.from("locales").select("id").eq("id", v.value.localId).maybeSingle();
      if (!loc) return json({ error: "local_invalido" }, 400);
    }
    const { data: antes } = await sb.from("usuarios").select("*").eq("id", id).maybeSingle();
    if (!antes) return json({ error: "no_existe" }, 404);
    // Los tramos de comisión solo se tocan si vienen en la petición.
    const cambios: Record<string, unknown> = {
      nombre: v.value.nombre, email: v.value.email, telefono: v.value.telefono, roles: v.value.roles,
      permisos_extra: v.value.extra, local_id: v.value.localId, actualizado_en: new Date().toISOString(),
    };
    if (v.value.comision !== undefined) cambios.comision = v.value.comision;
    const { data, error } = await sb.from("usuarios").update(cambios).eq("id", id).select().single();
    if (error) return dbFail(error);
    dropLiveCache();
    await audit(actor, "usuario.editar", "usuario", id, {
      nombre: data.nombre,
      ...(v.value.comision !== undefined ? { comision: { antes: antes.comision ?? {}, despues: data.comision ?? {} } } : {}),
      roles: { antes: antes.roles, despues: data.roles },
      permisos_extra: { antes: antes.permisos_extra, despues: data.permisos_extra },
      local: { antes: antes.local_id, despues: data.local_id },
    });
    return json({ usuario: pubUser(data) });
  }
  if (op === "usuarios.setActivo") {
    const activo = body.activo === true;
    const { data, error } = await sb.from("usuarios").update({ activo, actualizado_en: new Date().toISOString() }).eq("id", String(body.id ?? "")).select().single();
    if (error) return dbFail(error);
    dropLiveCache();
    await audit(actor, activo ? "usuario.activar" : "usuario.desactivar", "usuario", data.id, { rut: data.rut, nombre: data.nombre });
    return json({ usuario: pubUser(data) });
  }
  /** Qué dejaría atrás eliminar a una persona: lo que lo impide (historial de ventas, compras, fichas) y lo que solo quedaría sin responsable. */
  async function impactoDeUsuario(id: string) {
    const contar = async (tabla: string, col: string) => {
      const r = await sb.from(tabla).select("id", { count: "exact", head: true }).eq(col, id);
      return r.error ? 0 : (r.count ?? 0); // una tabla que aún no existe no tiene registros
    };
    const fichas = async (prefijo: string) => {
      const r = await sb.from(TABLE).select("key", { count: "exact", head: true }).like("key", `${prefijo}::${id}::%`);
      return r.error ? 0 : (r.count ?? 0);
    };
    const [ventas, compras, consignaciones, inspecciones, valorizaciones, leads, tareas, tasT, tasS, insI, insS, validaciones, anuncios] = await Promise.all([
      contar("cierres", "ejecutivo_id"), contar("compras", "ejecutivo_id"), contar("consignaciones", "ejecutivo_id"),
      fichas("inspeccion"), fichas("tasacion"),
      contar("leads", "asignado_a"), contar("tareas", "asignado_a"), contar("tasaciones", "tasador_id"), contar("tasaciones", "solicitante_id"),
      contar("inspecciones", "inspector_id"), contar("inspecciones", "solicitante_id"), contar("validaciones", "validador_id"), contar("anuncios", "anunciante_id"),
    ]);
    const bloqueos = [
      { que: "ventas cerradas", n: ventas }, { que: "compras", n: compras }, { que: "consignaciones", n: consignaciones },
      { que: "fichas de inspección del Inspector", n: inspecciones }, { que: "valorizaciones del Inspector", n: valorizaciones },
    ].filter((x) => x.n > 0);
    const avisos = [
      { que: "leads asignados", n: leads }, { que: "tareas", n: tareas }, { que: "tasaciones", n: tasT + tasS }, { que: "inspecciones pedidas o realizadas", n: insI + insS },
      { que: "validaciones", n: validaciones }, { que: "avisos de publicación", n: anuncios },
    ].filter((x) => x.n > 0);
    return { bloqueos, avisos };
  }
  if (op === "usuarios.impacto") {
    const { data, error } = await sb.from("usuarios").select("id, nombre, activo").eq("id", String(body.id ?? "")).maybeSingle();
    if (error) return dbFail(error);
    if (!data) return json({ error: "no_existe" }, 404);
    return json({ nombre: data.nombre, activo: !!data.activo, ...(await impactoDeUsuario(data.id)) });
  }
  // Eliminar de verdad a una persona. Solo si ya está desactivada y no tiene historial que se perdería (ventas, compras, consignaciones, fichas);
  // lo demás (leads, tareas, tasaciones…) queda sin responsable pero se conserva. No se puede deshacer.
  if (op === "usuarios.delete") {
    const { data, error } = await sb.from("usuarios").select("*").eq("id", String(body.id ?? "")).maybeSingle();
    if (error) return dbFail(error);
    if (!data) return json({ error: "no_existe" }, 404);
    if (data.activo) return json({ error: "desactivar_primero" }, 409);
    if (String(body.confirmar ?? "").trim().toLowerCase() !== String(data.nombre).trim().toLowerCase()) return json({ error: "confirmacion_invalida" }, 400);
    const impacto = await impactoDeUsuario(data.id);
    if (impacto.bloqueos.length) return json({ error: "tiene_historial", bloqueos: impacto.bloqueos }, 409);
    const del = await sb.from("usuarios").delete().eq("id", data.id);
    if (del.error) return del.error.code === "23503" ? json({ error: "tiene_historial", bloqueos: [] }, 409) : dbFail(del.error);
    dropLiveCache();
    await audit(actor, "usuario.eliminar", "usuario", data.id, { rut: data.rut, nombre: data.nombre, roles: data.roles ?? [], quedaronSinResponsable: impacto.avisos });
    return json({ ok: true, quedaronSinResponsable: impacto.avisos });
  }
  if (op === "usuarios.resetClave") {
    const clave = claveProvisoria(crypto.getRandomValues(new Uint8Array(10)));
    const { data, error } = await sb.from("usuarios").update({
      clave_hash: await hashSecret(clave), debe_cambiar_clave: true, actualizado_en: new Date().toISOString(),
    }).eq("id", String(body.id ?? "")).select().single();
    if (error) return dbFail(error);
    await audit(actor, "usuario.reiniciar_clave", "usuario", data.id, { rut: data.rut, nombre: data.nombre });
    return json({ usuario: pubUser(data), claveProvisoria: clave });
  }

  /* --- permisos por rol --- */
  if (op === "permisos.get") {
    try {
      const overrides = await rolePermOverrides();
      const porRol: Record<string, string[]> = {};
      for (const r of ROLES) porRol[r.id] = permisosDeRol(r.id, overrides);
      return json({ porRol, personalizados: Object.keys(overrides) });
    } catch (e) { return dbFail(e); }
  }
  if (op === "permisos.setRol") {
    const rol = String(body.rol ?? "");
    // El administrador general siempre tiene todo: no se recorta.
    if (!ROLES_ASIGNABLES.includes(rol)) return json({ error: "rol_invalido" }, 400);
    if (!Array.isArray(body.permisos)) return json({ error: "invalid_input" }, 400);
    const permisos = Array.from(new Set((body.permisos as unknown[]).map(String).filter((p) => PERMISO_IDS.includes(p))));
    const antes = permisosDeRol(rol, await rolePermOverrides().catch(() => ({})));
    const { error } = await sb.from("roles_permisos").upsert({ rol, permisos, actualizado_en: new Date().toISOString() }, { onConflict: "rol" });
    if (error) return dbFail(error);
    dropLiveCache();
    await audit(actor, "permisos.editar_rol", "rol", rol, {
      agregados: permisos.filter((p) => !antes.includes(p)),
      quitados: antes.filter((p) => !permisos.includes(p)),
    });
    return json({ ok: true, permisos });
  }
  if (op === "permisos.reiniciarRol") {
    const rol = String(body.rol ?? "");
    if (!ROLES_ASIGNABLES.includes(rol)) return json({ error: "rol_invalido" }, 400);
    const { error } = await sb.from("roles_permisos").delete().eq("rol", rol);
    if (error) return dbFail(error);
    dropLiveCache();
    await audit(actor, "permisos.reiniciar_rol", "rol", rol);
    return json({ ok: true, permisos: permisosDeRol(rol, {}) });
  }

  /* --- configuración del negocio --- */
  if (op === "config.get") {
    const { data, error } = await sb.from("config_negocio").select("clave, valor");
    if (error) return dbFail(error);
    const guardada: Record<string, unknown> = {};
    for (const r of data ?? []) guardada[r.clave] = r.valor;
    return json({ config: configCompleta(guardada) });
  }
  if (op === "config.set") {
    const clave = String(body.clave ?? "");
    const r = validarConfig(clave, body.valor);
    if (!r.ok) return json({ error: "invalid_input" }, 400);
    const { data: previo } = await sb.from("config_negocio").select("valor").eq("clave", clave).maybeSingle();
    const { error } = await sb.from("config_negocio").upsert({ clave, valor: r.value, actualizado_en: new Date().toISOString() }, { onConflict: "clave" });
    if (error) return dbFail(error);
    await audit(actor, "config.editar", "config", clave, { antes: previo?.valor ?? null, despues: r.value });
    return json({ ok: true, valor: r.value });
  }

  /* --- bitácora --- */
  if (op === "bitacora.list") {
    const limite = Math.min(Math.max(parseInt(String(body.limite ?? 50), 10) || 50, 1), 200);
    const desde = Math.max(parseInt(String(body.desde ?? 0), 10) || 0, 0);
    let q = sb.from("bitacora").select("*", { count: "exact" }).order("creado_en", { ascending: false }).range(desde, desde + limite - 1);
    const prefijo = String(body.prefijo ?? "").trim();
    if (prefijo) q = q.like("accion", prefijo.replace(/[\\%_]/g, (m) => "\\" + m) + "%");
    const { data, error, count } = await q;
    if (error) return dbFail(error);
    return json({ filas: data, total: count ?? 0 });
  }

  /* --- estado del sistema --- */
  if (op === "sistema.estado") {
    const t0 = Date.now();
    const ping = await sb.from("config_negocio").select("clave").limit(1);
    const dbMs = Date.now() - t0;
    if (ping.error && !isMissingTable(ping.error)) return dbFail(ping.error);
    const conteos: Record<string, number | null> = {};
    for (const t of ["usuarios", "locales", "clientes", "leads", "vehiculos", "cierres", "kv_store"]) {
      const r = await sb.from(t).select("*", { count: "exact", head: true });
      conteos[t] = r.error ? null : (r.count ?? 0);
    }
    const resp = await sb.from("bitacora").select("creado_en, detalle").eq("accion", "respaldo.realizado").order("creado_en", { ascending: false }).limit(1);
    const hace7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const fall = await sb.from("bitacora").select("creado_en, detalle").eq("accion", "aviso.fallido").gte("creado_en", hace7).order("creado_en", { ascending: false }).limit(50);
    const omit = await sb.from("bitacora").select("id").eq("accion", "aviso.omitido").gte("creado_en", hace7);
    const fallidos = fall.data ?? [];
    let patentesWebHoy = 0;
    let patentesGuardadas: number | null = null;
    try { patentesWebHoy = Number.parseInt((await dbGet(`patente_uso_web::${new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" })}`)) ?? "0", 10) || 0; } catch { /* sin dato */ }
    try { const g = await sb.from("patentes_consultadas").select("patente", { count: "exact", head: true }); patentesGuardadas = g.error ? null : (g.count ?? 0); } catch { /* tabla aún no creada */ }
    let patentesHoy = 0;
    try { patentesHoy = Number.parseInt((await dbGet(`patente_uso::${new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" })}`)) ?? "0", 10) || 0; } catch { /* sin dato */ }
    return json({
      patentes: { activa: !!Deno.env.get("BOOSTR_API_KEY"), usadasHoy: patentesHoy, usadasWebHoy: patentesWebHoy, limite: limiteDiario(Deno.env.get("BOOSTR_LIMITE_DIARIO")), limiteWeb: limiteWeb(limiteDiario(Deno.env.get("BOOSTR_LIMITE_DIARIO"))), guardadas: patentesGuardadas },
      ahora: new Date().toISOString(), dbMs, conteos,
      respaldo: (resp.data ?? [])[0] ? { en: resp.data[0].creado_en, detalle: resp.data[0].detalle ?? {} } : null,
      avisos: {
        activo: !!Deno.env.get("RESEND_API_KEY"), remitente: Deno.env.get("MAIL_FROM") ?? "", enlaceConfigurado: !!Deno.env.get("APP_URL"),
        fallidos7d: fallidos.length, omitidos7d: (omit.data ?? []).length,
        ultimosFallos: fallidos.slice(0, 3).map((f: any) => ({ en: f.creado_en, error: String(f.detalle?.error ?? "").slice(0, 200), asunto: String(f.detalle?.asunto ?? "") })),
      },
    });
  }

  return json({ error: "unknown_op" }, 400);
}

/* ---------- HTTP ---------- */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function adminAuthRecord() {
  try {
    const v = await dbGet("admin_auth");
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

async function masterOk(email: unknown, password: unknown) {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD_HASH) return false;
  if (typeof email !== "string" || typeof password !== "string") return false;
  const emailOk = email.trim().toLowerCase() === ADMIN_EMAIL;
  const pwOk = await verifySecret(password, ADMIN_PASSWORD_HASH); // siempre se calcula (tiempo constante)
  return emailOk && pwOk;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  // Chequeo de salud para monitores externos (UptimeRobot y similares): responde 200 solo si la base contesta. No devuelve datos.
  if (req.method === "GET" && new URL(req.url).searchParams.has("health")) {
    const t0 = Date.now();
    try {
      const { error } = await sb.from(TABLE).select("key").limit(1);
      if (error) throw error;
      return json({ ok: true, ms: Date.now() - t0 });
    } catch { return json({ ok: false }, 503); }
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!SESSION_SECRET) return json({ error: "server_not_configured" }, 500);

  const len = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (len > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const action = body?.action;

  try {
    // Sitio web público: catálogo y solicitudes de los visitantes (no requiere sesión; se valida y limita adentro).
    if (action === "public") {
      return await publicOp({ sb, json, audit, isMissingTable, rolePermOverrides, ip }, body);
    }

    /* ----- autenticación ----- */
    if (action === "adminStatus") {
      return json({ hasExtra: !!(await adminAuthRecord()) });
    }

    if (action === "adminLogin") {
      if (blocked(ip, "admin")) return json({ error: "too_many_attempts" }, 429);
      const { email, password } = body;
      if (await masterOk(email, password)) return json({ token: await signSession("admin", "master", ADMIN_TTL_S) });
      const rec = await adminAuthRecord();
      if (rec && typeof email === "string" && typeof password === "string") {
        const emailOk = email.trim().toLowerCase() === String(rec.email ?? "").toLowerCase();
        const pwOk = await verifySecret(password, rec.passwordHash);
        if (emailOk && pwOk) return json({ token: await signSession("admin", "extra", ADMIN_TTL_S) });
      }
      await fail(ip, "admin");
      return json({ error: "invalid_credentials" }, 401);
    }

    if (action === "adminSetup") {
      // Crear/cambiar la clave adicional exige la clave maestra.
      if (blocked(ip, "admin")) return json({ error: "too_many_attempts" }, 429);
      if (!(await masterOk(body.masterEmail, body.masterPassword))) {
        await fail(ip, "admin");
        return json({ error: "invalid_credentials" }, 401);
      }
      const email = String(body.email ?? "").trim();
      if (!email.includes("@") || !validAdminPassword(body.password)) return json({ error: "invalid_input" }, 400);
      const code = genRecoveryCode();
      await dbSet("admin_auth", JSON.stringify({
        email,
        passwordHash: await hashSecret(body.password),
        recoveryHash: await hashSecret(code),
        updatedAt: new Date().toISOString(),
      }));
      return json({ recoveryCode: code });
    }

    if (action === "adminRecoverCheck" || action === "adminReset") {
      if (blocked(ip, "recover")) return json({ error: "too_many_attempts" }, 429);
      const rec = await adminAuthRecord();
      const code = String(body.code ?? "").trim().toUpperCase();
      if (!rec || !code || !(await verifySecret(code, rec.recoveryHash))) {
        await fail(ip, "recover");
        return json({ error: "invalid_code" }, 401);
      }
      if (action === "adminRecoverCheck") return json({ ok: true });
      if (!validAdminPassword(body.newPassword)) return json({ error: "invalid_input" }, 400);
      const next = genRecoveryCode();
      await dbSet("admin_auth", JSON.stringify({
        email: rec.email,
        passwordHash: await hashSecret(body.newPassword),
        recoveryHash: await hashSecret(next),
        updatedAt: new Date().toISOString(),
      }));
      return json({ recoveryCode: next });
    }

    if (action === "profileLogin") {
      if (blocked(ip, "profile")) return json({ error: "too_many_attempts" }, 429);
      const role = body.role === "inspector" ? "inspector" : body.role === "vendor" ? "vendor" : null;
      const code = String(body.code ?? "").trim().toUpperCase();
      if (!role || !code) return json({ error: "invalid_input" }, 400);
      const list = await dbJsonList(role === "vendor" ? "vendors" : "inspectors");
      const profile = list.find((p) => String(p?.id ?? "").toUpperCase() === code);
      if (!profile) {
        await fail(ip, "profile");
        return json({ error: "invalid_code" }, 401);
      }
      return json({ token: await signSession(role, profile.id, PROFILE_TTL_S), profile });
    }

    /* ----- personas del CRM (RUT y clave) ----- */
    if (action === "userLogin") {
      const rut = typeof body.rut === "string" && validarRut(body.rut) ? normalizarRut(body.rut) : "";
      const password = typeof body.password === "string" ? body.password : "";
      // Se limita por IP y también por RUT, para frenar a quien pruebe claves de una misma persona.
      if (blocked(ip, "user") || (rut && blocked(rut, "userrut"))) return json({ error: "too_many_attempts" }, 429);
      let u: any = null;
      if (rut) {
        const { data, error } = await sb.from("usuarios").select("*").eq("rut", rut).maybeSingle();
        if (error) {
          if (isMissingTable(error)) return json({ error: "crm_not_installed" }, 503);
          throw error;
        }
        u = data;
      }
      const claveOk = u ? await verifySecret(password, u.clave_hash) : (await consumeLoginTime(password), false);
      if (!u || !u.activo || !claveOk) {
        await fail(ip, "user");
        if (rut) await fail(rut, "userrut");
        return json({ error: "invalid_credentials" }, 401);
      }
      await sb.from("usuarios").update({ ultimo_acceso: new Date().toISOString() }).eq("id", u.id);
      return json({ token: await signSession("user", u.id, USER_TTL_S), me: await meOf(u) });
    }

    // Al recargar la página: confirma que la sesión sigue vigente y devuelve los datos y permisos ACTUALES de la persona.
    if (action === "userMe") {
      const s = await readSession(body.token);
      if (!s || s.role !== "user") return json({ error: "unauthorized" }, 401);
      const { data: u, error } = await sb.from("usuarios").select("*").eq("id", s.id).maybeSingle();
      if (error) throw error;
      if (!u || !u.activo) return json({ error: "unauthorized" }, 401);
      return json({ me: await meOf(u) });
    }

    if (action === "userChangePassword") {
      const s = await readSession(body.token);
      if (!s || s.role !== "user") return json({ error: "unauthorized" }, 401);
      if (blocked(ip, "userpw")) return json({ error: "too_many_attempts" }, 429);
      if (!claveValida(body.nueva)) return json({ error: "clave_invalida" }, 400);
      const { data: u, error } = await sb.from("usuarios").select("*").eq("id", s.id).maybeSingle();
      if (error) throw error;
      if (!u || !u.activo) return json({ error: "unauthorized" }, 401);
      if (!(await verifySecret(String(body.actual ?? ""), u.clave_hash))) {
        await fail(ip, "userpw");
        return json({ error: "invalid_credentials" }, 401);
      }
      if (body.actual === body.nueva) return json({ error: "clave_igual" }, 400);
      const { data: nuevo, error: e2 } = await sb.from("usuarios").update({
        clave_hash: await hashSecret(body.nueva), debe_cambiar_clave: false, actualizado_en: new Date().toISOString(),
      }).eq("id", u.id).select().single();
      if (e2) throw e2;
      await audit({ tipo: "usuario", id: u.id, nombre: u.nombre }, "usuario.cambiar_clave", "usuario", u.id);
      return json({ me: await meOf(nuevo) });
    }

    if (action === "crm") {
      const s = await readSession(body.token);
      if (!s) return json({ error: "unauthorized" }, 401);
      return await crmOp(s, body);
    }

    // Módulo comercial: inventario, clientes, leads y tareas. Cuenta maestra o persona del CRM.
    if (action === "ventas") {
      const s = await readSession(body.token);
      if (!s || (s.role !== "admin" && s.role !== "user")) return json({ error: "unauthorized" }, 401);
      let user = null;
      if (s.role === "user") {
        const vivo = await liveUser(s.id);
        if (!vivo) return json({ error: "unauthorized" }, 401);
        user = { id: s.id, nombre: vivo.nombre, localId: vivo.localId, permisos: vivo.permisos };
      }
      const actor: Actor = s.role === "admin" ? adminActor(s) : { tipo: "usuario", id: s.id, nombre: user!.nombre };
      try {
        return await ventasOp({ sb, json, audit, isMissingTable, rolePermOverrides, esAdmin: s.role === "admin", actor, user }, body);
      } catch (e) {
        // Quien llega aquí ya inició sesión: se le muestra el motivo técnico para poder corregirlo (nunca claves ni datos).
        console.error("ventas error:", body?.op, e);
        const detalle = String((e as any)?.message ?? e).slice(0, 300);
        return json({ error: "server_error", detalle: `${String(body?.op ?? "")}: ${detalle}` }, 500);
      }
    }

    /* ----- almacenamiento ----- */
    if (action === "kv") {
      const s = await readSession(body.token);
      if (!s) return json({ error: "unauthorized" }, 401);
      if (s.role === "user") {
        // Los permisos se leen de la base en cada petición: si la persona se desactiva o se le quita
        // un permiso, deja de tener acceso en segundos aunque su sesión siga vigente.
        const vivo = await liveUser(s.id);
        if (!vivo) return json({ error: "unauthorized" }, 401);
        s.perms = vivo.permisos;
        s.localId = vivo.localId;
      }
      const op = body.op;

      if (op === "list") {
        const prefix = String(body.prefix ?? "");
        if (!canList(s, prefix) && !(await supervisorLee(s, prefix))) return json({ error: "forbidden" }, 403);
        const esc = prefix.replace(/[\\%_]/g, (m) => `\\${m}`);
        const { data, error } = await sb.from(TABLE).select("key").like("key", `${esc}%`);
        if (error) throw error;
        const keys = (data ?? []).map((r: any) => r.key).filter((k: string) => k !== "admin_auth");
        return json({ keys });
      }

      const key = String(body.key ?? "");
      if (!key || key.length > 300 || !(canKv(s, op, key) || (op === "get" && await supervisorLee(s, key)))) return json({ error: "forbidden" }, 403);

      if (op === "get") {
        const value = await dbGet(key);
        return json({ value });
      }
      if (op === "set") {
        if (typeof body.value !== "string") return json({ error: "invalid_input" }, 400);
        await dbSet(key, body.value);
        return json({ ok: true });
      }
      if (op === "delete") {
        const { error } = await sb.from(TABLE).delete().eq("key", key);
        if (error) throw error;
        return json({ ok: true });
      }
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("api error:", e);
    return json({ error: "server_error" }, 500);
  }
});
