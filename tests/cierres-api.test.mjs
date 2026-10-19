// Cierre de venta, aprobación del supervisor y comisiones por tramos, contra la función real y una base falsa.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";
import { mesChile } from "../supabase/functions/api/ventas-core.js";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1; let L2;
let patenteN = 0;
const MES = mesChile();

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  assert.equal(l.status, 200);
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}
const patente = () => `TT${String(1000 + ++patenteN)}`;
async function vehiculo(precio = 10000000, costo = 8500000) {
  const r = await ve(U.jefe.token, "inventario.save", { datos: { patente: patente(), marca: "Toyota", modelo: "Yaris", anio: 2020, km: 40000, precioLista: precio, costo } });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.vehiculo;
}
let clienteN = 0;
async function leadReservado(token, { precio = 10000000, costo = 8500000 } = {}) {
  const veh = await vehiculo(precio, costo);
  const l = (await ve(token, "leads.create", { cliente: { nombre: `Cliente Prueba ${++clienteN}`, telefono: `9${String(10000000 + clienteN)}` }, lead: {} })).lead;
  const cot = (await ve(token, "cotizaciones.save", { leadId: l.id, vehiculoId: veh.id, datos: {} })).cotizacion;
  const res = (await ve(token, "reservas.crear", { cotizacionId: cot.id, monto: 500000 })).reserva;
  assert.ok(res, "no se pudo reservar");
  return { lead: l, veh, cot, res };
}
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const DATOS = (extra = {}) => ({ precioFinal: 9800000, montoParteDePago: 0, montoFinanciado: 0, fechaEntrega: hoy(), ...extra });
const cerrar = (token, leadId, datos) => ve(token, "cierres.crear", { leadId, datos });
/** Una venta completa y aprobada por la supervisora. */
async function vender(token, datos = {}, opciones) {
  const x = await leadReservado(token, opciones);
  const c = await cerrar(token, x.lead.id, DATOS(datos));
  assert.equal(c.status, 200, JSON.stringify(c));
  const a = await ve(U.jefe.token, "cierres.aprobar", { id: c.cierre.id });
  assert.equal(a.status, 200, JSON.stringify(a));
  return { ...x, cierre: a.cierre };
}

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  L2 = (await crm(admin, "locales.create", { nombre: "Sucursal Sur" })).local.id;
  const ventas = { otorgar: ["ventas.operar"], quitar: [] };
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1, ventas);
  await crear("e2", "Ema Dos", "7.654.321-6", ["ejecutivo"], L1, ventas);
  await crear("e3", "Eli Tres", "9.876.543-3", ["ejecutivo"], L1);
  await crear("jefeSur", "Jorge Sur", "8.765.432-K", ["jefe_local"], L2);
  await crear("mkt", "Marta Marketing", "13.579.246-2", ["marketing"], L1);
});

test("Solo se cierra una venta con el lead reservado y una reserva activa", async () => {
  const l = (await ve(U.e1.token, "leads.create", { cliente: { nombre: "Sin Reserva", telefono: "911111111" }, lead: {} })).lead;
  assert.equal((await cerrar(U.e1.token, l.id, DATOS())).error, "lead_no_reservado");
  const veh = await vehiculo();
  await ve(U.e1.token, "cotizaciones.save", { leadId: l.id, vehiculoId: veh.id, datos: {} });
  assert.equal((await cerrar(U.e1.token, l.id, DATOS())).error, "lead_no_reservado", "cotizado no basta: falta reservar");
  assert.equal((await ve(U.e3.token, "cierres.crear", { leadId: l.id, datos: DATOS() })).status, 404, "Eli no ve ese lead");
});

test("El ejecutivo pide el cierre: queda pendiente y todo sigue reservado hasta que el supervisor apruebe", async () => {
  const x = await leadReservado(U.e1.token);
  U.x1 = x;
  const r = await cerrar(U.e1.token, x.lead.id, DATOS({ precioFinal: 9800000, montoParteDePago: 2000000, montoFinanciado: 5000000, financiera: "Autofin", comisionFinanciera: 600000, seguro: true, notas: "Entrega el sábado" }));
  assert.equal(r.status, 200, JSON.stringify(r));
  const c = r.cierre;
  assert.equal(c.estado, "pendiente");
  assert.equal(c.ejecutivo_id, U.e1.id);
  assert.equal(c.precio_final, 9800000);
  assert.equal(c.precio_cotizado, 10000000);
  assert.equal(c.reserva_monto, 500000);
  assert.equal(c.costo, null, "el ejecutivo no ve el costo");
  assert.equal(c.margen, null, "ni el margen");
  assert.equal(c.solicitado_por, "Eva Uno");
  assert.equal(c.mes, null, "el mes de comisión se fija al aprobar");
  U.c1 = c;

  const veh = (await ve(U.jefe.token, "inventario.list")).vehiculos.find((v) => v.id === x.veh.id);
  assert.equal(veh.estado, "reservado");
  assert.equal(db.tablas.leads.find((l) => l.id === x.lead.id).etapa, "reservado");
  assert.equal(db.tablas.cierres.find((k) => k.id === c.id).margen, 1300000, "el margen se guarda: 9.800.000 − 8.500.000");
  assert.equal((await ve(U.e1.token, "leads.list")).marcas[x.lead.id].cierre_pendiente, true);
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "venta.solicitar" && b.detalle.precio_final === 9800000));
});

test("Datos del cierre: validaciones", async () => {
  const x = await leadReservado(U.e2.token);
  const mal = async (extra) => (await cerrar(U.e2.token, x.lead.id, DATOS(extra))).error;
  assert.equal(await mal({ precioFinal: 0 }), "precio_cierre_invalido");
  assert.equal(await mal({ montoParteDePago: 9000000, montoFinanciado: 2000000, financiera: "BK" }), "pagos_exceden_precio");
  assert.equal(await mal({ montoFinanciado: 3000000 }), "financiera_requerida");
  assert.equal(await mal({ fechaEntrega: "" }), "fecha_entrega_invalida");
  assert.equal(db.tablas.cierres.filter((c) => c.lead_id === x.lead.id).length, 0, "ninguno quedó guardado");
  U.x2 = x;
});

test("No se puede pedir un segundo cierre mientras hay uno en curso", async () => {
  assert.equal((await cerrar(U.e1.token, U.x1.lead.id, DATOS())).error, "cierre_en_curso");
});

test("Aprobar: solo el supervisor del local; el vehículo, la reserva, la cotización y el lead cambian juntos", async () => {
  assert.equal((await ve(U.e1.token, "cierres.aprobar", { id: U.c1.id })).status, 403, "el ejecutivo no aprueba su propia venta");
  assert.equal((await ve(U.mkt.token, "cierres.aprobar", { id: U.c1.id })).status, 403);
  assert.equal((await ve(U.jefeSur.token, "cierres.aprobar", { id: U.c1.id })).status, 404, "otro local no la ve");

  const ok = await ve(U.jefe.token, "cierres.aprobar", { id: U.c1.id });
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(ok.cierre.estado, "aprobada");
  assert.equal(ok.cierre.aprobado_por, "Julia Jefa");
  assert.equal(ok.cierre.mes, MES);
  assert.equal(ok.cierre.margen, 1300000, "la supervisora sí ve el margen");

  assert.equal(db.tablas.vehiculos.find((v) => v.id === U.x1.veh.id).estado, "vendido");
  assert.equal(db.tablas.reservas.find((r) => r.id === U.x1.res.id).estado, "convertida");
  assert.equal(db.tablas.cotizaciones.find((c) => c.id === U.x1.cot.id).estado, "vendida");
  assert.equal(db.tablas.leads.find((l) => l.id === U.x1.lead.id).etapa, "ganado");
  assert.equal((await ve(U.jefe.token, "cierres.aprobar", { id: U.c1.id })).error, "sin_cambio", "no se aprueba dos veces");
  const f = db.tablas.bitacora.find((b) => b.accion === "venta.aprobar");
  assert.equal(f.actor_nombre, "Julia Jefa");
  assert.equal(f.detalle.solicitado_por, "Eva Uno");
  assert.ok((await ve(U.e1.token, "leads.get", { id: U.x1.lead.id })).eventos.some((e) => e.tipo === "cierre" && /aprobada/.test(e.detalle)));
});

test("Una venta cerrada queda protegida: el vehículo, el lead y la reserva no se tocan a mano", async () => {
  assert.equal((await ve(U.jefe.token, "inventario.setEstado", { id: U.x1.veh.id, estado: "disponible" })).error, "vehiculo_vendido");
  assert.equal((await ve(U.jefe.token, "inventario.archivar", { id: U.x1.veh.id })).error, "vehiculo_vendido");
  const ed = await ve(U.jefe.token, "inventario.save", { id: U.x1.veh.id, datos: { patente: U.x1.veh.patente, marca: "Toyota", modelo: "Yaris", anio: 2020, km: 1, precioLista: 10000000, costo: 8500000, estado: "disponible" } });
  assert.equal(ed.vehiculo.estado, "vendido", "editar la ficha no la libera");
  assert.equal((await ve(U.e1.token, "leads.mover", { id: U.x1.lead.id, etapa: "seguimiento" })).error, "venta_cerrada");
  assert.equal((await ve(U.jefe.token, "leads.mover", { id: U.x1.lead.id, etapa: "seguimiento" })).error, "venta_cerrada", "ni siquiera el supervisor");
  assert.equal((await ve(U.e1.token, "cotizaciones.save", { leadId: U.x1.lead.id, vehiculoId: U.x1.veh.id, datos: {} })).error, "lead_cerrado");
  assert.equal((await ve(U.e1.token, "reservas.cancelar", { id: U.x1.res.id })).error, "reserva_cerrada");
  assert.equal((await ve(U.e1.token, "cotizaciones.anular", { id: U.x1.cot.id })).error, "cotizacion_cerrada");
});

test("Rechazar exige un motivo, y el ejecutivo puede volver a pedir el cierre", async () => {
  assert.equal((await ve(U.e2.token, "cierres.rechazar", { id: "x" })).status, 403);
  const c = (await cerrar(U.e2.token, U.x2.lead.id, DATOS({ precioFinal: 9000000 }))).cierre;
  assert.equal((await ve(U.jefe.token, "cierres.rechazar", { id: c.id, motivo: "" })).error, "motivo_requerido");
  const r = await ve(U.jefe.token, "cierres.rechazar", { id: c.id, motivo: "El precio no coincide con lo acordado" });
  assert.equal(r.cierre.estado, "rechazada");
  assert.equal(r.cierre.motivo_rechazo, "El precio no coincide con lo acordado");
  assert.equal(db.tablas.vehiculos.find((v) => v.id === U.x2.veh.id).estado, "reservado", "sigue reservado");
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "venta.rechazar" && b.detalle.motivo));

  const otra = await cerrar(U.e2.token, U.x2.lead.id, DATOS({ precioFinal: 9800000 }));
  assert.equal(otra.status, 200, "una rechazada no bloquea un nuevo intento");
  U.c2 = otra.cierre;
});

test("Retirar un cierre pendiente: lo puede hacer su dueño y deja todo como estaba", async () => {
  assert.equal((await ve(U.e1.token, "cierres.retirar", { id: U.c2.id })).status, 404, "Eva no ve el lead de Ema");
  const r = await ve(U.e2.token, "cierres.retirar", { id: U.c2.id });
  assert.equal(r.cierre.estado, "anulada");
  assert.equal(db.tablas.vehiculos.find((v) => v.id === U.x2.veh.id).estado, "reservado");
  assert.equal((await ve(U.e2.token, "cierres.retirar", { id: U.c2.id })).error, "sin_cambio");
});

test("Si la reserva se cancela con un cierre pendiente, el cierre se anula solo", async () => {
  const x = await leadReservado(U.e2.token);
  const c = (await cerrar(U.e2.token, x.lead.id, DATOS())).cierre;
  assert.equal((await ve(U.e2.token, "reservas.cancelar", { id: x.res.id, motivo: "Desistió" })).ok, true);
  const k = db.tablas.cierres.find((y) => y.id === c.id);
  assert.equal(k.estado, "anulada");
  assert.match(k.motivo_anulacion, /reserva/i);
  assert.equal((await ve(U.jefe.token, "cierres.aprobar", { id: c.id })).error, "sin_cambio");
});

test("Una reserva con un cierre esperando aprobación no se libera sola al vencer", async () => {
  const x = await leadReservado(U.e1.token);
  const c = (await cerrar(U.e1.token, x.lead.id, DATOS())).cierre;
  db.tablas.reservas.find((r) => r.id === x.res.id).vence_en = new Date(Date.now() - 3600_000).toISOString();
  await ve(U.jefe.token, "inventario.list");
  assert.equal(db.tablas.reservas.find((r) => r.id === x.res.id).estado, "activa", "decide el supervisor, no el reloj");
  assert.equal((await ve(U.jefe.token, "cierres.aprobar", { id: c.id })).status, 200);
});

test("Si el supervisor cierra la venta, queda aprobada de inmediato y a su nombre", async () => {
  const x = await leadReservado(U.jefe.token);
  const l = db.tablas.leads.find((y) => y.id === x.lead.id);
  const r = await cerrar(U.jefe.token, x.lead.id, DATOS());
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.cierre.estado, "aprobada");
  assert.equal(r.cierre.aprobado_por, "Julia Jefa");
  assert.equal(r.cierre.solicitado_por, "Julia Jefa");
  assert.equal(db.tablas.leads.find((y) => y.id === x.lead.id).etapa, "ganado");
  assert.ok(l.asignado_a, "el lead tiene dueño");
  assert.equal(r.cierre.ejecutivo_id, l.asignado_a, "la venta cuenta para quien tiene el lead");
});

test("Anular una venta aprobada: solo el supervisor, con motivo; el vehículo y el lead vuelven atrás", async () => {
  const v = await vender(U.e2.token);
  assert.equal((await ve(U.e2.token, "cierres.anular", { id: v.cierre.id, motivo: "Error" })).status, 403);
  assert.equal((await ve(U.jefe.token, "cierres.anular", { id: v.cierre.id, motivo: "" })).error, "motivo_requerido");
  const r = await ve(U.jefe.token, "cierres.anular", { id: v.cierre.id, motivo: "El cliente no pagó" });
  assert.equal(r.cierre.estado, "anulada");
  assert.equal(r.cierre.anulado_por, "Julia Jefa");
  assert.equal(r.cierre.motivo_anulacion, "El cliente no pagó");
  assert.equal(db.tablas.vehiculos.find((x) => x.id === v.veh.id).estado, "disponible");
  assert.equal(db.tablas.cotizaciones.find((x) => x.id === v.cot.id).estado, "vigente");
  assert.equal(db.tablas.leads.find((x) => x.id === v.lead.id).etapa, "cotizado");
  assert.equal((await ve(U.jefe.token, "cierres.anular", { id: v.cierre.id, motivo: "otra vez" })).error, "sin_cambio");
  const f = db.tablas.bitacora.find((b) => b.accion === "venta.anular");
  assert.equal(f.detalle.mes, MES);
  assert.equal(f.detalle.motivo, "El cliente no pagó");
  // El vehículo queda libre para venderse de nuevo.
  assert.equal((await ve(U.e2.token, "reservas.crear", { cotizacionId: v.cot.id, monto: 400000 })).status, 200);
});

test("Listado de ventas: cada ejecutivo ve las suyas; el supervisor, las del local; el costo solo para quien corresponde", async () => {
  const propias = await ve(U.e1.token, "cierres.list");
  assert.ok(propias.cierres.length >= 1 && propias.cierres.every((c) => c.ejecutivo_id === U.e1.id));
  assert.ok(propias.cierres.every((c) => c.costo === null && c.margen === null));
  assert.equal(propias.puedeAprobar, false);
  assert.equal(propias.nombreMes.split(" ")[1], MES.slice(0, 4));

  const todas = await ve(U.jefe.token, "cierres.list");
  assert.ok(todas.cierres.length > propias.cierres.length);
  assert.ok(todas.cierres.some((c) => c.margen != null && c.ejecutivo === "Eva Uno" && c.folio.startsWith("VTA-")));
  assert.equal((await ve(U.jefeSur.token, "cierres.list")).cierres.length, 0, "otro local no ve estas ventas");
  assert.equal((await ve(U.mkt.token, "cierres.list")).status, 200, "Marketing puede mirar");
  assert.equal((await ve(U.jefe.token, "cierres.list", { mes: "2026-13" })).error, "mes_invalido");
  const pend = await ve(U.jefe.token, "cierres.list", { estado: "pendiente" });
  assert.ok(pend.cierres.every((c) => c.estado === "pendiente"));
});

test("Sin permiso no se cierra: Marketing mira, Eli (sin ventas) no cierra", async () => {
  const x = await leadReservado(U.e1.token);
  assert.equal((await ve(U.mkt.token, "cierres.crear", { leadId: x.lead.id, datos: DATOS() })).status, 403);
  assert.equal((await ve(U.e3.token, "cierres.crear", { leadId: x.lead.id, datos: DATOS() })).status, 404);
  await ve(U.e1.token, "reservas.cancelar", { id: x.res.id });
});

test("Comisiones: tramos estándar, y el tramo nuevo se aplica a TODAS las ventas del mes", async () => {
  // Estado limpio para Ana (nueva ejecutiva): sin ventas en el mes.
  await crear("ana", "Ana Tramos", "11.111.111-1", ["ejecutivo"], L1, { otorgar: ["ventas.operar"], quitar: [] });
  const ventas = [];
  ventas.push(await vender(U.ana.token, { seguro: true, montoFinanciado: 5000000, financiera: "Autofin", comisionFinanciera: 500000 }));
  ventas.push(await vender(U.ana.token, { montoFinanciado: 4000000, financiera: "BK", comisionFinanciera: 300000 }));
  ventas.push(await vender(U.ana.token));

  const r3 = await ve(U.ana.token, "comisiones.resumen");
  assert.equal(r3.status, 200, JSON.stringify(r3));
  assert.equal(r3.verTodos, false);
  assert.equal(r3.ejecutivos.length, 1, "solo ve su propia comisión");
  const e = r3.ejecutivos[0];
  assert.deepEqual(e.datos, { ventasN: 3, segurosN: 1, creditosN: 2, creditosComision: 800000, comprasN: 0, consigRows: [] });
  assert.equal(e.produccion.ventas.total, 3 * 75000);
  assert.equal(e.produccion.seguros.total, 1 * 35000);
  assert.equal(e.produccion.creditos.total, 800000 * 0.15);
  assert.equal(e.produccion.total, 225000 + 35000 + 120000);
  assert.equal(e.produccion.ventas.proximo.faltan, 1, "una venta más y pasa al tramo de $90.000");
  assert.equal(e.margen, null, "la ejecutiva no ve márgenes");
  assert.equal(r3.meta, 0);

  ventas.push(await vender(U.ana.token));
  const r4 = (await ve(U.ana.token, "comisiones.resumen")).ejecutivos[0];
  assert.equal(r4.datos.ventasN, 4);
  assert.equal(r4.produccion.ventas.total, 4 * 90000, "las 4 ventas pagan $90.000, no solo la cuarta");
  assert.equal(r4.produccion.ventas.tramo, "4 a 10");

  // Anular una venta del mes: la comisión se recalcula sin ella y baja de tramo.
  await ve(U.jefe.token, "cierres.anular", { id: ventas[3].cierre.id, motivo: "Venta caída" });
  const r3b = (await ve(U.ana.token, "comisiones.resumen")).ejecutivos[0];
  assert.equal(r3b.datos.ventasN, 3);
  assert.equal(r3b.produccion.ventas.total, 3 * 75000);
  U.anaVentas = ventas;
});

test("Comisiones: la supervisora ve a todo el equipo con sus márgenes; otro local no", async () => {
  const r = await ve(U.jefe.token, "comisiones.resumen");
  assert.equal(r.verTodos, true);
  const nombres = r.ejecutivos.map((e) => e.nombre);
  assert.ok(nombres.includes("Ana Tramos") && nombres.includes("Eva Uno") && nombres.includes("Ema Dos"));
  assert.ok(!nombres.includes("Eli Tres"), "Eli no está habilitada para ventas");
  const ana = r.ejecutivos.find((e) => e.nombre === "Ana Tramos");
  assert.ok(ana.margen > 0, "la supervisora ve el margen");
  assert.equal(r.ejecutivos[0].datos.ventasN >= r.ejecutivos[1].datos.ventasN, true, "ordenados por ventas");
  assert.equal(r.totales.unidades, r.ejecutivos.reduce((a, e) => a + e.datos.ventasN, 0));
  assert.equal(r.totales.produccion, r.ejecutivos.reduce((a, e) => a + e.produccion.total, 0));
  assert.deepEqual(r.pendientesDeOtrosModulos, []);
  assert.equal((await ve(U.jefeSur.token, "comisiones.resumen")).ejecutivos.length, 0);
  assert.equal((await ve(U.mkt.token, "comisiones.resumen")).status, 403, "Marketing no ve comisiones");
  assert.equal((await ve(U.e1.token, "comisiones.resumen")).ejecutivos.length, 1, "Eva solo ve la suya");
  assert.equal((await ve(U.e1.token, "comisiones.resumen", { mes: "no" })).error, "mes_invalido");
});

test("Comisiones por mes: una venta aprobada en otro mes cuenta en ese mes", async () => {
  const anterior = "2026-01";
  const cierre = db.tablas.cierres.find((c) => c.id === U.anaVentas[0].cierre.id);
  cierre.mes = anterior;
  const actual = (await ve(U.ana.token, "comisiones.resumen")).ejecutivos[0];
  const previo = (await ve(U.ana.token, "comisiones.resumen", { mes: anterior })).ejecutivos[0];
  assert.equal(actual.datos.ventasN, 2);
  assert.equal(previo.datos.ventasN, 1);
  assert.equal(previo.produccion.seguros.total, 35000);
  cierre.mes = MES;
});

test("Tramos propios: el administrador los define por persona y reemplazan a los estándar en ese módulo", async () => {
  const mal = await crm(admin, "usuarios.update", { id: U.ana.id, datos: { nombre: "Ana Tramos", roles: ["ejecutivo"], localId: L1, extra: { otorgar: ["ventas.operar"], quitar: [] }, comision: { tramos: { ventas: [{ min: 1, max: 5, rate: 100000 }, { min: 4, max: "", rate: 200000 }] } } } });
  assert.equal(mal.error, "tramos_invalidos", "tramos que se superponen");
  const ok = await crm(admin, "usuarios.update", { id: U.ana.id, datos: { nombre: "Ana Tramos", roles: ["ejecutivo"], localId: L1, extra: { otorgar: ["ventas.operar"], quitar: [] }, comision: { tramos: { ventas: [{ min: 1, max: 10, rate: 100000 }, { min: 11, max: "", rate: 110000 }] } } } });
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(ok.usuario.comision.tramos.ventas.length, 2);
  const e = (await ve(U.ana.token, "comisiones.resumen")).ejecutivos[0];
  assert.equal(e.personalizado, true);
  assert.equal(e.produccion.ventas.total, 3 * 100000);
  assert.equal(e.produccion.seguros.total, 35000, "seguros sigue con el tramo estándar");
  const f = db.tablas.bitacora.find((b) => b.accion === "usuario.editar" && b.detalle.comision);
  assert.deepEqual(f.detalle.comision.antes, {});

  // Editar a la persona sin enviar tramos no los borra.
  await crm(admin, "usuarios.update", { id: U.ana.id, datos: { nombre: "Ana Tramos B", roles: ["ejecutivo"], localId: L1, extra: { otorgar: ["ventas.operar"], quitar: [] } } });
  assert.equal((await ve(U.ana.token, "comisiones.resumen")).ejecutivos[0].produccion.ventas.total, 3 * 100000);
  // Enviar tramos vacíos la devuelve a los estándar.
  await crm(admin, "usuarios.update", { id: U.ana.id, datos: { nombre: "Ana Tramos", roles: ["ejecutivo"], localId: L1, extra: { otorgar: ["ventas.operar"], quitar: [] }, comision: { tramos: {} } } });
  const e2 = (await ve(U.ana.token, "comisiones.resumen")).ejecutivos[0];
  assert.equal(e2.personalizado, false);
  assert.equal(e2.produccion.ventas.total, 3 * 75000);
});

test("La meta mensual sale de la configuración", async () => {
  await crm(admin, "config.set", { clave: "meta_mensual_unidades", valor: 8 });
  assert.equal((await ve(U.ana.token, "comisiones.resumen")).meta, 8);
});

test("Si faltan las tablas de la entrega 2C, el resto sigue funcionando", async () => {
  const guardadas = { ...db.tablas };
  delete db.tablas.cierres;
  try {
    assert.equal((await ve(U.jefe.token, "inventario.list")).status, 200);
    assert.equal((await ve(U.e1.token, "leads.list")).status, 200);
    assert.equal((await ve(U.e1.token, "cierres.list")).error, "crm_not_installed");
    const x = db.tablas.leads.find((l) => l.etapa === "reservado");
    if (x) assert.equal((await cerrar(U.jefe.token, x.id, DATOS())).error, "crm_not_installed");
  } finally { Object.assign(db.tablas, guardadas); }
});
