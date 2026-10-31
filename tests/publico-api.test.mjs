// Sitio web público: catálogo, detalle, fotos y solicitudes de visitantes sin iniciar sesión,
// contra la función real y una base falsa en memoria.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db, correos } from "./helpers/api-env.mjs";
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

test("Vender, consignar o cambiar: los Tasadores con correo reciben el aviso de la tasación; los demás no", async () => {
  db.tablas.usuarios.find((u) => u.id === U.t1.id).email = "tito@tasa.cl";
  nuevaIp();
  const datos = { patente: "TTTT11", marca: "Kia", modelo: "Rio", anio: 2020, km: 30000, transmision: "Automática", combustible: "Bencina", duenos: 1, prenda: "no", mantenciones: "si", precioEsperado: 7000000, modalidad: "consignar", localId: L1 };
  correos.length = 0;
  assert.equal((await sol("vender", datos)).status, 200);
  const aTasador = correos.filter((c) => c.to.includes("tito@tasa.cl"));
  assert.equal(aTasador.length, 1);
  assert.match(aTasador[0].html, /Nueva tasación del sitio web/);
  assert.match(aTasador[0].html, /consignar/);
  assert.match(aTasador[0].html, /Kia Rio 2020/);
  assert.equal(correos.filter((c) => c.to.includes("tito@tasa.cl") && /Nuevo lead/.test(c.subject || "")).length, 0, "el Tasador no recibe el aviso del lead");
  correos.length = 0;
  nuevaIp();
  assert.equal((await sol("consulta", { vehiculoId: U.disp.id, mensaje: "¿Sigue disponible?" })).status, 200);
  assert.equal(correos.filter((c) => c.to.includes("tito@tasa.cl")).length, 0, "una consulta no genera tasación");
  correos.length = 0;
  nuevaIp();
  assert.equal((await sol("renovar", { ...datos, vehiculoId: U.disp.id, patente: "TTTT22" })).status, 200);
  assert.equal(correos.filter((c) => c.to.includes("tito@tasa.cl")).length, 1);
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

test("Mismo teléfono con otro nombre: el marcador «Lead 01» se reemplaza por el nombre escrito; el de una persona real no se pisa", async () => {
  nuevaIp();
  const tel = `9${String(70000000 + ++n)}`;
  const cli0 = db.tablas.clientes.length;
  db.tablas.clientes.push({ id: randomUUID(), nombre: "Lead 01", telefono: tel, local_id: L1 });
  assert.equal((await sol("consulta", { vehiculoId: U.disp.id, nombre: "María González", telefono: tel })).status, 200);
  const clientes = db.tablas.clientes.filter((c) => c.telefono === tel);
  assert.equal(clientes.length, 1, "no se duplica el cliente");
  assert.equal(clientes[0].nombre, "María González");
  const l = leadsWeb()[leadsWeb().length - 1];
  assert.match(l.notas, /^Contacto: María González · /, "el nombre escrito queda también en las notas del lead");
  // Una persona real no cambia de nombre porque alguien use su teléfono.
  nuevaIp();
  assert.equal((await sol("consulta", { vehiculoId: U.disp.id, nombre: "Otra Persona", telefono: tel })).status, 200);
  assert.equal(db.tablas.clientes.find((c) => c.telefono === tel).nombre, "María González");
  assert.match(leadsWeb()[leadsWeb().length - 1].notas, /^Contacto: Otra Persona · /);
  assert.equal(db.tablas.clientes.length, cli0 + 1);
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
  const datos = { patente: "ab-cd 12", marca: "Toyota", modelo: "Yaris", anio: 2018, km: 78000, transmision: "Automática", combustible: "Bencina", duenos: 2, prenda: "no", mantenciones: "si", precioEsperado: 8500000 };
  const r = await sol("vender", { ...datos, modalidad: "consignar", localId: L1 });
  assert.equal(r.status, 200, JSON.stringify(r));
  const l = leadsWeb()[leadsWeb().length - 1];
  assert.equal(l.tipo, "consignacion");
  assert.match(l.vehiculo_interes, /CONSIGNA: Toyota Yaris 2018 · ABCD12/);
  assert.equal(l.vehiculo_id ?? null, null);
  assert.match(l.notas, /2 dueños · prenda: no · mantenciones en la marca: sí · precio esperado \$8\.500\.000/);
  assert.deepEqual([l.vehiculo_ofrecido.duenos, l.vehiculo_ofrecido.prenda, l.vehiculo_ofrecido.mantenciones, l.vehiculo_ofrecido.precioEsperado], [2, "no", "si", 8500000], "los datos del dueño quedan en el lead");
  const t = db.tablas.tasaciones.find((x) => x.patente === "ABCD12");
  assert.ok(t, "se creó la tasación");
  assert.equal(t.estado, "pendiente");
  assert.equal(t.tipo, "directa");
  assert.equal(t.contacto.nombre, "Pedro Soto");
  assert.ok(t.lead_id, "queda ligada al lead para devolver el resultado al ejecutivo (no es de parte de pago: no toca su valor)");
  assert.match(t.notas_solicitud, /Espera \$8\.500\.000 · 2 dueño\(s\) · prenda: no · mantenciones en la marca: sí/, "el Tasador ve lo que declaró el dueño");
  // El Tasador la ve en su cola.
  const cola = await ve(U.t1.token, "tasaciones.list", { vista: "cola" });
  assert.ok(cola.tasaciones.some((x) => x.id === t.id));
  nuevaIp();
  assert.equal((await sol("vender", { ...datos, patente: "12", modalidad: "vender", localId: L1 })).error, "patente_invalida");
  assert.equal((await sol("vender", { ...datos, km: "", modalidad: "vender", localId: L1 })).error, "km_invalido");
  assert.equal((await sol("vender", { ...datos, patente: "ZZZZ11", modalidad: "vender", localId: L1 })).status, 200);
  assert.equal(leadsWeb()[leadsWeb().length - 1].tipo, "compra");
  // Todo es obligatorio al vender o consignar.
  nuevaIp();
  for (const [campo, valor, error] of [["email", "", "email_requerido"], ["duenos", "", "duenos_invalido"], ["prenda", "", "prenda_invalida"], ["mantenciones", "", "mantenciones_invalidas"], ["precioEsperado", "", "precio_esperado_invalido"]]) {
    assert.equal((await sol("vender", { ...datos, patente: "YYYY11", modalidad: "vender", localId: L1, [campo]: valor })).error, error, campo);
  }
});

test("Vender o consignar: el teléfono lleva código de país y se guarda como número internacional", async () => {
  nuevaIp();
  const datos = { patente: "PPPP11", marca: "Kia", modelo: "Rio", anio: 2020, km: 30000, transmision: "Automática", combustible: "Bencina", duenos: 1, prenda: "si", mantenciones: "si", precioEsperado: 7000000, modalidad: "vender", localId: L1 };
  assert.equal((await sol("vender", { ...datos, codigoPais: "56", telefono: "9 8765 4321" })).status, 200);
  const l = leadsWeb()[leadsWeb().length - 1];
  const cli = db.tablas.clientes.find((c) => c.id === l.cliente_id);
  assert.equal(cli.telefono, "+56987654321");
  assert.equal(l.vehiculo_ofrecido.prenda, "si");
  assert.equal((await sol("vender", { ...datos, patente: "PPPP22", codigoPais: "56", telefono: "98765" })).error, "telefono_invalido");
  assert.equal((await sol("vender", { ...datos, patente: "PPPP33", codigoPais: "000", telefono: "987654321" })).error, "codigo_pais_invalido");
  assert.equal((await sol("vender", { ...datos, patente: "PPPP44", codigoPais: "54", telefono: "11 2345 6789" })).status, 200);
  assert.equal(db.tablas.clientes.find((c) => c.id === leadsWeb()[leadsWeb().length - 1].cliente_id).telefono, "+541123456789");
});

test("Renovar (cambiar mi auto por otro): lead de venta con su auto como parte de pago y su tasación esperando al Tasador", async () => {
  nuevaIp();
  const datos = { vehiculoId: U.disp.id, patente: "ab-cd 34", marca: "Chevrolet", modelo: "Sail", anio: 2017, km: 88000, transmision: "Automática", combustible: "Bencina", duenos: 3, prenda: "si", mantenciones: "no", precioEsperado: 4500000 };
  const r = await sol("renovar", datos);
  assert.equal(r.status, 200, JSON.stringify(r));
  const l = leadsWeb()[leadsWeb().length - 1];
  assert.equal(l.tipo, "venta", "es un lead de venta: va al reparto de ventas");
  assert.equal(l.vehiculo_id, U.disp.id, "el auto que le interesa");
  assert.equal(l.parte_pago.tiene, true);
  assert.deepEqual([l.parte_pago.patente, l.parte_pago.marca, l.parte_pago.modelo, l.parte_pago.anio, l.parte_pago.km], ["ABCD34", "Chevrolet", "Sail", 2017, 88000]);
  assert.deepEqual([l.parte_pago.duenos, l.parte_pago.prenda, l.parte_pago.mantenciones, l.parte_pago.precioEsperado], [3, "si", "no", 4500000]);
  assert.match(l.notas, /Quiere cambiar su Chevrolet Sail 2017/);
  const t = db.tablas.tasaciones.find((x) => x.patente === "ABCD34");
  assert.ok(t, "se pidió la tasación de su auto");
  assert.equal(t.tipo, "parte_pago");
  assert.equal(t.estado, "pendiente");
  assert.equal(t.lead_id, l.id, "ligada al lead: al completarse fija el valor en parte de pago");
  assert.equal(t.tasador_id ?? null, null);
  assert.match(t.notas_solicitud, /Espera \$4\.500\.000 · 3 dueño\(s\) · prenda: sí/);
  const cola = await ve(U.t1.token, "tasaciones.list", { vista: "cola" });
  assert.ok(cola.tasaciones.some((x) => x.id === t.id), "el Tasador la ve en su cola");
  // El Tasador la completa y el valor queda como parte de pago del lead.
  assert.equal((await ve(U.t1.token, "tasaciones.tomar", { id: t.id })).status, 200);
  assert.equal((await ve(U.t1.token, "tasaciones.completar", { id: t.id, borrador: { aplicaPara: "compra", valorCompra: 4000000, valorVenta: 5200000 } })).status, 200);
  assert.equal(db.tablas.leads.find((x) => x.id === l.id).parte_pago.valor, 4000000);
  // Obligatorios: el auto deseado y todos los datos del actual.
  nuevaIp();
  assert.equal((await sol("renovar", { ...datos, vehiculoId: "" })).error, "vehiculo_requerido");
  assert.equal((await sol("renovar", { ...datos, precioEsperado: "" })).error, "precio_esperado_invalido");
  assert.equal((await sol("renovar", { ...datos, email: "" })).error, "email_requerido");
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
  const datos = { patente: "QQQQ11", marca: "Mazda", modelo: "3", anio: 2019, km: 50000, modalidad: "vender", transmision: "Automática", combustible: "Bencina", duenos: 1, prenda: "no", mantenciones: "no", precioEsperado: 9000000 };
  assert.equal((await sol("vender", datos)).error, "sin_local");
  assert.equal((await sol("vender", { ...datos, localId: L2 })).status, 200);
  assert.equal(leadsWeb()[leadsWeb().length - 1].local_id, L2);
});

test("Tasación pedida desde el sitio web: el Tasador no puede editar los datos que dio el cliente", async () => {
  nuevaIp();
  const datos = { patente: "LK-ZZ 33", marca: "Kia", modelo: "Morning", anio: 2019, km: 40000, transmision: "Mecánica", combustible: "Bencina", duenos: 1, prenda: "no", mantenciones: "si", precioEsperado: 5000000 };
  const rs = await sol("vender", { ...datos, modalidad: "vender", localId: L1 });
  assert.equal(rs.status, 200, JSON.stringify(rs));
  const t = db.tablas.tasaciones.find((x) => x.patente === "LKZZ33");
  assert.ok(t);
  assert.equal((await ve(U.t1.token, "tasaciones.tomar", { id: t.id })).status, 200);
  const g = await ve(U.t1.token, "tasaciones.get", { id: t.id });
  assert.equal(g.vehiculoBloqueado, true);
  // Intenta cambiar el vehículo: se ignora; lo demás del borrador sí se guarda.
  const r = await ve(U.t1.token, "tasaciones.guardar", { id: t.id, borrador: { vehiculo: { ...t.vehiculo, km: 1, marca: "Otra" }, observaciones: "Se ve bien" } });
  assert.equal(r.status, 200, JSON.stringify(r));
  const fila = db.tablas.tasaciones.find((x) => x.id === t.id);
  assert.deepEqual([fila.vehiculo.km, fila.vehiculo.marca], [40000, "Kia"]);
  assert.equal(fila.observaciones, "Se ve bien");
  // La que pide una persona del equipo sí se edita.
  const l = (await ve(U.e1.token, "leads.create", { lead: { tipo: "venta", fuente: "WhatsApp", cliente: { nombre: "Cliente Manual", telefono: "987654321" }, notas: "" } }));
  if (l.status === 200) {
    const p = await ve(U.e1.token, "tasaciones.pedir", { leadId: l.lead.id, datos: { vehiculo: { patente: "MN-OP 12", marca: "Fiat", modelo: "Uno", anio: 2015, km: 90000 } } });
    if (p.status === 200) {
      await ve(U.t1.token, "tasaciones.tomar", { id: p.tasacion.id });
      assert.equal((await ve(U.t1.token, "tasaciones.get", { id: p.tasacion.id })).vehiculoBloqueado, false);
    }
  }
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

test("Consulta pública de inspecciones: por patente, con informe, CAV y fotos; con acceso firmado y captcha si hay clave", async () => {
  await crear("insp", "Ivo Inspector", "12.000.000-4", ["inspector"], L1);
  const lead = (await ve(U.e1.token, "leads.create", { cliente: { nombre: "Cliente Insp", telefono: "955500001" }, lead: {} })).lead;
  const patente = "KLMN34";
  const veh = { patente, marca: "Toyota", modelo: "Yaris", anio: 2018, km: 78000 };
  const ped = await ve(U.e1.token, "inspecciones.pedir", { origen: "lead", leadId: lead.id, datos: { vehiculo: veh, direccion: "Av. Vitacura 1234", fechaHora: new Date(Date.now() + 30 * 3_600_000).toISOString() } });
  assert.equal(ped.status, 200, JSON.stringify(ped));

  // Aún sin realizar: no hay nada que mostrar.
  assert.equal((await pub("inspeccion.buscar", { patente })).error, "sin_inspeccion");
  assert.equal((await pub("inspeccion.buscar", { patente: "12" })).error, "patente_invalida");

  assert.equal((await ve(U.insp.token, "inspecciones.tomar", { id: ped.inspeccion.id })).status, 200);
  const key = `inspeccion::${U.insp.id}::${Date.now()}`;
  const ficha = { inscripcion: patente, marca: "Toyota", modelo: "Yaris", anio: "2018", fecha: "2026-06-10", inspectorNombre: "Ivo Inspector", propietarioNombre: "Juan Pérez Soto", propietarioRun: "11.222.333-4", cavFileData: "data:application/pdf;base64,AAAA", cavFileName: "cav.pdf", fotosEquipo: ["fotoa1"], checklist: { motor_ruidos: { estado: "Regular", observacion: "Ruido leve" } } };
  assert.equal((await api({ action: "kv", token: U.insp.token, op: "set", key, value: JSON.stringify(ficha) })).status, 200);
  assert.equal((await api({ action: "kv", token: U.insp.token, op: "set", key: `ifoto::${key.split("::").pop()}::fotoa1`, value: "data:image/jpeg;base64,BBBB" })).status, 200);
  const reg = await ve(U.insp.token, "inspecciones.registrar", { key, vehiculo: veh, solicitudId: ped.inspeccion.id, fecha: "2026-06-10", fotos: ["fotoa1"], resumen: { buenos: 40, regulares: 1, malos: 0, noAplica: 5, sinRevisar: 0, destacados: [], observaciones: "Buen estado" } });
  assert.equal(reg.status, 200, JSON.stringify(reg));

  const b = await pub("inspeccion.buscar", { patente: "klmn-34" });
  assert.equal(b.status, 200, JSON.stringify(b));
  assert.equal(b.inspeccion.vehiculo.marca, "Toyota");
  assert.equal(b.inspeccion.resultado.veredicto, "con_observaciones");
  assert.deepEqual(b.inspeccion.fotos, ["fotoa1"]);
  assert.equal(b.inspeccion.tieneCav, true);
  assert.ok(!/lead|cliente|solicitante|Cliente Insp|Eva/.test(JSON.stringify(b)), "nada del lead ni de quien la pidió");

  const inf = await pub("inspeccion.informe", { acceso: b.acceso });
  assert.equal(inf.status, 200);
  assert.equal(inf.ficha.checklist.motor_ruidos.estado, "Regular");
  assert.equal(inf.ficha.propietarioNombre, "Juan Pérez Soto", "el informe público lleva al propietario (decisión del negocio)");
  assert.ok(!JSON.stringify(inf).includes("base64"), "el CAV se pide aparte");
  assert.equal((await pub("inspeccion.cav", { acceso: b.acceso })).value, "data:application/pdf;base64,AAAA");
  assert.equal((await pub("inspeccion.foto", { acceso: b.acceso, fotoId: "fotoa1" })).value, "data:image/jpeg;base64,BBBB");
  assert.equal((await pub("inspeccion.foto", { acceso: b.acceso, fotoId: "otra" })).status, 404, "solo las fotos de esa inspección");

  // Sin acceso, con un acceso alterado o vencido: nada.
  assert.equal((await pub("inspeccion.informe", {})).error, "acceso_vencido");
  assert.equal((await pub("inspeccion.informe", { acceso: b.acceso.slice(0, -3) + "abc" })).error, "acceso_vencido");
  const vencido = b.acceso.split(".");
  const cuerpo = JSON.parse(Buffer.from(vencido[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  cuerpo.e = Date.now() - 1000;
  const alterado = `${Buffer.from(JSON.stringify(cuerpo)).toString("base64url")}.${vencido[1]}`;
  assert.equal((await pub("inspeccion.informe", { acceso: alterado })).error, "acceso_vencido");

  // Una inspección más reciente de la misma patente reemplaza a la anterior.
  db.tablas.inspecciones.find((x) => x.id === ped.inspeccion.id).completada_en = new Date(Date.now() - 86_400_000).toISOString();
  db.tablas.inspecciones.push({ ...db.tablas.inspecciones.find((x) => x.id === ped.inspeccion.id), id: randomUUID(), numero: 9999, completada_en: new Date().toISOString(), inspeccion_key: key });
  assert.equal((await pub("inspeccion.buscar", { patente })).inspeccion.folio, "INS-009999");
});

test("Consulta pública de inspecciones: con clave de Turnstile se exige el captcha, y la búsqueda tiene límite por IP", async () => {
  const { entorno } = await import("./helpers/api-env.mjs");
  const e = entorno;
  e.TURNSTILE_SECRET_KEY = "secreto_prueba"; e.TURNSTILE_SITE_KEY = "clave_sitio";
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes("turnstile") ? { json: async () => ({ success: String(init.body).includes("response=bueno1234567") }) } : fetchOriginal(url, init));
  try {
    assert.equal((await pub("inspeccion.config")).captcha, "clave_sitio");
    assert.equal((await pub("inspeccion.buscar", { patente: "KLMN34" })).error, "captcha_invalido");
    assert.equal((await pub("inspeccion.buscar", { patente: "KLMN34", captcha: "malo123456789" })).error, "captcha_invalido");
    assert.equal((await pub("inspeccion.buscar", { patente: "KLMN34", captcha: "bueno1234567" })).status, 200);
  } finally { globalThis.fetch = fetchOriginal; delete e.TURNSTILE_SECRET_KEY; delete e.TURNSTILE_SITE_KEY; }
  assert.equal((await pub("inspeccion.config")).captcha, null, "sin clave secreta no se pide captcha");
  nuevaIp();
  let ultimo = 0;
  for (let i = 0; i < 25; i++) { ultimo = (await pub("inspeccion.buscar", { patente: "ZZZZ99" })).status; if (ultimo === 429) break; }
  assert.equal(ultimo, 429, "pasado el límite por hora, se frena");
});
