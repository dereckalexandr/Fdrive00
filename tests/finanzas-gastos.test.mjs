// Finanzas: gastos de operación con respaldo (archivos), informe por categoría y mes, y gastos fijos que se repiten cada mes.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";
import { gastosPorMes, gastosFijosPendientes, faltaRespaldo, categoriasAgrupadas, CATEGORIAS_FIN, GRUPOS_FIN } from "../supabase/functions/api/finanzas-core.js";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
let admin; let L1; let jefe;
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const mes = hoy.slice(0, 7);
const mesAnterior = (() => { let [a, m] = mes.split("-").map(Number); m--; if (m === 0) { m = 12; a--; } return `${a}-${String(m).padStart(2, "0")}`; })();
const NS = `fin-${randomUUID()}`;
const archivo = (id) => ({ id, nombre: "factura.pdf", tipo: "application/pdf", tam: 2000, v: NS });

test("Categorías: todas tienen grupo; las de operación incluyen arriendo, insumos, servicios, software y seguros", () => {
  for (const c of CATEGORIAS_FIN) assert.ok(GRUPOS_FIN.some((g) => g.id === c.grupo), c.id);
  const op = categoriasAgrupadas("egreso").find((g) => g.id === "operacion").categorias.map((c) => c.id);
  for (const id of ["arriendo", "insumos", "servicios", "software", "seguros", "gastos_comunes"]) assert.ok(op.includes(id), id);
  assert.ok(categoriasAgrupadas("ingreso").every((g) => g.categorias.every((c) => c.tipo === "ingreso")));
});

test("Informe: gastos por categoría y mes (mes al que corresponde), sin aportes ni gastos de vehículos asociados", () => {
  const r = gastosPorMes([
    { tipo: "egreso", categoria: "arriendo", monto: 800, fecha: "2026-10-05" },
    { tipo: "egreso", categoria: "arriendo", monto: 800, fecha: "2026-11-05" },
    { tipo: "egreso", categoria: "insumos", monto: 50, fecha: "2026-11-10" },
    { tipo: "egreso", categoria: "sueldos", monto: 1000, fecha: "2026-11-02", mes_resultado: "2026-10" },
    { tipo: "egreso", categoria: "reparacion", monto: 300, fecha: "2026-11-02", vehiculo_id: "v1" },
    { tipo: "egreso", categoria: "retiro_dueno", monto: 999, fecha: "2026-11-02" },
    { tipo: "egreso", categoria: "arriendo", monto: 5, fecha: "2026-11-02", estado: "anulado" },
    { tipo: "egreso", categoria: "arriendo", monto: 7, fecha: "2026-01-02" }, // fuera del rango
  ], ["2026-10", "2026-11"]);
  assert.deepEqual(r.totales, { "2026-10": 1800, "2026-11": 850 });
  const op = r.grupos.find((g) => g.id === "operacion");
  assert.equal(op.categorias.find((c) => c.id === "arriendo").total, 1600);
  assert.equal(op.meses["2026-11"], 850);
  assert.equal(r.grupos.find((g) => g.id === "personal").meses["2026-10"], 1000);
  assert.ok(!r.grupos.some((g) => g.id === "vehiculos" || g.id === "no_resultado"));
  assert.equal(r.promedio, 1325);
});

test("Gastos fijos: propone la última versión de cada serie que falta en el mes; no lo que ya se registró", () => {
  const movs = [
    { id: "a1", categoria: "arriendo", monto: 800, fecha: "2026-09-05", recurrente: true },
    { id: "a2", serie_id: "a1", categoria: "arriendo", monto: 850, fecha: "2026-10-05", recurrente: true },
    { id: "i1", categoria: "servicios", monto: 40, fecha: "2026-10-03", recurrente: true },
    { id: "i2", serie_id: "i1", categoria: "servicios", monto: 41, fecha: "2026-11-03", recurrente: true },
    { id: "x", categoria: "insumos", monto: 10, fecha: "2026-10-01", recurrente: false },
  ];
  const p = gastosFijosPendientes(movs, "2026-11");
  assert.equal(p.length, 1);
  assert.equal(p[0].id, "a2");
  assert.equal(p[0].monto, 850);
  assert.equal(p[0].serie_id, "a1");
  assert.equal(faltaRespaldo({ origen: "manual", tipo: "egreso", archivos: [] }), true);
  assert.equal(faltaRespaldo({ origen: "manual", tipo: "traspaso" }), false);
  assert.equal(faltaRespaldo({ origen: "venta", tipo: "ingreso" }), false);
});

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  const r = await crm(admin, "usuarios.create", { datos: { nombre: "Julia Jefa", rut: "12.345.678-5", roles: ["jefe_local"], localId: L1 }, clave: "Prueba12345" });
  nuevaIp();
  jefe = (await api({ action: "userLogin", rut: "12.345.678-5", password: "Prueba12345" })).token;
  assert.ok(r.usuario);
});

let ARRIENDO;
test("Respaldos: el Administrador adjunta facturas al registrar o editar; se validan; los sin respaldo se cuentan y filtran", async () => {
  const base = { tipo: "egreso", categoria: "arriendo", monto: 900000, fecha: `${mesAnterior}-05`, descripcion: "Arriendo oficina", recurrente: true, documentoTipo: "factura" };
  const a = await ve(admin, "fin.mov_guardar", { localId: L1, mov: base, archivos: [archivo("arch000001")] });
  assert.equal(a.status, 200, JSON.stringify(a));
  assert.equal(a.movimiento.archivos.length, 1);
  assert.equal(a.movimiento.archivos[0].v, NS);
  assert.equal(a.movimiento.recurrente, true);
  ARRIENDO = a.movimiento.id;
  assert.equal((await ve(admin, "fin.mov_guardar", { localId: L1, mov: base, archivos: [{ ...archivo("arch000002"), v: "otro::x" }] })).error, "archivo_invalido");
  assert.equal((await ve(admin, "fin.mov_guardar", { localId: L1, mov: base, archivos: [{ ...archivo("arch000003"), tipo: "text/html" }] })).error, "archivo_tipo_invalido");
  assert.equal((await ve(admin, "fin.mov_guardar", { localId: L1, mov: base, archivos: [1, 2, 3, 4, 5, 6].map((i) => archivo(`arch00010${i}`)) })).error, "demasiados_archivos");

  const ins = await ve(admin, "fin.mov_guardar", { localId: L1, mov: { tipo: "egreso", categoria: "insumos", monto: 35000, fecha: hoy, descripcion: "Papel y tóner" } });
  assert.equal(ins.status, 200);
  let lista = await ve(jefe, "fin.movimientos", { sinRespaldo: true });
  assert.equal(lista.movimientos.length, 1);
  assert.equal(lista.sinRespaldo, 1);
  // Editar sin mandar archivos conserva los que tenía; mandarlos los reemplaza.
  await ve(admin, "fin.mov_guardar", { localId: L1, id: ARRIENDO, mov: { ...base, monto: 950000 } });
  assert.equal(db.tablas.fin_movimientos.find((m) => m.id === ARRIENDO).archivos.length, 1);
  await ve(admin, "fin.mov_guardar", { localId: L1, id: ins.movimiento.id, mov: { tipo: "egreso", categoria: "insumos", monto: 35000, fecha: hoy, descripcion: "Papel y tóner" }, archivos: [archivo("arch000009")] });
  lista = await ve(jefe, "fin.movimientos", { sinRespaldo: true });
  assert.equal(lista.movimientos.length, 0);
});

test("Gastos fijos e informe: el arriendo del mes anterior se propone en este mes y, al registrarlo en su serie, deja de proponerse", async () => {
  let f = await ve(jefe, "fin.fijos", { mes });
  assert.equal(f.status, 200);
  assert.equal(f.pendientes.length, 1);
  assert.equal(f.pendientes[0].serie_id, ARRIENDO);
  assert.equal(f.pendientes[0].monto, 950000);
  const g = await ve(jefe, "fin.gastos", { hasta: mes, meses: 3 });
  assert.equal(g.status, 200);
  assert.equal(g.fijosPendientes, 1);
  assert.equal(g.totales[mesAnterior], 950000);
  assert.equal(g.totales[mes], 35000);
  assert.equal(g.sinRespaldo.cantidad, 0);

  const r = await ve(admin, "fin.mov_guardar", { localId: L1, mov: { tipo: "egreso", categoria: "arriendo", monto: 950000, fecha: hoy, descripcion: "Arriendo oficina", recurrente: true, serieId: ARRIENDO } });
  assert.equal(r.status, 200);
  assert.equal(r.movimiento.serie_id, ARRIENDO);
  f = await ve(jefe, "fin.fijos", { mes });
  assert.equal(f.pendientes.length, 0);
  const g2 = await ve(jefe, "fin.gastos", { hasta: mes, meses: 3 });
  assert.equal(g2.sinRespaldo.cantidad, 1); // el arriendo nuevo aún no tiene factura
  assert.equal(g2.grupos.find((x) => x.id === "operacion").meses[mes], 985000);
});
