// Avisos por correo de los eventos del CRM y del sitio web, contra la función real con el envío simulado.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, correos, db } from "./helpers/api-env.mjs";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const pub = (op, extra = {}) => api({ action: "public", op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1; let n = 0;
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const VEH = { patente: "ABCD12", marca: "Toyota", modelo: "Yaris", anio: 2018, km: 78000, version: "1.5 GLI", transmision: "Automática", combustible: "Bencina" };

async function crear(clave, nombre, rut, roles, extra, email = `${clave}@prueba.cl`) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId: L1, extra, email }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}
const vaciar = () => { correos.length = 0; };
/** Destinatarios y asuntos de los correos enviados desde la última vez. */
const enviados = () => correos.map((c) => `${c.to[0]} | ${c.subject}`);
const nuevoLead = (token, extra = {}) => ve(token, "leads.create", { cliente: { nombre: `Cliente ${++n}`, telefono: `9${String(20000000 + n)}` }, lead: {}, ...extra });
async function vehiculo(precio = 10000000) {
  const r = await ve(U.jefe.token, "inventario.save", { datos: { patente: `WB${String(1000 + ++n)}`, marca: "Hyundai", modelo: "Venue", anio: 2023, km: 56000, precioLista: precio, costo: 8500000, color: "Blanco", transmision: "Automática" } });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.vehiculo;
}

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"]);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], { otorgar: ["ventas.operar"], quitar: [] });
  await crear("e2", "Ema Dos", "7.654.321-6", ["ejecutivo"], { otorgar: ["ventas.operar"], quitar: [] });
  await crear("t1", "Tito Tasador", "5.555.555-9", ["tasador"]);
});

test("Lead nuevo: avisa al ejecutivo asignado (no a quien lo crea) y al reasignar", async () => {
  vaciar();
  const l = (await nuevoLead(U.jefe.token, { asignarA: U.e1.id })).lead;
  assert.deepEqual(enviados(), ["e1@prueba.cl | Nuevo lead asignado"]);
  assert.equal(correos[0].from, "Drive Futuro <avisos@prueba.cl>");
  assert.ok(correos[0].html.includes("https://app.prueba.cl/plataforma"));
  vaciar();
  assert.equal((await nuevoLead(U.e1.token)).status, 200);
  assert.deepEqual(enviados(), [], "quien crea su propio lead no recibe aviso");
  assert.equal((await ve(U.jefe.token, "leads.reasignar", { id: l.id, asignarA: U.e2.id })).status, 200);
  assert.deepEqual(enviados(), ["e2@prueba.cl | Nuevo lead asignado"]);
});

test("Descuento: el Jefe Local recibe el aviso por aprobar y el ejecutivo, el resultado", async () => {
  const l = (await nuevoLead(U.e1.token)).lead;
  const v = await vehiculo();
  vaciar();
  const c = await ve(U.e1.token, "cotizaciones.save", { leadId: l.id, vehiculoId: v.id, datos: { descuento: 300000 } });
  assert.equal(c.status, 200, JSON.stringify(c));
  assert.equal(c.cotizacion.estado, "pendiente");
  assert.deepEqual(enviados(), ["jefe@prueba.cl | Descuento por aprobar"]);
  vaciar();
  assert.equal((await ve(U.jefe.token, "cotizaciones.aprobar", { id: c.cotizacion.id })).status, 200);
  assert.deepEqual(enviados(), ["e1@prueba.cl | Descuento aprobado"]);
  const c2 = await ve(U.e1.token, "cotizaciones.save", { leadId: l.id, id: c.cotizacion.id, vehiculoId: v.id, datos: { descuento: 500000 } });
  assert.equal(c2.cotizacion.estado, "pendiente");
  vaciar();
  assert.equal((await ve(U.jefe.token, "cotizaciones.rechazar", { id: c.cotizacion.id, motivo: "Margen muy bajo" })).status, 200);
  assert.deepEqual(enviados(), ["e1@prueba.cl | Descuento rechazado"]);
  assert.ok(correos[0].text.includes("Margen muy bajo"));
});

test("Cierre de venta: avisa a quien aprueba y luego al ejecutivo", async () => {
  const l = (await nuevoLead(U.e1.token)).lead;
  const v = await vehiculo();
  const cot = (await ve(U.e1.token, "cotizaciones.save", { leadId: l.id, vehiculoId: v.id, datos: {} })).cotizacion;
  assert.ok((await ve(U.e1.token, "reservas.crear", { cotizacionId: cot.id, monto: 500000 })).reserva);
  vaciar();
  const c = await ve(U.e1.token, "cierres.crear", { leadId: l.id, datos: { precioFinal: 9800000, montoParteDePago: 0, montoFinanciado: 0, fechaEntrega: hoy() } });
  assert.equal(c.status, 200, JSON.stringify(c));
  assert.deepEqual(enviados(), ["jefe@prueba.cl | Cierre de venta por aprobar"]);
  vaciar();
  assert.equal((await ve(U.jefe.token, "cierres.aprobar", { id: c.cierre.id })).status, 200);
  assert.deepEqual(enviados(), ["e1@prueba.cl | Cierre de venta aprobado"]);
});

test("Tasación completada: avisa a quien la pidió", async () => {
  const l = (await nuevoLead(U.e1.token)).lead;
  const t = (await ve(U.e1.token, "tasaciones.pedir", { leadId: l.id, datos: { vehiculo: { ...VEH, patente: `TT${String(1000 + ++n)}` } } })).tasacion;
  assert.ok(t);
  assert.equal((await ve(U.t1.token, "tasaciones.tomar", { id: t.id })).status, 200);
  vaciar();
  assert.equal((await ve(U.t1.token, "tasaciones.completar", { id: t.id, borrador: { aplicaPara: "compra", valorCompra: 5000000, valorVenta: 6000000 } })).status, 200);
  assert.deepEqual(enviados(), ["e1@prueba.cl | Tasación completada"]);
});

test("Sitio web: avisa al ejecutivo asignado y confirma al cliente; sin correo del cliente, solo al ejecutivo", async () => {
  const sol = (extra = {}) => pub("solicitud", { tipo: "consulta", nombre: "Pedro <b>Soto</b>", telefono: `9${String(70000000 + ++n)}`, email: "pedro@correo.cl", mensaje: "Hola", acepta: true, abiertoEn: Date.now() - 10_000, web: "", ...extra });
  const web = await vehiculo();
  vaciar();
  const r = await sol({ vehiculoId: web.id });
  assert.equal(r.status, 200, JSON.stringify(r));
  const para = enviados().map((x) => x.split(" | ")[0]).sort();
  assert.equal(para.length, 2);
  assert.ok(para.includes("pedro@correo.cl"));
  assert.ok(para.some((x) => x === "e1@prueba.cl" || x === "e2@prueba.cl"));
  const alCliente = correos.find((c) => c.to[0] === "pedro@correo.cl");
  assert.equal(alCliente.subject, "Recibimos tu solicitud");
  assert.ok(!alCliente.html.includes("<b>Soto</b>"), "el nombre va escapado");
  vaciar();
  assert.equal((await sol({ email: "", vehiculoId: web.id })).status, 200);
  assert.equal(enviados().length, 1);
  assert.ok(!enviados()[0].startsWith("pedro@"));
});

test("Si el envío falla o la persona no tiene correo, la operación sigue igual", async () => {
  await crear("sinmail", "Sara Sinmail", "8.765.432-K", ["ejecutivo"], { otorgar: ["ventas.operar"], quitar: [] }, "");
  vaciar();
  const r = await nuevoLead(U.jefe.token, { asignarA: U.sinmail.id });
  assert.equal(r.status, 200);
  assert.deepEqual(enviados(), []);
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "aviso.omitido"), "queda anotado que no había correo");
  const antes = globalThis.fetch;
  globalThis.fetch = async (u, i) => (String(u).includes("resend") ? new Response("no", { status: 500 }) : antes(u, i));
  try {
    assert.equal((await nuevoLead(U.jefe.token, { asignarA: U.e1.id })).status, 200, "un fallo del correo no rompe la creación");
    assert.ok(db.tablas.bitacora.some((b) => b.accion === "aviso.fallido" && JSON.stringify(b.detalle).includes("500")), "el fallo queda en la bitácora");
  } finally { globalThis.fetch = antes; }
});
