// Reparto automático y rotativo de los leads que llegan por el sitio web:
// ventas -> solo ejecutivos con «Ventas»; compras y consignaciones -> solo con «Compras» o «Consignaciones», cada grupo rota por separado.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";

const CLAVE = "Prueba12345";
const U = {};
let admin; let L; let n = 0;

async function crearEje(clave, nombre, rut, habilitaciones) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles: ["ejecutivo"], localId: L, extra: { otorgar: habilitaciones, quitar: habilitaciones.includes("ventas.operar") ? [] : ["ventas.operar"] } }, clave: CLAVE });
  assert.equal(r.status, 200, JSON.stringify(r));
  U[clave] = r.usuario.id;
}
const nombreDe = (id) => Object.entries(U).find(([, v]) => v === id)?.[0] ?? "(sin asignar)";
const pub = (extra) => api({ action: "public", op: "solicitud", nombre: "Visitante Web", codigoPais: "56", telefono: `9${String(60000000 + ++n)}`, email: "v@correo.cl", mensaje: "Hola, quiero información", acepta: true, abiertoEn: Date.now() - 10_000, web: "", localId: L, ...extra });
const ultimoLead = () => db.tablas.leads.filter((l) => l.fuente === "Sitio web").at(-1);
async function pedir(tipo, extra = {}) {
  nuevaIp();
  const r = await pub({ tipo, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r));
  return ultimoLead();
}
const consulta = (veh) => pedir("consulta", { vehiculoId: veh });
const vender = (modalidad) => pedir("vender", { modalidad, patente: `ZX${String(1000 + ++n)}`, marca: "Kia", modelo: "Rio", anio: 2019, km: 50000, duenos: 1, prenda: "no", mantenciones: "si", precioEsperado: 7000000 });
const conteo = (leads) => leads.reduce((m, l) => { const k = nombreDe(l.asignado_a); m[k] = (m[k] || 0) + 1; return m; }, {});

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  await crearEje("ventasYcompras", "Ana Ventas y Compras", "6.000.000-K", ["ventas.operar", "compras.operar"]);
  await crearEje("soloVentas", "Beto Solo Ventas", "7.654.321-6", ["ventas.operar"]);
  await crearEje("comprasYconsig", "Carla Compras y Consig", "9.876.543-3", ["compras.operar", "consignaciones.operar"]);
  await crearEje("soloConsig", "Dani Solo Consig", "8.765.432-K", ["consignaciones.operar"]);
  await crearEje("sinNada", "Eli Sin Habilitaciones", "13.000.000-2", []);
  // Un vehículo del inventario para las consultas.
  const jefe = await crm(admin, "usuarios.create", { datos: { nombre: "Julia Jefa", rut: "14.000.000-0", roles: ["jefe_local"], localId: L }, clave: CLAVE });
  nuevaIp();
  const tok = (await api({ action: "userLogin", rut: "14.000.000-0", password: CLAVE })).token;
  const v = await api({ action: "ventas", token: tok, op: "inventario.save", datos: { patente: "WB1001", marca: "Hyundai", modelo: "Venue", anio: 2023, km: 56000, precioLista: 12480000, costo: 10000000, color: "Blanco", transmision: "Automática" } });
  U.vehiculo = v.vehiculo.id;
  assert.ok(jefe.usuario);
});

test("Ventas (consulta, visita, financiamiento): solo a quienes tienen Ventas, uno tras otro, al que lleva más tiempo sin recibir", async () => {
  const leads = [];
  for (let i = 0; i < 6; i++) leads.push(await consulta(U.vehiculo));
  const quienes = leads.map((l) => nombreDe(l.asignado_a));
  assert.ok(quienes.every((q) => ["ventasYcompras", "soloVentas"].includes(q)), `solo con Ventas: ${quienes}`);
  assert.deepEqual(conteo(leads), { ventasYcompras: 3, soloVentas: 3 });
  for (let i = 1; i < quienes.length; i++) assert.notEqual(quienes[i], quienes[i - 1], "se alterna: nunca el mismo dos veces seguidas");
  // Visita y financiamiento entran al mismo reparto.
  const visita = await pedir("visita", { vehiculoId: U.vehiculo, fechaHora: new Date(Date.now() + 2 * 86_400_000).toISOString() });
  const fin = await pedir("financiamiento", { vehiculoId: U.vehiculo, pie: 1000000, plazo: 48 });
  for (const l of [visita, fin]) assert.ok(["ventasYcompras", "soloVentas"].includes(nombreDe(l.asignado_a)));
  assert.notEqual(visita.asignado_a, fin.asignado_a, "siguen alternando");
  assert.ok(leads.every((l) => l.tipo === "venta"));
});

test("Compras: solo a quienes tienen Compras; consignaciones: solo a quienes tienen Consignaciones", async () => {
  const compras = [];
  for (let i = 0; i < 4; i++) compras.push(await vender("vender"));
  assert.ok(compras.every((l) => l.tipo === "compra"));
  assert.ok(compras.every((l) => ["ventasYcompras", "comprasYconsig"].includes(nombreDe(l.asignado_a))), `compras: ${compras.map((l) => nombreDe(l.asignado_a))}`);
  const consig = [];
  for (let i = 0; i < 4; i++) consig.push(await vender("consignar"));
  assert.ok(consig.every((l) => l.tipo === "consignacion"));
  assert.ok(consig.every((l) => ["comprasYconsig", "soloConsig"].includes(nombreDe(l.asignado_a))), `consignaciones: ${consig.map((l) => nombreDe(l.asignado_a))}`);
  for (const nombre of ["soloVentas", "sinNada"]) assert.ok(![...compras, ...consig].some((l) => nombreDe(l.asignado_a) === nombre), `${nombre} no recibe compras ni consignaciones`);
  assert.ok(![...compras, ...consig].some((l) => nombreDe(l.asignado_a) === "soloConsig" && l.tipo === "compra"), "quien solo consigna no recibe compras");
});

test("Cada grupo rota por separado: recibir un lead de venta no quita el turno de los de compra", async () => {
  // «Ana» ya recibió leads de venta hace un momento; aun así debe repartirse parejo entre las compras con Carla.
  const compras = [];
  for (let i = 0; i < 6; i++) compras.push(await vender("vender"));
  const c = conteo(compras);
  assert.equal(c.ventasYcompras, 3, JSON.stringify(c));
  assert.equal(c.comprasYconsig, 3, JSON.stringify(c));
  const quienes = compras.map((l) => nombreDe(l.asignado_a));
  for (let i = 1; i < quienes.length; i++) assert.notEqual(quienes[i], quienes[i - 1]);
  // Y a la inversa: tras varias compras, las ventas siguen alternando entre sus dos habilitados.
  const ventas = [await consulta(U.vehiculo), await consulta(U.vehiculo)];
  assert.notEqual(ventas[0].asignado_a, ventas[1].asignado_a);
});

test("Cambiar mi auto por otro (renovar): es un lead de venta y rota con el resto de las ventas", async () => {
  const renovar = () => pedir("renovar", { vehiculoId: U.vehiculo, patente: `RN${String(1000 + ++n)}`, marca: "Kia", modelo: "Rio", anio: 2016, km: 90000, duenos: 2, prenda: "no", mantenciones: "no", precioEsperado: 4000000 });
  const seguidos = [await consulta(U.vehiculo), await renovar(), await consulta(U.vehiculo), await renovar()];
  assert.ok(seguidos.every((l) => l.tipo === "venta"));
  assert.ok(seguidos.every((l) => ["ventasYcompras", "soloVentas"].includes(nombreDe(l.asignado_a))), "solo con Ventas");
  const q = seguidos.map((l) => nombreDe(l.asignado_a));
  for (let i = 1; i < q.length; i++) assert.notEqual(q[i], q[i - 1], "alterna con las consultas");
  assert.equal(seguidos[1].parte_pago.tiene, true);
});

test("Si nadie está habilitado para ese tipo, el lead queda sin asignar (y no va a quien no corresponde)", async () => {
  // Se le quita Consignaciones a quienes la tenían.
  for (const id of [U.comprasYconsig, U.soloConsig]) {
    const u = db.tablas.usuarios.find((x) => x.id === id);
    u.permisos_extra = { otorgar: (u.permisos_extra.otorgar || []).filter((p) => p !== "consignaciones.operar"), quitar: [] };
  }
  const l = await vender("consignar");
  assert.equal(l.asignado_a ?? null, null);
  assert.equal(l.tipo, "consignacion");
});

test("Una persona desactivada no recibe leads", async () => {
  await crm(admin, "usuarios.setActivo", { id: U.soloVentas, activo: false });
  const leads = [];
  for (let i = 0; i < 3; i++) leads.push(await consulta(U.vehiculo));
  assert.ok(leads.every((l) => l.asignado_a === U.ventasYcompras), "solo queda Ana con Ventas activa");
});
