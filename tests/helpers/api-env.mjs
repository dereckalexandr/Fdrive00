// Ayuda compartida de las pruebas de la Edge Function: base de datos falsa en memoria + carga del código real.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
void test; void assert;

/* ---------- base falsa ---------- */
const DEFAULTS = {
  usuarios: () => ({ id: randomUUID(), activo: true, debe_cambiar_clave: true, roles: [], permisos_extra: { otorgar: [], quitar: [] },
    email: null, telefono: null, local_id: null, ultimo_acceso: null, creado_en: new Date().toISOString() }),
  locales: () => ({ id: randomUUID(), activo: true, direccion: null, creado_en: new Date().toISOString() }),
  vehiculos: () => ({ id: randomUUID(), activo: true, estado: "disponible", fotos: [], creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  clientes: () => ({ id: randomUUID(), creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  leads: () => ({ id: randomUUID(), etapa: "nuevo", tipo: "venta", parte_pago: {}, financiamiento: {}, ultimo_contacto: null, motivo_perdida: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  lead_eventos: () => ({ id: Math.floor(Math.random() * 1e9), creado_en: new Date().toISOString() }),
  tareas: () => ({ id: randomUUID(), hecha: false, hecha_en: null, creado_en: new Date().toISOString() }),
  bitacora: () => ({ id: Math.floor(Math.random() * 1e9), creado_en: new Date().toISOString() }),
};
const UNICOS = { vehiculos: ["patente"], usuarios: ["rut"], locales: ["nombre"], roles_permisos: ["rol"], config_negocio: ["clave"], kv_store: ["key"] };

export function crearBaseFalsa() {
  const tablas = { usuarios: [], locales: [], roles_permisos: [], bitacora: [], config_negocio: [], kv_store: [], vehiculos: [], clientes: [], leads: [], lead_eventos: [], tareas: [] };
  const consultas = [];

  function builder(nombre) {
    const st = { op: "select", filtros: [], payload: null, devolver: false, uno: null, opts: {}, orden: null, rango: null, like: null };
    const b = {
      select(_c, opts) { if (st.op !== "select") st.devolver = true; st.opts = opts || {}; return b; },
      insert(p) { st.op = "insert"; st.payload = p; return b; },
      update(p) { st.op = "update"; st.payload = p; return b; },
      upsert(p, o) { st.op = "upsert"; st.payload = p; st.upsertOn = o && o.onConflict; return b; },
      delete() { st.op = "delete"; return b; },
      eq(c, v) { st.filtros.push([c, v]); return b; },
      in(c, arr) { st.filtros.push([c, (x) => arr.includes(x)]); return b; },
      limit(n) { st.limite = n; return b; },
      like(c, p) { st.like = [c, p]; return b; },
      order(c, o) { st.orden = [c, o && o.ascending === false ? -1 : 1]; return b; },
      range(a, z) { st.rango = [a, z]; return b; },
      maybeSingle() { st.uno = "maybe"; return b; },
      single() { st.uno = "single"; return b; },
      then(res, rej) { return Promise.resolve(ejecutar()).then(res, rej); },
    };
    const coincide = (f) => st.filtros.every(([c, v]) => (typeof v === "function" ? v(f[c]) : f[c] === v));
    function ejecutar() {
      consultas.push({ tabla: nombre, op: st.op });
      const T = tablas[nombre];
      if (!T) return { data: null, error: { code: "42P01", message: `relation "${nombre}" does not exist` } };
      let filas = [];
      if (st.op === "insert" || st.op === "upsert") {
        const nuevo = { ...(DEFAULTS[nombre] ? DEFAULTS[nombre]() : {}), ...st.payload };
        const claves = UNICOS[nombre] || [];
        const dup = T.find((f) => claves.some((c) => String(f[c]).toLowerCase() === String(nuevo[c]).toLowerCase()));
        if (dup && st.op === "insert") return { data: null, error: { code: "23505", message: "duplicate key" } };
        if (dup) { Object.assign(dup, st.payload); filas = [dup]; } else { T.push(nuevo); filas = [nuevo]; }
      } else if (st.op === "update") {
        filas = T.filter(coincide);
        filas.forEach((f) => Object.assign(f, st.payload));
      } else if (st.op === "delete") {
        const quedan = T.filter((f) => !coincide(f));
        filas = T.filter(coincide);
        T.length = 0; T.push(...quedan);
      } else {
        filas = T.filter(coincide);
        if (st.like) { const pre = st.like[1].replace(/%$/, "").replace(/\\(.)/g, "$1"); filas = filas.filter((f) => String(f[st.like[0]]).startsWith(pre)); }
        if (st.orden) filas = [...filas].sort((a, z) => (a[st.orden[0]] > z[st.orden[0]] ? 1 : -1) * st.orden[1]);
      }
      filas = filas.map((f) => structuredClone(f)); // como la base real: devuelve copias, no las filas guardadas
      const total = filas.length;
      if (st.limite) filas = filas.slice(0, st.limite);
      if (st.rango) filas = filas.slice(st.rango[0], st.rango[1] + 1);
      const quiereFilas = st.op === "select" || st.devolver;
      if (!quiereFilas) return { data: null, error: null };
      if (st.uno === "maybe") return { data: filas[0] ?? null, error: null };
      if (st.uno === "single") return filas[0] ? { data: filas[0], error: null } : { data: null, error: { message: "sin filas" } };
      return { data: filas, error: null, count: st.opts.count ? total : null };
    }
    return b;
  }
  return { tablas, consultas, cliente: { from: builder } };
}

/* ---------- carga de la función real ---------- */
const ADMIN_EMAIL = "admin@prueba.cl";
const ADMIN_PW = "MaestraSegura123";
const SESSION_SECRET = "secreto-de-prueba-largo-largo-largo";
const hashPw = (pw) => { const salt = randomBytes(16); return `pbkdf2$150000$${salt.toString("base64")}$${pbkdf2Sync(pw, salt, 150000, 32, "sha256").toString("base64")}`; };

let handler;
export let db;
const IP = { n: 1 };

export const iniciarFuncion = async () => {
  db = crearBaseFalsa();
  const dir = mkdtempSync(join(tmpdir(), "df-api-"));
  const fake = join(dir, "fake-supabase.mjs");
  writeFileSync(fake, "export const createClient = () => globalThis.__baseFalsa.cliente;\n");
  const core = pathToFileURL(resolve("supabase/functions/api/crm-core.js")).href;
  let src = readFileSync("supabase/functions/api/index.ts", "utf8");
  src = src.replace("npm:@supabase/supabase-js@2", pathToFileURL(fake).href).replace("./crm-core.js", core).replace("./ventas.ts", pathToFileURL(resolve("supabase/functions/api/ventas.ts")).href);
  const archivo = join(dir, "index.mts");
  writeFileSync(archivo, src);
  globalThis.__baseFalsa = db;
  const env = { SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k", SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD_HASH: hashPw(ADMIN_PW) };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  await import(pathToFileURL(archivo).href);
};
export const prepararFuncion = () => before(iniciarFuncion);

export async function api(body) {
  const ip = `10.0.0.${IP.n}`;
  const res = await handler(new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));
  return { status: res.status, ...(await res.json()) };
}
export const nuevaIp = () => { IP.n++; };

export async function loginAdmin() {
  const r = await api({ action: "adminLogin", email: ADMIN_EMAIL, password: ADMIN_PW });
  assert.equal(r.status, 200);
  return r.token;
}
export const crm = (token, op, extra = {}) => api({ action: "crm", token, op, ...extra });


export { ADMIN_EMAIL, ADMIN_PW };
