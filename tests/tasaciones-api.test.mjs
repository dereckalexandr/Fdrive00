// Perfil del Tasador: solicitudes de los ejecutivos, tasaciones directas y valor reconocido en parte de pago,
// contra la función real y una base falsa en memoria.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const kv = (token, op, key, extra = {}) => api({ action: "kv", token, op, key, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1; let L2;
let n = 0;
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const haceH = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const VEH = { patente: "ABCD12", marca: "Toyota", modelo: "Yaris", anio: 2018, km: 78000, version: "1.5 GLI", transmision: "Automática", combustible: "Bencina" };
const fila = (id) => db.tablas.tasaciones.find((t) => t.id === id);
const filaLead = (id) => db.tablas.leads.find((l) => l.id === id);

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}
async function lead(token, asignarA) {
  const r = await ve(token, "leads.create", { cliente: { nombre: `Cliente ${++n}`, telefono: `9${String(30000000 + n)}` }, lead: {}, asignarA });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.lead;
}
const pedir = (token, leadId, vehiculo = VEH, notas) => ve(token, "tasaciones.pedir", { leadId, datos: { vehiculo, notas } });
/** Pide, toma y completa una tasación; devuelve la tasación completada. */
async function tasar(tokenEje, leadId, tasador, { compra = 6500000, venta = 8500000, vehiculo = VEH } = {}) {
  const t = (await pedir(tokenEje, leadId, vehiculo)).tasacion;
  assert.ok(t, "no se pudo pedir");
  assert.equal((await ve(tasador.token, "tasaciones.tomar", { id: t.id })).status, 200);
  const r = await ve(tasador.token, "tasaciones.completar", { id: t.id, borrador: { aplicaPara: "compra", valorCompra: compra, valorVenta: venta } });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.tasacion;
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
  await crear("t1", "Tito Tasador", "5.555.555-9", ["tasador"], L1);
  await crear("t2", "Tania Tasadora", "11.111.111-1", ["tasador"], L1);
  await crear("tSur", "Tomás Sur", "13.579.246-2", ["tasador"], L2);
  await crear("jefeSur", "Jorge Sur", "8.765.432-K", ["jefe_local"], L2);
  await crear("mkt", "Marta Marketing", "10.000.013-K", ["marketing"], L1);
  await crear("insp", "Ivo Inspector", "12.000.000-4", ["inspector"], L1);
});

test("Permisos básicos: quién puede pedir, quién tasar y quién ni siquiera entra", async () => {
  for (const op of ["tasaciones.list", "tasaciones.resumen", "tasaciones.equipo"]) {
    assert.equal((await ve(U.mkt.token, op, { vista: "cola" })).status, 403, `${op}: marketing`);
    assert.equal((await ve(U.insp.token, op, { vista: "cola" })).status, 403, `${op}: inspector`);
  }
  assert.equal((await ve(U.e1.token, "tasaciones.list", { vista: "cola" })).status, 403, "el ejecutivo no ve la cola");
  assert.equal((await ve(U.e1.token, "tasaciones.resumen")).status, 403);
  assert.equal((await ve(U.e1.token, "tasaciones.tomar", { id: randomUUID() })).status, 403);
  assert.equal((await ve(U.e1.token, "tasaciones.directa", { datos: { vehiculo: VEH } })).status, 403);
  U.l1 = await lead(U.e1.token);
  assert.equal((await pedir(U.t1.token, U.l1.id)).status, 403, "el Tasador no pide: tasa");
  assert.equal((await pedir(U.mkt.token, U.l1.id)).status, 403);
  assert.equal((await ve(U.t1.token, "leads.list")).status, 403, "el Tasador no entra a los leads");
  assert.equal((await ve(U.mkt.token, "tasaciones.pedir", { leadId: U.l1.id, datos: { vehiculo: VEH } })).status, 403);
});

test("Pedir una tasación: queda en la cola y el lead guarda el vehículo en parte de pago", async () => {
  assert.equal((await pedir(U.e1.token, U.l1.id, { ...VEH, patente: "123" })).error, "patente_invalida");
  assert.equal((await pedir(U.e1.token, U.l1.id, { ...VEH, km: "" })).error, "km_invalido");
  assert.equal((await pedir(U.e2.token, U.l1.id)).status, 404, "Ema no ve el lead de Eva");
  assert.equal((await pedir(U.e3.token, U.l1.id)).status, 404);

  const r = await pedir(U.e1.token, U.l1.id, VEH, "El cliente espera $7.000.000");
  assert.equal(r.status, 200, JSON.stringify(r));
  const t = r.tasacion;
  assert.equal(t.estado, "pendiente");
  assert.equal(t.tipo, "parte_pago");
  assert.equal(t.folio, `TAS-${String(t.numero).padStart(6, "0")}`);
  assert.equal(t.vehiculo.patente, "ABCD12");
  assert.equal(t.notas_solicitud, "El cliente espera $7.000.000");
  assert.equal(t.solicitante, "Eva Uno");
  assert.match(t.cliente, /^Cliente /);
  assert.equal(t.tasador_id, null);
  const l = filaLead(U.l1.id);
  assert.equal(l.parte_pago.tiene, true);
  assert.equal(l.parte_pago.patente, "ABCD12");
  assert.equal(l.parte_pago.valor, undefined, "aún no hay valor reconocido");
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === U.l1.id && e.tipo === "tasacion" && /pedida por Eva Uno/.test(e.detalle)));
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "tasacion.pedir" && b.detalle.patente === "ABCD12"));
  U.t1a = t;
});

test("Una sola tasación abierta por lead", async () => {
  assert.equal((await pedir(U.e1.token, U.l1.id)).error, "tasacion_en_curso");
  assert.equal((await pedir(U.jefe.token, U.l1.id)).error, "tasacion_en_curso", "ni siquiera el supervisor");
});

test("Quién ve qué: el Tasador y el supervisor la cola; cada ejecutivo, lo suyo", async () => {
  const cola = await ve(U.t1.token, "tasaciones.list", { vista: "cola" });
  assert.equal(cola.tasaciones.length, 1);
  assert.equal(cola.tasaciones[0].id, U.t1a.id);
  assert.equal((await ve(U.jefe.token, "tasaciones.list", { vista: "cola" })).tasaciones.length, 1);
  assert.equal((await ve(U.tSur.token, "tasaciones.list", { vista: "cola" })).tasaciones.length, 0, "otro local no la ve");
  assert.equal((await ve(U.jefeSur.token, "tasaciones.list", { vista: "local" })).tasaciones.length, 0);

  assert.equal((await ve(U.e1.token, "tasaciones.list", { vista: "solicitadas" })).tasaciones.length, 1);
  assert.equal((await ve(U.e2.token, "tasaciones.list", { vista: "solicitadas" })).tasaciones.length, 0);
  assert.equal((await ve(U.e1.token, "tasaciones.get", { id: U.t1a.id })).status, 200);
  assert.equal((await ve(U.e2.token, "tasaciones.get", { id: U.t1a.id })).status, 404, "Ema no ve la tasación de Eva");
  assert.equal((await ve(U.t1.token, "tasaciones.get", { id: U.t1a.id })).status, 200);
  assert.equal((await ve(U.tSur.token, "tasaciones.get", { id: U.t1a.id })).status, 404);
  assert.equal((await ve(U.t1.token, "tasaciones.list", { vista: "inventada" })).error, "vista_invalida");
});

test("Tomar: el primero se la queda; otro no puede; la cuenta maestra tampoco tasa", async () => {
  assert.equal((await ve(admin, "tasaciones.tomar", { id: U.t1a.id })).status, 403);
  const r = await ve(U.t1.token, "tasaciones.tomar", { id: U.t1a.id });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.tasacion.estado, "en_proceso");
  assert.equal(r.tasacion.tasador, "Tito Tasador");
  assert.ok(fila(U.t1a.id).tomada_en);
  assert.equal((await ve(U.t2.token, "tasaciones.tomar", { id: U.t1a.id })).error, "tasacion_ya_tomada");
  assert.equal((await ve(U.t1.token, "tasaciones.tomar", { id: U.t1a.id })).error, "tasacion_ya_tomada", "ni siquiera quien ya la tiene");
  assert.equal((await ve(U.t1.token, "tasaciones.list", { vista: "cola" })).tasaciones.length, 0, "ya salió de la cola");
  assert.equal((await ve(U.t1.token, "tasaciones.list", { vista: "mias" })).tasaciones.length, 1);
  assert.equal((await ve(U.t2.token, "tasaciones.list", { vista: "mias" })).tasaciones.length, 0);
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === U.l1.id && /Tito Tasador tomó/.test(e.detalle)));
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "tasacion.tomar"));
});

test("Devolver a la cola y asignar: quién puede hacerlo", async () => {
  assert.equal((await ve(U.t2.token, "tasaciones.liberar", { id: U.t1a.id })).status, 403, "otra persona no la devuelve");
  assert.equal((await ve(U.e1.token, "tasaciones.liberar", { id: U.t1a.id })).status, 403);
  const lib = await ve(U.t1.token, "tasaciones.liberar", { id: U.t1a.id });
  assert.equal(lib.tasacion.estado, "pendiente");
  assert.equal(lib.tasacion.tasador_id, null);
  assert.equal((await ve(U.t1.token, "tasaciones.liberar", { id: U.t1a.id })).error, "tasacion_estado_invalido", "ya está en la cola");

  assert.equal((await ve(U.t1.token, "tasaciones.asignar", { id: U.t1a.id, tasadorId: U.t2.id })).status, 403, "solo el supervisor asigna");
  assert.equal((await ve(U.jefe.token, "tasaciones.asignar", { id: U.t1a.id, tasadorId: U.e1.id })).error, "asignado_invalido", "un ejecutivo no tasa");
  assert.equal((await ve(U.jefe.token, "tasaciones.asignar", { id: U.t1a.id, tasadorId: U.tSur.id })).error, "asignado_invalido", "ni alguien de otro local");
  const asig = await ve(U.jefe.token, "tasaciones.asignar", { id: U.t1a.id, tasadorId: U.t2.id });
  assert.equal(asig.tasacion.estado, "en_proceso");
  assert.equal(asig.tasacion.tasador, "Tania Tasadora");
  assert.equal((await ve(U.jefe.token, "tasaciones.equipo")).tasadores.map((x) => x.nombre).sort().join(), "Tania Tasadora,Tito Tasador");
  assert.equal((await ve(U.e1.token, "tasaciones.equipo")).status, 403);
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "tasacion.asignar"));
});

test("Guardar un borrador: solo quien la tiene; los datos se limpian", async () => {
  const id = U.t1a.id; // ahora es de Tania
  const borrador = { valorCompra: 6500000, valorVenta: 8500000, observaciones: "  Pintura nueva en el capó  ", fotos: ["abcdef12", "../x"],
    estimacion: { promedio: 8500000, compra: 6500000, hackeo: "<script>" }, inspeccion: { key: "vendors" }, vehiculo: { ...VEH, km: 80000 } };
  assert.equal((await ve(U.t1.token, "tasaciones.guardar", { id, borrador })).status, 403, "Tito ya no la tiene");
  assert.equal((await ve(U.e1.token, "tasaciones.guardar", { id, borrador })).status, 403);
  assert.equal((await ve(U.t2.token, "tasaciones.guardar", { id, borrador: { aplicaPara: "compra", valorCompra: "abc" } })).error, "valor_compra_invalido");
  const r = await ve(U.t2.token, "tasaciones.guardar", { id, borrador });
  assert.equal(r.status, 200, JSON.stringify(r));
  const t = fila(id);
  assert.equal(t.valor_compra, 6500000);
  assert.equal(t.observaciones, "Pintura nueva en el capó");
  assert.deepEqual(t.fotos, ["abcdef12"], "el id de foto malicioso se descarta");
  assert.equal(t.estimacion.hackeo, undefined);
  assert.equal(t.estimacion.compra, 6500000);
  assert.deepEqual(t.inspeccion, {}, "no se puede vincular cualquier registro");
  assert.equal(t.vehiculo.km, 80000);
  assert.equal(t.estado, "en_proceso", "guardar no la termina");
  assert.equal(filaLead(U.l1.id).parte_pago.valor, undefined, "el lead no cambia hasta completarla");
});

test("Completar: valores obligatorios; al terminar el lead queda con el valor reconocido y su tope", async () => {
  const id = U.t1a.id;
  assert.equal((await ve(U.t1.token, "tasaciones.completar", { id })).status, 403);
  assert.equal((await ve(U.t2.token, "tasaciones.completar", { id, borrador: { valorVenta: 0 } })).error, "valor_venta_invalido");
  assert.equal((await ve(U.t2.token, "tasaciones.completar", { id, borrador: { aplicaPara: "compra", valorCompra: 9000000, valorVenta: 8500000 } })).error, "valor_venta_menor");
  assert.equal(fila(id).estado, "en_proceso", "un intento fallido no la termina");
  const r = await ve(U.t2.token, "tasaciones.completar", { id, borrador: { aplicaPara: "compra", valorCompra: 6500000, valorVenta: 8500000 } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.tasacion.estado, "completada");
  assert.ok(fila(id).completada_en);
  const pp = filaLead(U.l1.id).parte_pago;
  assert.equal(pp.valor, 6500000);
  assert.equal(pp.tasacion_id, id);
  assert.equal(pp.patente, "ABCD12");
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === U.l1.id && /completada por Tania Tasadora/.test(e.detalle)));
  const f = db.tablas.bitacora.find((b) => b.accion === "tasacion.completar");
  assert.equal(f.detalle.valor_compra, 6500000);
  // Terminada, ya no se edita ni se completa de nuevo.
  assert.equal((await ve(U.t2.token, "tasaciones.guardar", { id, borrador: { observaciones: "x" } })).error, "tasacion_estado_invalido");
  assert.equal((await ve(U.t2.token, "tasaciones.completar", { id, borrador: {} })).error, "tasacion_estado_invalido");
  // El ejecutivo ve el resultado en el lead y en sus solicitudes.
  const g = await ve(U.e1.token, "leads.get", { id: U.l1.id });
  assert.equal(g.tasaciones.length, 1);
  assert.equal(g.tasaciones[0].valor_compra, 6500000);
  assert.equal(g.tasaciones[0].fotos, undefined, "la lista del lead no arrastra las fotos");
  assert.equal(g.tasaciones[0].nFotos, 1);
});

test("El valor tasado es el tope: se puede bajar al negociar, no subir", async () => {
  const veh = (await ve(U.jefe.token, "inventario.save", { datos: { patente: "WXYZ99", marca: "Kia", modelo: "Rio", anio: 2020, km: 1, precioLista: 12000000, costo: 10000000 } })).vehiculo;
  const cot = (datos) => ve(U.e1.token, "cotizaciones.save", { leadId: U.l1.id, vehiculoId: veh.id, datos });
  assert.equal((await cot({ parteDePago: { tiene: true, valor: 7000000 } })).error, "parte_pago_excede_tasacion");
  assert.equal((await cot({ parteDePago: { tiene: true, valor: 6500001 } })).error, "parte_pago_excede_tasacion");
  const ok = await cot({ parteDePago: { tiene: true, valor: 6500000, patente: "ABCD12" } });
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal((await cot({ parteDePago: { tiene: true, valor: 5000000 } })).status, 200, "negociar a la baja es válido");
  assert.equal((await cot({ parteDePago: { tiene: false } })).status, 200, "si ya no entrega el vehículo, no aplica");
  U.veh = veh; U.cot = ok.cotizacion;
});

test("Editar el lead: el valor tampoco puede subir y el vínculo con la tasación se conserva", async () => {
  const edit = (valor) => ve(U.e1.token, "leads.update", { id: U.l1.id, lead: { parteDePago: { tiene: true, patente: "ABCD12", marca: "Toyota", modelo: "Yaris", anio: 2018, km: 80000, valor }, notas: "x" } });
  assert.equal((await edit(7000000)).error, "parte_pago_excede_tasacion");
  const ok = await edit(6000000);
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(filaLead(U.l1.id).parte_pago.tasacion_id, U.t1a.id, "la pantalla no manda el vínculo y aun así se conserva");
  assert.equal(filaLead(U.l1.id).parte_pago.valor, 6000000);
  assert.equal((await edit(6500000)).status, 200, "puede volver al valor tasado");
});

test("Cierre de venta: lo recibido por el vehículo tampoco supera lo tasado", async () => {
  const cot = (await ve(U.e1.token, "cotizaciones.save", { leadId: U.l1.id, vehiculoId: U.veh.id, datos: { parteDePago: { tiene: true, valor: 6000000 } } })).cotizacion;
  assert.equal((await ve(U.e1.token, "reservas.crear", { cotizacionId: cot.id, monto: 300000 })).status, 200);
  const cierre = (datos) => ve(U.e1.token, "cierres.crear", { leadId: U.l1.id, datos: { precioFinal: 11500000, fechaEntrega: hoy(), ...datos } });
  assert.equal((await cierre({ montoParteDePago: 7000000 })).error, "parte_pago_excede_tasacion");
  const ok = await cierre({ montoParteDePago: 6500000 });
  assert.equal(ok.status, 200, JSON.stringify(ok));
  await ve(U.e1.token, "cierres.retirar", { id: ok.cierre.id });
  await ve(U.e1.token, "reservas.cancelar", { id: db.tablas.reservas.find((r) => r.lead_id === U.l1.id && r.estado === "activa").id });
});

test("Pedir una nueva tasación: es la única forma de subir el valor", async () => {
  const nueva = await tasar(U.e1.token, U.l1.id, U.t1, { compra: 7200000, venta: 9000000 });
  assert.equal(nueva.estado, "completada");
  assert.equal(filaLead(U.l1.id).parte_pago.valor, 7200000);
  assert.equal(filaLead(U.l1.id).parte_pago.tasacion_id, nueva.id, "el vínculo apunta a la tasación nueva");
  const veh = (await ve(U.jefe.token, "inventario.save", { datos: { patente: "QQQQ11", marca: "Kia", modelo: "Rio", anio: 2020, km: 1, precioLista: 12000000, costo: 10000000 } })).vehiculo;
  assert.equal((await ve(U.e1.token, "cotizaciones.save", { leadId: U.l1.id, vehiculoId: veh.id, datos: { parteDePago: { tiene: true, valor: 7200000 } } })).status, 200);
  assert.equal((await ve(U.e1.token, "cotizaciones.save", { leadId: U.l1.id, vehiculoId: veh.id, datos: { parteDePago: { tiene: true, valor: 7200001 } } })).error, "parte_pago_excede_tasacion");
});

test("Cancelar: el ejecutivo solo mientras está en la cola; el Tasador la suya; el supervisor cualquiera", async () => {
  const l2 = await lead(U.e2.token);
  const t = (await pedir(U.e2.token, l2.id)).tasacion;
  assert.equal((await ve(U.e1.token, "tasaciones.cancelar", { id: t.id, motivo: "No es mía" })).status, 404, "no ve la de otra persona");
  assert.equal((await ve(U.e2.token, "tasaciones.cancelar", { id: t.id, motivo: "" })).error, "motivo_requerido");
  const r = await ve(U.e2.token, "tasaciones.cancelar", { id: t.id, motivo: "El cliente ya no entrega el auto" });
  assert.equal(r.tasacion.estado, "cancelada");
  assert.ok(fila(t.id).cancelada_en);
  assert.equal((await ve(U.e2.token, "tasaciones.cancelar", { id: t.id, motivo: "otra vez" })).error, "tasacion_estado_invalido");

  const t2 = (await pedir(U.e2.token, l2.id)).tasacion;
  await ve(U.t1.token, "tasaciones.tomar", { id: t2.id });
  assert.equal((await ve(U.e2.token, "tasaciones.cancelar", { id: t2.id, motivo: "Ya la tomaron" })).status, 403, "tomada: el ejecutivo ya no puede cancelarla");
  assert.equal((await ve(U.t2.token, "tasaciones.cancelar", { id: t2.id, motivo: "No es mía" })).status, 403);
  assert.equal((await ve(U.t1.token, "tasaciones.cancelar", { id: t2.id, motivo: "Vehículo no coincide" })).tasacion.estado, "cancelada");

  const t3 = (await pedir(U.e2.token, l2.id)).tasacion;
  assert.equal((await ve(U.jefe.token, "tasaciones.cancelar", { id: t3.id, motivo: "Duplicada" })).tasacion.estado, "cancelada");
  assert.equal((await ve(U.t1.token, "tasaciones.cancelar", { id: U.t1a.id, motivo: "Ya completada" })).error, "tasacion_estado_invalido");
  assert.equal(db.tablas.bitacora.filter((b) => b.accion === "tasacion.cancelar").length, 3);
});

test("Lead cerrado: no se pide tasación", async () => {
  const l = await lead(U.e1.token);
  await ve(U.e1.token, "leads.mover", { id: l.id, etapa: "perdido", motivo: "Precio" });
  assert.equal((await pedir(U.e1.token, l.id)).error, "lead_cerrado");
});

test("Tasación directa: el Tasador la crea y la toma; sin lead ni ejecutivo", async () => {
  const r = await ve(U.t1.token, "tasaciones.directa", { datos: { vehiculo: { patente: "ZZZZ99", marca: "Suzuki", modelo: "Swift", anio: 2016, km: 90000 }, contacto: { nombre: "Pedro Soto", telefono: "+56 9 1234 5678" }, notas: "Quiere consignar" } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.tasacion.tipo, "directa");
  assert.equal(r.tasacion.estado, "en_proceso");
  assert.equal(r.tasacion.tasador, "Tito Tasador");
  assert.equal(r.tasacion.cliente, "Pedro Soto");
  assert.ok(!r.tasacion.lead_id, "no está ligada a ningún lead");
  const c = await ve(U.t1.token, "tasaciones.completar", { id: r.tasacion.id, borrador: { aplicaPara: "compra", valorCompra: 4000000, valorVenta: 5200000 } });
  assert.equal(c.tasacion.estado, "completada");
  assert.equal((await ve(U.t1.token, "tasaciones.directa", { datos: { vehiculo: { patente: "1" } } })).error, "patente_invalida");
  assert.equal((await ve(U.t1.token, "tasaciones.directa", { datos: { vehiculo: { patente: "ZZZZ98", marca: "Suzuki", modelo: "Swift", anio: 2016, km: 1 }, contacto: { nombre: "Al" } } })).error, "nombre_invalido");
  assert.equal((await ve(U.e1.token, "tasaciones.get", { id: r.tasacion.id })).status, 404, "una directa no es de ningún ejecutivo");
  assert.equal((await ve(U.t2.token, "tasaciones.get", { id: r.tasacion.id })).status, 200, "pero cualquier Tasador del local la ve");
  // La cuenta maestra la deja en la cola para que alguien la tome.
  const a = await ve(admin, "tasaciones.directa", { localId: L1, datos: { vehiculo: { patente: "YYYY88", marca: "Kia", modelo: "Rio", anio: 2017, km: 1 } } });
  assert.equal(a.tasacion.estado, "pendiente");
  assert.equal(a.tasacion.tasador_id, null);
});

test("Inspecciones del mismo vehículo: se encuentran por patente y nunca se muestran datos del propietario", async () => {
  db.tablas.kv_store.push(
    { key: "inspeccion::INS001::abc", value: JSON.stringify({ inscripcion: "ABCD.12-3", marca: "Toyota", modelo: "Yaris", anio: "2018", fecha: "2026-10-06", inspectorNombre: "Ivo Inspector", propietarioNombre: "JUAN PEREZ GONZALEZ", propietarioRun: "12.345.678-5", cavFileData: "data:application/pdf;base64,AAAA", fotosEquipo: ["fa1", "fa2"] }) },
    { key: "inspeccion::INS001::def", value: JSON.stringify({ inscripcion: "WXYZ.99-1", marca: "Kia", modelo: "Rio", fecha: "2026-09-01", propietarioNombre: "OTRA PERSONA" }) },
    { key: "inspeccion::INS002::ghi", value: JSON.stringify({ inscripcion: "ABCD.12-3", marca: "Toyota", modelo: "Yaris", anio: "2018", fecha: "2026-08-01", inspectorNombre: "Otro Inspector" }) },
  );
  const r = await ve(U.t1.token, "tasaciones.inspecciones", { patente: "ab-cd12" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual(r.inspecciones.map((x) => x.key), ["inspeccion::INS001::abc", "inspeccion::INS002::ghi"], "las más recientes primero");
  const texto = JSON.stringify(r);
  for (const prohibido of ["JUAN", "PEREZ", "12.345.678-5", "OTRA PERSONA", "cavFileData", "base64"]) assert.ok(!texto.includes(prohibido), `no debe aparecer «${prohibido}»`);
  assert.equal(r.inspecciones[0].inspector, "Ivo Inspector");
  assert.deepEqual(r.inspecciones[0].fotos, ["fa1", "fa2"], "salen solo los ids de las fotos del inspector");
  assert.deepEqual(r.inspecciones[1].fotos, []);
  assert.equal((await ve(U.t1.token, "tasaciones.inspecciones", { patente: "QQQQ77" })).inspecciones.length, 0);
  assert.equal((await ve(U.t1.token, "tasaciones.inspecciones", { patente: "12" })).error, "patente_invalida");
  assert.equal((await ve(U.e1.token, "tasaciones.inspecciones", { patente: "ABCD12" })).status, 403);
  // Se puede vincular la inspección encontrada, pero solo con su clave y datos del vehículo.
  const l = await lead(U.e1.token);
  const t = (await pedir(U.e1.token, l.id, { ...VEH, patente: "ABCD12" })).tasacion;
  await ve(U.t1.token, "tasaciones.tomar", { id: t.id });
  await ve(U.t1.token, "tasaciones.guardar", { id: t.id, borrador: { inspeccion: { ...r.inspecciones[0], propietarioNombre: "JUAN" } } });
  assert.equal(fila(t.id).inspeccion.key, "inspeccion::INS001::abc");
  assert.equal(fila(t.id).inspeccion.propietarioNombre, undefined);
  // Al abrir la tasación, se ven las fotos que sacó el Inspector en esa inspección (solo ids; nada del propietario).
  const det = await ve(U.t1.token, "tasaciones.get", { id: t.id });
  assert.deepEqual(det.tasacion.inspeccion.fotos, ["fa1", "fa2"]);
  for (const prohibido of ["JUAN", "12.345.678-5", "cavFileData", "base64"]) assert.ok(!JSON.stringify(det).includes(prohibido), `no debe aparecer «${prohibido}»`);
  assert.deepEqual((await ve(U.e1.token, "tasaciones.get", { id: t.id })).tasacion.inspeccion.fotos, ["fa1", "fa2"], "quien la pidió también las ve");
  await ve(U.t1.token, "tasaciones.cancelar", { id: t.id, motivo: "Solo era una prueba" });
});

test("Fotos de la tasación: las sube quien tasa; las ven quienes piden o miran los leads", async () => {
  const id = U.t1a.id;
  const key = `tfoto::${id}::abcdef123456`;
  assert.equal((await kv(U.t1.token, "set", key, { value: "data:image/jpeg;base64,AAA" })).status, 200);
  assert.equal((await kv(U.e1.token, "get", key)).status, 200);
  assert.equal((await kv(U.jefe.token, "get", key)).status, 200);
  assert.equal((await kv(U.e1.token, "set", key, { value: "x" })).status, 403);
  assert.equal((await kv(U.e1.token, "delete", key)).status, 403);
  assert.equal((await kv(U.mkt.token, "get", key)).status, 200, "Marketing ve los leads, así que ve las fotos");
  assert.equal((await kv(U.insp.token, "get", key)).status, 403);
  assert.equal((await kv(U.insp.token, "set", key, { value: "x" })).status, 403);
  assert.equal((await kv(U.t1.token, "delete", key)).status, 200);
});

test("Resumen: cada Tasador ve su actividad; el supervisor, la de todos y la cola", async () => {
  const mio = await ve(U.t1.token, "tasaciones.resumen");
  assert.equal(mio.status, 200);
  assert.equal(mio.tasadores.length, 1);
  assert.equal(mio.tasadores[0].nombre, "Tito Tasador");
  assert.ok(mio.tasadores[0].hechas >= 2);
  assert.ok(mio.tasadores[0].valorCompraTotal >= 11000000);
  assert.ok(mio.tasadores[0].tiempoMedioHoras >= 0);
  const todos = await ve(U.jefe.token, "tasaciones.resumen");
  assert.deepEqual(todos.tasadores.map((x) => x.nombre).sort(), ["Tania Tasadora", "Tito Tasador"]);
  assert.equal(todos.horasLimite, 8);
  assert.equal((await ve(U.jefe.token, "tasaciones.resumen", { mes: "2026-13" })).error, "mes_invalido");
  assert.equal((await ve(U.jefeSur.token, "tasaciones.resumen")).tasadores.length, 0);
});

test("Alerta al supervisor: solicitudes que llevan demasiado sin tomarse", async () => {
  const l = await lead(U.e1.token);
  const t = (await pedir(U.e1.token, l.id, { ...VEH, patente: "TTTT11" })).tasacion;
  const sin = await ve(U.jefe.token, "gestion.resumen");
  assert.equal(sin.conteos.tasacionesSinTomar, 0, "recién pedida: aún en plazo");
  fila(t.id).solicitada_en = haceH(10);
  const r = await ve(U.jefe.token, "gestion.resumen");
  assert.equal(r.conteos.tasacionesSinTomar, 1);
  assert.equal(r.tasacionesSinTomar[0].id, t.id);
  assert.equal(r.tasacionesSinTomar[0].solicitante, "Eva Uno");
  assert.match(r.tasacionesSinTomar[0].vehiculo, /Toyota Yaris 2018 · TTTT11/);
  assert.equal((await ve(U.jefe.token, "tasaciones.resumen")).cola.atrasadas, 1);
  // El plazo se configura.
  await crm(admin, "config.set", { clave: "horas_tasacion", valor: 24 });
  assert.equal((await ve(U.jefe.token, "gestion.resumen")).conteos.tasacionesSinTomar, 0);
  await crm(admin, "config.set", { clave: "horas_tasacion", valor: 8 });
  // Al tomarla deja de ser una alerta.
  await ve(U.t2.token, "tasaciones.tomar", { id: t.id });
  assert.equal((await ve(U.jefe.token, "gestion.resumen")).conteos.tasacionesSinTomar, 0);
  await ve(U.t2.token, "tasaciones.cancelar", { id: t.id, motivo: "Fin de la prueba" });
});

test("Si faltan las tablas de la entrega 4, el resto del módulo sigue funcionando", async () => {
  const guardadas = { ...db.tablas };
  delete db.tablas.tasaciones;
  try {
    assert.equal((await ve(U.jefe.token, "inventario.list")).status, 200);
    const g = await ve(U.e1.token, "leads.get", { id: U.l1.id });
    assert.equal(g.status, 200);
    assert.deepEqual(g.tasaciones, []);
    assert.equal((await ve(U.jefe.token, "gestion.resumen")).status, 200);
    assert.equal((await pedir(U.e1.token, (await lead(U.e1.token)).id)).error, "crm_not_installed");
    assert.equal((await ve(U.t1.token, "tasaciones.list", { vista: "cola" })).error, "crm_not_installed");
  } finally { Object.assign(db.tablas, guardadas); }
});

test("Corregir una tasación ya realizada: solo el Jefe Local y el administrador; se validan las mismas reglas y se avisa al ejecutivo", async () => {
  const l = await lead(U.e1.token);
  const t = (await pedir(U.e1.token, l.id, { ...VEH, patente: "KLMN34" })).tasacion;
  const corregir = (token, borrador, id = t.id) => ve(token, "tasaciones.corregir", { id, borrador });
  // No se corrige una tasación que aún no está completada.
  await ve(U.t1.token, "tasaciones.tomar", { id: t.id });
  assert.equal((await corregir(U.jefe.token, { valorCompra: 1 })).error, "tasacion_estado_invalido");
  const ok = await ve(U.t1.token, "tasaciones.completar", { id: t.id, borrador: { valorRetoma: 5000000, valorVenta: 6000000 } });
  assert.equal(ok.status, 200, JSON.stringify(ok));
  // El Tasador y el ejecutivo no la corrigen; el Jefe Local y el administrador sí.
  assert.equal((await corregir(U.t1.token, { valorRetoma: 5100000, valorVenta: 6000000 })).status, 403);
  assert.equal((await corregir(U.e1.token, { valorRetoma: 5100000, valorVenta: 6000000 })).status, 403);
  assert.equal((await ve(U.t1.token, "tasaciones.get", { id: t.id })).puedeCorregir, false);
  assert.equal((await ve(U.jefe.token, "tasaciones.get", { id: t.id })).puedeCorregir, true);
  // Mismas reglas que al completar: la venta no puede quedar bajo la retoma.
  assert.equal((await corregir(U.jefe.token, { valorRetoma: 7000000, valorVenta: 6000000 })).error, "valor_venta_menor");
  const r = await corregir(U.jefe.token, { valorRetoma: 5200000, valorVenta: 6100000, observaciones: "Corregido por el Jefe Local" });
  assert.equal(r.status, 200, JSON.stringify(r));
  const fila0 = fila(t.id);
  assert.deepEqual([fila0.estado, fila0.valor_retoma, fila0.valor_compra, fila0.valor_venta], ["completada", 5200000, 5200000, 6100000]);
  assert.equal(fila0.observaciones, "Corregido por el Jefe Local");
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "tasacion.corregir" && b.entidad_id === t.id));
  assert.equal((await corregir(admin, { valorRetoma: 5300000, valorVenta: 6100000 })).status, 200, "el administrador también");
});
