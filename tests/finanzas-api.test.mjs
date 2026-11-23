// Finanzas contra la función real y una base falsa: permisos (Administrador edita, Jefe Local mira), movimientos manuales,
// pagos del CRM que entran solos, saldos, resultados, por cobrar / por pagar y rentabilidad por vehículo.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1; let L2;
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const mes = hoy.slice(0, 7);
const ahora = () => new Date().toISOString();

async function crear(clave, nombre, rut, roles, localId) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token };
}

const V = {};
let CTA;
before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  L2 = (await crm(admin, "locales.create", { nombre: "Sucursal" })).local.id;
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1);

  const T = db.tablas;
  CTA = randomUUID();
  T.cuentas_empresa.push({ id: CTA, local_id: L1, banco: "Banco BCI", tipo_cuenta: "Cuenta corriente", numero_cuenta: "12345678", titular: "Empresa", activa: true, creado_en: ahora(), actualizado_en: ahora() });
  // Vehículos: uno comprado y vendido, uno comprado en stock, uno consignado y vendido.
  const veh = (k, extra) => { const v = { id: randomUUID(), local_id: L1, patente: `AB${k}12`.slice(0, 6), marca: "Toyota", modelo: `Yaris ${k}`, anio: 2020, activo: true, fotos: [], creado_en: ahora(), actualizado_en: ahora(), ...extra }; T.vehiculos.push(v); V[k] = v; return v; };
  veh("vend", { estado: "vendido", costo: 8000000, origen: "compra", precio_lista: 10500000 });
  veh("stock", { estado: "disponible", costo: 6000000, origen: "compra", precio_lista: 7500000 });
  veh("cons", { estado: "vendido", costo: 9000000, origen: "consignacion", precio_lista: 11000000 });
  // Venta aprobada del auto comprado: reserva validada de 500.000 (efectivo) + transferencia + crédito + parte de pago.
  const res = { id: randomUUID(), local_id: L1, lead_id: randomUUID(), vehiculo_id: V.vend.id, monto: 500000, medio_pago: "efectivo", fecha_pago: hoy, pago_estado: "validado", estado: "convertida", creado_en: ahora() };
  T.reservas.push(res);
  const c1 = { id: randomUUID(), numero: 7, local_id: L1, lead_id: res.lead_id, vehiculo_id: V.vend.id, reserva_id: res.id, reserva_monto: 500000, precio_final: 10000000, costo: 8000000, estado: "aprobada", mes, aprobado_en: ahora(), vehiculo_snapshot: { marca: "Toyota", modelo: "Yaris vend", anio: 2020, patente: "ABVEND" } };
  T.cierres.push(c1);
  const pago = (cierre, medio, monto, extra = {}) => T.cierre_pagos.push({ id: randomUUID(), cierre_id: cierre.id, local_id: L1, medio, monto, fecha_pago: hoy, estado: "vigente", archivos: [], cuenta_id: null, ...extra });
  pago(c1, "transferencia", 4500000, { cuenta_id: CTA });
  pago(c1, "credito", 4000000);
  pago(c1, "parte_pago", 1000000);
  pago(c1, "efectivo", 999, { estado: "anulado" });
  // Venta pendiente del consignado: falta cobrar 11.000.000 − 2.000.000.
  const c2 = { id: randomUUID(), numero: 8, local_id: L1, lead_id: randomUUID(), vehiculo_id: V.cons.id, reserva_id: null, reserva_monto: 0, precio_final: 11000000, costo: 9000000, estado: "pendiente", mes: null, aprobado_en: null, vehiculo_snapshot: { marca: "Toyota", modelo: "Yaris cons" } };
  T.cierres.push(c2);
  pago(c2, "transferencia", 2000000, { cuenta_id: CTA });
  T.consignaciones.push({ id: randomUUID(), numero: 3, local_id: L1, vehiculo_id: V.cons.id, estado: "vendida", precio_piso: 9000000, precio_publicacion: 11000000, vehiculo: { marca: "Toyota", modelo: "Yaris cons" }, patente: "ABCONS" });
  // Compra del auto en stock: se pagaron 4.000.000 de 6.000.000.
  const k = { id: randomUUID(), numero: 4, local_id: L1, estado: "comprada", monto_final: 6000000, monto_oferta: 6000000, vehiculo_id: V.stock.id, vehiculo: { marca: "Toyota", modelo: "Yaris stock" }, patente: "ABSTOC" };
  T.compras.push(k);
  T.compra_pagos.push({ id: randomUUID(), compra_id: k.id, local_id: L1, medio: "transferencia", monto: 4000000, fecha_pago: hoy, estado: "vigente", cuenta_id: CTA, archivos: [] });
  // Un pago de otro local no se mezcla con el del Jefe Local.
  const k2 = { id: randomUUID(), numero: 5, local_id: L2, estado: "comprada", monto_final: 123, monto_oferta: 123, vehiculo: {}, patente: "ZZZZ11" };
  T.compras.push(k2);
  T.compra_pagos.push({ id: randomUUID(), compra_id: k2.id, local_id: L2, medio: "efectivo", monto: 123, fecha_pago: hoy, estado: "vigente", cuenta_id: null, archivos: [] });
});

test("Permisos: el ejecutivo no entra; el Jefe Local ve pero no registra; el Administrador registra", async () => {
  assert.equal((await ve(U.e1.token, "fin.resumen")).status, 403);
  const r = await ve(U.jefe.token, "fin.resumen");
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.puedeEditar, false);
  const mov = { tipo: "egreso", categoria: "arriendo", monto: 800000, fecha: hoy, descripcion: "Arriendo del local" };
  assert.equal((await ve(U.jefe.token, "fin.mov_guardar", { mov })).status, 403);
  assert.equal((await ve(U.jefe.token, "fin.saldo_guardar", { clave: CTA, saldoInicial: 1, desde: hoy })).status, 403);
  const a = await ve(admin, "fin.mov_guardar", { mov, localId: L1 });
  assert.equal(a.status, 200, JSON.stringify(a));
  assert.equal(a.movimiento.registrado_por !== undefined, true);
  assert.equal((await ve(admin, "fin.mov_guardar", { mov: { ...mov, monto: 0 }, localId: L1 })).error, "fin_monto");
});

test("Movimientos: los pagos del CRM entran solos (sin parte de pago ni anulados) junto con los manuales, y se filtran", async () => {
  const r = await ve(U.jefe.token, "fin.movimientos");
  assert.equal(r.status, 200);
  const auto = r.movimientos.filter((m) => m.origen !== "manual");
  // reserva + transferencia + crédito de la venta 1, transferencia de la venta 2, pago de compra (el de otro local no)
  assert.equal(auto.length, 5, JSON.stringify(auto.map((m) => [m.origen, m.monto])));
  assert.ok(!auto.some((m) => m.medio === "parte_pago" || m.monto === 999 || m.monto === 123));
  const credito = auto.find((m) => m.medio === "credito");
  assert.equal(credito.cuenta_id, "por_depositar");
  assert.equal(credito.folio, "VTA-00007");
  assert.equal(r.ingresos, 500000 + 4500000 + 4000000 + 2000000);
  assert.equal(r.egresos, 4000000 + 800000);
  const solo = await ve(U.jefe.token, "fin.movimientos", { origen: "manual" });
  assert.equal(solo.movimientos.length, 1);
  const banco = await ve(U.jefe.token, "fin.movimientos", { cuenta: CTA });
  assert.equal(banco.movimientos.length, 3);
  const busca = await ve(U.jefe.token, "fin.movimientos", { q: "arriendo" });
  assert.equal(busca.movimientos.length, 1);
});

test("Saldos: saldo inicial del banco más lo que entra y sale; la caja recibe el efectivo y los traspasos lo mueven", async () => {
  assert.equal((await ve(admin, "fin.saldo_guardar", { clave: CTA, saldoInicial: 1000000, desde: "2020-01-01", localId: L1 })).status, 200);
  const dep = await ve(admin, "fin.mov_guardar", { localId: L1, mov: { tipo: "traspaso", monto: 300000, fecha: hoy, descripcion: "Depósito de la caja", cuentaId: "", cuentaDestinoId: CTA } });
  assert.equal(dep.status, 200, JSON.stringify(dep));
  const r = await ve(U.jefe.token, "fin.resumen");
  const banco = r.cuentas.find((c) => c.clave === CTA);
  assert.equal(banco.saldo, 1000000 + 4500000 + 2000000 - 4000000 + 300000);
  const caja = r.cuentas.find((c) => c.clave === `caja:${L1}`);
  assert.equal(caja.saldo, 500000 - 800000 - 300000); // reserva en efectivo − arriendo − depósito
  assert.equal(r.cuentas.find((c) => c.clave === "por_depositar").saldo, 4000000);
  assert.equal(r.saldoTotal, banco.saldo + caja.saldo + 4000000);
});

test("Resultados del mes: margen de la venta aprobada con sus gastos de vehículo, menos los gastos del período", async () => {
  const rep = await ve(admin, "fin.mov_guardar", { localId: L1, mov: { tipo: "egreso", categoria: "reparacion", monto: 400000, fecha: hoy, descripcion: "Pintura parachoques", vehiculoId: V.vend.id } });
  assert.equal(rep.status, 200);
  const r = await ve(U.jefe.token, "fin.resumen", { periodo: mes });
  assert.equal(r.resultados.unidades, 1);
  assert.equal(r.resultados.ingresosVentas, 10000000);
  assert.equal(r.resultados.costoVentas, 8400000);
  assert.equal(r.resultados.totalGastos, 800000); // la reparación es costo del auto, no gasto del período
  assert.equal(r.resultados.resultado, 1600000 - 800000);
  // Por cobrar: la venta pendiente. Por pagar: la compra (2.000.000) y el dueño del consignado (9.000.000).
  assert.deepEqual(r.porCobrar.map((x) => [x.folio, x.falta]), [["VTA-00008", 9000000]]);
  assert.equal(r.totalPorPagar, 2000000 + 9000000);
  assert.equal(r.stock.unidades, 1);
  assert.equal(r.stock.invertido, 6000000);
});

test("Pago al consignante: baja lo que se le debe; anular un movimiento lo saca de las cuentas (solo el Administrador)", async () => {
  const p = await ve(admin, "fin.mov_guardar", { localId: L1, mov: { tipo: "egreso", categoria: "pago_consignante", monto: 9000000, fecha: hoy, descripcion: "Liquidación al dueño", cuentaId: CTA, vehiculoId: V.cons.id } });
  assert.equal(p.status, 200);
  let r = await ve(U.jefe.token, "fin.resumen");
  assert.equal(r.totalPorPagar, 2000000);
  assert.equal((await ve(U.jefe.token, "fin.mov_anular", { id: p.movimiento.id, motivo: "error" })).status, 403);
  assert.equal((await ve(admin, "fin.mov_anular", { id: p.movimiento.id, motivo: "" })).error, "fin_motivo");
  assert.equal((await ve(admin, "fin.mov_anular", { id: p.movimiento.id, motivo: "Se registró dos veces" })).status, 200);
  assert.equal((await ve(admin, "fin.mov_anular", { id: p.movimiento.id, motivo: "otra vez" })).status, 409);
  r = await ve(U.jefe.token, "fin.resumen");
  assert.equal(r.totalPorPagar, 11000000);
  const lista = await ve(admin, "fin.movimientos", { conAnulados: true, localId: L1 });
  assert.equal(lista.movimientos.find((m) => m.id === p.movimiento.id).estado, "anulado");
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "finanzas.anular"));
});

test("Editar un movimiento: el Administrador corrige el monto; no se edita uno anulado", async () => {
  const m = db.tablas.fin_movimientos.find((x) => x.categoria === "arriendo");
  const e = await ve(admin, "fin.mov_guardar", { id: m.id, localId: L1, mov: { tipo: "egreso", categoria: "arriendo", monto: 850000, fecha: hoy, descripcion: "Arriendo del local" } });
  assert.equal(e.status, 200);
  assert.equal(e.movimiento.monto, 850000);
  const anulado = db.tablas.fin_movimientos.find((x) => x.estado === "anulado");
  assert.equal((await ve(admin, "fin.mov_guardar", { id: anulado.id, localId: L1, mov: { tipo: "egreso", categoria: "otros_gastos", monto: 1, fecha: hoy, descripcion: "xxx" } })).status, 409);
});

test("Rentabilidad: margen por venta con gastos del vehículo y stock con lo invertido y días en inventario", async () => {
  const r = await ve(U.jefe.token, "fin.rentabilidad", { periodo: mes });
  assert.equal(r.status, 200);
  assert.equal(r.ventas.length, 1);
  assert.equal(r.ventas[0].margen, 10000000 - 8400000);
  assert.equal(r.ventas[0].gastos, 400000);
  assert.equal(r.totales.margenPct, 16);
  const st = r.stock.find((v) => v.id === V.stock.id);
  assert.equal(st.invertido, 6000000);
  assert.equal(st.margenEsperado, 1500000);
  const veh = await ve(admin, "fin.vehiculos", { localId: L1 });
  assert.ok(veh.vehiculos.length >= 3);
});
