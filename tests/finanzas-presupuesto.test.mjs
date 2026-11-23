// Finanzas: presupuesto mensual por categoría y publicidad de Meta/Google por registrar (con el mes al que corresponde).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { validarPresupuesto, compararPresupuesto, publicidadPorRegistrar, esDePlataforma, gastosPorMes, validarMovimiento } from "../supabase/functions/api/finanzas-core.js";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db, ads, entorno } from "./helpers/api-env.mjs";

test("Presupuesto: valida categorías y montos; compara lo gastado con lo presupuestado", () => {
  assert.equal(validarPresupuesto({ categorias: { retiro_dueno: 100 } }).error, "fin_categoria");
  assert.equal(validarPresupuesto({ categorias: { arriendo: -5 } }).error, undefined); // «-5» se lee como 5: solo dígitos
  assert.deepEqual(validarPresupuesto({ categorias: { arriendo: "1.200.000", insumos: 0, publicidad: 300000 } }).value, { categorias: { arriendo: 1200000, publicidad: 300000 } });
  const g = gastosPorMes([
    { tipo: "egreso", categoria: "arriendo", monto: 1200000, fecha: "2026-11-05" },
    { tipo: "egreso", categoria: "publicidad", monto: 380000, fecha: "2026-11-10" },
    { tipo: "egreso", categoria: "insumos", monto: 25000, fecha: "2026-11-11" },
  ], ["2026-11"]);
  const c = compararPresupuesto(g, { categorias: { arriendo: 1200000, publicidad: 300000, software: 50000 } }, "2026-11");
  const fila = (id) => c.filas.find((f) => f.id === id);
  assert.deepEqual([fila("arriendo").pct, fila("arriendo").excede], [100, false]);
  assert.deepEqual([fila("publicidad").pct, fila("publicidad").excede], [127, true]);
  assert.deepEqual([fila("software").gasto, fila("software").pct], [0, 0]);
  assert.equal(fila("insumos").sinPresupuesto, true);
  assert.equal(c.excedidas.length, 1);
  assert.deepEqual([c.totalPresupuesto, c.totalGasto], [1550000, 1580000]);
});

test("Publicidad por registrar: por plataforma y mes, según el mes al que corresponde lo registrado", () => {
  assert.equal(esDePlataforma({ contraparte: "Meta Platforms Ireland" }, "meta"), true);
  assert.equal(esDePlataforma({ descripcion: "Publicidad Google Ads" }, "meta"), false);
  const movs = [
    { tipo: "egreso", categoria: "publicidad", monto: 200000, fecha: "2026-11-03", mes_resultado: "2026-10", contraparte: "Meta Platforms" },
    { tipo: "egreso", categoria: "publicidad", monto: 50000, fecha: "2026-11-15", contraparte: "Google" },
    { tipo: "egreso", categoria: "publicidad", monto: 999, fecha: "2026-11-15", contraparte: "Meta", estado: "anulado" },
  ];
  const f = publicidadPorRegistrar({ meta: { "2026-10": 238500, "2026-11": 90000 }, google: { "2026-11": 50000 } }, movs, ["2026-10", "2026-11"]);
  assert.deepEqual(f, [
    { plataforma: "meta", mes: "2026-10", gasto: 238500, registrado: 200000, diferencia: 38500 },
    { plataforma: "meta", mes: "2026-11", gasto: 90000, registrado: 0, diferencia: 90000 },
    { plataforma: "google", mes: "2026-11", gasto: 50000, registrado: 50000, diferencia: 0 },
  ]);
  // El mes al que corresponde se guarda solo si viene.
  const base = { tipo: "egreso", categoria: "publicidad", monto: 1, fecha: "2026-11-03", descripcion: "Meta Ads" };
  assert.equal(validarMovimiento({ ...base, mesResultado: "2026-10" }).value.mes_resultado, "2026-10");
  assert.equal("mes_resultado" in validarMovimiento(base).value, false);
});

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
let admin; let L1; let jefe;
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const mes = hoy.slice(0, 7);
const mesAnt = (() => { let [a, m] = mes.split("-").map(Number); m--; if (m === 0) { m = 12; a--; } return `${a}-${String(m).padStart(2, "0")}`; })();
before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  await crm(admin, "usuarios.create", { datos: { nombre: "Julia Jefa", rut: "12.345.678-5", roles: ["jefe_local"], localId: L1 }, clave: "Prueba12345" });
  nuevaIp();
  jefe = (await api({ action: "userLogin", rut: "12.345.678-5", password: "Prueba12345" })).token;
});

test("Servidor: presupuesto (solo el Administrador lo cambia) y su comparación en Gastos y en el informe", async () => {
  assert.equal((await ve(jefe, "fin.presupuesto_guardar", { presupuesto: { categorias: { arriendo: 1 } } })).status, 403);
  const g = await ve(admin, "fin.presupuesto_guardar", { localId: L1, presupuesto: { categorias: { arriendo: 1000000, publicidad: 200000 } } });
  assert.equal(g.status, 200, JSON.stringify(g));
  assert.deepEqual((await ve(jefe, "fin.presupuesto")).presupuesto, { categorias: { arriendo: 1000000, publicidad: 200000 } });
  await ve(admin, "fin.mov_guardar", { localId: L1, mov: { tipo: "egreso", categoria: "arriendo", monto: 1100000, fecha: hoy, descripcion: "Arriendo oficina" } });
  const r = await ve(jefe, "fin.gastos", { hasta: mes, meses: 3 });
  assert.equal(r.presupuestoMes.excedidas.length, 1);
  assert.equal(r.presupuestoMes.excedidas[0].id, "arriendo");
  const inf = await ve(jefe, "fin.informe", { periodo: mes });
  assert.ok(inf.informe.alertas.some((a) => /Arriendo de oficina y local: se gastó \$1\.100\.000, sobre el presupuesto/.test(a.texto)));
});

test("Servidor: publicidad de Meta y Google por mes contra lo registrado; se registra con el mes al que corresponde", async () => {
  let r = await ve(jefe, "fin.publicidad", { hasta: mes, meses: 2 });
  assert.deepEqual([r.filas.length, r.conectadas.length], [0, 0], "sin plataformas conectadas no hay nada que comparar");
  Object.assign(entorno, { META_AD_ACCOUNT_ID: "998877", GOOGLE_ADS_DEVELOPER_TOKEN: "t", GOOGLE_ADS_CUSTOMER_ID: "1234567890", GOOGLE_ADS_REFRESH_TOKEN: "r", GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s" });
  ads.meta.gastoMensual = { [mesAnt]: 238500, [mes]: 90000 };
  ads.google.gastoMensual = { [mes]: 154300 };
  r = await ve(jefe, "fin.publicidad", { hasta: mes, meses: 2 });
  assert.deepEqual(r.conectadas.sort(), ["google", "meta"]);
  const fila = (p, m) => r.filas.find((f) => f.plataforma === p && f.mes === m);
  assert.deepEqual([fila("meta", mesAnt).diferencia, fila("meta", mes).diferencia, fila("google", mes).diferencia], [238500, 90000, 154300]);
  // Se registra lo de Meta del mes anterior (pagado hoy): cuenta en su mes.
  const m = await ve(admin, "fin.mov_guardar", { localId: L1, mov: { tipo: "egreso", categoria: "publicidad", monto: 238500, fecha: hoy, descripcion: `Publicidad Meta Ads`, contraparte: "Meta Platforms", mesResultado: mesAnt } });
  assert.equal(m.status, 200);
  assert.equal(m.movimiento.mes_resultado, mesAnt);
  r = await ve(jefe, "fin.publicidad", { hasta: mes, meses: 2 });
  assert.equal(r.filas.find((f) => f.plataforma === "meta" && f.mes === mesAnt).diferencia, 0);
  // Editar ese movimiento sin mandar el mes no lo pierde.
  await ve(admin, "fin.mov_guardar", { localId: L1, id: m.movimiento.id, mov: { tipo: "egreso", categoria: "publicidad", monto: 238500, fecha: hoy, descripcion: "Publicidad Meta Ads (factura)", contraparte: "Meta Platforms" } });
  assert.equal(db.tablas.fin_movimientos.find((x) => x.id === m.movimiento.id).mes_resultado, mesAnt);
  // El informe del mes avisa la publicidad de este mes sin registrar.
  const inf = await ve(jefe, "fin.informe", { periodo: mes });
  assert.ok(inf.informe.alertas.some((a) => /Publicidad de Meta sin registrar en Finanzas: \$90\.000/.test(a.texto)));
  assert.ok(inf.informe.alertas.some((a) => /Publicidad de Google Ads sin registrar/.test(a.texto)));
  // Una cuenta en dólares no se suma: se informa el error.
  ads.meta.cuenta.currency = "USD";
  r = await ve(jefe, "fin.publicidad", { hasta: mes, meses: 2 });
  assert.match(r.errores.find((e) => e.plataforma === "meta").error, /USD/);
  ads.meta.cuenta.currency = "CLP";
});
