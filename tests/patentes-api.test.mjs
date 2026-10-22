// Datos del vehículo por patente (API de Boostr simulada): permisos, guardado permanente, cupo diario y errores,
// desde el CRM y desde el sitio web, contra la función real.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, boostr, entorno, db } from "./helpers/api-env.mjs";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const pub = (patente) => api({ action: "public", op: "patente", patente });
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
const reiniciar = () => {
  boostr.llamadas.length = 0;
  for (const k of Object.keys(boostr.respuestas)) delete boostr.respuestas[k];
  db.tablas.kv_store = db.tablas.kv_store.filter((x) => !/^patente(_uso(_web)?)?::/.test(x.key));
  db.tablas.patentes_consultadas.length = 0;
  entorno.BOOSTR_LIMITE_DIARIO = "5";
  entorno.BOOSTR_API_KEY = "clave_prueba";
};
const guardada = (placa) => db.tablas.patentes_consultadas.find((x) => x.patente === placa);

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  const L = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  // Cada prueba usa su propia persona: el freno por minuto es por persona y se mantiene entre pruebas.
  const ruts = ["5.555.555-9", "7.654.321-6", "9.876.543-3", "8.765.432-K", "13.000.000-2", "14.000.000-0", "12.000.000-4"];
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
  const t = JSON.stringify(r) + JSON.stringify(db.tablas.patentes_consultadas);
  for (const prohibido of ["JUAN", "PEREZ", "12.345.678-5", "clave_prueba"]) assert.ok(!t.includes(prohibido), prohibido);
});

test("Guardado permanente: cada patente nueva queda en la base de datos y no vuelve a consultarse ni a gastar cupo", async () => {
  reiniciar();
  boostr.respuestas.GPDD74 = OK("GPDD74");
  const a = await ve(U.t2.token, "vehiculos.patente", { patente: "GPDD74" });
  assert.equal(a.origen, "boostr");
  const fila = guardada("GPDD74");
  assert.ok(fila, "quedó guardada en patentes_consultadas");
  assert.equal(fila.marca, "Subaru");
  assert.equal(fila.modelo_completo, "NEW WRX S AWD CVT 2.0T");
  assert.equal(fila.anio, 2014);
  assert.equal(fila.fuente, "boostr:interno");
  const b = await ve(U.e1.token, "vehiculos.patente", { patente: "GPDD74" });
  assert.equal(b.origen, "guardada");
  assert.deepEqual(a.vehiculo, b.vehiculo);
  assert.equal(boostr.llamadas.length, 1);
  assert.equal(db.tablas.kv_store.find((x) => x.key.startsWith("patente_uso::")).value, "1", "la segunda consulta no gastó cupo");
  // Para siempre: aunque pasen años, no se vuelve a consultar.
  fila.consultado_en = new Date(Date.now() - 5 * 365 * 86_400_000).toISOString();
  assert.equal((await ve(U.t2.token, "vehiculos.patente", { patente: "GPDD74" })).origen, "guardada");
  assert.equal(boostr.llamadas.length, 1);
});

test("Lo guardado se responde aunque falte la clave o se haya agotado el cupo; lo nuevo, no", async () => {
  reiniciar();
  boostr.respuestas.GPDD74 = OK("GPDD74");
  await ve(U.t3.token, "vehiculos.patente", { patente: "GPDD74" });
  entorno.BOOSTR_API_KEY = "";
  assert.equal((await ve(U.t3.token, "vehiculos.patente", { patente: "GPDD74" })).origen, "guardada", "sin clave, la guardada igual responde");
  assert.equal((await ve(U.t3.token, "vehiculos.patente", { patente: "HHHH11" })).error, "no_configurado");
  entorno.BOOSTR_API_KEY = "clave_prueba";
  entorno.BOOSTR_LIMITE_DIARIO = "1";
  assert.equal((await ve(U.t3.token, "vehiculos.patente", { patente: "GPDD74" })).origen, "guardada", "con el cupo agotado, la guardada igual responde");
  assert.equal((await ve(U.t3.token, "vehiculos.patente", { patente: "HHHH11" })).error, "cupo_agotado");
});

test("Cupo diario: al llegar al tope se avisa y no se consulta más", async () => {
  reiniciar();
  const placas = ["AAAA11", "BBBB22", "CCCC33", "DDDD44", "EEEE55", "FFFF66"];
  for (const p of placas) boostr.respuestas[p] = OK(p);
  for (const p of placas.slice(0, 5)) assert.equal((await ve(U.t4.token, "vehiculos.patente", { patente: p })).status, 200, p);
  const sexta = await ve(U.t4.token, "vehiculos.patente", { patente: "FFFF66" });
  assert.equal(sexta.status, 429);
  assert.equal(sexta.error, "cupo_agotado");
  assert.equal(boostr.llamadas.length, 5);
  assert.equal(db.tablas.patentes_consultadas.length, 5, "solo se guardan las consultas que resultaron");
  entorno.BOOSTR_LIMITE_DIARIO = "6";
  assert.equal((await ve(U.t4.token, "vehiculos.patente", { patente: "FFFF66" })).status, 200, "con más cupo configurado vuelve a funcionar");
});

test("Errores: no encontrada, patente inválida, servicio caído y sin clave; un error nunca se guarda como dato", async () => {
  reiniciar();
  assert.equal((await ve(U.t5.token, "vehiculos.patente", { patente: "ZZZZ99" })).error, "no_encontrada");
  assert.equal((await ve(U.t5.token, "vehiculos.patente", { patente: "12" })).error, "patente_invalida");
  assert.equal((await ve(U.t5.token, "vehiculos.patente", {})).error, "patente_invalida");
  boostr.respuestas.YYYY88 = 503;
  assert.equal((await ve(U.t5.token, "vehiculos.patente", { patente: "YYYY88" })).error, "servicio_no_disponible");
  boostr.respuestas.XXXX77 = new Error("fetch failed");
  assert.equal((await ve(U.t5.token, "vehiculos.patente", { patente: "XXXX77" })).error, "servicio_no_disponible");
  boostr.respuestas.WWWW66 = 401;
  assert.equal((await ve(U.t5.token, "vehiculos.patente", { patente: "WWWW66" })).error, "servicio_no_disponible", "clave rechazada: se avisa como servicio no disponible");
  assert.equal(db.tablas.patentes_consultadas.length, 0, "ningún error quedó guardado");
  entorno.BOOSTR_API_KEY = "";
  assert.equal((await ve(U.t5.token, "vehiculos.patente", { patente: "GPDD74" })).error, "no_configurado");
});

test("Permisos: sin sesión no; Marketing no; Tasador, Ejecutivo y la cuenta maestra sí", async () => {
  reiniciar();
  boostr.respuestas.GPDD74 = OK("GPDD74");
  assert.equal((await ve(null, "vehiculos.patente", { patente: "GPDD74" })).status, 401);
  assert.equal((await ve(U.mkt.token, "vehiculos.patente", { patente: "GPDD74" })).status, 403);
  assert.equal((await ve(U.t6.token, "vehiculos.patente", { patente: "GPDD74" })).status, 200);
  assert.equal((await ve(U.e1.token, "vehiculos.patente", { patente: "GPDD74" })).status, 200);
  assert.equal((await ve(admin, "vehiculos.patente", { patente: "GPDD74" })).status, 200);
});

test("Freno por persona: no más de unas pocas consultas por minuto", async () => {
  reiniciar();
  entorno.BOOSTR_LIMITE_DIARIO = "100";
  for (let i = 0; i < 12; i++) boostr.respuestas[`HH${1000 + i}`] = OK(`HH${1000 + i}`);
  const estados = [];
  for (let i = 0; i < 12; i++) estados.push((await ve(U.t7.token, "vehiculos.patente", { patente: `HH${1000 + i}` })).status);
  assert.ok(estados.slice(0, 7).every((s) => s === 200), JSON.stringify(estados));
  assert.ok(estados.includes(429), "después de unas cuantas seguidas se frena");
});

test("Sitio web: consulta por patente sin sesión, guarda para siempre y solo entrega marca, modelo y año", async () => {
  reiniciar();
  boostr.respuestas.GPDD74 = OK("GPDD74", { owner: { fullname: "JUAN PEREZ" }, color: "NEGRO", gas_type: "GASOLINA" });
  nuevaIp();
  const r = await pub("gp-dd74");
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual(r.vehiculo, { patente: "GPDD74", marca: "Subaru", modeloCompleto: "NEW WRX S AWD CVT 2.0T", anio: 2014 });
  assert.ok(!JSON.stringify(r).includes("JUAN"), "nada del dueño");
  assert.equal(guardada("GPDD74").fuente, "boostr:web");
  assert.equal(guardada("GPDD74").extras.color, "NEGRO", "lo técnico queda guardado para el personal");
  // Ahora el CRM la encuentra guardada, y el sitio web también la responde sin gastar cupo.
  assert.equal((await ve(U.e1.token, "vehiculos.patente", { patente: "GPDD74" })).origen, "guardada");
  assert.equal((await pub("GPDD74")).status, 200);
  assert.equal(boostr.llamadas.length, 1);
  assert.equal(db.tablas.kv_store.find((x) => x.key.startsWith("patente_uso::")).value, "1");
  assert.equal((await pub("12")).error, "patente_invalida");
  assert.equal((await pub("ZZZZ99")).error, "no_encontrada");
});

test("Sitio web: puede gastar como máximo la mitad del cupo diario; el resto queda para el personal", async () => {
  reiniciar();
  const placas = ["AAAA11", "BBBB22", "CCCC33", "DDDD44"];
  for (const p of placas) boostr.respuestas[p] = OK(p);
  nuevaIp();
  assert.equal((await pub("AAAA11")).status, 200);
  assert.equal((await pub("BBBB22")).status, 200);
  const tercera = await pub("CCCC33");
  assert.equal(tercera.status, 429, "con cupo 5, el sitio web usa hasta 2");
  assert.equal(tercera.error, "cupo_agotado");
  assert.equal((await pub("AAAA11")).status, 200, "lo ya guardado sigue respondiendo");
  // El personal todavía tiene sus consultas.
  assert.equal((await ve(U.e1.token, "vehiculos.patente", { patente: "CCCC33" })).status, 200);
  assert.equal(boostr.llamadas.length, 3);
});

test("Sitio web: freno por dirección IP (también para lo guardado)", async () => {
  reiniciar();
  entorno.BOOSTR_LIMITE_DIARIO = "100";
  boostr.respuestas.GPDD74 = OK("GPDD74");
  nuevaIp();
  const estados = [];
  for (let i = 0; i < 16; i++) estados.push((await pub("GPDD74")).status);
  assert.ok(estados.slice(0, 12).every((s) => s === 200), JSON.stringify(estados));
  assert.ok(estados.slice(12).every((s) => s === 429), "pasadas las 12 por hora, se frena");
  nuevaIp();
  assert.equal((await pub("GPDD74")).status, 200, "otra dirección no está frenada");
});

test("Los contadores y datos de patentes no los puede leer ni escribir nadie desde el navegador", async () => {
  reiniciar();
  boostr.respuestas.GPDD74 = OK("GPDD74");
  await ve(U.t2.token, "vehiculos.patente", { patente: "GPDD74" });
  for (const token of [U.t2.token, U.e1.token]) {
    for (const key of ["patente::GPDD74", "patente_uso::2026-01-01", "patente_uso_web::2026-01-01"]) {
      assert.equal((await api({ action: "kv", token, op: "get", key })).status, 403, key);
      assert.equal((await api({ action: "kv", token, op: "set", key, value: "0" })).status, 403, key);
    }
  }
});

test("Estado del sistema: cuántas patentes hay guardadas y cuánto cupo se usó hoy (CRM y sitio web)", async () => {
  reiniciar();
  boostr.respuestas.GPDD74 = OK("GPDD74");
  boostr.respuestas.BCYT91 = OK("BCYT91");
  await ve(U.t2.token, "vehiculos.patente", { patente: "GPDD74" });
  nuevaIp();
  await pub("BCYT91");
  const e = await crm(admin, "sistema.estado");
  assert.deepEqual(e.patentes, { activa: true, usadasHoy: 2, usadasWebHoy: 1, limite: 5, limiteWeb: 2, guardadas: 2 });
});

test("Si falta crear la tabla, se avisa (no se pierde nada en silencio)", async () => {
  reiniciar();
  boostr.respuestas.GPDD74 = OK("GPDD74");
  const original = db.tablas.patentes_consultadas;
  delete db.tablas.patentes_consultadas;
  try {
    const r = await ve(U.t2.token, "vehiculos.patente", { patente: "GPDD74" });
    assert.equal(r.status, 503);
    assert.equal(r.error, "crm_not_installed");
    assert.equal(boostr.llamadas.length, 0, "sin la tabla no se gasta cupo");
  } finally { db.tablas.patentes_consultadas = original; }
});
