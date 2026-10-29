// Compras y consignaciones: del lead a la oferta, el pago aprobado y el vehículo en el inventario; contrato de consignación con precio piso
// y comisión por el margen; contra la función real y una base falsa en memoria.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db, correos } from "./helpers/api-env.mjs";
import { mesChile } from "../supabase/functions/api/ventas-core.js";
import { reglaDocCompra } from "../supabase/functions/api/validaciones-core.js";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1; let L2;
let n = 0;
const MES = mesChile();
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const patente = () => `CC${String(1000 + ++n)}`;
const ofrecido = (extra = {}) => ({ patente: patente(), marca: "Toyota", modelo: "Yaris", anio: 2018, km: 78000, ...extra });
const fila = (t, id) => db.tablas[t].find((x) => x.id === id);

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}
async function leadDe(token, tipo, vehiculoOfrecido = ofrecido()) {
  const r = await ve(token, "leads.create", { cliente: { nombre: `Cliente ${++n}`, telefono: `9${String(60000000 + n)}` }, lead: { tipo, fuente: "Llamada", vehiculoOfrecido } });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.lead;
}
/** Pide la tasación, la toma y la completa el Tasador; devuelve la tasación. */
async function tasar(lead, { compra = 6500000, venta = 8500000 } = {}) {
  const p = await ve(U.c1.token, "compras.pedirTasacion", { leadId: lead.id });
  assert.equal(p.status, 200, JSON.stringify(p));
  assert.equal((await ve(U.t1.token, "tasaciones.tomar", { id: p.tasacion.id })).status, 200);
  const r = await ve(U.t1.token, "tasaciones.completar", { id: p.tasacion.id, borrador: { aplicaPara: "compra", valorCompra: compra, valorVenta: venta } });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.tasacion;
}
const ofertar = (token, leadId, tasacionId, monto, notas) => ve(token, "compras.ofertar", { leadId, tasacionId, datos: { monto, notas } });
const PAGO = (extra = {}) => ({ montoFinal: 5800000, medioPago: "Transferencia", fechaPago: hoy(), ...extra });
const dvRut = (n) => { let suma = 0; let m = 2; for (const d of String(n).split("").reverse()) { suma += Number(d) * m; m = m === 7 ? 2 : m + 1; } const r = 11 - (suma % 11); return r === 11 ? "0" : r === 10 ? "K" : String(r); };
let rutN = 20000000; let archN = 0;
const rutNuevo = () => { const n = ++rutN; return `${n}-${dvRut(n)}`; };
const DATOS_VENDEDOR = (extra = {}) => ({ nombre: "Vendedor Prueba", rut: rutNuevo(), telefono: "912345678", email: "vendedor@x.cl", direccion: "Calle Falsa 123", comuna: "Santiago", banco: "BancoEstado", tipoCuenta: "Cuenta vista", numeroCuenta: "12345678", ...extra });
const CUENTA = (extra = {}) => ({ banco: "Banco de Chile", tipoCuenta: "Cuenta corriente", numeroCuenta: "00123456789", ...extra });
/** El ejecutivo completa los datos del vendedor y sube los 11 documentos (con vencimiento y precio del permiso). */
async function cumplirRequisitos(compraId, token = U.c1.token) {
  const rq = await ve(token, "compras.requisitos", { id: compraId });
  assert.equal(rq.status, 200, JSON.stringify(rq));
  const dc = await ve(token, "compras.datosCliente", { id: compraId, datos: DATOS_VENDEDOR() });
  assert.equal(dc.status, 200, JSON.stringify(dc));
  for (const d of rq.docs) {
    if (d.nArchivos === 0) {
      const ad = await ve(token, "validacion.adjuntar", { id: rq.validacionId, docId: d.id, archivo: { id: `rq${++archN}abcd`, nombre: "doc.pdf", tipo: "application/pdf", tam: 1000 } });
      assert.equal(ad.status, 200, d.clave + " " + JSON.stringify(ad));
    }
    const regla = reglaDocCompra(d.clave);
    if (regla.vence || regla.precio) {
      const dd = await ve(token, "validacion.datosDoc", { id: rq.validacionId, docId: d.id, venceEn: "2027-06-30", precio: 95000 });
      assert.equal(dd.status, 200, d.clave + " " + JSON.stringify(dd));
    }
  }
}
/** Compra completa hasta «pago por aprobar». */
async function comprarHastaPago(monto = 6000000) {
  const lead = await leadDe(U.c1.token, "compra");
  const tas = await tasar(lead);
  const o = await ofertar(U.c1.token, lead.id, tas.id, monto);
  assert.equal(o.status, 200, JSON.stringify(o));
  assert.equal((await ve(U.c1.token, "compras.responder", { id: o.compra.id, acepta: true })).status, 200);
  await cumplirRequisitos(o.compra.id);
  const p = await ve(U.c1.token, "compras.solicitarPago", { id: o.compra.id, datos: PAGO() });
  assert.equal(p.status, 200, JSON.stringify(p));
  return { lead, tas, compra: p.compra };
}
async function vehiculoVendible(token = U.jefe.token, extra = {}) {
  const r = await ve(token, "inventario.save", { datos: { patente: patente(), marca: "Kia", modelo: "Rio", anio: 2020, km: 30000, precioLista: 9000000, costo: 7000000, ...extra } });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.vehiculo;
}

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  L2 = (await crm(admin, "locales.create", { nombre: "Sucursal Sur" })).local.id;
  const todo = { otorgar: ["compras.operar", "consignaciones.operar"], quitar: ["ventas.operar"] }; // solo compras y consignaciones (sin Ventas)
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("jefeSur", "Jorge Sur", "8.765.432-K", ["jefe_local"], L2);
  await crear("c1", "Carla Compras", "6.000.000-K", ["ejecutivo"], L1, todo);
  await crear("c2", "Camilo Compras", "7.654.321-6", ["ejecutivo"], L1, { otorgar: ["compras.operar"], quitar: ["ventas.operar"] });
  await crear("e1", "Eva Ventas", "9.876.543-3", ["ejecutivo"], L1, { otorgar: ["ventas.operar"], quitar: [] });
  await crear("t1", "Tito Tasador", "5.555.555-9", ["tasador"], L1);
  await crear("mkt", "Marta Marketing", "10.000.013-K", ["marketing"], L1);
});

test("Habilitaciones: cada tipo de lead exige su permiso", async () => {
  const ofr = ofrecido();
  assert.equal((await ve(U.e1.token, "leads.create", { cliente: { nombre: "Cliente X", telefono: "955555551" }, lead: { tipo: "compra", vehiculoOfrecido: ofr } })).status, 403, "con solo ventas no se crean leads de compra");
  assert.equal((await ve(U.c2.token, "leads.create", { cliente: { nombre: "Cliente Y", telefono: "955555552" }, lead: { tipo: "consignacion", vehiculoOfrecido: ofr } })).status, 403, "c2 solo compra");
  assert.equal((await ve(U.c1.token, "leads.create", { cliente: { nombre: "Cliente Z", telefono: "955555553" }, lead: { fuente: "Llamada" } })).status, 403, "c1 no vende");
  assert.equal((await ve(U.c1.token, "leads.create", { cliente: { nombre: "Cliente W", telefono: "955555554" }, lead: { tipo: "compra", vehiculoOfrecido: { ...ofr, patente: "12" } } })).error, "patente_invalida");
  assert.equal((await ve(U.c1.token, "leads.create", { cliente: { nombre: "Cliente V", telefono: "955555555" }, lead: { tipo: "compra" } })).error, "patente_invalida", "el vehículo ofrecido es obligatorio");
  const l = await leadDe(U.c1.token, "compra");
  assert.equal(l.tipo, "compra");
  assert.equal(l.asignado_a, U.c1.id);
  assert.equal(l.vehiculo_ofrecido.marca, "Toyota");
  assert.equal(l.vehiculo_id ?? null, null);
  // Ni Eva ni Camilo tocan el lead de Carla.
  assert.equal((await ve(U.e1.token, "compras.pedirTasacion", { leadId: l.id })).status, 403, "Eva no tiene compras");
  assert.equal((await ve(U.c2.token, "compras.pedirTasacion", { leadId: l.id })).status, 404);
  assert.equal((await ve(U.e1.token, "compras.list", { vista: "mias" })).status, 403);
  assert.equal((await ve(U.mkt.token, "compras.list", { vista: "local" })).status, 403);
  U.lead1 = l;
});

test("Reparto automático: un lead de compra va a quien tiene compras, no a quien solo vende", async () => {
  const r = await ve(U.jefe.token, "leads.create", { cliente: { nombre: "Cliente Auto", telefono: "955555560" }, lead: { tipo: "compra", vehiculoOfrecido: ofrecido() }, asignarA: "auto" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.ok([U.c1.id, U.c2.id].includes(r.lead.asignado_a), "solo c1 y c2 pueden recibirlo");
  assert.equal((await ve(U.jefe.token, "leads.create", { cliente: { nombre: "Cliente Mal", telefono: "955555561" }, lead: { tipo: "compra", vehiculoOfrecido: ofrecido() }, asignarA: U.e1.id })).error, "asignado_invalido");
  assert.equal((await ve(U.jefe.token, "leads.reasignar", { id: U.lead1.id, asignarA: U.e1.id })).error, "asignado_invalido", "reasignar tampoco a quien no está habilitado");
});

test("Tasación para la compra: queda en la cola del Tasador y NO toca la parte de pago del lead", async () => {
  const p = await ve(U.c1.token, "compras.pedirTasacion", { leadId: U.lead1.id });
  assert.equal(p.status, 200, JSON.stringify(p));
  const t = fila("tasaciones", p.tasacion.id);
  assert.equal(t.tipo, "compra");
  assert.equal(t.lead_id, U.lead1.id);
  assert.equal(t.estado, "pendiente");
  assert.equal(t.vehiculo.marca, "Toyota");
  assert.equal((await ve(U.c1.token, "compras.pedirTasacion", { leadId: U.lead1.id })).error, "tasacion_en_curso");
  assert.ok((await ve(U.t1.token, "tasaciones.list", { vista: "cola" })).tasaciones.some((x) => x.id === t.id));
  // Antes de completarse no hay con qué ofertar.
  assert.equal((await ofertar(U.c1.token, U.lead1.id, t.id, 5000000)).error, "tasacion_incompleta");
  const lt = await ve(U.c1.token, "compras.tasaciones", { leadId: U.lead1.id });
  assert.deepEqual(lt.tasaciones, []);
  assert.equal(lt.pendiente.id, t.id);
  await ve(U.t1.token, "tasaciones.tomar", { id: t.id });
  const fin = await ve(U.t1.token, "tasaciones.completar", { id: t.id, borrador: { aplicaPara: "compra", valorCompra: 6500000, valorVenta: 8500000 } });
  assert.equal(fin.status, 200, JSON.stringify(fin));
  const lead = fila("leads", U.lead1.id);
  assert.deepEqual(lead.parte_pago, {}, "una tasación de compra no es parte de pago");
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === U.lead1.id && /se paga hasta \$6\.500\.000/.test(e.detalle)));
  const lt2 = await ve(U.c1.token, "compras.tasaciones", { leadId: U.lead1.id });
  assert.equal(lt2.tasaciones.length, 1);
  assert.equal(lt2.tasaciones[0].valor_compra, 6500000);
  U.tas1 = lt2.tasaciones[0];
});

test("Ofertar: no más de lo tasado, una sola oferta abierta, y el lead pasa a «oferta hecha»", async () => {
  assert.equal((await ofertar(U.c1.token, U.lead1.id, U.tas1.id, 7000000)).error, "oferta_excede_tasacion");
  assert.equal((await ofertar(U.c1.token, U.lead1.id, U.tas1.id, 0)).error, "monto_invalido");
  assert.equal((await ofertar(U.c2.token, U.lead1.id, U.tas1.id, 5000000)).status, 404, "Camilo no ve el lead de Carla");
  const otro = await leadDe(U.c1.token, "compra");
  assert.equal((await ofertar(U.c1.token, otro.id, U.tas1.id, 5000000)).error, "tasacion_no_corresponde", "la tasación es de otro vehículo");
  const o = await ofertar(U.c1.token, U.lead1.id, U.tas1.id, 6000000, "Incluye llaves y manuales");
  assert.equal(o.status, 200, JSON.stringify(o));
  const c = o.compra;
  assert.equal(c.estado, "oferta");
  assert.equal(c.folio, `CMP-${String(c.numero).padStart(5, "0")}`);
  assert.equal(c.monto_oferta, 6000000);
  assert.equal(c.valor_tasado, 6500000);
  assert.equal(c.ejecutivo, "Carla Compras");
  assert.equal(fila("leads", U.lead1.id).etapa, "cotizado");
  assert.equal((await ofertar(U.c1.token, U.lead1.id, U.tas1.id, 5000000)).error, "compra_en_curso");
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "compra.ofertar" && b.detalle.monto === 6000000));
  // No se puede dar por perdido un lead con una oferta abierta.
  assert.equal((await ve(U.c1.token, "leads.mover", { id: U.lead1.id, etapa: "perdido", motivo: "Precio" })).error, "operacion_en_curso");
  U.compra1 = c;
});

test("El cliente rechaza: se puede hacer otra oferta; luego acepta y se piden los documentos", async () => {
  assert.equal((await ve(U.c1.token, "compras.responder", { id: U.compra1.id, acepta: false })).error, "motivo_requerido");
  assert.equal((await ve(U.c2.token, "compras.responder", { id: U.compra1.id, acepta: true })).status, 404);
  const r = await ve(U.c1.token, "compras.responder", { id: U.compra1.id, acepta: false, motivo: "Quiere $6.400.000" });
  assert.equal(r.compra.estado, "rechazada");
  assert.equal(r.compra.motivo, "Quiere $6.400.000");
  const o2 = await ofertar(U.c1.token, U.lead1.id, U.tas1.id, 6400000);
  assert.equal(o2.status, 200, "tras un rechazo se puede ofertar de nuevo");
  const a = await ve(U.c1.token, "compras.responder", { id: o2.compra.id, acepta: true });
  assert.equal(a.compra.estado, "aceptada");
  assert.equal(fila("leads", U.lead1.id).etapa, "reservado");
  const val = db.tablas.validaciones.find((v) => v.compra_id === o2.compra.id);
  assert.ok(val, "se creó la validación de documentos");
  assert.equal(val.tipo, "compra");
  assert.ok(db.tablas.validacion_docs.some((d) => d.validacion_id === val.id && d.clave === "carnet_identidad"));
  assert.equal(a.compra.validacion.estado, "pendiente");
  assert.equal((await ve(U.c1.token, "compras.responder", { id: o2.compra.id, acepta: true })).error, "compra_estado_invalido");
  U.compra1 = a.compra;
});

test("Pago: lo pagado no supera la oferta, y el supervisor lo aprueba (el vehículo entra al inventario)", async () => {
  const sol = (datos) => ve(U.c1.token, "compras.solicitarPago", { id: U.compra1.id, datos });
  assert.equal((await sol(PAGO({ montoFinal: 6400001 }))).error, "monto_excede_oferta");
  assert.equal((await sol(PAGO({ medioPago: "Trueque" }))).error, "medio_invalido");
  assert.equal((await sol(PAGO({ fechaPago: "ayer" }))).error, "fecha_invalida");
  assert.equal((await sol(PAGO({ montoFinal: 6200000 }))).error, "compra_incompleta", "sin los datos del vendedor y los documentos no se pide el pago");
  await cumplirRequisitos(U.compra1.id);
  const p = await sol(PAGO({ montoFinal: 6200000, notas: "Transferencia al banco del dueño" }));
  assert.equal(p.status, 200, JSON.stringify(p));
  assert.equal(p.compra.estado, "pago_pendiente", "la ejecutiva no se aprueba sola");
  assert.equal(p.compra.monto_final, 6200000);
  assert.equal((await ve(U.c1.token, "compras.aprobar", { id: U.compra1.id })).status, 403);
  assert.equal((await ve(U.jefeSur.token, "compras.aprobar", { id: U.compra1.id })).status, 404, "otro local");
  assert.equal((await ve(U.jefe.token, "compras.rechazarPago", { id: U.compra1.id, motivo: "" })).error, "motivo_requerido");

  // Alerta en el panel del Jefe Local.
  const g = await ve(U.jefe.token, "gestion.resumen");
  assert.equal(g.conteos.comprasPorAprobar, 1);
  assert.equal(g.comprasPorAprobar[0].monto_final, 6200000);

  // El supervisor rechaza el pago: vuelve a «aceptada» con el motivo.
  const rp = await ve(U.jefe.token, "compras.rechazarPago", { id: U.compra1.id, motivo: "Falta el comprobante" });
  assert.equal(rp.compra.estado, "aceptada");
  assert.equal(rp.compra.motivo_rechazo_pago, "Falta el comprobante");
  assert.equal((await sol(PAGO({ montoFinal: 6200000 }))).compra.estado, "pago_pendiente");

  const ap = await ve(U.jefe.token, "compras.aprobar", { id: U.compra1.id });
  assert.equal(ap.status, 200, JSON.stringify(ap));
  assert.equal(ap.compra.estado, "comprada");
  assert.equal(ap.compra.mes, MES);
  assert.equal(ap.compra.aprobado_por, "Julia Jefa");
  const veh = fila("vehiculos", ap.compra.vehiculo_id);
  assert.equal(veh.estado, "preparacion");
  assert.equal(veh.costo, 6200000);
  assert.equal(veh.precio_lista, 8500000, "el valor de venta esperado de la tasación");
  assert.equal(veh.origen, "compra");
  assert.equal(veh.local_id, L1);
  assert.equal(veh.marca, "Toyota");
  assert.equal(fila("leads", U.lead1.id).etapa, "ganado");
  assert.ok(db.tablas.validaciones.some((v) => v.vehiculo_id === veh.id && v.tipo === "vehiculo"), "el vehículo nuevo recibe su validación de documentos");
  assert.equal((await ve(U.jefe.token, "compras.aprobar", { id: U.compra1.id })).error, "compra_estado_invalido");
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "compra.aprobar" && b.detalle.mes === MES));
  assert.equal((await ve(U.jefe.token, "gestion.resumen")).conteos.comprasPorAprobar, 0);
  U.compraOk = ap.compra;
});

test("Comisión de compras: por tramos de unidades del mes", async () => {
  const r = await ve(U.c1.token, "comisiones.resumen");
  assert.equal(r.status, 200);
  const yo = r.ejecutivos[0];
  assert.equal(yo.datos.comprasN, 1);
  assert.equal(yo.produccion.compras.total, 100000, "tramo 1 a 5 = $100.000 por compra");
  assert.equal(yo.comprado, 6200000);
  const todos = await ve(U.jefe.token, "comisiones.resumen");
  assert.ok(todos.ejecutivos.some((e) => e.nombre === "Carla Compras"), "aparece aunque no tenga ventas");
  const c2 = await ve(U.c2.token, "comisiones.resumen");
  assert.equal(c2.status, 200);
  assert.equal(c2.ejecutivos[0].datos.comprasN, 0, "Camilo aún no cierra compras: solo ve lo suyo");
});

test("Patente repetida: no entra un vehículo que ya está activo en el inventario", async () => {
  const lead = await leadDe(U.c1.token, "compra");
  const dup = await vehiculoVendible(U.jefe.token, { patente: lead.vehiculo_ofrecido.patente });
  assert.ok(dup.id);
  const tas = await tasar(lead);
  const o = await ofertar(U.c1.token, lead.id, tas.id, 6000000);
  await ve(U.c1.token, "compras.responder", { id: o.compra.id, acepta: true });
  await cumplirRequisitos(o.compra.id);
  await ve(U.c1.token, "compras.solicitarPago", { id: o.compra.id, datos: PAGO() });
  const ap = await ve(U.jefe.token, "compras.aprobar", { id: o.compra.id });
  assert.equal(ap.error, "patente_duplicada");
  assert.equal(ap.status, 409);
  assert.equal(fila("compras", o.compra.id).estado, "pago_pendiente", "no cambió nada");
});

test("Cancelar y anular una compra", async () => {
  const lead = await leadDe(U.c1.token, "compra");
  const tas = await tasar(lead);
  const o = await ofertar(U.c1.token, lead.id, tas.id, 6000000);
  assert.equal((await ve(U.c1.token, "compras.cancelar", { id: o.compra.id, motivo: "" })).error, "motivo_requerido");
  const c = await ve(U.c1.token, "compras.cancelar", { id: o.compra.id, motivo: "El cliente ya no vende" });
  assert.equal(c.compra.estado, "cancelada");
  assert.equal(fila("leads", lead.id).etapa, "contactado");
  assert.equal((await ve(U.c1.token, "compras.cancelar", { id: o.compra.id, motivo: "otra vez" })).error, "compra_estado_invalido");

  // Anular una compra aprobada: solo el supervisor; archiva el vehículo y la saca de la comisión.
  assert.equal((await ve(U.c1.token, "compras.anular", { id: U.compraOk.id, motivo: "Error" })).status, 403);
  assert.equal((await ve(U.jefe.token, "compras.anular", { id: U.compraOk.id, motivo: "" })).error, "motivo_requerido");
  // Si el vehículo ya se está usando (reservado o vendido), no se puede anular.
  const vehC = fila("vehiculos", U.compraOk.vehiculo_id);
  vehC.estado = "reservado";
  assert.equal((await ve(U.jefe.token, "compras.anular", { id: U.compraOk.id, motivo: "Error" })).error, "vehiculo_en_uso");
  vehC.estado = "preparacion";
  const a = await ve(U.jefe.token, "compras.anular", { id: U.compraOk.id, motivo: "Se cayó la operación" });
  assert.equal(a.status, 200, JSON.stringify(a));
  assert.equal(a.compra.estado, "anulada");
  assert.equal(vehC.activo, false);
  assert.equal(fila("leads", U.lead1.id).etapa, "reservado");
  assert.equal((await ve(U.c1.token, "comisiones.resumen")).ejecutivos[0].datos.comprasN, 0, "sale de la comisión del mes");
});

test("Lead que llega por el sitio web: se asigna a quien compra y se ofrece su tasación", async () => {
  nuevaIp();
  const pat = "WEBV11";
  const r = await api({ action: "public", op: "solicitud", tipo: "vender", nombre: "Pedro Web", codigoPais: "56", telefono: "955500123", email: "pedro@web.cl", mensaje: "Auto en buen estado", transmision: "Automática", combustible: "Bencina", duenos: 1, prenda: "no", mantenciones: "si", precioEsperado: 9000000, acepta: true, abiertoEn: Date.now() - 10000, web: "", localId: L1, patente: pat, marca: "Mazda", modelo: "3", anio: 2019, km: 50000, modalidad: "vender" });
  assert.equal(r.status, 200, JSON.stringify(r));
  const lead = db.tablas.leads.find((l) => l.vehiculo_ofrecido && l.vehiculo_ofrecido.patente === pat);
  assert.ok(lead, "el lead guarda el vehículo ofrecido");
  assert.equal(lead.tipo, "compra");
  assert.ok([U.c1.id, U.c2.id].includes(lead.asignado_a), "se asigna a quien tiene compras habilitadas");
  // La tasación directa creada por el sitio se completa y se puede ofertar sobre ella (misma patente).
  const t = db.tablas.tasaciones.find((x) => x.patente === pat);
  const dueño = lead.asignado_a === U.c1.id ? U.c1 : U.c2;
  await ve(U.t1.token, "tasaciones.tomar", { id: t.id });
  await ve(U.t1.token, "tasaciones.completar", { id: t.id, borrador: { aplicaPara: "compra", valorCompra: 7000000, valorVenta: 9000000 } });
  const lt = await ve(dueño.token, "compras.tasaciones", { leadId: lead.id });
  assert.equal(lt.tasaciones.length, 1);
  const o = await ofertar(dueño.token, lead.id, lt.tasaciones[0].id, 6800000);
  assert.equal(o.status, 200, JSON.stringify(o));
  // Al aceptar se reutiliza la validación que el sitio ya había creado con la tasación.
  const antes = db.tablas.validaciones.filter((v) => v.tasacion_id === t.id).length;
  await ve(dueño.token, "compras.responder", { id: o.compra.id, acepta: true });
  const despues = db.tablas.validaciones.filter((v) => v.tasacion_id === t.id && v.estado !== "cancelada");
  assert.equal(despues.length, antes, "no se duplica la validación");
  assert.ok(despues.some((v) => v.compra_id === o.compra.id));
});

/* ======================= CONSIGNACIONES ======================= */
const CONTRATO = (extra = {}) => ({ precioPiso: 8000000, precioPublicacion: 8990000, plazoDias: 60, notas: "Llaves en el local", ...extra });
/** El ejecutivo completa los datos del dueño y sube los 9 documentos de una consignación (sin aserciones: lo usan los flujos que no prueban los requisitos). */
async function cumplirRequisitosConsignacion(leadId, token = U.c1.token) {
  if (db.tablas.consignaciones.some((c) => c.lead_id === leadId)) return;
  const rq = await ve(token, "consignaciones.requisitos", { leadId });
  if (rq.status !== 200) return;
  await ve(token, "consignaciones.datosCliente", { leadId, datos: DATOS_VENDEDOR() });
  for (const d of rq.docs) {
    if (d.nArchivos === 0) await ve(token, "validacion.adjuntar", { id: rq.validacionId, docId: d.id, archivo: { id: `cs${++archN}abcd`, nombre: "doc.pdf", tipo: "application/pdf", tam: 1000 } });
    const regla = reglaDocCompra(d.clave);
    if (regla.vence || regla.precio) await ve(token, "validacion.datosDoc", { id: rq.validacionId, docId: d.id, venceEn: "2027-06-30", precio: 95000 });
  }
}
const consignar = async (token, leadId, datos = CONTRATO(), { requisitos = true } = {}) => {
  if (requisitos) await cumplirRequisitosConsignacion(leadId, token);
  return ve(token, "consignaciones.crear", { leadId, datos });
};

test("Contrato de consignación: valida los precios y el plazo; sin Validadores el vehículo entra de inmediato", async () => {
  const lead = await leadDe(U.c1.token, "consignacion");
  assert.equal((await consignar(U.c1.token, lead.id, CONTRATO({ precioPublicacion: 7000000 }))).error, "publicacion_bajo_piso");
  assert.equal((await consignar(U.c1.token, lead.id, CONTRATO({ precioPiso: 0 }))).error, "precio_invalido");
  assert.equal((await consignar(U.c1.token, lead.id, CONTRATO({ plazoDias: 3 }))).error, "plazo_invalido");
  assert.equal((await consignar(U.c2.token, lead.id)).status, 403, "Camilo no tiene consignaciones habilitadas");
  const ventaLead = await ve(U.e1.token, "leads.create", { cliente: { nombre: "Cliente Venta", telefono: "955500777" }, lead: {} });
  assert.equal((await consignar(U.c1.token, ventaLead.lead.id)).status, 404, "no es su lead");

  const r = await consignar(U.c1.token, lead.id);
  assert.equal(r.status, 200, JSON.stringify(r));
  const c = r.consignacion;
  assert.equal(c.estado, "vigente", "sin Validadores se activa sola");
  assert.equal(c.folio, `CNS-${String(c.numero).padStart(5, "0")}`);
  assert.equal(c.precio_piso, 8000000);
  assert.equal(c.margenEsperado, 990000);
  assert.ok(c.vence_en);
  assert.ok(c.diasRestantes >= 59 && c.diasRestantes <= 61);
  const veh = fila("vehiculos", c.vehiculo_id);
  assert.equal(veh.estado, "disponible");
  assert.equal(veh.costo, 8000000, "el costo del vehículo consignado es el piso");
  assert.equal(veh.precio_lista, 8990000);
  assert.equal(veh.precio_piso, 8000000);
  assert.equal(veh.origen, "consignacion");
  assert.equal(fila("leads", lead.id).etapa, "ganado");
  assert.equal((await consignar(U.c1.token, lead.id)).error, "lead_cerrado");
  U.cons1 = c; U.lead2 = lead;
});

test("Precio piso: el vehículo consignado no se publica, cotiza ni vende por debajo", async () => {
  const id = U.cons1.vehiculo_id;
  const veh = fila("vehiculos", id);
  const guardar = (precioLista) => ve(U.jefe.token, "inventario.save", { id, datos: { patente: veh.patente, marca: veh.marca, modelo: veh.modelo, anio: veh.anio, km: veh.km, precioLista, costo: 8000000, estado: "disponible" } });
  assert.equal((await guardar(7900000)).error, "bajo_precio_piso", "en el inventario");
  assert.equal((await guardar(9100000)).status, 200);
  const guardar2 = await guardar(8990000);
  assert.equal(guardar2.status, 200);
  assert.equal(fila("vehiculos", id).precio_piso, 8000000, "editar el inventario no pierde el piso");

  // Cotización con un descuento que deja el precio bajo el piso.
  const lead = (await ve(U.e1.token, "leads.create", { cliente: { nombre: "Comprador", telefono: "955500888" }, lead: {} })).lead;
  assert.equal((await ve(U.e1.token, "cotizaciones.save", { leadId: lead.id, vehiculoId: id, datos: { descuento: 1200000 } })).error, "bajo_precio_piso");
  const cot = await ve(U.e1.token, "cotizaciones.save", { leadId: lead.id, vehiculoId: id, datos: { descuento: 900000 } });
  assert.equal(cot.status, 200, JSON.stringify(cot));
  assert.equal(cot.cotizacion.precio_final, 8090000);
  U.ventaLead = lead; U.cot = cot.cotizacion;
});

test("Venta de un vehículo consignado: el margen sobre el piso paga el 25 % al ejecutivo de la consignación", async () => {
  // El supervisor aprueba el descuento y se reserva.
  if (U.cot.estado === "pendiente") assert.equal((await ve(U.jefe.token, "cotizaciones.aprobar", { id: U.cot.id })).status, 200);
  const res = await ve(U.e1.token, "reservas.crear", { cotizacionId: U.cot.id, monto: 500000 });
  assert.equal(res.status, 200, JSON.stringify(res));
  const bajo = await ve(U.e1.token, "cierres.crear", { leadId: U.ventaLead.id, datos: { precioFinal: 7900000, montoParteDePago: 0, montoFinanciado: 0, fechaEntrega: hoy() } });
  assert.equal(bajo.error, "bajo_precio_piso", "tampoco se cierra bajo el piso");
  const c = await ve(U.e1.token, "cierres.crear", { leadId: U.ventaLead.id, datos: { precioFinal: 8090000, montoParteDePago: 0, montoFinanciado: 0, fechaEntrega: hoy() } });
  assert.equal(c.status, 200, JSON.stringify(c));
  const ap = await ve(U.jefe.token, "cierres.aprobar", { id: c.cierre.id });
  assert.equal(ap.status, 200, JSON.stringify(ap));
  const cons = fila("consignaciones", U.cons1.id);
  assert.equal(cons.estado, "vendida");
  assert.equal(cons.precio_venta, 8090000);
  assert.equal(cons.margen, 90000);
  assert.equal(cons.mes, MES);
  assert.equal(cons.cierre_id, c.cierre.id);

  // Comisión de Carla: 25 % del margen (precio de venta − piso).
  const r = (await ve(U.c1.token, "comisiones.resumen")).ejecutivos[0];
  assert.equal(r.produccion.consignaciones.total, Math.round(90000 * 0.25));
  assert.equal(r.produccion.consignaciones.n, 1);
  // Eva, que vendió, cobra su venta como siempre.
  assert.equal((await ve(U.e1.token, "comisiones.resumen")).ejecutivos[0].datos.ventasN, 1);

  // Si se anula la venta, la consignación vuelve a estar vigente y la comisión desaparece.
  const an = await ve(U.jefe.token, "cierres.anular", { id: c.cierre.id, motivo: "El cliente desistió" });
  assert.equal(an.status, 200);
  assert.equal(fila("consignaciones", U.cons1.id).estado, "vigente");
  assert.equal(fila("consignaciones", U.cons1.id).precio_venta, null);
  assert.equal((await ve(U.c1.token, "comisiones.resumen")).ejecutivos[0].produccion.consignaciones.total, 0);
});

test("Consignación: extender el plazo, devolver al dueño y alertas de vencimiento", async () => {
  const lead = await leadDe(U.c1.token, "consignacion");
  const c = (await consignar(U.c1.token, lead.id, CONTRATO({ plazoDias: 15 }))).consignacion;
  assert.equal((await ve(U.c1.token, "consignaciones.extender", { id: c.id, dias: 3 })).error, "plazo_invalido");
  const ex = await ve(U.c1.token, "consignaciones.extender", { id: c.id, dias: 30 });
  assert.equal(ex.consignacion.plazo_dias, 45);
  assert.ok(ex.consignacion.diasRestantes >= 44 && ex.consignacion.diasRestantes <= 46);

  // Vence pronto: aparece en el panel del Jefe Local; vencida, se marca.
  fila("consignaciones", c.id).vence_en = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString("en-CA");
  const g = await ve(U.jefe.token, "gestion.resumen");
  assert.ok(g.consignacionesPorVencer.some((x) => x.id === c.id));
  assert.ok(g.conteos.consignacionesPorVencer >= 1);
  fila("consignaciones", c.id).vence_en = "2020-01-01";
  const vencida = await ve(U.c1.token, "consignaciones.get", { id: c.id });
  assert.equal(vencida.consignacion.vencida, true);
  assert.ok(vencida.consignacion.diasRestantes < 0);
  assert.equal((await ve(U.c1.token, "consignaciones.extender", { id: c.id, dias: 30 })).status, 200, "se puede renovar una vencida");

  // Devolver: no si el vehículo está reservado o vendido; sí si sigue disponible (se archiva).
  const veh = fila("vehiculos", c.vehiculo_id);
  veh.estado = "reservado";
  assert.equal((await ve(U.c1.token, "consignaciones.devolver", { id: c.id, motivo: "El dueño lo retira" })).error, "vehiculo_en_uso");
  veh.estado = "disponible";
  assert.equal((await ve(U.c1.token, "consignaciones.devolver", { id: c.id, motivo: "" })).error, "motivo_requerido");
  assert.equal((await ve(U.c2.token, "consignaciones.devolver", { id: c.id, motivo: "No es mía" })).status, 403);
  const d = await ve(U.c1.token, "consignaciones.devolver", { id: c.id, motivo: "El dueño lo retira" });
  assert.equal(d.consignacion.estado, "devuelta");
  assert.equal(veh.activo, false);
  assert.equal((await ve(U.c1.token, "consignaciones.devolver", { id: c.id, motivo: "otra vez" })).error, "consignacion_estado_invalido");
});

test("Con Validadores: la compra espera sus documentos; la consignación espera la aprobación para entrar", async () => {
  await crear("val", "Vera Validadora", "13.579.246-2", ["validador"], L1);
  // --- compra ---
  const { compra } = await comprarHastaPago(6000000);
  const val = db.tablas.validaciones.find((v) => v.compra_id === compra.id);
  assert.equal(val.estado, "pendiente");
  assert.equal((await ve(U.jefe.token, "compras.aprobar", { id: compra.id })).error, "validacion_pendiente");
  assert.equal((await ve(U.val.token, "validacion.tomar", { id: val.id })).status, 200);
  let n2 = 0;
  for (const d of db.tablas.validacion_docs.filter((x) => x.validacion_id === val.id && x.requerido)) {
    if ((d.archivos ?? []).length === 0) { const ad = await ve(U.val.token, "validacion.adjuntar", { id: val.id, docId: d.id, archivo: { id: `arch${200000 + ++n2}`, nombre: "d.jpg", tipo: (reglaDocCompra(d.clave) || { tipos: ["image/jpeg"] }).tipos[0], tam: 1000 } }); assert.equal(ad.status, 200, d.clave + " " + JSON.stringify(ad)); }
    const rv = await ve(U.val.token, "validacion.revisar", { id: val.id, docId: d.id, estado: "aprobado" });
    assert.equal(rv.status, 200, d.clave + " " + JSON.stringify(rv));
  }
  const ap = await ve(U.jefe.token, "compras.aprobar", { id: compra.id });
  assert.equal(ap.status, 200, JSON.stringify(ap));
  // Los documentos del vehículo ya aprobados pasan al vehículo nuevo.
  const vv = db.tablas.validaciones.find((v) => v.vehiculo_id === ap.compra.vehiculo_id && v.tipo === "vehiculo");
  assert.equal(vv.estado, "aprobada", "los 5 documentos del vehículo se heredaron de la compra");

  // --- consignación ---
  const lead = await leadDe(U.c1.token, "consignacion");
  const r = await consignar(U.c1.token, lead.id);
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.consignacion.estado, "en_validacion");
  assert.equal(r.consignacion.vehiculo_id ?? null, null, "aún no entra al inventario");
  assert.equal(db.tablas.vehiculos.filter((v) => v.patente === lead.vehiculo_ofrecido.patente && v.activo !== false).length, 0);
  assert.equal(fila("leads", lead.id).etapa, "cotizado");
  const v2 = db.tablas.validaciones.find((v) => v.consignacion_id === r.consignacion.id);
  assert.equal(v2.tipo, "consignacion");
  assert.ok(db.tablas.validacion_docs.some((d) => d.validacion_id === v2.id && d.clave === "contrato_consignacion"));
  await ve(U.val.token, "validacion.tomar", { id: v2.id });
  const docs = db.tablas.validacion_docs.filter((x) => x.validacion_id === v2.id);
  for (const d of docs) {
    await ve(U.val.token, "validacion.adjuntar", { id: v2.id, docId: d.id, archivo: { id: `arch${300000 + ++n2}`, nombre: "d.jpg", tipo: "image/jpeg", tam: 1000 } });
    await ve(U.val.token, "validacion.revisar", { id: v2.id, docId: d.id, estado: "aprobado" });
  }
  const activa = fila("consignaciones", r.consignacion.id);
  assert.equal(activa.estado, "vigente", "al aprobarse los documentos, el vehículo entra solo");
  assert.ok(activa.vehiculo_id);
  assert.equal(fila("vehiculos", activa.vehiculo_id).origen, "consignacion");
  assert.equal(fila("leads", lead.id).etapa, "ganado");
  U.consPend = r.consignacion;
});

test("Cancelar una consignación en validación", async () => {
  const lead = await leadDe(U.c1.token, "consignacion");
  const r = await consignar(U.c1.token, lead.id);
  assert.equal(r.consignacion.estado, "en_validacion");
  assert.equal((await ve(U.c1.token, "consignaciones.devolver", { id: r.consignacion.id, motivo: "Aún no está" })).error, "consignacion_estado_invalido");
  const c = await ve(U.c1.token, "consignaciones.cancelar", { id: r.consignacion.id, motivo: "El dueño cambió de idea" });
  assert.equal(c.consignacion.estado, "cancelada");
  assert.ok(db.tablas.validaciones.filter((v) => v.consignacion_id === r.consignacion.id).every((v) => v.estado === "cancelada"));
  assert.equal(fila("leads", lead.id).etapa, "contactado");
});

test("Listas: cada ejecutivo ve lo suyo; el supervisor, lo del local; otro local, nada", async () => {
  const mias = await ve(U.c1.token, "compras.list", { vista: "mias" });
  assert.ok(mias.compras.length >= 3);
  assert.ok(mias.compras.every((c) => c.ejecutivo === "Carla Compras"));
  assert.equal((await ve(U.c2.token, "compras.list", { vista: "mias" })).compras.filter((c) => c.ejecutivo !== "Camilo Compras").length, 0);
  const local = await ve(U.jefe.token, "compras.list", { vista: "local" });
  assert.ok(local.compras.length >= mias.compras.length);
  assert.equal((await ve(U.jefeSur.token, "compras.list", { vista: "local" })).compras.length, 0);
  assert.equal((await ve(U.jefe.token, "compras.list", { vista: "pendientes" })).compras.every((c) => c.estado === "pago_pendiente"), true);
  assert.equal((await ve(U.c1.token, "compras.list", { vista: "rara" })).error, "vista_invalida");
  const porLead = await ve(U.c1.token, "compras.list", { vista: "lead", leadId: U.lead1.id });
  assert.ok(porLead.compras.length >= 2);
  assert.equal((await ve(U.c2.token, "compras.list", { vista: "lead", leadId: U.lead1.id })).status, 404);
  const cons = await ve(U.c1.token, "consignaciones.list", { vista: "mias" });
  assert.ok(cons.consignaciones.length >= 3);
  assert.equal((await ve(U.jefeSur.token, "consignaciones.list", { vista: "local" })).consignaciones.length, 0);
  assert.equal((await ve(U.c2.token, "consignaciones.list", { vista: "mias" })).status, 403, "Camilo no tiene consignaciones");
  assert.equal((await ve(U.mkt.token, "consignaciones.list", { vista: "local" })).status, 403);
  assert.equal((await ve(U.c1.token, "consignaciones.get", { id: randomUUID() })).status, 404);
});

test("La cuenta maestra mira pero no opera", async () => {
  assert.equal((await ve(admin, "compras.list", { vista: "local", localId: L1 })).status, 200);
  assert.equal((await ve(admin, "consignaciones.list", { vista: "local", localId: L1 })).status, 200);
  assert.equal((await ve(admin, "compras.responder", { id: U.compra1.id, acepta: true, localId: L1 })).error, "compra_estado_invalido", "la compra ya está anulada: nada que responder");
});

test("Etapas automáticas del tablero: tasación pedida → oferta → aceptada → documentos y pago, y la lista trae próxima acción y foto", async () => {
  const lead = await leadDe(U.c1.token, "compra");
  const p = await ve(U.c1.token, "compras.pedirTasacion", { leadId: lead.id });
  assert.equal(p.status, 200, JSON.stringify(p));
  assert.equal(fila("leads", lead.id).etapa, "tasacion");
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === lead.id && e.tipo === "etapa" && /Tasación pedida/.test(e.detalle)));
  assert.equal((await ve(U.t1.token, "tasaciones.tomar", { id: p.tasacion.id })).status, 200);
  const t = await ve(U.t1.token, "tasaciones.completar", { id: p.tasacion.id, borrador: { aplicaPara: "compra", valorCompra: 6500000, valorVenta: 8500000 } });
  assert.equal(t.status, 200, JSON.stringify(t));
  const o = await ofertar(U.c1.token, lead.id, t.tasacion.id, 6000000);
  assert.equal(fila("leads", lead.id).etapa, "cotizado");
  assert.equal((await ve(U.c1.token, "compras.responder", { id: o.compra.id, acepta: true })).status, 200);
  assert.equal(fila("leads", lead.id).etapa, "reservado");
  await cumplirRequisitos(o.compra.id);
  assert.equal((await ve(U.c1.token, "compras.solicitarPago", { id: o.compra.id, datos: PAGO() })).status, 200);
  assert.equal(fila("leads", lead.id).etapa, "documentos");
  // Un lead que ya avanzó no retrocede por pedir otra tasación.
  const lista = await ve(U.c1.token, "leads.list", {});
  assert.equal(lista.status, 200);
  assert.ok(lista.proximas && typeof lista.proximas === "object");
  assert.ok(lista.leads.some((l) => l.id === lead.id && l.etapa === "documentos"));
});

test("Leads perdidos: quedan guardados para siempre y solo se traen al pedirlos", async () => {
  const lead = await leadDe(U.c1.token, "compra");
  assert.equal((await ve(U.c1.token, "leads.mover", { id: lead.id, etapa: "perdido", motivo: "Precio" })).status, 200);
  fila("leads", lead.id).actualizado_en = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const sin = await ve(U.c1.token, "leads.list", {});
  assert.ok(!sin.leads.some((l) => l.id === lead.id), "un perdido antiguo no se trae por defecto");
  const con = await ve(U.c1.token, "leads.list", { perdidos: true });
  const l = con.leads.find((x) => x.id === lead.id);
  assert.ok(l, "se trae al pedir los perdidos");
  assert.equal(l.etapa, "perdido");
  assert.equal(l.motivo_perdida, "Precio");
  assert.ok(db.tablas.leads.some((x) => x.id === lead.id), "sigue guardado");
});

/** Pide la tasación de un lead, la toma el Tasador y la completa con el borrador dado; devuelve la respuesta de «completar». */
async function tasarCon(lead, borrador, token = U.c1.token) {
  const p = await ve(token, "compras.pedirTasacion", { leadId: lead.id });
  assert.equal(p.status, 200, JSON.stringify(p));
  assert.equal((await ve(U.t1.token, "tasaciones.tomar", { id: p.tasacion.id })).status, 200);
  return { id: p.tasacion.id, r: await ve(U.t1.token, "tasaciones.completar", { id: p.tasacion.id, borrador }) };
}

test("Tasador: debe decidir a qué aplica y poner el precio que corresponde", async () => {
  const lead = await leadDe(U.c1.token, "compra");
  const p = await ve(U.c1.token, "compras.pedirTasacion", { leadId: lead.id });
  await ve(U.t1.token, "tasaciones.tomar", { id: p.tasacion.id });
  const completar = (borrador) => ve(U.t1.token, "tasaciones.completar", { id: p.tasacion.id, borrador });
  assert.equal((await completar({ valorCompra: 6000000, valorVenta: 8000000 })).error, "aplica_para_requerido");
  assert.equal((await completar({ aplicaPara: "otra" })).error, "aplica_para_invalido");
  assert.equal((await completar({ aplicaPara: "compra", valorCompra: 0, valorVenta: 8000000 })).error, "valor_compra_invalido");
  assert.equal((await completar({ aplicaPara: "consignacion", valorConsignacion: 0 })).error, "valor_consignacion_invalido");
  assert.equal((await completar({ aplicaPara: "consignacion", valorConsignacion: 7000000 })).error, "valor_venta_invalido");
  assert.equal((await completar({ aplicaPara: "ambas", valorCompra: 6000000, valorVenta: 8000000 })).error, "valor_consignacion_invalido");
  assert.equal((await completar({ aplicaPara: "ninguna", observaciones: "" })).error, "motivo_no_aplica_requerido");
  const ok = await completar({ aplicaPara: "compra", valorCompra: 6000000, valorVenta: 8000000, valorConsignacion: 8300000, valorRetoma: 5800000 });
  assert.equal(ok.status, 200, JSON.stringify(ok));
  const t = fila("tasaciones", p.tasacion.id);
  assert.deepEqual([t.aplica_para, t.valor_compra, t.valor_consignacion, t.valor_retoma], ["compra", 6000000, 8300000, 5800000]);
});

test("Tasador: el resultado vuelve al ejecutivo (historial y correo) y la oferta solo va si aplica a compra", async () => {
  db.tablas.usuarios.find((u) => u.id === U.c1.id).email = "carla@x.cl";
  correos.length = 0;
  const lead = await leadDe(U.c1.token, "compra");
  const { id, r } = await tasarCon(lead, { aplicaPara: "ninguna", observaciones: "Chasis dañado" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === lead.id && e.tipo === "tasacion" && /NO aplica/.test(e.detalle) && /Chasis dañado/.test(e.detalle)));
  assert.ok(correos.some((c) => c.to.includes("carla@x.cl") && /Tasación completada/.test(c.html || "")), "le llega el correo a la ejecutiva");
  const of = await ofertar(U.c1.token, lead.id, id, 1000000);
  assert.equal(of.error, "tasacion_no_aplica_compra");
});

test("Tasador: si decide consignación en un lead de compra, el lead cambia de tipo y sigue con quien está habilitado", async () => {
  const lead = await leadDe(U.c1.token, "compra");
  const { r } = await tasarCon(lead, { aplicaPara: "consignacion", valorConsignacion: 9000000, valorVenta: 10500000 });
  assert.equal(r.status, 200, JSON.stringify(r));
  const l = fila("leads", lead.id);
  assert.equal(l.tipo, "consignacion");
  assert.equal(l.asignado_a, U.c1.id, "Carla tiene Consignaciones: se queda con ella");
  assert.equal(l.etapa, "contrato", "pasa a la etapa del contrato");
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === lead.id && e.tipo === "tipo" && /Compra a Consignación/.test(e.detalle)));
  const c = await consignar(U.c1.token, lead.id, { precioPiso: 8000000, precioPublicacion: 9000000, plazoDias: 90 });
  assert.equal(c.status, 200, JSON.stringify(c));
});

test("Tasador: si el ejecutivo no está habilitado para el nuevo tipo, el lead pasa a quien sí lo está", async () => {
  const lead = await leadDe(U.c2.token, "compra"); // Camilo solo tiene Compras
  const { r } = await tasarCon(lead, { aplicaPara: "consignacion", valorConsignacion: 9000000, valorVenta: 10500000 }, U.c2.token);
  assert.equal(r.status, 200, JSON.stringify(r));
  const l = fila("leads", lead.id);
  assert.equal(l.tipo, "consignacion");
  assert.equal(l.asignado_a, U.c1.id, "Carla es la única con Consignaciones");
});

test("Compra: sin los datos del vendedor y los 11 documentos no se pide el pago, no se aprueba ni hay nota de compra", async () => {
  const lead = await leadDe(U.c1.token, "compra");
  const tas = await tasar(lead);
  const o = await ofertar(U.c1.token, lead.id, tas.id, 6000000);
  assert.equal((await ve(U.c1.token, "compras.responder", { id: o.compra.id, acepta: true })).status, 200);
  const rq = await ve(U.c1.token, "compras.requisitos", { id: o.compra.id });
  assert.equal(rq.status, 200, JSON.stringify(rq));
  assert.equal(rq.aplica, true);
  assert.equal(rq.completo, false);
  assert.equal(rq.docs.length, 11);
  assert.ok(rq.faltantes.some((f) => f.clave === "direccion") && rq.faltantes.some((f) => f.clave === "banco") && rq.faltantes.some((f) => f.clave === "tipo_cuenta") && rq.faltantes.some((f) => f.clave === "numero_cuenta"));
  assert.equal((await ve(U.c1.token, "compras.solicitarPago", { id: o.compra.id, datos: PAGO() })).error, "compra_incompleta");

  // Datos críticos del vendedor.
  const dc = (extra) => ve(U.c1.token, "compras.datosCliente", { id: o.compra.id, datos: DATOS_VENDEDOR(extra) });
  assert.equal((await dc({ rut: "12.345.678-9" })).error, "rut_invalido");
  assert.equal((await dc({ nombre: "Solo" })).error, "nombre_apellido_requerido");
  assert.equal((await dc({ banco: "" })).error, "banco_invalido");
  assert.equal((await dc({ tipoCuenta: "" })).error, "tipo_cuenta_invalido");
  assert.equal((await dc({ numeroCuenta: "abc" })).error, "numero_cuenta_invalido");
  assert.equal((await dc({ direccion: "" })).error, "direccion_requerida");
  assert.equal((await ve(U.c2.token, "compras.datosCliente", { id: o.compra.id, datos: DATOS_VENDEDOR() })).status, 404, "otro ejecutivo no toca la compra");
  assert.equal((await dc({})).status, 200);
  const cli = db.tablas.clientes.find((c) => c.id === db.tablas.compras.find((x) => x.id === o.compra.id).cliente_id);
  assert.deepEqual([cli.direccion, cli.comuna], ["Calle Falsa 123", "Santiago"]);
  assert.equal((await dc({ comuna: "Narnia" })).error, "comuna_invalida");
  assert.equal((await dc({ rut: "12.345.678-9" })).error, "rut_invalido", "el RUT se verifica con su dígito verificador");
  assert.deepEqual([cli.banco, cli.tipo_cuenta, cli.numero_cuenta], ["BancoEstado", "Cuenta vista", "12345678"]);

  // Tipos de archivo por documento: el CAV solo acepta PDF; el padrón, imagen o PDF.
  const doc = (clave) => rq.docs.find((d) => d.clave === clave);
  const adj = (clave, tipo) => ve(U.c1.token, "validacion.adjuntar", { id: rq.validacionId, docId: doc(clave).id, archivo: { id: `tp${++archN}abcd`, nombre: "x", tipo, tam: 1000 } });
  assert.equal((await adj("cav", "image/jpeg")).error, "archivo_solo_pdf");
  assert.equal((await adj("cav", "application/pdf")).status, 200);
  assert.equal((await adj("padron", "image/jpeg")).status, 200);

  // Vencimiento y precio del permiso.
  const dd = (clave, extra) => ve(U.c1.token, "validacion.datosDoc", { id: rq.validacionId, docId: doc(clave).id, ...extra });
  assert.equal((await dd("soap", { venceEn: "mañana" })).error, "vencimiento_invalido");
  assert.equal((await dd("permiso_circulacion", { venceEn: "2027-01-31" })).error, "precio_doc_invalido");
  assert.equal((await dd("cav", { venceEn: "2027-01-31" })).error, "doc_sin_datos");
  assert.equal((await dd("soap", { venceEn: "2027-01-31" })).status, 200);

  // Con todo cargado: se puede pedir el pago, y aprobar; quitar un documento antes de aprobar vuelve a bloquear.
  await cumplirRequisitos(o.compra.id);
  const rq2 = await ve(U.c1.token, "compras.requisitos", { id: o.compra.id });
  assert.equal(rq2.completo, true, JSON.stringify(rq2.faltantes));
  assert.equal((await ve(U.jefe.token, "compras.nota", { id: o.compra.id })).error, "compra_estado_invalido", "aún no está concretada");
  assert.equal((await ve(U.c1.token, "compras.solicitarPago", { id: o.compra.id, datos: PAGO() })).status, 200);
  const dsoap = db.tablas.validacion_docs.find((d) => d.validacion_id === rq.validacionId && d.clave === "soap");
  const archivoSoap = dsoap.archivos[0];
  assert.equal((await ve(U.c1.token, "validacion.quitar", { id: rq.validacionId, docId: dsoap.id, archivoId: archivoSoap.id })).status, 200);
  assert.equal((await ve(U.jefe.token, "compras.aprobar", { id: o.compra.id })).error, "compra_incompleta");
  assert.equal((await ve(U.c1.token, "validacion.adjuntar", { id: rq.validacionId, docId: dsoap.id, archivo: { id: `tp${++archN}abcd`, nombre: "x", tipo: "application/pdf", tam: 1000 } })).status, 200);
  // Con Validador en el local, además revisa los documentos.
  assert.equal((await ve(U.val.token, "validacion.tomar", { id: rq.validacionId })).status, 200);
  for (const d of db.tablas.validacion_docs.filter((x) => x.validacion_id === rq.validacionId)) assert.equal((await ve(U.val.token, "validacion.revisar", { id: rq.validacionId, docId: d.id, estado: "aprobado" })).status, 200);
  const ap = await ve(U.jefe.token, "compras.aprobar", { id: o.compra.id });
  assert.equal(ap.status, 200, JSON.stringify(ap));

  // Nota de compra: con todos los datos.
  const nota = await ve(U.jefe.token, "compras.nota", { id: o.compra.id });
  assert.equal(nota.status, 200, JSON.stringify(nota));
  assert.deepEqual([nota.nota.vendedor.banco, nota.nota.vendedor.tipo_cuenta, nota.nota.vendedor.numero_cuenta], ["BancoEstado", "Cuenta vista", "12345678"]);
  assert.equal(nota.nota.permiso.precio, 95000);
  assert.equal(nota.nota.soap.vence_en, "2027-06-30");
  assert.equal(nota.nota.documentos.length, 11);
});

test("Compra: las compras con la lista anterior de documentos siguen con su regla de siempre", async () => {
  const lead = await leadDe(U.c1.token, "compra");
  const tas = await tasar(lead);
  const o = await ofertar(U.c1.token, lead.id, tas.id, 6000000);
  assert.equal((await ve(U.c1.token, "compras.responder", { id: o.compra.id, acepta: true })).status, 200);
  const val = db.tablas.validaciones.find((v) => v.compra_id === o.compra.id);
  // Se deja la validación como si se hubiera creado antes de este cambio (sin el CAV).
  db.tablas.validacion_docs = db.tablas.validacion_docs.filter((d) => !(d.validacion_id === val.id && d.clave === "cav"));
  const rq = await ve(U.c1.token, "compras.requisitos", { id: o.compra.id });
  assert.equal(rq.aplica, false);
  assert.equal(rq.completo, true);
  assert.equal((await ve(U.c1.token, "compras.solicitarPago", { id: o.compra.id, datos: PAGO() })).status, 200);
});

test("Consignación: sin los datos del dueño (con su cuenta bancaria) y los 9 documentos no se registra el contrato", async () => {
  const lead = await leadDe(U.c1.token, "consignacion");
  assert.equal((await ve(U.c1.token, "consignaciones.requisitos", { leadId: lead.id })).status, 200);
  const rq = await ve(U.c1.token, "consignaciones.requisitos", { leadId: lead.id });
  assert.equal(rq.aplica, true);
  assert.equal(rq.completo, false);
  assert.equal(rq.docs.length, 9);
  assert.deepEqual(rq.docs.map((d) => d.clave), ["cav", "multas", "carnet_identidad", "informe_legal", "permiso_circulacion", "revision_tecnica", "soap", "padron", "contrato_consignacion"]);
  assert.ok(!rq.docs.some((d) => d.clave === "dicom" || d.clave === "pension_alimentos"), "Dicom y pensión de alimentos no se piden");
  assert.ok(rq.faltantes.some((f) => f.texto === "Banco del dueño") && rq.faltantes.some((f) => f.texto === "RUT del dueño"));
  assert.equal((await consignar(U.c1.token, lead.id, CONTRATO(), { requisitos: false })).error, "consignacion_incompleta");
  assert.equal((await ve(U.c2.token, "consignaciones.requisitos", { leadId: lead.id })).status, 403, "quien no tiene Consignaciones no lo ve");

  // Datos del dueño: banco y tipo de cuenta de listas, y el número.
  const dc = (extra) => ve(U.c1.token, "consignaciones.datosCliente", { leadId: lead.id, datos: DATOS_VENDEDOR(extra) });
  assert.equal((await dc({ banco: "Banco Falso" })).error, "banco_invalido");
  assert.equal((await dc({ tipoCuenta: "" })).error, "tipo_cuenta_invalido");
  assert.equal((await dc({ numeroCuenta: "12" })).error, "numero_cuenta_invalido");
  assert.equal((await dc({ numeroCuenta: "00-123.456" })).status, 200);
  const cli = db.tablas.clientes.find((c) => c.id === fila("leads", lead.id).cliente_id);
  assert.deepEqual([cli.banco, cli.tipo_cuenta, cli.numero_cuenta], ["BancoEstado", "Cuenta vista", "00123456"]);

  // Documentos: el contrato de consignación acepta imagen o PDF; el CAV solo PDF.
  const doc = (clave) => rq.docs.find((d) => d.clave === clave);
  const adj = (clave, tipo) => ve(U.c1.token, "validacion.adjuntar", { id: rq.validacionId, docId: doc(clave).id, archivo: { id: `cn${++archN}abcd`, nombre: "x", tipo, tam: 1000 } });
  assert.equal((await adj("cav", "image/jpeg")).error, "archivo_solo_pdf");
  assert.equal((await adj("contrato_consignacion", "image/jpeg")).status, 200);
  assert.equal((await ve(U.c1.token, "validacion.datosDoc", { id: rq.validacionId, docId: doc("soap").id, venceEn: "2027-01-31" })).status, 200);
  assert.equal((await ve(U.c1.token, "validacion.datosDoc", { id: rq.validacionId, docId: doc("permiso_circulacion").id, venceEn: "2027-01-31" })).error, "precio_doc_invalido");

  // Con todo completo, el contrato se registra y toma la validación de documentos ya cargada.
  await cumplirRequisitosConsignacion(lead.id);
  const rq2 = await ve(U.c1.token, "consignaciones.requisitos", { leadId: lead.id });
  assert.equal(rq2.completo, true, JSON.stringify(rq2.faltantes));
  const ok = await consignar(U.c1.token, lead.id, CONTRATO(), { requisitos: false });
  assert.equal(ok.status, 200, JSON.stringify(ok));
  const vals = db.tablas.validaciones.filter((v) => v.lead_id === lead.id && v.tipo === "consignacion");
  assert.equal(vals.length, 1, "no se crea una segunda validación");
  assert.equal(vals[0].consignacion_id, ok.consignacion.id);
});

test("Consignación: el comprobante existe con el contrato registrado y trae los datos del dueño, los precios y los vencimientos", async () => {
  const lead = await leadDe(U.c1.token, "consignacion");
  const ok = await consignar(U.c1.token, lead.id, CONTRATO({ precioPiso: 8100000, precioPublicacion: 9100000, plazoDias: 45 }));
  assert.equal(ok.status, 200, JSON.stringify(ok));
  const r = await ve(U.c1.token, "consignaciones.comprobante", { id: ok.consignacion.id });
  assert.equal(r.status, 200, JSON.stringify(r));
  const n = r.comprobante;
  assert.equal(n.folio, ok.consignacion.folio);
  assert.deepEqual([n.precio_piso, n.precio_publicacion, n.plazo_dias], [8100000, 9100000, 45]);
  assert.deepEqual([n.dueno.banco, n.dueno.tipo_cuenta, n.dueno.numero_cuenta], ["BancoEstado", "Cuenta vista", "12345678"]);
  assert.equal(n.permiso.precio, 95000);
  assert.equal(n.soap.vence_en, "2027-06-30");
  assert.equal(n.documentos.length, 9);
  assert.equal((await ve(U.c2.token, "consignaciones.comprobante", { id: ok.consignacion.id })).status, 403, "quien no tiene Consignaciones no lo ve");
  // Devuelta o cancelada: ya no hay comprobante.
  assert.equal((await ve(U.c1.token, "consignaciones.cancelar", { id: ok.consignacion.id, motivo: "El dueño se arrepintió" })).status, 200);
  assert.equal((await ve(U.c1.token, "consignaciones.comprobante", { id: ok.consignacion.id })).error, "consignacion_estado_invalido");
});

test("La solicitud que llega sola por el sitio web no se edita; la que el equipo crea a mano sí", async () => {
  for (const tipo of ["compra", "consignacion"]) {
    const lead = await leadDe(U.c1.token, tipo);
    assert.equal((await ve(U.c1.token, "leads.update", { id: lead.id, lead: { notas: "ajuste" } })).status, 200, "creado a mano: se edita");
    Object.assign(fila("leads", lead.id), { creado_por: null, fuente: "Sitio web" });
    const r = await ve(U.c1.token, "leads.update", { id: lead.id, lead: { notas: "cambio" } });
    assert.deepEqual([r.status, r.error], [409, "lead_no_editable"], tipo);
  }
});

test("Consignación: el contrato para firmar se entrega con los datos del dueño completos y los precios y el plazo válidos", async () => {
  const lead = await leadDe(U.c1.token, "consignacion");
  const pedir = (datos) => ve(U.c1.token, "consignaciones.contrato", { leadId: lead.id, datos });
  const buenos = { precioPiso: 8100000, precioPublicacion: 9100000, plazoDias: 60, notas: "Llaves en el local" };
  // Sin los datos del dueño no hay contrato.
  assert.equal((await pedir(buenos)).error, "contrato_datos_incompletos");
  assert.equal((await ve(U.c1.token, "consignaciones.datosCliente", { leadId: lead.id, datos: DATOS_VENDEDOR() })).status, 200);
  // El piso debe estar aceptado por el dueño, y los precios y el plazo, bien.
  assert.equal((await pedir({ ...buenos, precioPublicacion: 8000000 })).error, "publicacion_bajo_piso");
  assert.equal((await pedir({ ...buenos, plazoDias: 5 })).error, "plazo_invalido");
  // Los documentos todavía no hacen falta: el contrato es uno de ellos.
  const ok = await pedir(buenos);
  assert.equal(ok.status, 200, JSON.stringify(ok));
  const c = ok.contrato;
  assert.deepEqual([c.precio_piso, c.precio_publicacion, c.plazo_dias], [8100000, 9100000, 60]);
  assert.equal(c.dueno.banco, "BancoEstado");
  assert.equal(c.dueno.numero_cuenta, "12345678");
  assert.ok(c.vehiculo.patente);
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === lead.id && /descargó el contrato de consignación/.test(e.detalle)));
  // Quien no tiene Consignaciones no lo pide, y un lead que no es de consignación tampoco.
  assert.equal((await ve(U.c2.token, "consignaciones.contrato", { leadId: lead.id, datos: buenos })).status, 403);
  const compra = await leadDe(U.c1.token, "compra");
  assert.equal((await ve(U.c1.token, "consignaciones.contrato", { leadId: compra.id, datos: buenos })).status, 403);
});

test("Tasador: si aplica para compra y consignación, la oferta tiene como tope el precio de consignación y el lead no cambia de tipo", async () => {
  const lead = await leadDe(U.c1.token, "compra");
  const { id, r } = await tasarCon(lead, { aplicaPara: "ambas", valorCompra: 6000000, valorConsignacion: 7000000, valorVenta: 8500000 });
  assert.equal(r.status, 200, JSON.stringify(r));
  const t = fila("tasaciones", id);
  assert.deepEqual([t.aplica_para, t.valor_compra, t.valor_consignacion, t.valor_venta], ["ambas", 6000000, 7000000, 8500000]);
  assert.equal(fila("leads", lead.id).tipo, "compra", "sigue como compra: el ejecutivo decide con el cliente");
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === lead.id && e.tipo === "tasacion" && /COMPRA y CONSIGNACIÓN/.test(e.detalle) && /\$7\.000\.000/.test(e.detalle)));
  assert.equal((await ofertar(U.c1.token, lead.id, id, 7000001)).error, "oferta_excede_tasacion");
  const ok = await ofertar(U.c1.token, lead.id, id, 7000000);
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(ok.compra.valor_tasado, 7000000);
});

/** Tasación completada del lead con la decisión del Tasador (compra, consignación, ambas o ninguna). */
async function tasarCon2(lead, borrador, token = U.c1.token) {
  const p = await ve(token, "compras.pedirTasacion", { leadId: lead.id });
  assert.equal(p.status, 200, JSON.stringify(p));
  assert.equal((await ve(U.t1.token, "tasaciones.tomar", { id: p.tasacion.id })).status, 200);
  const r = await ve(U.t1.token, "tasaciones.completar", { id: p.tasacion.id, borrador });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.tasacion;
}

test("Hacer oferta compra o consignación: la operación elegida fija el tipo del lead", async () => {
  const AMBAS = { aplicaPara: "ambas", valorCompra: 6000000, valorConsignacion: 7000000, valorVenta: 8500000 };
  // Sin tasación completada no se elige.
  const l0 = await leadDe(U.c1.token, "compra");
  assert.equal((await ve(U.c1.token, "leads.elegirOperacion", { leadId: l0.id, operacion: "consignacion" })).error, "tasacion_pendiente");
  assert.equal((await ve(U.c1.token, "leads.elegirOperacion", { leadId: l0.id, operacion: "otra" })).error, "operacion_invalida");

  // Aplica para compra y consignación: puede seguir con cualquiera de las dos.
  await tasarCon2(l0, AMBAS);
  assert.equal(fila("leads", l0.id).tipo, "compra", "el Tasador no cambia el tipo si aplica para ambas");
  const a = await ve(U.c1.token, "leads.elegirOperacion", { leadId: l0.id, operacion: "consignacion" });
  assert.equal(a.status, 200, JSON.stringify(a));
  assert.equal(fila("leads", l0.id).tipo, "consignacion");
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === l0.id && e.tipo === "tipo" && /Compra a Consignación/.test(e.detalle) && /se eligió hacer esa oferta/.test(e.detalle)));
  const b = await ve(U.c1.token, "leads.elegirOperacion", { leadId: l0.id, operacion: "compra" });
  assert.equal(b.status, 200, "mientras no haya una oferta en curso se puede cambiar de opinión");
  assert.equal(fila("leads", l0.id).tipo, "compra");

  // Con una oferta de compra en curso ya no se cambia.
  const tas = db.tablas.tasaciones.find((t) => t.lead_id === l0.id);
  assert.equal((await ofertar(U.c1.token, l0.id, tas.id, 7000000)).status, 200);
  assert.equal((await ve(U.c1.token, "leads.elegirOperacion", { leadId: l0.id, operacion: "consignacion" })).error, "operacion_en_curso");

  // Si el Tasador dejó solo compra, la consignación no se ofrece.
  const l1 = await leadDe(U.c1.token, "compra");
  await tasarCon2(l1, { aplicaPara: "compra", valorCompra: 6000000, valorVenta: 8000000 });
  assert.equal((await ve(U.c1.token, "leads.elegirOperacion", { leadId: l1.id, operacion: "consignacion" })).error, "tasacion_no_aplica_operacion");

  // Un ejecutivo sin la habilitación de la otra operación no la toma; el Jefe Local sí y el lead pasa a quien corresponde.
  const l2 = await leadDe(U.c2.token, "compra");
  await tasarCon2(l2, AMBAS, U.c2.token);
  assert.equal((await ve(U.c2.token, "leads.elegirOperacion", { leadId: l2.id, operacion: "consignacion" })).error, "operacion_no_habilitada");
  const j = await ve(U.jefe.token, "leads.elegirOperacion", { leadId: l2.id, operacion: "consignacion" });
  assert.equal(j.status, 200, JSON.stringify(j));
  assert.deepEqual([fila("leads", l2.id).tipo, fila("leads", l2.id).asignado_a], ["consignacion", U.c1.id], "pasa a Carla, que sí tiene Consignaciones");
});

test("Enviar a validar: los documentos de una compra recién entran a la cola del Validador cuando el ejecutivo los envía completos", async () => {
  await crear("vv", "Vera Validadora", "11.111.111-1", ["validador"], L1);
  try {
    const lead = await leadDe(U.c1.token, "compra");
    const tas = await tasar(lead);
    const o = await ofertar(U.c1.token, lead.id, tas.id, 6000000);
    assert.equal(o.status, 200, JSON.stringify(o));
    // Los documentos se cargan desde que se hace la oferta.
    const rq = await ve(U.c1.token, "compras.requisitos", { id: o.compra.id });
    assert.equal(rq.status, 200, JSON.stringify(rq));
    const val = () => db.tablas.validaciones.find((v) => v.id === rq.validacionId);
    assert.equal(val().enviada_en, null, "nace sin enviar");
    // El Validador no la ve en su cola ni puede tomarla.
    const cola = await ve(U.vv.token, "validacion.list", { vista: "cola" });
    assert.ok(!cola.validaciones.some((v) => v.id === rq.validacionId));
    assert.equal((await ve(U.vv.token, "validacion.tomar", { id: rq.validacionId })).error, "validacion_sin_enviar");
    // Incompleta: no se envía.
    assert.equal((await ve(U.c1.token, "validacion.enviar", { id: rq.validacionId })).error, "envio_incompleto");
    // Aceptada la oferta y completo todo, aún hay que enviar a validar antes de pedir el pago.
    assert.equal((await ve(U.c1.token, "compras.responder", { id: o.compra.id, acepta: true })).status, 200);
    assert.equal(db.tablas.validaciones.filter((v) => v.compra_id === o.compra.id).length, 1, "no se crea una segunda validación al aceptar");
    await cumplirRequisitos(o.compra.id);
    assert.equal((await ve(U.c1.token, "compras.solicitarPago", { id: o.compra.id, datos: PAGO() })).error, "validacion_sin_enviar");
    // Solo quien gestiona el lead (o el supervisor) la envía.
    assert.equal((await ve(U.c2.token, "validacion.enviar", { id: rq.validacionId })).status, 404);
    const env = await ve(U.c1.token, "validacion.enviar", { id: rq.validacionId });
    assert.equal(env.status, 200, JSON.stringify(env));
    assert.ok(val().enviada_en);
    assert.equal((await ve(U.c1.token, "validacion.enviar", { id: rq.validacionId })).error, "validacion_ya_enviada");
    // Ahora sí está en la cola y se puede tomar.
    assert.ok((await ve(U.vv.token, "validacion.list", { vista: "cola" })).validaciones.some((v) => v.id === rq.validacionId));
    assert.equal((await ve(U.vv.token, "validacion.tomar", { id: rq.validacionId })).status, 200);
    assert.equal((await ve(U.c1.token, "compras.solicitarPago", { id: o.compra.id, datos: PAGO() })).status, 200);
  } finally {
    fila("usuarios", U.vv.id).activo = false; // los demás flujos de este archivo no tienen Validadores
    db.tablas.validaciones.forEach((v) => { if (!v.enviada_en) v.enviada_en = new Date().toISOString(); });
  }
});

test("Enviar a validar: al registrar el contrato de consignación la validación queda enviada", async () => {
  const lead = await leadDe(U.c1.token, "consignacion");
  const ok = await consignar(U.c1.token, lead.id);
  assert.equal(ok.status, 200, JSON.stringify(ok));
  const val = db.tablas.validaciones.find((v) => v.consignacion_id === ok.consignacion.id);
  assert.ok(val && val.enviada_en, "queda enviada al registrar el contrato");
});
