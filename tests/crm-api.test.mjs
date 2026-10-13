// Prueba la Edge Function REAL (supabase/functions/api/index.ts) contra una base de datos falsa en memoria.
// No es Supabase: solo imita lo mínimo (select/insert/update/upsert/delete) para comprobar la lógica de
// permisos, inicio de sesión y bitácora sin necesitar Deno ni red. La prueba con la base real se hace al desplegar.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/* ---------- base falsa ---------- */
const DEFAULTS = {
  usuarios: () => ({ id: randomUUID(), activo: true, debe_cambiar_clave: true, roles: [], permisos_extra: { otorgar: [], quitar: [] },
    email: null, telefono: null, local_id: null, ultimo_acceso: null, creado_en: new Date().toISOString() }),
  locales: () => ({ id: randomUUID(), activo: true, direccion: null, creado_en: new Date().toISOString() }),
  bitacora: () => ({ id: Math.floor(Math.random() * 1e9), creado_en: new Date().toISOString() }),
};
const UNICOS = { usuarios: ["rut"], locales: ["nombre"], roles_permisos: ["rol"], config_negocio: ["clave"], kv_store: ["key"] };

export function crearBaseFalsa() {
  const tablas = { usuarios: [], locales: [], roles_permisos: [], bitacora: [], config_negocio: [], kv_store: [] };
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
      like(c, p) { st.like = [c, p]; return b; },
      order(c, o) { st.orden = [c, o && o.ascending === false ? -1 : 1]; return b; },
      range(a, z) { st.rango = [a, z]; return b; },
      maybeSingle() { st.uno = "maybe"; return b; },
      single() { st.uno = "single"; return b; },
      then(res, rej) { return Promise.resolve(ejecutar()).then(res, rej); },
    };
    const coincide = (f) => st.filtros.every(([c, v]) => f[c] === v);
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
      const total = filas.length;
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
let db;
const IP = { n: 1 };

before(async () => {
  db = crearBaseFalsa();
  const dir = mkdtempSync(join(tmpdir(), "df-api-"));
  const fake = join(dir, "fake-supabase.mjs");
  writeFileSync(fake, "export const createClient = () => globalThis.__baseFalsa.cliente;\n");
  const core = pathToFileURL(resolve("supabase/functions/api/crm-core.js")).href;
  let src = readFileSync("supabase/functions/api/index.ts", "utf8");
  src = src.replace("npm:@supabase/supabase-js@2", pathToFileURL(fake).href).replace("./crm-core.js", core);
  const archivo = join(dir, "index.mts");
  writeFileSync(archivo, src);
  globalThis.__baseFalsa = db;
  const env = { SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k", SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD_HASH: hashPw(ADMIN_PW) };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  await import(pathToFileURL(archivo).href);
});

async function api(body) {
  const ip = `10.0.0.${IP.n}`;
  const res = await handler(new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));
  return { status: res.status, ...(await res.json()) };
}
const nuevaIp = () => { IP.n++; };

async function loginAdmin() {
  const r = await api({ action: "adminLogin", email: ADMIN_EMAIL, password: ADMIN_PW });
  assert.equal(r.status, 200);
  return r.token;
}
const crm = (token, op, extra = {}) => api({ action: "crm", token, op, ...extra });

const ANA = { nombre: "Ana Pérez", rut: "12.345.678-5", roles: ["inspector"], email: "ana@mail.cl" };

test("Sin sesión de administrador no se puede usar el panel del CRM", async () => {
  assert.equal((await crm(null, "usuarios.list")).status, 401);
  assert.equal((await crm("basura.token", "usuarios.list")).status, 401);
});

test("Una persona (rol user) no puede administrar el CRM", async () => {
  const admin = await loginAdmin();
  const c = await crm(admin, "usuarios.create", { datos: ANA });
  assert.equal(c.status, 200);
  const l = await api({ action: "userLogin", rut: "12345678-5", password: c.claveProvisoria });
  assert.equal(l.status, 200);
  for (const op of ["usuarios.list", "usuarios.create", "permisos.setRol", "config.set", "bitacora.list", "locales.create"]) {
    assert.equal((await crm(l.token, op, { datos: ANA, rol: "inspector", permisos: [], clave: "x", valor: 1 })).status, 403, op);
  }
});

test("Crear usuario: valida RUT, guarda la clave solo como hash y registra en la bitácora", async () => {
  const admin = await loginAdmin();
  assert.equal((await crm(admin, "usuarios.create", { datos: { ...ANA, rut: "12345678-9" } })).error, "rut_invalido");
  assert.equal((await crm(admin, "usuarios.create", { datos: { ...ANA, rut: "6.000.000-K", nombre: "x" } })).error, "nombre_invalido");
  const dup = await crm(admin, "usuarios.create", { datos: ANA });
  assert.equal(dup.status, 409, "el mismo RUT no se puede crear dos veces");

  const ok = await crm(admin, "usuarios.create", { datos: { nombre: "Beto Soto", rut: "6.000.000-K", roles: ["ejecutivo"] }, clave: "ClaveInicial9" });
  assert.equal(ok.status, 200);
  assert.equal(ok.usuario.rut, "6000000-K");
  assert.equal(ok.usuario.debeCambiarClave, true);
  assert.equal(ok.usuario.clave_hash, undefined, "nunca se devuelve el hash");
  assert.equal(JSON.stringify(ok).includes("pbkdf2"), false);
  const fila = db.tablas.usuarios.find((u) => u.rut === "6000000-K");
  assert.ok(fila.clave_hash.startsWith("pbkdf2$"));
  assert.ok(!JSON.stringify(fila).includes("ClaveInicial9"));
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "usuario.crear" && b.entidad_id === fila.id));
});

test("Crear usuario: rechaza rol administrador general y clave débil", async () => {
  const admin = await loginAdmin();
  assert.equal((await crm(admin, "usuarios.create", { datos: { nombre: "Eva Mora", rut: "11.111.111-1", roles: ["admin_general"] } })).error, "rol_invalido");
  assert.equal((await crm(admin, "usuarios.create", { datos: { nombre: "Eva Mora", rut: "11.111.111-1", roles: ["tasador"] }, clave: "corta" })).error, "clave_invalida");
});

test("Ingreso con RUT: acepta formas distintas del RUT, rechaza clave mala sin dar pistas", async () => {
  const admin = await loginAdmin();
  const c = await crm(admin, "usuarios.create", { datos: { nombre: "Carla Díaz", rut: "11.111.111-1", roles: ["tasador"] }, clave: "Carla12345" });
  nuevaIp();
  const a = await api({ action: "userLogin", rut: "11.111.111-1", password: "Carla12345" });
  const b = await api({ action: "userLogin", rut: "111111111", password: "Carla12345" });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(a.me.roles, ["tasador"]);
  assert.ok(a.me.permisos.includes("tasacion_compra.usar"));
  assert.equal(a.me.clave_hash, undefined);

  const mala = await api({ action: "userLogin", rut: "11.111.111-1", password: "otra" });
  const inexistente = await api({ action: "userLogin", rut: "9.999.999-3", password: "Carla12345" });
  const rutMalo = await api({ action: "userLogin", rut: "123", password: "x" });
  assert.deepEqual([mala.status, mala.error], [401, "invalid_credentials"]);
  assert.deepEqual([inexistente.status, inexistente.error], [401, "invalid_credentials"]);
  assert.deepEqual([rutMalo.status, rutMalo.error], [401, "invalid_credentials"]);
  assert.ok(db.tablas.usuarios.find((u) => u.rut === "11111111-1").ultimo_acceso);
  void c;
});

test("Una persona desactivada no puede entrar, y su sesión abierta deja de funcionar", async () => {
  const admin = await loginAdmin();
  const c = await crm(admin, "usuarios.create", { datos: { nombre: "Diego Rojas", rut: "7.654.321-6", roles: ["inspector"] }, clave: "Diego12345" });
  assert.equal(c.status, 200, JSON.stringify(c));
  nuevaIp();
  const l = await api({ action: "userLogin", rut: "7654321-6", password: "Diego12345" });
  assert.equal(l.status, 200);
  const clave = `inspeccion::${c.usuario.id}::1`;
  assert.equal((await api({ action: "kv", token: l.token, op: "set", key: clave, value: "{}" })).status, 200);

  await crm(admin, "usuarios.setActivo", { id: c.usuario.id, activo: false });
  // La caché de 15 s se vacía al desactivar en la misma instancia.
  assert.equal((await api({ action: "kv", token: l.token, op: "get", key: clave })).status, 401);
  nuevaIp();
  assert.equal((await api({ action: "userLogin", rut: "7654321-6", password: "Diego12345" })).status, 401);

  await crm(admin, "usuarios.setActivo", { id: c.usuario.id, activo: true });
  nuevaIp();
  assert.equal((await api({ action: "userLogin", rut: "7654321-6", password: "Diego12345" })).status, 200);
});

test("Permisos y almacenamiento: cada persona solo toca lo suyo y solo con el permiso", async () => {
  const admin = await loginAdmin();
  const mk = async (rut, nombre, roles) => (await crm(admin, "usuarios.create", { datos: { nombre, rut, roles }, clave: "Prueba12345" })).usuario;
  const ins = await mk("8.765.432-K", "Inés Vega", ["inspector"]);
  const eje = await mk("5.555.555-9", "Elisa Mena", ["ejecutivo"]);
  assert.ok(ins && eje);
  nuevaIp();
  const tIns = (await api({ action: "userLogin", rut: ins.rut, password: "Prueba12345" })).token;
  const tEje = (await api({ action: "userLogin", rut: eje.rut, password: "Prueba12345" })).token;
  const kv = (token, op, key, extra = {}) => api({ action: "kv", token, op, key, ...extra });

  // El inspector escribe y lee lo suyo (inspecciones, tasaciones y fotos), no lo ajeno.
  assert.equal((await kv(tIns, "set", `inspeccion::${ins.id}::a`, { value: "1" })).status, 200);
  assert.equal((await kv(tIns, "set", `tasacion::${ins.id}::a`, { value: "1" })).status, 200);
  assert.equal((await kv(tIns, "set", `foto::${ins.id}::p`, { value: "x" })).status, 200);
  assert.equal((await kv(tIns, "get", `inspeccion::${eje.id}::a`)).status, 403);
  assert.equal((await kv(tIns, "set", "vendors", { value: "[]" })).status, 403);
  assert.equal((await kv(tIns, "get", "admin_auth")).status, 403);
  assert.equal((await api({ action: "kv", token: tIns, op: "list", prefix: "inspeccion::" })).status, 403, "no puede listar todo");
  assert.equal((await api({ action: "kv", token: tIns, op: "list", prefix: `inspeccion::${ins.id}::` })).status, 200);
  assert.equal((await kv(tIns, "delete", `inspeccion::${ins.id}::a`)).status, 200);

  // El ejecutivo no tiene permisos de inspección: aunque use su propio id, no escribe.
  assert.equal((await kv(tEje, "set", `inspeccion::${eje.id}::a`, { value: "1" })).status, 403);
  assert.equal((await kv(tEje, "get", "uf_valor")).status, 200, "lo compartido de solo lectura sí");
  assert.equal((await kv(tEje, "set", "uf_valor", { value: "1" })).status, 403);

  // Dar el permiso a la persona (extra) lo habilita de inmediato; quitarlo, lo cierra.
  await crm(admin, "usuarios.update", { id: eje.id, datos: { nombre: eje.nombre, roles: ["ejecutivo"], extra: { otorgar: ["inspecciones.usar"], quitar: [] } } });
  assert.equal((await kv(tEje, "set", `inspeccion::${eje.id}::a`, { value: "1" })).status, 200);
  await crm(admin, "usuarios.update", { id: eje.id, datos: { nombre: eje.nombre, roles: ["ejecutivo"], extra: { otorgar: [], quitar: [] } } });
  assert.equal((await kv(tEje, "set", `inspeccion::${eje.id}::a`, { value: "1" })).status, 403);

  // Cambiar los permisos del ROL también se aplica a todas las personas con ese rol.
  await crm(admin, "permisos.setRol", { rol: "inspector", permisos: ["inspecciones.usar"] });
  assert.equal((await kv(tIns, "set", `tasacion::${ins.id}::b`, { value: "1" })).status, 403, "se le quitó tasaciones.usar al rol");
  assert.equal((await kv(tIns, "set", `inspeccion::${ins.id}::b`, { value: "1" })).status, 200);
  await crm(admin, "permisos.reiniciarRol", { rol: "inspector" });
  assert.equal((await kv(tIns, "set", `tasacion::${ins.id}::b`, { value: "1" })).status, 200);
});

test("Permisos de rol: solo roles asignables, solo permisos del catálogo, queda en la bitácora", async () => {
  const admin = await loginAdmin();
  assert.equal((await crm(admin, "permisos.setRol", { rol: "admin_general", permisos: [] })).status, 400);
  assert.equal((await crm(admin, "permisos.setRol", { rol: "inventado", permisos: [] })).status, 400);
  const r = await crm(admin, "permisos.setRol", { rol: "validador", permisos: ["validacion.usar", "no.existe"] });
  assert.deepEqual(r.permisos, ["validacion.usar"]);
  const g = await crm(admin, "permisos.get");
  assert.deepEqual(g.porRol.validador, ["validacion.usar"]);
  assert.ok(g.personalizados.includes("validador"));
  assert.equal(g.porRol.admin_general.length > 20, true, "el administrador general siempre tiene todo");
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "permisos.editar_rol" && b.entidad_id === "validador"));
});

test("Cambio de clave: pide la actual, exige clave válida y baja la marca de cambio obligatorio", async () => {
  const admin = await loginAdmin();
  const c = await crm(admin, "usuarios.create", { datos: { nombre: "Fabio Lagos", rut: "9.876.543-3", roles: ["marketing"] } });
  assert.equal(c.status, 200, JSON.stringify(c));
  nuevaIp();
  const l = await api({ action: "userLogin", rut: "9876543-3", password: c.claveProvisoria });
  assert.equal(l.me.debeCambiarClave, true);
  const mala = await api({ action: "userChangePassword", token: l.token, actual: "no-es", nueva: "NuevaClave77" });
  assert.equal(mala.status, 401);
  assert.equal((await api({ action: "userChangePassword", token: l.token, actual: c.claveProvisoria, nueva: "debil" })).error, "clave_invalida");
  assert.equal((await api({ action: "userChangePassword", token: l.token, actual: c.claveProvisoria, nueva: c.claveProvisoria })).error, "clave_igual");
  const ok = await api({ action: "userChangePassword", token: l.token, actual: c.claveProvisoria, nueva: "NuevaClave77" });
  assert.equal(ok.status, 200);
  assert.equal(ok.me.debeCambiarClave, false);
  nuevaIp();
  assert.equal((await api({ action: "userLogin", rut: "9876543-3", password: c.claveProvisoria })).status, 401, "la clave provisoria ya no sirve");
  assert.equal((await api({ action: "userLogin", rut: "9876543-3", password: "NuevaClave77" })).status, 200);
  assert.equal((await api({ action: "userChangePassword", token: await loginAdmin(), actual: "a", nueva: "NuevaClave78" })).status, 401, "el administrador no usa esta ruta");
});

test("Reiniciar clave: genera una nueva provisoria y vuelve a exigir el cambio", async () => {
  const admin = await loginAdmin();
  const c = await crm(admin, "usuarios.create", { datos: { nombre: "Gala Pino", rut: "13.579.246-2", roles: ["anunciante"] }, clave: "GalaInicial1" });
  const r = await crm(admin, "usuarios.resetClave", { id: c.usuario.id });
  assert.equal(r.status, 200);
  assert.notEqual(r.claveProvisoria, "GalaInicial1");
  nuevaIp();
  assert.equal((await api({ action: "userLogin", rut: c.usuario.rut, password: "GalaInicial1" })).status, 401);
  assert.equal((await api({ action: "userLogin", rut: c.usuario.rut, password: r.claveProvisoria })).status, 200);
});

test("Demasiados intentos fallidos sobre un mismo RUT lo bloquean temporalmente", async () => {
  const admin = await loginAdmin();
  const c = await crm(admin, "usuarios.create", { datos: { nombre: "Hugo Salas", rut: "10.000.013-K", roles: ["validador"] }, clave: "Hugo123456" });
  let ultimo;
  for (let i = 0; i < 11; i++) { nuevaIp(); ultimo = await api({ action: "userLogin", rut: c.usuario.rut, password: "mala" + i }); }
  assert.equal(ultimo.status, 429);
  nuevaIp();
  assert.equal((await api({ action: "userLogin", rut: c.usuario.rut, password: "Hugo123456" })).status, 429, "ni con la clave correcta mientras dura el bloqueo");
});

test("Locales: crear, no repetir nombre, desactivar", async () => {
  const admin = await loginAdmin();
  const a = await crm(admin, "locales.create", { nombre: "Sucursal Norte", direccion: "Av. 1" });
  assert.equal(a.status, 200);
  assert.equal((await crm(admin, "locales.create", { nombre: "sucursal norte" })).status, 409);
  assert.equal((await crm(admin, "locales.create", { nombre: "x" })).status, 400);
  const u = await crm(admin, "locales.update", { id: a.local.id, nombre: "Sucursal Norte", direccion: "Av. 2", activo: false });
  assert.equal(u.local.activo, false);
  const l = await crm(admin, "locales.list");
  assert.ok(l.locales.some((x) => x.nombre === "Sucursal Norte"));
  // Un usuario no puede apuntar a un local que no existe.
  assert.equal((await crm(admin, "usuarios.create", { datos: { nombre: "Ivo Reyes", rut: "12.000.000-4", roles: ["tasador"], localId: randomUUID() } })).error, "local_invalido");
});

test("Configuración del negocio: valores iniciales, validación y bitácora con antes/después", async () => {
  const admin = await loginAdmin();
  const g = await crm(admin, "config.get");
  assert.ok(g.config.fuentes_lead.includes("Sitio web"));
  assert.equal((await crm(admin, "config.set", { clave: "comision_ventas_pct", valor: 500 })).status, 400);
  assert.equal((await crm(admin, "config.set", { clave: "inventada", valor: 1 })).status, 400);
  const ok = await crm(admin, "config.set", { clave: "comision_ventas_pct", valor: 2.5 });
  assert.equal(ok.valor, 2.5);
  assert.equal((await crm(admin, "config.get")).config.comision_ventas_pct, 2.5);
  const fila = db.tablas.bitacora.find((b) => b.accion === "config.editar" && b.entidad_id === "comision_ventas_pct");
  assert.deepEqual(fila.detalle, { antes: null, despues: 2.5 });
});

test("Bitácora: más recientes primero, con total y filtro por tipo de acción", async () => {
  const admin = await loginAdmin();
  const todo = await crm(admin, "bitacora.list", { limite: 5 });
  assert.equal(todo.status, 200);
  assert.ok(todo.total >= 5 && todo.filas.length === 5);
  const soloUsuarios = await crm(admin, "bitacora.list", { limite: 200, prefijo: "usuario." });
  assert.ok(soloUsuarios.filas.length > 0 && soloUsuarios.filas.every((f) => f.accion.startsWith("usuario.")));
  assert.ok(soloUsuarios.filas.every((f) => f.actor_tipo && f.accion));
});

test("Si faltan las tablas del CRM, el servidor lo dice claramente en vez de fallar a ciegas", async () => {
  const admin = await loginAdmin();
  const guardadas = { ...db.tablas };
  delete db.tablas.usuarios;
  try {
    const r = await crm(admin, "usuarios.list");
    assert.equal(r.status, 503);
    assert.equal(r.error, "crm_not_installed");
    nuevaIp();
    assert.equal((await api({ action: "userLogin", rut: "12.345.678-5", password: "x" })).error, "crm_not_installed");
  } finally { Object.assign(db.tablas, guardadas); }
});

test("Las sesiones antiguas (ejecutivo/inspector por código) siguen funcionando", async () => {
  const admin = await loginAdmin();
  await api({ action: "kv", token: admin, op: "set", key: "inspectors", value: JSON.stringify([{ id: "ABC123", nombre: "Viejo" }]) });
  nuevaIp();
  const l = await api({ action: "profileLogin", role: "inspector", code: "abc123" });
  assert.equal(l.status, 200);
  assert.equal((await api({ action: "kv", token: l.token, op: "set", key: "inspeccion::ABC123::1", value: "{}" })).status, 200);
  assert.equal((await api({ action: "kv", token: l.token, op: "set", key: "inspeccion::OTRO::1", value: "{}" })).status, 403);
});
