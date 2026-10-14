// Cotizaciones (con aprobación de descuentos) y reservas, contra la función real y una base falsa en memoria.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const VEH = { patente: "ABCD12", marca: "Toyota", modelo: "Yaris", anio: 2020, km: 45000, precioLista: 9500000, costo: 8000000 };
const VEH2 = { patente: "WXYZ99", marca: "Kia", modelo: "Rio", anio: 2019, km: 78000, precioLista: 7200000, costo: 6100000 };
const U = {};
let admin; let L1; let L2;

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  assert.equal(l.status, 200);
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}
async function lead(token, nombre, telefono, asignarA) {
  const r = await ve(token, "leads.create", { cliente: { nombre, telefono }, lead: {}, asignarA });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.lead;
}
const cotizar = (token, leadId, vehiculoId, datos = {}) => ve(token, "cotizaciones.save", { leadId, vehiculoId, datos });
const dias = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

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
  U.v1 = (await ve(U.jefe.token, "inventario.save", { datos: VEH })).vehiculo;
  U.v2 = (await ve(U.jefe.token, "inventario.save", { datos: VEH2 })).vehiculo;
  U.lead1 = await lead(U.e1.token, "Cecilia Mora", "+56 9 8765 4321");
  U.lead2 = await lead(U.e2.token, "Daniel Rojas", "912345678");
});

test("Cotizar sin descuento: queda vigente, con folio, y el lead pasa a 'Cotizado'", async () => {
  const r = await cotizar(U.e1.token, U.lead1.id, U.v1.id, { descuento: 0 });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.cotizacion.estado, "vigente");
  assert.ok(r.cotizacion.numero > 0);
  assert.equal(r.cotizacion.precio_lista, 9500000);
  assert.equal(r.cotizacion.precio_final, 9500000);
  assert.equal(r.cotizacion.vehiculo_snapshot.patente, "ABCD12");
  assert.equal(r.cotizacion.vehiculo_snapshot.costo, undefined, "el costo no va en la cotización");
  assert.ok(r.cotizacion.vigencia_hasta > new Date().toISOString());
  U.cotSin = r.cotizacion;
  const g = await ve(U.e1.token, "leads.get", { id: U.lead1.id });
  assert.equal(g.lead.etapa, "cotizado");
  assert.equal(g.cotizaciones.length, 1);
  assert.ok(g.eventos.some((e) => e.tipo === "cotizacion"));
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "cotizacion.crear" && b.detalle.numero === r.cotizacion.numero));
});

test("El precio de lista lo fija el servidor: lo que mande la pantalla se ignora", async () => {
  const r = await ve(U.e2.token, "cotizaciones.save", { leadId: U.lead2.id, vehiculoId: U.v2.id, datos: { descuento: 0, precio_lista: 1, precioLista: 1, precio_final: 1 } });
  assert.equal(r.cotizacion.precio_lista, 7200000);
  assert.equal(r.cotizacion.precio_final, 7200000);
  await ve(U.e2.token, "cotizaciones.anular", { id: r.cotizacion.id });
});

test("Validaciones: descuento mayor al precio, pagos que superan el precio, vehículo ajeno", async () => {
  assert.equal((await cotizar(U.e1.token, U.lead1.id, U.v1.id, { descuento: 9600000 })).error, "descuento_invalido");
  assert.equal((await cotizar(U.e1.token, U.lead1.id, U.v1.id, { descuento: -5 })).error, "descuento_invalido");
  assert.equal((await cotizar(U.e1.token, U.lead1.id, U.v1.id, { parteDePago: { tiene: true, valor: 9000000 }, financiamiento: { quiere: true, pie: 2000000, plazoMeses: 24 } })).error, "pago_excede_precio");
  assert.equal((await cotizar(U.e1.token, U.lead1.id, randomUUID())).error, "vehiculo_invalido");
  const sur = (await ve(U.jefeSur.token, "inventario.save", { datos: { ...VEH, patente: "SSSS11" } })).vehiculo;
  assert.equal((await cotizar(U.e1.token, U.lead1.id, sur.id)).error, "vehiculo_invalido", "no se cotiza un vehículo de otro local");
});

test("Un descuento deja la cotización esperando aprobación; sin aprobar no se puede reservar", async () => {
  const r = await cotizar(U.e1.token, U.lead1.id, U.v1.id, { descuento: 300000, parteDePago: { tiene: true, patente: "AB1234", marca: "Kia", modelo: "Rio", anio: 2015, km: 90000, valor: 3000000 }, financiamiento: { quiere: true, pie: 2000000, banco: "Banco X", plazoMeses: 36, tasaMensualPct: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.cotizacion.estado, "pendiente");
  assert.equal(r.cotizacion.precio_final, 9200000);
  assert.equal(r.cotizacion.solicitado_por, "Eva Uno");
  assert.equal(r.cotizacion.financiamiento.plazo_meses, 36);
  U.cotDesc = r.cotizacion;
  assert.equal((await ve(U.e1.token, "reservas.crear", { cotizacionId: U.cotDesc.id, monto: 500000 })).error, "cotizacion_pendiente");
});

test("Bandeja de aprobaciones: solo el supervisor de ese local, con el margen que quedaría", async () => {
  assert.equal((await ve(U.e1.token, "cotizaciones.pendientes")).status, 403);
  assert.equal((await ve(U.mkt.token, "cotizaciones.pendientes")).status, 403);
  const sur = await ve(U.jefeSur.token, "cotizaciones.pendientes");
  assert.equal(sur.pendientes.length, 0, "otro local no ve estas solicitudes");

  const jefe = await ve(U.jefe.token, "cotizaciones.pendientes");
  assert.equal(jefe.pendientes.length, 1);
  const p = jefe.pendientes[0];
  assert.equal(p.cliente, "Cecilia Mora");
  assert.equal(p.ejecutivo, "Eva Uno");
  assert.equal(p.descuento, 300000);
  assert.equal(p.margen_lista, 1500000);
  assert.equal(p.margen_final, 1200000);

  const marcas = (await ve(U.e1.token, "leads.list")).marcas;
  assert.equal(marcas[U.lead1.id].pendiente, true, "la tarjeta del embudo muestra que espera aprobación");
});

test("Aprobar: solo el supervisor; queda registrado quién y cuándo", async () => {
  assert.equal((await ve(U.e1.token, "cotizaciones.aprobar", { id: U.cotDesc.id })).status, 403, "el ejecutivo no se aprueba a sí mismo");
  assert.equal((await ve(U.e2.token, "cotizaciones.aprobar", { id: U.cotDesc.id })).status, 403);
  assert.equal((await ve(U.jefeSur.token, "cotizaciones.aprobar", { id: U.cotDesc.id })).status, 404, "otro local no la ve");
  const ok = await ve(U.jefe.token, "cotizaciones.aprobar", { id: U.cotDesc.id });
  assert.equal(ok.cotizacion.estado, "vigente");
  assert.equal(ok.cotizacion.aprobado_por, "Julia Jefa");
  assert.ok(ok.cotizacion.aprobado_en);
  assert.equal((await ve(U.jefe.token, "cotizaciones.aprobar", { id: U.cotDesc.id })).error, "sin_cambio", "no se aprueba dos veces");
  const f = db.tablas.bitacora.find((b) => b.accion === "cotizacion.aprobar");
  assert.equal(f.actor_nombre, "Julia Jefa");
  assert.equal(f.detalle.solicitado_por, "Eva Uno");
  assert.equal(f.detalle.descuento, 300000);
  assert.ok((await ve(U.e1.token, "leads.get", { id: U.lead1.id })).eventos.some((e) => /aprobado/.test(e.detalle)));
});

test("Editar una cotización aprobada: cambiar la parte de pago no reabre; cambiar el descuento sí", async () => {
  const edit = (datos) => ve(U.e1.token, "cotizaciones.save", { leadId: U.lead1.id, id: U.cotDesc.id, datos });
  const base = { descuento: 300000, financiamiento: { quiere: true, pie: 2000000, banco: "Banco X", plazoMeses: 36, tasaMensualPct: 1 } };
  const sinCambioDescuento = await edit({ ...base, parteDePago: { tiene: true, valor: 3500000 } });
  assert.equal(sinCambioDescuento.cotizacion.estado, "vigente");
  assert.equal(sinCambioDescuento.cotizacion.aprobado_por, "Julia Jefa", "conserva la aprobación");
  const masDescuento = await edit({ ...base, descuento: 500000 });
  assert.equal(masDescuento.cotizacion.estado, "pendiente");
  assert.equal(masDescuento.cotizacion.aprobado_por, null);
  const sinDescuento = await edit({ ...base, descuento: 0 });
  assert.equal(sinDescuento.cotizacion.estado, "vigente", "sin descuento no hay qué aprobar");
});

test("Rechazar exige un motivo; una rechazada no se reserva y al editarla vuelve a aprobación", async () => {
  await ve(U.e1.token, "cotizaciones.save", { leadId: U.lead1.id, id: U.cotDesc.id, datos: { descuento: 400000 } });
  assert.equal((await ve(U.jefe.token, "cotizaciones.rechazar", { id: U.cotDesc.id, motivo: "" })).error, "motivo_requerido");
  const r = await ve(U.jefe.token, "cotizaciones.rechazar", { id: U.cotDesc.id, motivo: "Es demasiado" });
  assert.equal(r.cotizacion.estado, "rechazada");
  assert.equal(r.cotizacion.motivo_rechazo, "Es demasiado");
  assert.equal((await ve(U.e1.token, "reservas.crear", { cotizacionId: U.cotDesc.id, monto: 500000 })).error, "cotizacion_no_vigente");
  const ed = await ve(U.e1.token, "cotizaciones.save", { leadId: U.lead1.id, id: U.cotDesc.id, datos: { descuento: 200000 } });
  assert.equal(ed.cotizacion.estado, "pendiente", "un descuento nuevo se vuelve a pedir");
  assert.equal(ed.cotizacion.motivo_rechazo, null);
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "cotizacion.rechazar" && b.detalle.motivo === "Es demasiado"));
  await ve(U.jefe.token, "cotizaciones.aprobar", { id: U.cotDesc.id });
});

test("Un supervisor que cotiza con descuento queda aprobado, pero registrado a su nombre", async () => {
  const l = await lead(U.jefe.token, "Fabiola Paz", "911111111", U.e2.id);
  const r = await cotizar(U.jefe.token, l.id, U.v2.id, { descuento: 100000 });
  assert.equal(r.cotizacion.estado, "vigente");
  assert.equal(r.cotizacion.aprobado_por, "Julia Jefa");
  U.leadJefe = l; U.cotJefe = r.cotizacion;
});

test("Permisos: solo quien puede modificar el lead cotiza; los demás ni lo ven", async () => {
  assert.equal((await cotizar(U.e2.token, U.lead1.id, U.v1.id)).status, 404, "Ema no ve el lead de Eva");
  assert.equal((await cotizar(U.mkt.token, U.lead1.id, U.v1.id)).status, 403, "Marketing solo mira");
  assert.equal((await cotizar(U.jefeSur.token, U.lead1.id, U.v1.id)).status, 404, "otro local");
  assert.equal((await ve(U.e2.token, "cotizaciones.list", { leadId: U.lead1.id })).status, 404);
  assert.equal((await ve(U.mkt.token, "cotizaciones.list", { leadId: U.lead1.id })).status, 200, "Marketing sí puede ver");
  assert.equal((await ve(U.e2.token, "cotizaciones.anular", { id: U.cotDesc.id })).status, 404);
  // Eli no está habilitada para ventas: ni crea leads ni cotiza.
  assert.equal((await ve(U.e3.token, "leads.create", { cliente: { nombre: "Gala Pino", telefono: "955555555" }, lead: {} })).status, 403);
});

test("Reservar: el vehículo, la cotización y el lead cambian juntos", async () => {
  const sinMonto = await ve(U.e1.token, "reservas.crear", { cotizacionId: U.cotDesc.id, monto: 0 });
  assert.equal(sinMonto.error, "monto_invalido");
  assert.equal((await ve(U.e1.token, "reservas.crear", { cotizacionId: U.cotDesc.id, monto: 99999999 })).error, "monto_invalido");
  assert.equal((await ve(U.e1.token, "reservas.crear", { cotizacionId: U.cotDesc.id, monto: 500000, medioPago: "Trueque" })).error, "medio_invalido");

  const r = await ve(U.e1.token, "reservas.crear", { cotizacionId: U.cotDesc.id, monto: 500000, medioPago: "Transferencia", notas: "Depositó hoy" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.reserva.estado, "activa");
  assert.equal(r.reserva.monto, 500000);
  const dias = (Date.parse(r.reserva.vence_en) - Date.now()) / 86_400_000;
  assert.ok(dias > 2.9 && dias <= 3.01, `usa los 3 días de la configuración (${dias})`);
  U.reserva = r.reserva;

  const inv = (await ve(U.e1.token, "inventario.list")).vehiculos.find((v) => v.id === U.v1.id);
  assert.equal(inv.estado, "reservado");
  assert.equal(inv.reserva_vence_en, r.reserva.vence_en);
  const g = await ve(U.e1.token, "leads.get", { id: U.lead1.id });
  assert.equal(g.lead.etapa, "reservado");
  assert.equal(g.cotizaciones.find((c) => c.id === U.cotDesc.id).estado, "reservada");
  assert.equal(g.reservas.length, 1);
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "reserva.crear" && b.detalle.patente === "ABCD12" && b.detalle.monto === 500000));
});

test("Con una reserva activa: nadie más reserva ni cotiza ese vehículo; el estado no se toca a mano", async () => {
  assert.equal((await ve(U.e1.token, "reservas.crear", { cotizacionId: U.cotDesc.id, monto: 500000 })).error, "ya_reservada");
  const otraCot = await ve(U.e2.token, "cotizaciones.save", { leadId: U.lead2.id, vehiculoId: U.v1.id, datos: {} });
  assert.equal(otraCot.error, "vehiculo_no_disponible", "otro ejecutivo no puede cotizar un vehículo reservado");
  assert.equal((await ve(U.jefe.token, "inventario.setEstado", { id: U.v1.id, estado: "disponible" })).error, "vehiculo_reservado");
  assert.equal((await ve(U.jefe.token, "inventario.archivar", { id: U.v1.id })).error, "vehiculo_reservado");
  assert.equal((await ve(U.jefe.token, "inventario.setEstado", { id: U.v2.id, estado: "reservado" })).error, "estado_automatico", "'reservado' solo lo pone el sistema");
  const ed = await ve(U.jefe.token, "inventario.save", { id: U.v1.id, datos: { ...VEH, estado: "disponible" } });
  assert.equal(ed.vehiculo.estado, "reservado", "editar la ficha no libera el vehículo");
  assert.equal((await ve(U.jefe.token, "inventario.save", { datos: { ...VEH2, patente: "NEWW11", estado: "reservado" } })).error, "estado_automatico");
});

test("El lead con reserva activa no se mueve de etapa a mano; las etapas automáticas no se eligen", async () => {
  assert.equal((await ve(U.e1.token, "leads.mover", { id: U.lead1.id, etapa: "seguimiento" })).error, "reserva_activa");
  assert.equal((await ve(U.e2.token, "leads.mover", { id: U.lead2.id, etapa: "cotizado" })).error, "etapa_automatica");
  assert.equal((await ve(U.e2.token, "leads.mover", { id: U.lead2.id, etapa: "reservado" })).error, "etapa_automatica");
  assert.equal((await ve(U.e2.token, "leads.mover", { id: U.lead2.id, etapa: "ganado" })).error, "etapa_no_disponible");
});

test("Extender: suma días a la reserva, con tope; las cerradas no se extienden", async () => {
  assert.equal((await ve(U.e1.token, "reservas.extender", { id: U.reserva.id, dias: 0 })).error, "dias_invalidos");
  assert.equal((await ve(U.e1.token, "reservas.extender", { id: U.reserva.id, dias: 30 })).error, "dias_invalidos");
  assert.equal((await ve(U.e2.token, "reservas.extender", { id: U.reserva.id, dias: 2 })).status, 404, "otra persona no la ve");
  const antes = Date.parse(U.reserva.vence_en);
  const r = await ve(U.e1.token, "reservas.extender", { id: U.reserva.id, dias: 2 });
  assert.ok(Math.abs(Date.parse(r.reserva.vence_en) - (antes + 2 * 86_400_000)) < 1000);
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "reserva.extender"));
});

test("Ver reservas: cada ejecutivo las suyas; el supervisor, las del local", async () => {
  const mias = await ve(U.e1.token, "reservas.list");
  assert.equal(mias.reservas.length, 1);
  assert.match(mias.reservas[0].vehiculo, /Yaris/);
  assert.equal(mias.reservas[0].cliente, "Cecilia Mora");
  assert.equal((await ve(U.e2.token, "reservas.list")).reservas.length, 0);
  assert.equal((await ve(U.jefe.token, "reservas.list")).reservas.length, 1);
  assert.equal((await ve(U.jefeSur.token, "reservas.list")).reservas.length, 0);
  assert.equal((await ve(U.e2.token, "reservas.list", { leadId: U.lead1.id })).status, 404);
});

test("Cancelar la reserva: el vehículo y la cotización vuelven a estar disponibles y el lead a 'Cotizado'", async () => {
  assert.equal((await ve(U.e2.token, "reservas.cancelar", { id: U.reserva.id })).status, 404);
  assert.equal((await ve(U.mkt.token, "reservas.cancelar", { id: U.reserva.id })).status, 403);
  const r = await ve(U.e1.token, "reservas.cancelar", { id: U.reserva.id, motivo: "El cliente desistió" });
  assert.equal(r.ok, true);
  assert.equal(db.tablas.reservas.find((x) => x.id === U.reserva.id).estado, "cancelada");
  assert.equal(db.tablas.reservas.find((x) => x.id === U.reserva.id).motivo, "El cliente desistió");
  assert.equal((await ve(U.jefe.token, "inventario.list")).vehiculos.find((v) => v.id === U.v1.id).estado, "disponible");
  const g = await ve(U.e1.token, "leads.get", { id: U.lead1.id });
  assert.equal(g.lead.etapa, "cotizado");
  assert.equal(g.cotizaciones.find((c) => c.id === U.cotDesc.id).estado, "vigente");
  assert.equal((await ve(U.e1.token, "reservas.cancelar", { id: U.reserva.id })).error, "reserva_cerrada");
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "reserva.cancelar"));
});

test("Reserva vencida: se libera sola cuando alguien abre el sistema", async () => {
  const r = await ve(U.e1.token, "reservas.crear", { cotizacionId: U.cotDesc.id, monto: 400000, dias: 1 });
  assert.equal(r.status, 200, JSON.stringify(r));
  // Se simula que pasó el plazo.
  db.tablas.reservas.find((x) => x.id === r.reserva.id).vence_en = new Date(Date.now() - 3600_000).toISOString();

  const inv = await ve(U.jefe.token, "inventario.list");
  assert.equal(inv.vehiculos.find((v) => v.id === U.v1.id).estado, "disponible", "el vehículo volvió a estar disponible");
  assert.equal(db.tablas.reservas.find((x) => x.id === r.reserva.id).estado, "vencida");
  const g = await ve(U.e1.token, "leads.get", { id: U.lead1.id });
  assert.equal(g.lead.etapa, "cotizado");
  assert.equal(g.cotizaciones.find((c) => c.id === U.cotDesc.id).estado, "vigente");
  assert.ok(g.eventos.some((e) => e.tipo === "reserva" && /venció/.test(e.detalle) && e.usuario_nombre === "Sistema"));
  const f = db.tablas.bitacora.find((b) => b.accion === "reserva.vencer");
  assert.equal(f.actor_tipo, "sistema");
});

test("Una reserva no vencida no se toca al abrir el sistema", async () => {
  const r = await ve(U.e1.token, "reservas.crear", { cotizacionId: U.cotDesc.id, monto: 400000 });
  assert.equal(r.status, 200);
  await ve(U.jefe.token, "inventario.list");
  assert.equal(db.tablas.reservas.find((x) => x.id === r.reserva.id).estado, "activa");
  U.reserva2 = r.reserva;
});

test("Perder un lead con reserva cancela la reserva y libera el vehículo", async () => {
  assert.equal((await ve(U.e1.token, "leads.mover", { id: U.lead1.id, etapa: "perdido" })).error, "motivo_requerido");
  const r = await ve(U.e1.token, "leads.mover", { id: U.lead1.id, etapa: "perdido", motivo: "Precio" });
  assert.equal(r.lead.etapa, "perdido");
  assert.equal(db.tablas.reservas.find((x) => x.id === U.reserva2.id).estado, "cancelada");
  assert.equal((await ve(U.jefe.token, "inventario.list")).vehiculos.find((v) => v.id === U.v1.id).estado, "disponible");
  assert.equal(db.tablas.cotizaciones.find((c) => c.id === U.cotDesc.id).estado, "vigente");
  assert.equal(db.tablas.leads.find((l) => l.id === U.lead1.id).etapa, "perdido", "no vuelve a 'Cotizado'");
  assert.equal((await cotizar(U.e1.token, U.lead1.id, U.v1.id)).error, "lead_cerrado");
  assert.equal((await ve(U.e1.token, "reservas.crear", { cotizacionId: U.cotDesc.id, monto: 1000 })).error, "lead_cerrado");
});

test("Anular una cotización: se puede salvo que tenga una reserva", async () => {
  const l = await lead(U.e1.token, "Hilda Vega", "944444444");
  const cot = (await cotizar(U.e1.token, l.id, U.v1.id)).cotizacion;
  const res = await ve(U.e1.token, "reservas.crear", { cotizacionId: cot.id, monto: 300000 });
  assert.equal(res.status, 200);
  assert.equal((await ve(U.e1.token, "cotizaciones.anular", { id: cot.id })).error, "tiene_reserva");
  assert.equal((await cotizar(U.e1.token, l.id, U.v1.id, { id: cot.id })).error, "vehiculo_no_disponible");
  await ve(U.e1.token, "reservas.cancelar", { id: res.reserva.id });
  const ok = await ve(U.e1.token, "cotizaciones.anular", { id: cot.id });
  assert.equal(ok.cotizacion.estado, "anulada");
  assert.equal((await ve(U.e1.token, "cotizaciones.anular", { id: cot.id })).error, "cotizacion_cerrada");
  assert.equal((await ve(U.e1.token, "reservas.crear", { cotizacionId: cot.id, monto: 1000 })).error, "cotizacion_no_vigente");
});

test("Una cotización vencida no se puede reservar", async () => {
  const l = await lead(U.e2.token, "Ivo Pérez", "955555555");
  const cot = (await cotizar(U.e2.token, l.id, U.v1.id)).cotizacion;
  db.tablas.cotizaciones.find((c) => c.id === cot.id).vigencia_hasta = new Date(Date.now() - 1000).toISOString();
  assert.equal((await ve(U.e2.token, "reservas.crear", { cotizacionId: cot.id, monto: 1000 })).error, "cotizacion_vencida");
});

test("Configuración: días de reserva y vigencia salen de ahí; valores inválidos se rechazan", async () => {
  assert.equal((await crm(admin, "config.set", { clave: "dias_reserva", valor: 0 })).status, 400);
  assert.equal((await crm(admin, "config.set", { clave: "dias_reserva", valor: 31 })).status, 400);
  assert.equal((await crm(admin, "config.set", { clave: "vigencia_cotizacion_dias", valor: 100 })).status, 400);
  assert.equal((await crm(admin, "config.set", { clave: "condiciones_cotizacion", valor: "x".repeat(801) })).status, 400);
  assert.equal((await crm(admin, "config.set", { clave: "dias_reserva", valor: 5 })).status, 200);
  assert.equal((await crm(admin, "config.set", { clave: "vigencia_cotizacion_dias", valor: 10 })).status, 200);
  assert.equal((await crm(admin, "config.set", { clave: "condiciones_cotizacion", valor: "Condiciones de prueba" })).status, 200);

  const cat = await ve(U.e1.token, "catalogos");
  assert.equal(cat.dias_reserva, 5);
  assert.equal(cat.vigencia_cotizacion_dias, 10);
  assert.equal(cat.condiciones_cotizacion, "Condiciones de prueba");

  const l = await lead(U.e2.token, "Julio Ríos", "966666666");
  const cot = (await cotizar(U.e2.token, l.id, U.v1.id)).cotizacion;
  const vig = (Date.parse(cot.vigencia_hasta) - Date.now()) / 86_400_000;
  assert.ok(vig > 9.9 && vig <= 10.01, `vigencia ${vig}`);
  const r = await ve(U.e2.token, "reservas.crear", { cotizacionId: cot.id, monto: 1000 });
  const d = (Date.parse(r.reserva.vence_en) - Date.now()) / 86_400_000;
  assert.ok(d > 4.9 && d <= 5.01, `reserva ${d}`);
  await ve(U.e2.token, "reservas.cancelar", { id: r.reserva.id });
});

test("Las cotizaciones nunca muestran el costo del vehículo", async () => {
  const todo = JSON.stringify([
    await ve(U.e2.token, "leads.get", { id: U.lead2.id }), await ve(U.e2.token, "cotizaciones.list", { leadId: U.lead2.id }),
    await ve(U.e2.token, "inventario.list"), await ve(U.e2.token, "reservas.list"),
  ]);
  assert.equal(todo.includes("8000000"), false);
  assert.equal(todo.includes("6100000"), false);
});

test("Si faltan las tablas de la entrega 2B, el resto del módulo sigue funcionando", async () => {
  const guardadas = { ...db.tablas };
  delete db.tablas.cotizaciones; delete db.tablas.reservas;
  try {
    assert.equal((await ve(U.jefe.token, "inventario.list")).status, 200);
    assert.equal((await ve(U.e2.token, "leads.list")).status, 200);
    const g = await ve(U.e2.token, "leads.get", { id: U.lead2.id });
    assert.equal(g.status, 200);
    assert.deepEqual([g.cotizaciones, g.reservas], [[], []]);
    assert.equal((await cotizar(U.e2.token, U.lead2.id, U.v2.id)).error, "crm_not_installed");
  } finally { Object.assign(db.tablas, guardadas); }
});
