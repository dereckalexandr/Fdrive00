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
let contadorCotizaciones = 0;
let contadorCierres = 0;
let contadorTasaciones = 0;
let contadorInspecciones = 0;
let contadorValidaciones = 0;
let contadorAnuncios = 0;
let contadorCompras = 0;
let contadorConsig = 0;
let contadorCampanias = 0;
let contadorPublicaciones = 0;
const DEFAULTS = {
  usuarios: () => ({ id: randomUUID(), comision: {}, activo: true, debe_cambiar_clave: true, roles: [], permisos_extra: { otorgar: [], quitar: [] },
    email: null, telefono: null, local_id: null, ultimo_acceso: null, creado_en: new Date().toISOString() }),
  locales: () => ({ id: randomUUID(), activo: true, direccion: null, creado_en: new Date().toISOString() }),
  vehiculos: () => ({ id: randomUUID(), activo: true, estado: "disponible", fotos: [], creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  clientes: () => ({ id: randomUUID(), creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  leads: () => ({ id: randomUUID(), etapa: "nuevo", tipo: "venta", parte_pago: {}, financiamiento: {}, ultimo_contacto: null, motivo_perdida: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  lead_eventos: () => ({ id: Math.floor(Math.random() * 1e9), creado_en: new Date().toISOString() }),
  cotizaciones: () => ({ id: randomUUID(), numero: ++contadorCotizaciones, estado: "vigente", descuento: 0, aprobado_por: null, aprobado_en: null, motivo_rechazo: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  tasaciones: () => ({ id: randomUUID(), numero: ++contadorTasaciones, estado: "pendiente", tipo: "parte_pago", tasador_id: null, contacto: {}, estimacion: {}, inspeccion: {}, fotos: [], valor_compra: null, valor_venta: null, observaciones: null, solicitada_en: new Date().toISOString(), tomada_en: null, completada_en: null, cancelada_en: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  inspecciones: () => ({ id: randomUUID(), numero: ++contadorInspecciones, estado: "pendiente", origen: "lead", inspector_id: null, inspeccion_key: null, resultado: {}, fotos: [], vehiculo: {}, solicitada_en: new Date().toISOString(), tomada_en: null, completada_en: null, cancelada_en: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  validaciones: () => ({ id: randomUUID(), numero: ++contadorValidaciones, estado: "pendiente", validador_id: null, sujeto: {}, solicitada_en: new Date().toISOString(), tomada_en: null, resuelta_en: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  validacion_docs: () => ({ id: randomUUID(), estado: "pendiente", comentario: null, archivos: [], requerido: true, grupo: "vehiculo", revisado_por: null, revisado_en: null, orden: 0, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  anuncios: () => ({ id: randomUUID(), numero: ++contadorAnuncios, estado: "por_publicar", baja_en: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  anuncio_portales: () => ({ id: randomUUID(), estado: "pendiente", url: null, precio_publicado: null, publicado_en: null, vence_en: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  campanias: () => ({ id: randomUUID(), numero: ++contadorCampanias, estado: "borrador", presupuesto: 0, presupuesto_aprobado: 0, gasto: 0, alcance: 0, impresiones: 0, clics: 0, motivo_rechazo: null, aprobado_por: null, aprobado_en: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  publicaciones_rrss: () => ({ id: randomUUID(), numero: ++contadorPublicaciones, estado: "idea", tipo: "post", fecha_programada: null, texto: null, url: null, campania_id: null, vehiculo_id: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  material_vehiculo: () => ({ id: randomUUID(), estado: "pendiente", url: null, notas: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  compras: () => ({ id: randomUUID(), numero: ++contadorCompras, estado: "oferta", vehiculo: {}, motivo: null, monto_final: null, mes: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  consignaciones: () => ({ id: randomUUID(), numero: ++contadorConsig, estado: "en_validacion", vehiculo: {}, plazo_dias: 90, vence_en: null, motivo: null, cierre_id: null, precio_venta: null, margen: null, mes: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  avisos: () => ({ id: randomUUID(), leido_en: null, creado_en: new Date().toISOString() }),
  cierres: () => ({ id: randomUUID(), numero: ++contadorCierres, estado: "pendiente", mes: null, aprobado_por: null, aprobado_en: null, motivo_rechazo: null, anulado_por: null, anulado_en: null, motivo_anulacion: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  reservas: () => ({ id: randomUUID(), estado: "activa", motivo: null, cerrado_en: null, creado_en: new Date().toISOString() }),
  tareas: () => ({ id: randomUUID(), hecha: false, hecha_en: null, creado_en: new Date().toISOString() }),
  bitacora: () => ({ id: Math.floor(Math.random() * 1e9), creado_en: new Date().toISOString() }),
};
const UNICOS = { vehiculos: ["patente"], usuarios: ["rut"], locales: ["nombre"], roles_permisos: ["rol"], config_negocio: ["clave"], kv_store: ["key"] };

/** Convierte un patrón LIKE/ILIKE de SQL (% = cualquier texto, _ = una letra, \ escapa) a una expresión regular. */
function patronARegex(patron, insensible) {
  const BARRA = String.fromCharCode(92);
  const ESPECIALES = ".*+?^${}()|[]" + BARRA;
  let fuente = "";
  for (let i = 0; i < patron.length; i++) {
    const c = patron[i];
    if (c === BARRA && i + 1 < patron.length) { const n = patron[++i]; fuente += ESPECIALES.includes(n) ? BARRA + n : n; }
    else if (c === "%") fuente += ".*";
    else if (c === "_") fuente += ".";
    else fuente += ESPECIALES.includes(c) ? BARRA + c : c;
  }
  return new RegExp("^" + fuente + "$", insensible ? "is" : "s");
}

export function crearBaseFalsa() {
  const tablas = { usuarios: [], locales: [], roles_permisos: [], bitacora: [], config_negocio: [], kv_store: [], vehiculos: [], clientes: [], leads: [], lead_eventos: [], tareas: [], cotizaciones: [], reservas: [], cierres: [], avisos: [], tasaciones: [], inspecciones: [], validaciones: [], validacion_docs: [], anuncios: [], anuncio_portales: [], campanias: [], publicaciones_rrss: [], material_vehiculo: [], compras: [], consignaciones: [] };
  const consultas = [];

  function builder(nombre) {
    const st = { op: "select", filtros: [], payload: null, devolver: false, uno: null, opts: {}, orden: null, rango: null, likes: [] };
    const b = {
      select(_c, opts) { if (st.op !== "select") st.devolver = true; st.opts = opts || {}; return b; },
      insert(p) { st.op = "insert"; st.payload = p; return b; },
      update(p) { st.op = "update"; st.payload = p; return b; },
      upsert(p, o) { st.op = "upsert"; st.payload = p; st.upsertOn = o && o.onConflict; return b; },
      delete() { st.op = "delete"; return b; },
      eq(c, v) { st.filtros.push([c, v]); return b; },
      neq(c, v) { st.filtros.push([c, (x) => x !== v]); return b; },
      in(c, arr) { st.filtros.push([c, (x) => arr.includes(x)]); return b; },
      limit(n) { st.limite = n; return b; },
      gte(c, v) { st.filtros.push([c, (x) => x !== null && x !== undefined && x >= v]); return b; },
      lt(c, v) { st.filtros.push([c, (x) => x !== null && x !== undefined && x < v]); return b; },
      like(c, p) { st.likes.push([c, patronARegex(p, false)]); return b; },
      ilike(c, p) { st.likes.push([c, patronARegex(p, true)]); return b; },
      order(c, o) { st.orden = [c, o && o.ascending === false ? -1 : 1]; return b; },
      range(a, z) { st.rango = [a, z]; return b; },
      maybeSingle() { st.uno = "maybe"; return b; },
      single() { st.uno = "single"; return b; },
      // LATENCIA_MS (opcional) simula el viaje de ida y vuelta a la base real, para medir tiempos de las pantallas.
      then(res, rej) {
        const ms = Number(process.env.LATENCIA_MS || 0);
        const p = ms > 0 ? new Promise((r) => setTimeout(r, ms)).then(() => ejecutar()) : Promise.resolve(ejecutar());
        return p.then(res, rej);
      },
    };
    const coincide = (f) => st.filtros.every(([c, v]) => (typeof v === "function" ? v(f[c]) : f[c] === v));
    function ejecutar() {
      consultas.push({ tabla: nombre, op: st.op });
      const T = tablas[nombre];
      if (!T) return { data: null, error: { code: "42P01", message: `relation "${nombre}" does not exist` } };
      let filas = [];
      if (st.op === "insert" && Array.isArray(st.payload)) {
        // Varias filas a la vez (como la base real).
        filas = st.payload.map((p) => ({ ...(DEFAULTS[nombre] ? DEFAULTS[nombre]() : {}), ...p }));
        T.push(...filas);
      } else if (st.op === "insert" || st.op === "upsert") {
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
        for (const [col, re] of st.likes) filas = filas.filter((f) => re.test(String(f[col])));
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
/** Correos que la función habría enviado (uno por destinatario). */
export const correos = [];
/** Respuestas simuladas de la API de patentes (Boostr): `respuestas[PATENTE]` = JSON, un número de estado HTTP o un Error. */
export const boostr = { llamadas: [], respuestas: {} };
/** Variables de entorno de la función simulada (las pruebas pueden cambiarlas). */
export let entorno = {};
const IP = { n: 1 };

export const iniciarFuncion = async () => {
  db = crearBaseFalsa();
  const dir = mkdtempSync(join(tmpdir(), "df-api-"));
  const fake = join(dir, "fake-supabase.mjs");
  writeFileSync(fake, "export const createClient = () => globalThis.__baseFalsa.cliente;\n");
  const core = pathToFileURL(resolve("supabase/functions/api/crm-core.js")).href;
  let src = readFileSync("supabase/functions/api/index.ts", "utf8");
  src = src.replace("npm:@supabase/supabase-js@2", pathToFileURL(fake).href).replace("./crm-core.js", core).replace("./ventas.ts", pathToFileURL(resolve("supabase/functions/api/ventas.ts")).href).replace("./publico.ts", pathToFileURL(resolve("supabase/functions/api/publico.ts")).href).replace("./patentes-core.js", pathToFileURL(resolve("supabase/functions/api/patentes-core.js")).href);
  const archivo = join(dir, "index.mts");
  writeFileSync(archivo, src);
  globalThis.__baseFalsa = db;
  const env = { SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k", SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD_HASH: hashPw(ADMIN_PW), RESEND_API_KEY: "re_prueba", MAIL_FROM: "Drive Futuro <avisos@prueba.cl>", APP_URL: "https://app.prueba.cl", BOOSTR_API_KEY: "clave_prueba", BOOSTR_LIMITE_DIARIO: "5" };
  entorno = env;
  // Los avisos por correo no salen a internet: se guardan para revisarlos.
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.boostr.cl/vehicle/")) {
      const placa = String(url).split("/vehicle/")[1].replace(".json", "").split("?")[0];
      boostr.llamadas.push({ placa, clave: init && init.headers && init.headers["x-api-key"], url: String(url) });
      const r = boostr.respuestas[placa];
      if (r instanceof Error) throw r;
      if (typeof r === "number") return new Response("{}", { status: r });
      return new Response(JSON.stringify(r !== undefined ? r : { status: "error", data: "", code: "V-02", message: "No encontramos datos asociados a la patente ingresada" }), { status: 200 });
    }
    if (String(url).startsWith("https://api.resend.com/")) { correos.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
    return fetchReal(url, init);
  };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  await import(pathToFileURL(archivo).href);
};
export const prepararFuncion = () => before(iniciarFuncion);

/** Atiende una petición HTTP tal cual la recibiría la función (lo usa el entorno de demostración). */
export const manejar = (req) => handler(req);

export async function api(body) {
  const ip = `10.0.0.${IP.n}`;
  const res = await handler(new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));
  return { status: res.status, ...(await res.json()) };
}
export const nuevaIp = () => { IP.n++; };
/** GET sin cuerpo (chequeo de salud). */
export async function obtener(ruta) {
  const res = await handler(new Request("http://x/api" + ruta, { method: "GET" }));
  return { status: res.status, ...(await res.json()) };
}

export async function loginAdmin() {
  const r = await api({ action: "adminLogin", email: ADMIN_EMAIL, password: ADMIN_PW });
  assert.equal(r.status, 200);
  return r.token;
}
export const crm = (token, op, extra = {}) => api({ action: "crm", token, op, ...extra });


export { ADMIN_EMAIL, ADMIN_PW };
