// Sitio web público: catálogo, detalle, fotos y solicitudes de visitantes sin iniciar sesión,
// contra la función real y una base falsa en memoria.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";
import { cuotaEstimada } from "../supabase/functions/api/ventas-core.js";

const pub = (op, extra = {}) => api({ action: "public", op, ...extra });
const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1; let L2;
let n = 0;
const sol = (tipo, extra = {}) => pub("solicitud", { tipo, nombre: "Pedro Soto", telefono: `9${String(80000000 + ++n)}`, email: "pedro@correo.cl", mensaje: "Hola", acepta: true, abiertoEn: Date.now() - 10_000, web: "", ...extra });

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}
async function vehiculo(extra = {}) {
  const r = await ve(U.jefe.token, "inventario.save", { datos: { patente: `WB${String(1000 + ++n)}`, marca: "Hyundai", modelo: "Venue", anio: 2023, km: 56000, precioLista: 12480000, costo: 10000000, color: "Blanco", transmision: "Automática", ...extra } });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.vehiculo;
}
const leadsWeb = () => db.tablas.leads.filter((l) => l.fuente === "Sitio web");

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  L2 = (await crm(admin, "locales.create", { nombre: "Sucursal Sur" })).local.id;
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1, { otorgar: ["ventas.operar"], quitar: [] });
  await crear("e2", "Ema Dos", "7.654.321-6", ["ejecutivo"], L1, { otorgar: ["ventas.operar"], quitar: [] });
  await crear("t1", "Tito Tasador", "5.555.555-9", ["tasador"], L1);
});

test("Catálogo: disponibles y reservados; sin patente, costo ni vehículos que no corresponden", async () => {
  const disp = await vehiculo();
  const res = await vehiculo({ marca: "Kia", modelo: "Rio" });
  db.tablas.vehiculos.find((v) => v.id === res.id).estado = "reservado";
  const prep = await vehiculo({ estado: "preparacion" });
  const vend = await vehiculo();
  db.tablas.vehiculos.find((v) => v.id === vend.id).estado = "vendido";
  const arch = await vehiculo();
  db.tablas.vehiculos.find((v) => v.id === arch.id).activo = false;
  U.disp = disp; U.res = res; U.prep = prep;

  nuevaIp();
  const r = await pub("catalogo");
  assert.equal(r.status, 200, JSON.stringify(r));
  const ids = r.vehiculos.map((v) => v.id);
  assert.ok(ids.includes(disp.id) && ids.includes(res.id));
  assert.ok(![prep.id, vend.id, arch.id].some((id) => ids.includes(id)));
  assert.equal(r.vehiculos.find((v) => v.id === res.id).reservado, true);
  assert.equal(r.vehiculos.find((v) => v.id === disp.id).reservado, false);
  const texto = JSON.stringify(r);
  assert.ok(!/WB10|costo|10000000|patente|notas/i.test(texto), "nada interno sale al público");
  assert.equal(r.vehiculos.find((v) => v.id === disp.id).precio, 12480000);
  assert.deepEqual(r.locales.map((l) => l.nombre), ["Casa matriz"], "solo locales con vehículos a la vista");
  assert.equal(r.empresa.nombre, "Drive Futuro");
  assert.equal(r.empresa.tasaMensual, 1.5);
});

test("Detalle: descripción sin patente; los no visibles dan 404", async () => {
  nuevaIp();
  const d = await pub("vehiculo", { id: U.disp.id });
  assert.equal(d.status, 200);
  assert.match(d.vehiculo.descripcion, /Hyundai Venue 2023/);
  assert.ok(!/WB10|patente/i.test(JSON.stringify(d)));
  assert.equal(d.local.nombre, "Casa matriz");
  assert.equal((await pub("vehiculo", { id: U.prep.id })).status, 404);
  assert.equal((await pub("vehiculo", { id: randomUUID() })).status, 404);
  // Si el Anunciante armó un aviso, se usa su texto.
  db.tablas.anuncios.push({ id: randomUUID(), vehiculo_id: U.disp.id, estado: "publicado", titulo: "t", descripcion: "Único dueño, mantenciones al día." });
  assert.match((await pub("vehiculo", { id: U.disp.id })).vehiculo.descripcion, /Único dueño/);
});

test("Fotos: solo las de un vehículo visible y que estén en su lista", async () => {
  const foto = "abcdef123456";
  db.tablas.vehiculos.find((v) => v.id === U.disp.id).fotos = [foto];
  db.tablas.vehiculos.find((v) => v.id === U.prep.id).fotos = [foto];
  db.tablas.kv_store.push({ key: `vfoto::${U.disp.id}::${foto}`, value: "data:image/jpeg;base64,AAA" }, { key: `vfoto::${U.prep.id}::${foto}`, value: "data:image/jpeg;base64,BBB" });
  nuevaIp();
  assert.equal((await pub("foto", { vehiculoId: U.disp.id, fotoId: foto })).value, "data:image/jpeg;base64,AAA");
  assert.equal((await pub("foto", { vehiculoId: U.prep.id, fotoId: foto })).status, 404, "vehículo no visible");
  assert.equal((await pub("foto", { vehiculoId: U.disp.id, fotoId: "otra123456" })).status, 404, "foto que no es de ese vehículo");
  assert.equal((await pub("catalogo")).vehiculos.find((v) => v.id === U.disp.id).fotos[0], foto);
});

test("Consulta por un vehículo: crea cliente y lead «Sitio web», repartido a un ejecutivo", async () => {
  nuevaIp();
  const antes = leadsWeb().length;
  const r = await sol("consulta", { vehiculoId: U.disp.id, mensaje: "¿Sigue disponible?" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.ok, true);
  assert.equal(leadsWeb().length, antes + 1);
  const l = leadsWeb()[leadsWeb().length - 1];
  assert.equal(l.fuente, "Sitio web");
  assert.equal(l.tipo, "venta");
  assert.equal(l.etapa, "nuevo");
  assert.equal(l.vehiculo_id, U.disp.id);
  assert.equal(l.local_id, L1);
  assert.ok([U.e1.id, U.e2.id].includes(l.asignado_a), "se reparte entre los ejecutivos habilitados");
  assert.match(l.notas, /Consulta por Hyundai Venue 2023.*Mensaje: ¿Sigue disponible\?/);
  const cli = db.tablas.clientes.find((c) => c.id === l.cliente_id);
  assert.equal(cli.nombre, "Pedro Soto");
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === l.id && /Lead creado desde el sitio web/.test(e.detalle)));
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "web.solicitud" && b.actor_tipo === "sistema"));
  // El ejecutivo lo ve en su lista (sin haber iniciado sesión el visitante).
  const mias = await ve(l.asignado_a === U.e1.id ? U.e1.token : U.e2.token, "leads.list", {});
  assert.ok(mias.leads.some((x) => x.id === l.id));
});

test("El reparto es rotativo entre los ejecutivos", async () => {
  nuevaIp();
  const a = [];
  for (let i = 0; i < 4; i++) { await sol("consulta", { vehiculoId: U.disp.id }); a.push(leadsWeb()[leadsWeb().length - 1].asignado_a); }
  const cuenta = (id) => a.filter((x) => x === id).length;
  assert.ok(cuenta(U.e1.id) >= 1 && cuenta(U.e2.id) >= 1, JSON.stringify(a));
});

test("Un vehículo reservado se puede consultar; uno no visible, no", async () => {
  nuevaIp();
  assert.equal((await sol("consulta", { vehiculoId: U.res.id })).status, 200);
  const r = await sol("consulta", { vehiculoId: U.prep.id });
  assert.equal(r.error, "vehiculo_no_disponible");
  assert.equal(r.status, 409);
  assert.equal((await sol("consulta", { vehiculoId: randomUUID() })).error, "vehiculo_no_disponible");
});

test("Validaciones: consentimiento, teléfono, nombre y vehículo", async () => {
  nuevaIp();
  const antes = leadsWeb().length;
  assert.equal((await sol("consulta", { vehiculoId: U.disp.id, acepta: false })).error, "consentimiento_requerido");
  assert.equal((await sol("consulta", { vehiculoId: U.disp.id, telefono: "12" })).error, "telefono_invalido");
  assert.equal((await sol("consulta", { vehiculoId: U.disp.id, nombre: "A" })).error, "nombre_invalido");
  assert.equal((await sol("consulta", {})).error, "vehiculo_requerido");
  assert.equal((await sol("otra", { vehiculoId: U.disp.id })).error, "tipo_invalido");
  assert.equal((await sol("consulta", { vehiculoId: U.disp.id, abiertoEn: Date.now() - 6 * 3_600_000 - 5000 })).error, "formulario_vencido");
  assert.equal(leadsWeb().length, antes, "nada se creó");
});

test("Anti-spam: el campo trampa y el envío instantáneo responden «ok» sin crear nada", async () => {
  nuevaIp();
  const antes = leadsWeb().length;
  const a = await sol("consulta", { vehiculoId: U.disp.id, web: "http://spam.example" });
  assert.equal(a.status, 200);
  assert.equal(a.ok, true);
  const b = await sol("consulta", { vehiculoId: U.disp.id, abiertoEn: Date.now() - 200 });
  assert.equal(b.status, 200);
  assert.equal(leadsWeb().length, antes, "ninguno de los dos creó un lead");
});

test("Anti-spam: máximo de solicitudes por teléfono en una hora", async () => {
  const tel = "955500011";
  const r = [];
  for (let i = 0; i < 4; i++) { nuevaIp(); r.push(await sol("consulta", { vehiculoId: U.disp.id, telefono: tel })); }
  assert.deepEqual(r.map((x) => x.status), [200, 200, 200, 429], JSON.stringify(r.map((x) => x.error)));
  assert.equal(r[3].error, "demasiadas_solicitudes");
  assert.equal(db.tablas.clientes.filter((c) => c.telefono === tel).length, 1, "el teléfono reutiliza al mismo cliente");
});

test("Anti-spam: máximo de solicitudes por dirección IP en una hora", async () => {
  nuevaIp();
  const res = [];
  for (let i = 0; i < 10; i++) res.push((await sol("consulta", { vehiculoId: U.disp.id })).status);
  assert.deepEqual(res.slice(0, 8), Array(8).fill(200));
  assert.deepEqual(res.slice(8), [429, 429], "desde la novena, el servidor frena esa IP");
  nuevaIp();
  assert.equal((await sol("consulta", { vehiculoId: U.disp.id })).status, 200, "otra IP no se ve afectada");
});

test("Agendar una visita: queda en la agenda del ejecutivo", async () => {
  nuevaIp();
  const fecha = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const r = await sol("visita", { vehiculoId: U.disp.id, fechaHora: fecha });
  assert.equal(r.status, 200, JSON.stringify(r));
  const l = leadsWeb()[leadsWeb().length - 1];
  const t = db.tablas.tareas.find((x) => x.lead_id === l.id);
  assert.ok(t, "se creó la tarea");
  assert.equal(t.tipo, "visita");
  assert.equal(t.asignado_a, l.asignado_a);
  assert.equal(Date.parse(t.vence_en), Date.parse(fecha));
  assert.match(t.titulo, /Visita pedida por el sitio web: Hyundai Venue 2023/);
  assert.equal((await sol("visita", { vehiculoId: U.disp.id, fechaHora: "ayer" })).error, "fecha_invalida");
  assert.equal((await sol("visita", { vehiculoId: U.disp.id, fechaHora: new Date(Date.now() - 5 * 86_400_000).toISOString() })).error, "fecha_invalida");
});

test("Cotizar financiamiento: el lead guarda el pie y recibe la cuota referencial", async () => {
  nuevaIp();
  const r = await sol("financiamiento", { vehiculoId: U.disp.id, pie: 3000000, plazo: 48 });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.cuota.montoFinanciar, 9480000);
  assert.equal(r.cuota.cuota, cuotaEstimada(9480000, 48, 1.5));
  const l = leadsWeb()[leadsWeb().length - 1];
  assert.equal(l.financiamiento.quiere, true);
  assert.equal(l.financiamiento.pie, 3000000);
  assert.equal(l.financiamiento.estado, "por_evaluar");
  assert.match(l.notas, /Cuota referencial: \$[\d.]+ por mes.*Sujeta a evaluación/);
  // La tasa sale de la configuración.
  assert.equal((await crm(admin, "config.set", { clave: "tasa_mensual_web", valor: 2 })).status, 200);
  nuevaIp();
  assert.equal((await sol("financiamiento", { vehiculoId: U.disp.id, pie: 3000000, plazo: 48 })).cuota.cuota, cuotaEstimada(9480000, 48, 2));
  assert.equal((await sol("financiamiento", { vehiculoId: U.disp.id, pie: "", plazo: 48 })).error, "pie_invalido");
  assert.equal((await sol("financiamiento", { vehiculoId: U.disp.id, pie: 0, plazo: 7 })).error, "plazo_invalido");
});

test("Vender o consignar: lead de compra o consignación y una tasación esperando al Tasador", async () => {
  nuevaIp();
  const datos = { patente: "ab-cd 12", marca: "Toyota", modelo: "Yaris", anio: 2018, km: 78000 };
  const r = await sol("vender", { ...datos, modalidad: "consignar", localId: L1 });
  assert.equal(r.status, 200, JSON.stringify(r));
  const l = leadsWeb()[leadsWeb().length - 1];
  assert.equal(l.tipo, "consignacion");
  assert.match(l.vehiculo_interes, /CONSIGNA: Toyota Yaris 2018 · ABCD12/);
  assert.equal(l.vehiculo_id ?? null, null);
  const t = db.tablas.tasaciones.find((x) => x.patente === "ABCD12");
  assert.ok(t, "se creó la tasación");
  assert.equal(t.estado, "pendiente");
  assert.equal(t.tipo, "directa");
  assert.equal(t.contacto.nombre, "Pedro Soto");
  assert.equal(t.lead_id ?? null, null, "no se liga al lead para no tocar su parte de pago");
  // El Tasador la ve en su cola.
  const cola = await ve(U.t1.token, "tasaciones.list", { vista: "cola" });
  assert.ok(cola.tasaciones.some((x) => x.id === t.id));
  nuevaIp();
  assert.equal((await sol("vender", { ...datos, patente: "12", modalidad: "vender", localId: L1 })).error, "patente_invalida");
  assert.equal((await sol("vender", { ...datos, km: "", modalidad: "vender", localId: L1 })).error, "km_invalido");
  assert.equal((await sol("vender", { ...datos, patente: "ZZZZ11", modalidad: "vender", localId: L1 })).status, 200);
  assert.equal(leadsWeb()[leadsWeb().length - 1].tipo, "compra");
});

test("Sin ejecutivos habilitados el lead queda sin asignar; con varios locales hay que elegir uno", async () => {
  nuevaIp();
  // Local 2 sin personal: se crea un vehículo allí.
  const vSur = (await ve(admin, "inventario.save", { localId: L2, datos: { patente: "SURS11", marca: "Kia", modelo: "Rio", anio: 2020, km: 1, precioLista: 7000000, costo: 5000000 } })).vehiculo;
  assert.equal((await sol("consulta", { vehiculoId: vSur.id })).status, 200);
  const l = leadsWeb()[leadsWeb().length - 1];
  assert.equal(l.local_id, L2);
  assert.equal(l.asignado_a ?? null, null);
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === l.id && /sin ejecutivos habilitados/.test(e.detalle)));
  // Dos locales y sin vehículo: se debe indicar cuál.
  nuevaIp();
  const datos = { patente: "QQQQ11", marca: "Mazda", modelo: "3", anio: 2019, km: 50000, modalidad: "vender" };
  assert.equal((await sol("vender", datos)).error, "sin_local");
  assert.equal((await sol("vender", { ...datos, localId: L2 })).status, 200);
  assert.equal(leadsWeb()[leadsWeb().length - 1].local_id, L2);
});

test("El freno general por local corta una avalancha de solicitudes", async () => {
  const hace = new Date().toISOString();
  for (let i = 0; i < 60; i++) db.tablas.leads.push({ id: randomUUID(), local_id: L1, fuente: "Sitio web", creado_en: hace, etapa: "nuevo", cliente_id: null, asignado_a: null });
  nuevaIp();
  const r = await sol("consulta", { vehiculoId: U.disp.id });
  assert.equal(r.status, 429);
  assert.equal(r.error, "demasiadas_solicitudes");
});

test("Operación desconocida y datos del sitio en la configuración", async () => {
  nuevaIp();
  assert.equal((await pub("nada")).error, "unknown_op");
  assert.equal((await crm(admin, "config.set", { clave: "sitio_whatsapp", valor: "+56 9 8765 4321" })).status, 200);
  assert.equal((await crm(admin, "config.set", { clave: "sitio_whatsapp", valor: "hola" })).status, 400);
  assert.equal((await crm(admin, "config.set", { clave: "sitio_nombre", valor: "Autos del Sur" })).status, 200);
  const r = await pub("catalogo");
  assert.equal(r.empresa.whatsapp, "56987654321");
  assert.equal(r.empresa.nombre, "Autos del Sur");
});
