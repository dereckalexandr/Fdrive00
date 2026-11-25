// Mensaje de bienvenida por WhatsApp a los leads de formularios (sitio web, Meta Ads y Google Ads), de punta a punta: configuración con
// la plantilla aprobada por Meta, envío con los datos del lead, frenos (apagado, repetidos, tope diario, ya conversando, plantilla no
// aprobada, Meta rechaza) y que la respuesta del cliente siga en su lead. Contra la función real, una base falsa y una Graph API simulada.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db, manejar, meta, ads, entorno } from "./helpers/api-env.mjs";

const pub = (op, extra = {}) => api({ action: "public", op, ...extra });
const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1; let VEH;
let n = 0;

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra, email: `${clave}@prueba.cl` }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}
async function firmado(url, payload) {
  const cuerpo = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", "secreto-app-prueba").update(cuerpo).digest("hex");
  const res = await manejar(new Request(url, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: cuerpo }));
  return { status: res.status, texto: await res.text() };
}
const webhookWa = (payload) => firmado("http://x/api?whatsapp=1", payload);
const entrante = (from, nombre, body) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "56220000000", phone_number_id: "PNID1" }, contacts: [{ profile: { name: nombre }, wa_id: from }], messages: [{ from, id: `wamid.BV${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }] } }] }] });
const avisoMeta = (id) => ({ object: "page", entry: [{ id: "PAG1", changes: [{ field: "leadgen", value: { leadgen_id: id, form_id: "F1", ad_id: "AD1", page_id: "PAG1" } }] }] });
const leadMeta = (nombre, tel, email) => ({ id: "x", campaign_id: "120200000001", campaign_name: "SUV usados", field_data: [{ name: "full_name", values: [nombre] }, ...(tel ? [{ name: "phone_number", values: [tel] }] : []), { name: "email", values: [email] }] });
const webhookGoogle = async (cuerpo) => { const r = await manejar(new Request("http://x/api?googleleads=1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) })); return { status: r.status, json: await r.json().catch(() => null) }; };
const solicitud = (extra = {}) => { nuevaIp(); return pub("solicitud", { tipo: "consulta", vehiculoId: VEH.id, nombre: "Pedro Soto", telefono: "911112001", email: "pedro@correo.cl", mensaje: "¿Sigue disponible?", acepta: true, abiertoEn: Date.now() - 10_000, web: "", ...extra }); };

const plantillasEnviadas = () => meta.llamadas.filter((l) => l.metodo === "POST" && l.ruta.endsWith("/PNID1/messages") && l.cuerpo && l.cuerpo.type === "template");
const aTel = (to) => plantillasEnviadas().filter((l) => l.cuerpo.to === to);
const conv = (t) => db.tablas.wa_conversaciones.find((c) => c.telefono === t);
const kv = (k) => { const f = db.tablas.kv_store.find((r) => r.key === k); return f ? JSON.parse(f.value) : null; };
const plantilla = (extra = {}) => ({ name: "bienvenida_formulario", language: "es", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Hola {{1}} 👋 Recibimos {{2}}. Un ejecutivo de {{3}} te contactará {{4}}. Si quieres, puedes escribirnos por aquí y te ayudamos." }, { type: "FOOTER", text: "Mensaje automático" }], ...extra });
const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const CERRADO = Object.fromEntries(DIAS.map((d) => [d, { abierto: true, desde: "03:00", hasta: "03:01" }])); // abierto un minuto al día: casi siempre cerrado
const configurar = (token, cfg) => ve(token, "wa.bienvenida_guardar", { config: { activa: true, plantilla: { nombre: "bienvenida_formulario", idioma: "es" }, maxPorDia: 40, ...cfg } });

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  Object.assign(entorno, { META_AD_ACCOUNT_ID: "998877", GOOGLE_ADS_LEAD_KEY: "clave-del-formulario-google" });
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1, { otorgar: ["ventas.operar"], quitar: [] });
  const r = await ve(U.jefe.token, "inventario.save", { datos: { patente: "WB1001", marca: "Hyundai", modelo: "Venue", anio: 2023, km: 56000, precioLista: 12480000, costo: 10000000, color: "Blanco", transmision: "Automática" } });
  assert.equal(r.status, 200, JSON.stringify(r));
  VEH = r.vehiculo;
  meta.plantillas = [];
});

test("Apagada por defecto: un lead del sitio se crea y se asigna, pero no sale ningún WhatsApp", async () => {
  const r = await solicitud({ telefono: "911110001" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(db.tablas.leads.filter((l) => l.fuente === "Sitio web").length, 1);
  assert.equal(plantillasEnviadas().length, 0);
  const e = await ve(U.jefe.token, "wa.bienvenida_estado");
  assert.equal(e.status, 200, JSON.stringify(e));
  assert.equal(e.config.activa, false);
  assert.equal(e.sugerida.estado, "NO_CREADA");
  assert.equal(e.sugerida.nombre, "bienvenida_formulario");
  assert.equal(e.whatsappConfigurado, true);
});

test("Configuración: solo Administrador y Jefe Local; la plantilla debe estar aprobada y traer 4 variables", async () => {
  assert.equal((await ve(U.e1.token, "wa.bienvenida_estado")).status, 403);
  assert.equal((await configurar(U.e1.token, {})).status, 403);
  // Creada desde el CRM con la sugerida: queda en revisión y todavía no se puede usar.
  const creada = await ve(U.jefe.token, "wa.plantilla_crear", { plantilla: { nombre: "bienvenida_formulario", categoria: "UTILITY", cuerpo: "Hola {{1}} 👋 Recibimos {{2}}. Un ejecutivo de {{3}} te contactará {{4}}. Si quieres, puedes escribirnos por aquí y te ayudamos.", pie: "Mensaje automático", ejemplos: ["Pedro", "tu consulta por el Toyota Yaris 2020", "BuyCar", "mañana desde las 10:00"] } });
  assert.equal(creada.status, 200, JSON.stringify(creada));
  assert.equal((await ve(U.jefe.token, "wa.bienvenida_estado")).sugerida.estado, "PENDING");
  assert.equal((await configurar(U.jefe.token, {})).error, "bienvenida_plantilla_invalida", "en revisión no sirve");
  meta.plantillas = [plantilla({ components: [{ type: "BODY", text: "Hola {{1}}, recibimos {{2}}." }] })];
  assert.equal((await configurar(U.jefe.token, {})).error, "bienvenida_plantilla_variables");
  assert.equal((await configurar(U.jefe.token, { plantilla: { nombre: "", idioma: "es" } })).error, "bienvenida_sin_plantilla");
  assert.equal((await configurar(U.jefe.token, { maxPorDia: 0 })).error, "bienvenida_config_invalida");
  // Aprobada con las 4 variables: se guarda.
  meta.plantillas = [plantilla()];
  const ok = await configurar(U.jefe.token, {});
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(ok.config.activa, true);
  assert.equal(ok.sugerida.estado, "APPROVED");
  assert.deepEqual(ok.plantillas.map((p) => p.nombre), ["bienvenida_formulario"]);
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "whatsapp.bienvenida_config"));
});

test("Lead del sitio web: recibe la plantilla con sus datos, queda la conversación en su lead y el historial lo anota", async () => {
  await ve(U.jefe.token, "wa.bot_guardar", { config: { activo: true, empresa: "BuyCar", horario: CERRADO, ia: { activa: false } } });
  const r = await solicitud({ telefono: "911112001" });
  assert.equal(r.status, 200, JSON.stringify(r));
  const env = aTel("56911112001");
  assert.equal(env.length, 1, "una sola plantilla");
  const t = env[0].cuerpo.template;
  assert.equal(t.name, "bienvenida_formulario");
  assert.equal(t.language.code, "es");
  assert.deepEqual(t.components[0].parameters.map((p) => p.text).slice(0, 3), ["Pedro", "tu consulta por el Hyundai Venue 2023", "BuyCar"]);
  assert.match(t.components[0].parameters[3].text, /desde las 03:00/, "de noche promete la próxima apertura");
  const lead = db.tablas.leads.find((l) => l.fuente === "Sitio web" && db.tablas.clientes.find((c) => c.id === l.cliente_id).telefono === "911112001");
  const c = conv("56911112001");
  assert.ok(c, "se crea la conversación");
  assert.equal(c.lead_id, lead.id);
  assert.equal(c.cliente_id, lead.cliente_id);
  const m = db.tablas.wa_mensajes.find((x) => x.conversacion_id === c.id);
  assert.deepEqual([m.direccion, m.tipo, m.plantilla, m.usuario_id, m.usuario_nombre, m.estado], ["saliente", "template", "bienvenida_formulario", "bienvenida", "Bienvenida automática", "enviado"]);
  assert.match(m.texto, /^Hola Pedro 👋 Recibimos tu consulta por el Hyundai Venue 2023\. Un ejecutivo de BuyCar te contactará/);
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === lead.id && e.usuario_nombre === "Bienvenida automática"));
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "whatsapp.bienvenida"));
  assert.equal(kv("whatsapp::bienvenida::dia::" + new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date())).n, 1);
  assert.ok(kv("bienvenida::tel::56911112001").en);
  const e = await ve(U.jefe.token, "wa.bienvenida_estado");
  assert.equal(e.ultimo.ok, true);
  assert.equal(e.enviadasHoy, 1);
  U.leadWeb = lead;
});

test("Si el cliente responde, la conversación sigue su lead: el asistente lo atiende como cliente conocido, con el nombre de su ejecutivo", async () => {
  await webhookWa(entrante("56911112001", "Pedro Soto", "Hola, gracias por escribirme"));
  const c = conv("56911112001");
  assert.equal(c.lead_id, U.leadWeb.id, "sigue en el mismo lead del formulario");
  assert.equal(db.tablas.leads.filter((l) => l.cliente_id === U.leadWeb.cliente_id).length, 1, "no crea otro lead");
  // La bienvenida automática no cuenta como «un ejecutivo ya le escribió»: el asistente fuera de horario sí responde.
  const aviso = meta.llamadas.filter((l) => l.metodo === "POST" && l.ruta.endsWith("/PNID1/messages") && l.cuerpo && l.cuerpo.to === "56911112001" && l.cuerpo.type === "text").pop();
  assert.ok(aviso, "el asistente respondió");
  assert.match(aviso.cuerpo.text.body, /fuera de horario/);
  assert.match(aviso.cuerpo.text.body, /Eva te responderá/);
});

test("No se repite: el mismo teléfono recibe la bienvenida una sola vez en 7 días, aunque llene el formulario otra vez", async () => {
  const antes = plantillasEnviadas().length;
  const r = await solicitud({ telefono: "911112001", nombre: "Pedro S." });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(plantillasEnviadas().length, antes);
  // Pasados 8 días, sí.
  kvForzar("bienvenida::tel::56911112001", { en: new Date(Date.now() - 8 * 86_400_000).toISOString() });
  const t0 = conv("56911112001"); t0.ultimo_entrante_en = new Date(Date.now() - 30 * 3_600_000).toISOString(); // y sin conversación abierta
  await solicitud({ telefono: "911112001" });
  assert.equal(plantillasEnviadas().length, antes + 1);
});
function kvForzar(key, v) { const f = db.tablas.kv_store.find((r) => r.key === key); if (f) f.value = JSON.stringify(v); else db.tablas.kv_store.push({ key, value: JSON.stringify(v), shared: false }); }

test("Si la persona ya está conversando con nosotros (escribió hace menos de 24 h), no se le manda una plantilla", async () => {
  await webhookWa(entrante("56911113001", "Rosa", "Hola, busco un auto"));
  const antes = plantillasEnviadas().length;
  const r = await solicitud({ telefono: "911113001", nombre: "Rosa Vera" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(plantillasEnviadas().length, antes);
});

test("Formularios de Meta y de Google: también reciben la bienvenida, y un lead repetido no la vuelve a recibir", async () => {
  ads.meta.leads["900000000001"] = leadMeta("María José Pérez", "+56 9 8765 4321", "maria@correo.cl");
  const r = await webhookWa(avisoMeta("900000000001"));
  assert.equal(r.status, 200);
  const m = aTel("56987654321");
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].cuerpo.template.components[0].parameters.slice(0, 3).map((p) => p.text), ["María", "tu solicitud de información", "BuyCar"]);
  assert.equal(db.tablas.leads.find((l) => l.fuente === "Meta Ads").id, conv("56987654321").lead_id);
  // Google.
  const g = await webhookGoogle({ lead_id: "g-1", google_key: "clave-del-formulario-google", campaign_id: 7700110022, is_test: false, user_column_data: [{ column_id: "FULL_NAME", string_value: "Pedro Rojas" }, { column_id: "PHONE_NUMBER", string_value: "+56 9 3333 4444" }, { column_id: "EMAIL", string_value: "pedro.rojas@correo.cl" }] });
  assert.equal(g.status, 200);
  assert.equal(aTel("56933334444").length, 1);
  // Reenviar el mismo lead de Google (duplicado) o pedir información otra vez no manda otro mensaje.
  await webhookGoogle({ lead_id: "g-1", google_key: "clave-del-formulario-google", campaign_id: 7700110022, user_column_data: [{ column_id: "PHONE_NUMBER", string_value: "+56 9 3333 4444" }] });
  ads.meta.leads["900000000002"] = leadMeta("María José Pérez", "+56 9 8765 4321", "maria@correo.cl");
  await webhookWa(avisoMeta("900000000002"));
  assert.equal(aTel("56987654321").length, 1);
  assert.equal(aTel("56933334444").length, 1);
  // Un formulario sin teléfono no recibe nada.
  const antes = plantillasEnviadas().length;
  await webhookGoogle({ lead_id: "g-2", google_key: "clave-del-formulario-google", campaign_id: 7700110022, user_column_data: [{ column_id: "FULL_NAME", string_value: "Sin Fono" }, { column_id: "EMAIL", string_value: "sinfono@correo.cl" }] });
  assert.equal(plantillasEnviadas().length, antes);
});

test("Tope diario: pasado el máximo de bienvenidas del día no se envían más, y la tarjeta lo dice", async () => {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
  const usadas = kv("whatsapp::bienvenida::dia::" + hoy).n;
  await configurar(U.jefe.token, { maxPorDia: usadas + 1 });
  await solicitud({ telefono: "911114001", nombre: "Uno" });
  assert.equal(aTel("56911114001").length, 1, "la última que cabía");
  await solicitud({ telefono: "911114002", nombre: "Dos" });
  assert.equal(aTel("56911114002").length, 0, "ya no cabe");
  const e = await ve(U.jefe.token, "wa.bienvenida_estado");
  assert.equal(e.ultimo.ok, false);
  assert.match(e.ultimo.error, /tope de \d+ bienvenidas por día/);
  assert.equal(db.tablas.leads.some((l) => db.tablas.clientes.find((c) => c.id === l.cliente_id)?.telefono === "911114002"), true, "el lead igual se creó y se asignó");
  await configurar(U.jefe.token, { maxPorDia: 100 });
});

test("Si Meta rechaza el envío o la plantilla deja de estar aprobada: el lead queda igual y se puede reintentar", async () => {
  meta.fallarEnvio = "Message undeliverable";
  const antes = plantillasEnviadas().length;
  const r = await solicitud({ telefono: "911115001", nombre: "Tres" });
  assert.equal(r.status, 200, "el formulario del visitante no se ve afectado");
  assert.equal(conv("56911115001"), undefined, "sin envío no queda conversación");
  assert.equal(kv("bienvenida::tel::56911115001"), null, "y el teléfono no queda bloqueado");
  assert.equal((await ve(U.jefe.token, "wa.bienvenida_estado")).ultimo.ok, false);
  // Un segundo formulario del mismo teléfono ahora sí sale.
  await solicitud({ telefono: "911115001", nombre: "Tres" });
  assert.equal(aTel("56911115001").length, 2, "el intento que Meta rechazó y el que salió");
  assert.equal(plantillasEnviadas().length, antes + 2);
  assert.equal(db.tablas.wa_mensajes.filter((x) => x.conversacion_id === conv("56911115001").id).length, 1, "pero en la conversación solo queda el que salió");
  // La plantilla pasa a «pausada» en Meta: no se envía y se explica.
  meta.plantillas[0].status = "PAUSED";
  assert.equal((await configurar(U.jefe.token, {})).error, "bienvenida_plantilla_invalida", "no se puede guardar con una plantilla pausada (y de paso se refresca la lista que el servidor guarda 5 minutos)");
  const e0 = plantillasEnviadas().length;
  await solicitud({ telefono: "911115002", nombre: "Cuatro" });
  assert.equal(plantillasEnviadas().length, e0);
  const e = await ve(U.jefe.token, "wa.bienvenida_estado");
  assert.match(e.ultimo.error, /no está aprobada en Meta/);
  assert.equal(kv("bienvenida::tel::56911115002"), null);
  meta.plantillas[0].status = "APPROVED";
  assert.equal((await configurar(U.jefe.token, {})).status, 200);
});

test("Probar: el Administrador se envía la bienvenida de ejemplo a un teléfono, sin crear lead ni conversación", async () => {
  const antes = db.tablas.leads.length;
  assert.equal((await ve(U.e1.token, "wa.bienvenida_probar", { telefono: "911119999" })).status, 403);
  assert.equal((await ve(U.jefe.token, "wa.bienvenida_probar", { telefono: "123" })).error, "telefono_invalido");
  const r = await ve(U.jefe.token, "wa.bienvenida_probar", { telefono: "9 1111 9999", nombre: "Julia Jefa" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.resultado, "enviada");
  const t = aTel("56911119999")[0].cuerpo.template;
  assert.deepEqual(t.components[0].parameters.slice(0, 2).map((p) => p.text), ["Julia", "tu consulta por el Toyota Yaris 2020"]);
  assert.equal(db.tablas.leads.length, antes);
  assert.equal(conv("56911119999"), undefined);
  // Se puede repetir las veces que haga falta (no cuenta para los límites).
  assert.equal((await ve(U.jefe.token, "wa.bienvenida_probar", { telefono: "9 1111 9999" })).resultado, "enviada");
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "whatsapp.bienvenida_prueba"));
});

test("Quien quiere vender o consignar su auto recibe su plantilla (con el auto que ofrece); sin ella o si no está aprobada, la general", async () => {
  const vender = (extra = {}) => { nuevaIp(); return pub("solicitud", { tipo: "vender", nombre: "Pedro Soto", telefono: "911118001", email: "pedro@correo.cl", mensaje: "", acepta: true, abiertoEn: Date.now() - 10_000, web: "", patente: "ab-cd 12", marca: "Toyota", modelo: "Yaris", anio: 2018, km: 78000, transmision: "Automática", combustible: "Bencina", duenos: 2, prenda: "no", mantenciones: "si", precioEsperado: 8500000, modalidad: "consignar", localId: L1, ...extra }); };
  const plantillaV = (extra = {}) => ({ name: "bienvenida_vender", language: "es", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Hola {{1}} 👋 Recibimos tu solicitud para {{2}} tu {{3}}. Un ejecutivo de {{4}} te contactará {{5}} para coordinar la tasación. Mientras tanto, puedes enviarnos por aquí fotos del auto y del permiso de circulación." }, { type: "FOOTER", text: "Mensaje automático" }], ...extra });
  const elegir = (extra = {}) => configurar(U.jefe.token, { plantillaVender: { nombre: "bienvenida_vender", idioma: "es" }, ...extra });
  // Aún sin elegir la de vender: recibe la general.
  assert.equal((await vender()).status, 200);
  assert.equal(aTel("56911118001").length, 1);
  assert.equal(aTel("56911118001")[0].cuerpo.template.name, "bienvenida_formulario");
  assert.equal(aTel("56911118001")[0].cuerpo.template.components[0].parameters[1].text, "tu solicitud para consignar tu auto");
  // Se elige una que no está aprobada o que trae otro número de variables: no se guarda.
  meta.plantillas.push(plantillaV({ status: "PENDING" }));
  assert.equal((await elegir()).error, "bienvenida_plantilla_invalida");
  meta.plantillas[1] = plantillaV({ components: [{ type: "BODY", text: "Hola {{1}}, recibimos tu solicitud de {{2}}." }] });
  assert.equal((await elegir()).error, "bienvenida_vender_variables");
  // Aprobada con sus 5 variables: se guarda y aparece en la tarjeta.
  meta.plantillas[1] = plantillaV();
  const ok = await elegir();
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(ok.config.plantillaVender.nombre, "bienvenida_vender");
  assert.deepEqual(ok.plantillasVender.map((p) => p.nombre), ["bienvenida_vender"]);
  assert.equal(ok.sugeridaVender.estado, "APPROVED");
  assert.equal(ok.sugeridaVender.nombre, "bienvenida_vender");
  assert.deepEqual(ok.plantillas.map((p) => p.nombre), ["bienvenida_formulario"], "cada lista muestra solo las plantillas con su número de variables");
  // Quien consigna: su plantilla, con el auto que ofrece.
  assert.equal((await vender({ telefono: "911118002", nombre: "Ana Rojas", patente: "ef-gh 34", modalidad: "consignar" })).status, 200);
  const c = aTel("56911118002")[0].cuerpo.template;
  assert.equal(c.name, "bienvenida_vender");
  assert.deepEqual(c.components[0].parameters.map((p) => p.text).slice(0, 4), ["Ana", "consignar", "Toyota Yaris 2018", "BuyCar"]);
  assert.match(c.components[0].parameters[4].text, /desde las 03:00|a la brevedad/);
  assert.match(db.tablas.wa_mensajes.find((x) => x.conversacion_id === conv("56911118002").id).texto, /^Hola Ana 👋 Recibimos tu solicitud para consignar tu Toyota Yaris 2018\./);
  // Quien vende (no consigna): «vender».
  assert.equal((await vender({ telefono: "911118003", nombre: "Luis Vera", patente: "ij-kl 56", modalidad: "vender" })).status, 200);
  assert.equal(aTel("56911118003")[0].cuerpo.template.components[0].parameters[1].text, "vender");
  // Quien solo consulta por un auto sigue recibiendo la general.
  await solicitud({ telefono: "911118004", nombre: "Eva Lima" });
  assert.equal(aTel("56911118004")[0].cuerpo.template.name, "bienvenida_formulario");
  // La de vender queda pausada en Meta: esos leads reciben la general, no se quedan sin nada.
  meta.plantillas[1].status = "PAUSED";
  assert.equal((await elegir()).error, "bienvenida_plantilla_invalida", "de paso se refresca la lista que el servidor guarda 5 minutos");
  assert.equal((await vender({ telefono: "911118005", nombre: "Mia Soto", patente: "mn-op 78" })).status, 200);
  assert.equal(aTel("56911118005")[0].cuerpo.template.name, "bienvenida_formulario");
  // Probar desde la tarjeta: la de vender y la general.
  meta.plantillas[1].status = "APPROVED";
  assert.equal((await elegir()).status, 200);
  const pv = await ve(U.jefe.token, "wa.bienvenida_probar", { telefono: "9 1111 8888", tipo: "consignar", nombre: "Julia Jefa" });
  assert.equal(pv.resultado, "enviada");
  const tp = aTel("56911118888")[0].cuerpo.template;
  assert.equal(tp.name, "bienvenida_vender");
  assert.deepEqual(tp.components[0].parameters.slice(0, 3).map((p) => p.text), ["Julia", "consignar", "Toyota Yaris 2018"]);
  await ve(U.jefe.token, "wa.bienvenida_probar", { telefono: "9 1111 8888", tipo: "consulta" });
  assert.equal(aTel("56911118888")[1].cuerpo.template.name, "bienvenida_formulario");
  // Se vuelve a la configuración de siempre (sin plantilla para vender).
  await configurar(U.jefe.token, {});
  assert.equal(kv("whatsapp::bienvenida").plantillaVender.nombre, "");
  meta.plantillas.splice(1, 1);
});

test("Baja: quien responde «No quiero recibir más mensajes» recibe la confirmación, queda etiquetado y no recibe más bienvenidas", async () => {
  await configurar(U.jefe.token, {});
  await solicitud({ telefono: "911117001", nombre: "Sexto" });
  assert.equal(aTel("56911117001").length, 1);
  // Un mensaje normal no es una baja: sigue el flujo de siempre.
  await webhookWa(entrante("56911117001", "Sexto", "Quiero comprar un auto"));
  assert.equal(kv("bienvenida::baja::56911117001"), null);
  assert.deepEqual(conv("56911117001").etiquetas, []);
  // Pide dejar de recibir mensajes.
  const antes = meta.llamadas.filter((l) => l.metodo === "POST" && l.ruta.endsWith("/PNID1/messages") && l.cuerpo && l.cuerpo.to === "56911117001").length;
  await webhookWa(entrante("56911117001", "Sexto", "No quiero recibir más mensajes"));
  const c = conv("56911117001");
  assert.deepEqual(c.etiquetas, ["No contactar"]);
  assert.ok(kv("bienvenida::baja::56911117001").en);
  const conf = meta.llamadas.filter((l) => l.metodo === "POST" && l.ruta.endsWith("/PNID1/messages") && l.cuerpo && l.cuerpo.to === "56911117001").slice(antes);
  assert.equal(conf.length, 1, "una sola respuesta: la confirmación");
  assert.match(conf[0].cuerpo.text.body, /no te escribiremos más mensajes automáticos/);
  assert.equal(c.bot_estado.baja, true);
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === c.lead_id && /no recibir más mensajes automáticos/.test(e.detalle)));
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "whatsapp.baja"));
  // El asistente ya no le responde, aunque escriba más.
  await webhookWa(entrante("56911117001", "Sexto", "Hola, ¿tienen autos disponibles?"));
  assert.equal(meta.llamadas.filter((l) => l.metodo === "POST" && l.ruta.endsWith("/PNID1/messages") && l.cuerpo && l.cuerpo.to === "56911117001").slice(antes).length, 1);
  // Un formulario nuevo suyo, incluso pasados los 7 días, no le manda otra bienvenida.
  kvForzar("bienvenida::tel::56911117001", { en: new Date(Date.now() - 30 * 86_400_000).toISOString() });
  c.ultimo_entrante_en = new Date(Date.now() - 30 * 3_600_000).toISOString();
  const previas = aTel("56911117001").length;
  await solicitud({ telefono: "911117001", nombre: "Sexto" });
  assert.equal(aTel("56911117001").length, previas);
});

test("Apagarla: deja de enviar y los leads siguen entrando", async () => {
  await ve(U.jefe.token, "wa.bienvenida_guardar", { config: { activa: false, plantilla: { nombre: "bienvenida_formulario", idioma: "es" }, maxPorDia: 40 } });
  const antes = plantillasEnviadas().length;
  const r = await solicitud({ telefono: "911116001", nombre: "Cinco" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(plantillasEnviadas().length, antes);
});
