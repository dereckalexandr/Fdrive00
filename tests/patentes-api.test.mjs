// Datos del vehículo por patente (API de Boostr simulada): permisos, caché, cupo diario y errores, contra la función real.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, boostr, entorno, db } from "./helpers/api-env.mjs";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const U = {};
let admin;
const OK = (placa, extra = {}) => ({ status: "success", data: { plate: placa, dv: "8", make: "SUBARU", model: "NEW WRX S AWD CVT 2.0T", year: 2014, type: "AUTOMOVIL", engine: "H983322", ...extra } });

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra }, clave: "Prueba12345" });
  assert.equal(r.status, 200, JSON.stringify(r));
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: "Prueba12345" });
  U[clave] = { id: r.usuario.id, token: l.token };
}
const reiniciar = () => { boostr.llamadas.length = 0; for (const k of Object.keys(boostr.respuestas)) delete boostr.respuestas[k]; db.tablas.kv_store = db.tablas.kv_store.filter((x) => !/^patente(_uso)?::/.test(x.key)); };

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  const L = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  // Cada prueba usa su propia persona: el freno por minuto es por persona y se mantiene entre pruebas.
  const ruts = ["5.555.555-9", "7.654.321-6", "9.876.543-3", "8.765.432-K", "13.000.000-2", "14.000.000-0"];
  for (const [i, rut] of ruts.entries()) await crear(`t${i + 1}`, `Tasador ${i + 1}`, rut, ["tasador"], L);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L, { otorgar: ["ventas.operar"], quitar: [] });
  await crear("mkt", "Marta Marketing", "10.000.013-K", ["marketing"], L);
});

test("Consulta por patente: devuelve marca, modelo, año y tipo; la clave sale solo en el encabezado y nunca se pide el dueño", async () => {
  reiniciar();
  boostr.respuestas.GPDD74 = OK("GPDD74", { owner: { fullname: "JUAN PEREZ", documentNumber: "12.345.678-5" } });
  const r = await ve(U.t1.token, "vehiculos.patente", { patente: "gp-dd74" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual(r.vehiculo, { patente: "GPDD74", marca: "Subaru", modeloCompleto: "NEW WRX S AWD CVT 2.0T", anio: 2014, tipo: "AUTOMOVIL" });
  assert.equal(r.origen, "boostr");
  assert.equal(boostr.llamadas.length, 1);
  assert.equal(boostr.llamadas[0].clave, "clave_prueba");
  assert.ok(!boostr.llamadas[0].url.includes("owner"), "no se pide el dueño");
  assert.ok(!boostr.llamadas[0].url.includes("clave_prueba"), "la clave no va en la dirección");
  const t = JSON.stringify(r);
  for (const prohibido of ["JUAN", "PEREZ", "12.345.678-5", "clave_prueba"]) assert.ok(!t.includes(prohibido), prohibido);
});

test("Caché: la misma patente no vuelve a consultarse (ni gasta cupo)", async () => {
  reiniciar();
  boostr.respuestas.GPDD74 = OK("GPDD74");
  const a = await ve(U.t2.token, "vehiculos.patente", { patente: "GPDD74" });
  const b = await ve(U.e1.token, "vehiculos.patente", { patente: "GPDD74" });
  assert.equal(a.origen, "boostr");
  assert.equal(b.origen, "guardada");
  assert.deepEqual(a.vehiculo, b.vehiculo);
  assert.equal(boostr.llamadas.length, 1);
  const uso = db.tablas.kv_store.find((x) => x.key.startsWith("patente_uso::"));
  assert.equal(uso.value, "1");
  // Un registro guardado hace más de 60 días se vuelve a consultar.
  const reg = db.tablas.kv_store.find((x) => x.key === "patente::GPDD74");
  reg.value = JSON.stringify({ ...JSON.parse(reg.value), consultadoEn: new Date(Date.now() - 61 * 86_400_000).toISOString() });
  assert.equal((await ve(U.t2.token, "vehiculos.patente", { patente: "GPDD74" })).origen, "boostr");
  assert.equal(boostr.llamadas.length, 2);
});

test("Cupo diario: al llegar al tope se avisa y no se consulta más; lo ya guardado sigue disponible", async () => {
  reiniciar();
  const placas = ["AAAA11", "BBBB22", "CCCC33", "DDDD44", "EEEE55", "FFFF66"];
  for (const p of placas) boostr.respuestas[p] = OK(p);
  for (const p of placas.slice(0, 5)) assert.equal((await ve(U.t3.token, "vehiculos.patente", { patente: p })).status, 200, p);
  nuevaIp();
  const sexta = await ve(U.t3.token, "vehiculos.patente", { patente: "FFFF66" });
  assert.equal(sexta.status, 429);
  assert.equal(sexta.error, "cupo_agotado");
  assert.equal(boostr.llamadas.length, 5);
  assert.equal((await ve(U.t3.token, "vehiculos.patente", { patente: "AAAA11" })).origen, "guardada", "una patente ya consultada no necesita cupo");
  entorno.BOOSTR_LIMITE_DIARIO = "6";
  assert.equal((await ve(U.t3.token, "vehiculos.patente", { patente: "FFFF66" })).status, 200, "con más cupo configurado vuelve a funcionar");
  entorno.BOOSTR_LIMITE_DIARIO = "5";
});

test("Errores: no encontrada, patente inválida, servicio caído y sin clave configurada", async () => {
  reiniciar();
  assert.equal((await ve(U.t4.token, "vehiculos.patente", { patente: "ZZZZ99" })).error, "no_encontrada");
  assert.equal((await ve(U.t4.token, "vehiculos.patente", { patente: "12" })).error, "patente_invalida");
  assert.equal((await ve(U.t4.token, "vehiculos.patente", {})).error, "patente_invalida");
  boostr.respuestas.YYYY88 = 503;
  assert.equal((await ve(U.t4.token, "vehiculos.patente", { patente: "YYYY88" })).error, "servicio_no_disponible");
  boostr.respuestas.XXXX77 = new Error("fetch failed");
  assert.equal((await ve(U.t4.token, "vehiculos.patente", { patente: "XXXX77" })).error, "servicio_no_disponible");
  boostr.respuestas.WWWW66 = 401;
  assert.equal((await ve(U.t4.token, "vehiculos.patente", { patente: "WWWW66" })).error, "servicio_no_disponible", "clave rechazada: se avisa como servicio no disponible");
  assert.ok(!db.tablas.kv_store.some((x) => /^patente::(ZZZZ99|YYYY88|XXXX77|WWWW66)$/.test(x.key)), "un error no se guarda como si fuera un dato");
  const clave = entorno.BOOSTR_API_KEY;
  entorno.BOOSTR_API_KEY = "";
  assert.equal((await ve(U.t4.token, "vehiculos.patente", { patente: "GPDD74" })).error, "no_configurado");
  entorno.BOOSTR_API_KEY = clave;
});

test("Permisos: sin sesión no; Marketing (sin trabajo con vehículos) no; Tasador, Ejecutivo y la cuenta maestra sí", async () => {
  reiniciar();
  boostr.respuestas.GPDD74 = OK("GPDD74");
  assert.equal((await ve(null, "vehiculos.patente", { patente: "GPDD74" })).status, 401);
  assert.equal((await ve(U.mkt.token, "vehiculos.patente", { patente: "GPDD74" })).status, 403);
  assert.equal((await ve(U.t5.token, "vehiculos.patente", { patente: "GPDD74" })).status, 200);
  assert.equal((await ve(U.e1.token, "vehiculos.patente", { patente: "GPDD74" })).status, 200);
  assert.equal((await ve(admin, "vehiculos.patente", { patente: "GPDD74" })).status, 200);
});

test("Freno por persona: no más de unas pocas consultas por minuto", async () => {
  reiniciar();
  entorno.BOOSTR_LIMITE_DIARIO = "100";
  for (let i = 0; i < 12; i++) boostr.respuestas[`HH${String(1000 + i)}`] = OK(`HH${1000 + i}`);
  const estados = [];
  for (let i = 0; i < 12; i++) estados.push((await ve(U.t6.token, "vehiculos.patente", { patente: `HH${1000 + i}` })).status);
  assert.ok(estados.slice(0, 7).every((s) => s === 200), JSON.stringify(estados));
  assert.ok(estados.includes(429), "después de unas cuantas seguidas se frena");
  entorno.BOOSTR_LIMITE_DIARIO = "5";
});

test("Los datos guardados de patentes no los puede leer ni escribir nadie desde el navegador", async () => {
  reiniciar();
  boostr.respuestas.GPDD74 = OK("GPDD74");
  await ve(U.t2.token, "vehiculos.patente", { patente: "GPDD74" });
  for (const token of [U.t2.token, U.e1.token]) {
    assert.equal((await api({ action: "kv", token, op: "get", key: "patente::GPDD74" })).status, 403);
    assert.equal((await api({ action: "kv", token, op: "set", key: "patente::GPDD74", value: "{}" })).status, 403);
    assert.equal((await api({ action: "kv", token, op: "set", key: "patente_uso::2026-01-01", value: "0" })).status, 403);
  }
});

test("Estado del sistema: muestra si la consulta por patente está activa y cuánto cupo se usó hoy", async () => {
  reiniciar();
  boostr.respuestas.GPDD74 = OK("GPDD74");
  await ve(U.t1.token, "vehiculos.patente", { patente: "GPDD74" });
  const e = await crm(admin, "sistema.estado");
  assert.deepEqual(e.patentes, { activa: true, usadasHoy: 1, limite: 5 });
});
