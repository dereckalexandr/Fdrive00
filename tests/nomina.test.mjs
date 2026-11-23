// Nómina de Finanzas: cálculo (liquidación + aportes del empleador), fichas, propuesta con comisiones del CRM, guardar y pagar
// (crea los egresos), por pagar y estado de resultados del mes que corresponde. Contra la función real y una base falsa.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";
import { calcularFila, armarNomina, validarTrabajador, totalesNomina, parametrosNomina } from "../supabase/functions/api/nomina-core.js";
import { calcularLiquido } from "../supabase/functions/api/calculadora-sueldo-core.js";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1;
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const mes = hoy.slice(0, 7);

test("Fila: la liquidación es la de la calculadora; el empleador paga reforma, cesantía y mutual sobre lo imponible", () => {
  const ficha = { sueldoBase: 1000000, contrato: "indefinido", gratificacion: false, afp: "habitat", salud: "fonasa" };
  const f = calcularFila(ficha, { comisiones: 200000 }, parametrosNomina());
  const r = calcularLiquido({ sueldoBase: 1000000, gratificacion: false, comisiones: 200000, afp: "habitat", salud: "fonasa", contrato: "indefinido" });
  assert.equal(f.resultado.liquido, r.liquido);
  assert.equal(f.resultado.imponible, 1200000);
  assert.equal(f.empleador.aporte, 42000); // 3,5%
  assert.equal(f.empleador.cesantia, 28800); // 2,4%
  assert.equal(f.empleador.mutual, 11160); // 0,93%
  assert.equal(f.costoEmpresa, 1200000 + 42000 + 28800 + 11160);
  const pf = calcularFila({ ...ficha, contrato: "plazo_fijo" }, {}, parametrosNomina());
  assert.equal(pf.empleador.cesantia, 30000); // 3% a plazo fijo
  assert.equal(pf.resultado.descuentos.cesantia, 0); // el trabajador a plazo fijo no cotiza cesantía
});

test("Totales: Previred = descuentos previsionales del trabajador + aportes del empleador; validaciones de ficha y nómina", () => {
  const n = armarNomina({ parametros: {}, filas: [
    { trabajadorId: "a", nombre: "A", ficha: { sueldoBase: 800000 }, variables: {} },
    { trabajadorId: "b", nombre: "B", ficha: { sueldoBase: 3000000 }, variables: { bonos: 100000 } },
  ] });
  assert.equal(n.ok, true);
  const t = n.value.totales;
  assert.equal(t.trabajadores, 2);
  assert.equal(t.previred, t.afp + t.salud + t.cesantia + t.empleador);
  assert.equal(t.costoEmpresa, t.haberes + t.empleador);
  assert.ok(t.impuesto > 0);
  assert.deepEqual(totalesNomina(n.value.filas), t);
  assert.equal(armarNomina({ filas: [] }).error, "nomina_vacia");
  assert.equal(armarNomina({ filas: [{ trabajadorId: "a", ficha: {}, variables: { bonos: -1 } }] }).error, "nomina_monto");
  assert.equal(armarNomina({ filas: [{ trabajadorId: "a", ficha: {} }, { trabajadorId: "a", ficha: {} }] }).error, "nomina_filas");
  assert.equal(armarNomina({ parametros: { uf: 0 }, filas: [{ trabajadorId: "a", ficha: {} }] }).error, "nomina_parametros");
  assert.equal(validarTrabajador({ nombre: "Ana Pérez", ficha: { sueldoBase: 0 } }).error, "nomina_sueldo");
  assert.equal(validarTrabajador({ nombre: "Ana Pérez", rut: "11.111.111-2", ficha: { sueldoBase: 600000 } }).error, "rut_invalido");
  const ok = validarTrabajador({ nombre: "Ana Pérez", rut: "11.111.111-1", ficha: { sueldoBase: 600000, salud: "isapre", planSaludUf: 3 } });
  assert.equal(ok.value.rut, "11111111-1");
  assert.equal(ok.value.ficha.planSaludUf, 3);
});

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token };
}

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1, { otorgar: ["ventas.operar"], quitar: [] });
  // Eva vendió un auto este mes: el CRM le calcula comisión.
  const veh = { id: randomUUID(), local_id: L1, patente: "ABCD12", marca: "Kia", modelo: "Rio", anio: 2020, estado: "vendido", activo: true, costo: 5000000, fotos: [] };
  db.tablas.vehiculos.push(veh);
  db.tablas.cierres.push({ id: randomUUID(), numero: 1, local_id: L1, lead_id: randomUUID(), vehiculo_id: veh.id, ejecutivo_id: U.e1.id, precio_final: 7000000, costo: 5000000, estado: "aprobada", mes, aprobado_en: new Date().toISOString(), monto_financiado: 0, seguro: false, vehiculo_snapshot: {} });
});

let EVA; let PEDRO;
test("Fichas: solo el Administrador crea trabajadores; los del equipo del CRM se ofrecen para agregar", async () => {
  const t0 = await ve(U.jefe.token, "fin.trabajadores");
  assert.equal(t0.status, 200);
  assert.ok(t0.equipo.some((u) => u.id === U.e1.id));
  assert.equal((await ve(U.jefe.token, "fin.trabajador_guardar", { trabajador: { nombre: "X Y", ficha: { sueldoBase: 500000 } } })).status, 403);
  const a = await ve(admin, "fin.trabajador_guardar", { localId: L1, trabajador: { nombre: "Eva Uno", usuarioId: U.e1.id, cargo: "Ejecutiva", ficha: { sueldoBase: 2500000, gratificacion: true } } });
  assert.equal(a.status, 200, JSON.stringify(a));
  EVA = a.trabajador.id;
  const b = await ve(admin, "fin.trabajador_guardar", { localId: L1, trabajador: { nombre: "Pedro Aseo", cargo: "Auxiliar", ficha: { sueldoBase: 560000, contrato: "plazo_fijo" } } });
  PEDRO = b.trabajador.id;
  const t1 = await ve(admin, "fin.trabajadores", { localId: L1 });
  assert.equal(t1.trabajadores.length, 2);
  assert.ok(!t1.equipo.some((u) => u.id === U.e1.id));
});

test("Propuesta del mes: trabajadores activos con la comisión que el CRM calcula para cada uno", async () => {
  const r = await ve(U.jefe.token, "fin.nomina", { mes });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.nomina, null);
  assert.equal(r.propuesta.filas.length, 2);
  const eva = r.propuesta.filas.find((f) => f.trabajadorId === EVA);
  assert.ok(r.comisionesCrm[EVA] > 0, "la venta de Eva genera comisión");
  assert.equal(eva.variables.comisiones, r.comisionesCrm[EVA]);
  assert.equal(r.propuesta.filas.find((f) => f.trabajadorId === PEDRO).variables.comisiones, 0);
});

test("Guardar y pagar: crea los egresos (uno por sueldo, Previred e impuesto), no se paga dos veces ni se edita pagada", async () => {
  const prop = (await ve(admin, "fin.nomina", { mes, localId: L1 })).propuesta;
  const filas = prop.filas.map((f) => ({ trabajadorId: f.trabajadorId, variables: { ...f.variables, bonos: f.trabajadorId === PEDRO ? 50000 : 0 }, ficha: { sueldoBase: 1 } }));
  assert.equal((await ve(U.jefe.token, "fin.nomina_guardar", { mes, filas, parametros: prop.parametros })).status, 403);
  assert.equal((await ve(admin, "fin.nomina_pagar", { mes, concepto: "sueldos", fecha: hoy, localId: L1 })).error, "nomina_sin_guardar");
  const g = await ve(admin, "fin.nomina_guardar", { localId: L1, mes, filas, parametros: prop.parametros });
  assert.equal(g.status, 200, JSON.stringify(g));
  const pedro = g.nomina.filas.find((f) => f.trabajadorId === PEDRO);
  assert.equal(pedro.resultado.haberes.sueldoBase, 560000); // el sueldo base sale de la ficha, no de la pantalla
  assert.equal(pedro.resultado.haberes.bonos, 50000);
  const tot = g.nomina.totales;

  // Por pagar: los tres conceptos de la nómina.
  let res = await ve(U.jefe.token, "fin.resumen");
  assert.equal(res.porPagar.filter((x) => x.tipo === "nomina").length, tot.impuesto > 0 ? 3 : 2);

  const p = await ve(admin, "fin.nomina_pagar", { localId: L1, mes, concepto: "sueldos", fecha: hoy, cuentaId: "" });
  assert.equal(p.status, 200, JSON.stringify(p));
  assert.equal(p.movimientos, 2);
  assert.equal((await ve(admin, "fin.nomina_pagar", { localId: L1, mes, concepto: "sueldos", fecha: hoy })).status, 409);
  assert.equal((await ve(admin, "fin.nomina_guardar", { localId: L1, mes, filas, parametros: prop.parametros })).error, "fin_nomina_pagada");
  assert.equal((await ve(admin, "fin.nomina_pagar", { localId: L1, mes, concepto: "previred", fecha: hoy })).status, 200);
  assert.equal((await ve(admin, "fin.nomina_pagar", { localId: L1, mes, concepto: "impuesto", fecha: hoy })).status, tot.impuesto > 0 ? 200 : 400);

  const movs = db.tablas.fin_movimientos.filter((m) => m.nomina_concepto);
  assert.equal(movs.filter((m) => m.nomina_concepto === "sueldos").reduce((s, m) => s + m.monto, 0), tot.liquido);
  assert.equal(movs.find((m) => m.nomina_concepto === "previred").monto, tot.previred);
  assert.ok(movs.every((m) => m.categoria === "sueldos" && m.tipo === "egreso" && m.mes_resultado === mes));

  // Ya no queda nada de la nómina por pagar; el estado de resultados del mes muestra el costo de la nómina.
  res = await ve(U.jefe.token, "fin.resumen", { periodo: mes });
  assert.equal(res.porPagar.filter((x) => x.tipo === "nomina").length, 0);
  const sueldos = res.resultados.gastos.find((x) => x.id === "sueldos");
  assert.equal(sueldos.monto, tot.liquido + tot.previred + tot.impuesto);
  assert.equal(sueldos.monto, tot.costoEmpresa - tot.otros);
  const vista = await ve(U.jefe.token, "fin.nomina", { mes });
  assert.equal(vista.pagos.sueldos.pagado, true);
  assert.equal(vista.pagos.previred.monto, tot.previred);
});
