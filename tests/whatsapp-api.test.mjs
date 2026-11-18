// WhatsApp Business en el CRM: avisos de Meta (firma, mensajes, estados), lead automático, bandeja por ejecutivo,
// ventana de 24 horas, plantillas aprobadas y archivos. Contra la función real, una base falsa y una Graph API simulada.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db, manejar, meta } from "./helpers/api-env.mjs";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1;
let n = 0;

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}

/** Envía un aviso a la función tal como lo haría Meta (firmado con el secreto de la app, salvo que se indique otra firma). */
async function webhook(payload, { firma } = {}) {
  const cuerpo = JSON.stringify(payload);
  const sig = firma ?? "sha256=" + createHmac("sha256", "secreto-app-prueba").update(cuerpo).digest("hex");
  const res = await manejar(new Request("http://x/api?whatsapp=1", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: cuerpo }));
  return { status: res.status, texto: await res.text() };
}
const aviso = (value) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "56220000000", phone_number_id: "PNID1" }, ...value } }] }] });
const entrante = (from, nombre, msg) => aviso({ contacts: [{ profile: { name: nombre }, wa_id: from }], messages: [{ from, id: msg.id || `wamid.IN${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), ...msg }] });
const texto = (from, nombre, body, id) => entrante(from, nombre, { ...(id ? { id } : {}), type: "text", text: { body } });
const estado = (wamid, status, extra = {}) => aviso({ statuses: [{ id: wamid, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: "56911112222", ...extra }] });
const conv = (telefono) => db.tablas.wa_conversaciones.find((c) => c.telefono === telefono);
const enviosA = (to) => meta.llamadas.filter((l) => l.metodo === "POST" && l.ruta.endsWith("/PNID1/messages") && l.cuerpo && l.cuerpo.to === to);

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  const ventas = { otorgar: ["ventas.operar"], quitar: [] };
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1, ventas);
  await crear("e2", "Ema Dos", "7.654.321-6", ["ejecutivo"], L1, ventas);
});

test("Webhook: Meta verifica la URL con el token; un aviso sin la firma correcta se rechaza y no crea nada", async () => {
  const get = async (q) => { const r = await manejar(new Request(`http://x/api?whatsapp=1&${q}`, { method: "GET" })); return { status: r.status, texto: await r.text() }; };
  const ok = await get("hub.mode=subscribe&hub.verify_token=verificar-prueba-123&hub.challenge=987654");
  assert.equal(ok.status, 200);
  assert.equal(ok.texto, "987654");
  assert.equal((await get("hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1")).status, 403);

  const malo = await webhook(texto("56911110000", "Intruso", "hola"), { firma: "sha256=" + "0".repeat(64) });
  assert.equal(malo.status, 401);
  assert.equal((await webhook(texto("56911110000", "Intruso", "hola"), { firma: "" })).status, 401);
  assert.equal(db.tablas.wa_conversaciones.length, 0);
  assert.equal(db.tablas.leads.length, 0);
});

test("Número nuevo: crea el cliente y un lead de venta (fuente WhatsApp) repartido a un ejecutivo; el aviso repetido no duplica", async () => {
  const r = await webhook(texto("56911112222", "Pedro Cliente", "Hola, ¿sigue disponible el Yaris?", "wamid.A1"));
  assert.equal(r.status, 200, r.texto);
  const c = conv("56911112222");
  assert.ok(c, "se crea la conversación");
  assert.equal(c.no_leidos, 1);
  assert.equal(c.nombre_perfil, "Pedro Cliente");
  const lead = db.tablas.leads.find((l) => l.id === c.lead_id);
  assert.equal(lead.tipo, "venta");
  assert.equal(lead.fuente, "WhatsApp");
  assert.equal(lead.etapa, "nuevo");
  assert.ok([U.e1.id, U.e2.id].includes(lead.asignado_a), "se reparte entre los ejecutivos de ventas");
  assert.match(lead.notas, /sigue disponible el Yaris/);
  const cliente = db.tablas.clientes.find((x) => x.id === c.cliente_id);
  assert.equal(cliente.nombre, "Pedro Cliente");
  assert.equal(cliente.telefono, "+56911112222");
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === lead.id && /WhatsApp/.test(e.detalle)));

  // Meta reintenta el mismo aviso: no se duplica nada.
  assert.equal((await webhook(texto("56911112222", "Pedro Cliente", "Hola, ¿sigue disponible el Yaris?", "wamid.A1"))).status, 200);
  assert.equal(db.tablas.wa_mensajes.filter((m) => m.wamid === "wamid.A1").length, 1);
  assert.equal(db.tablas.leads.length, 1);
  assert.equal(conv("56911112222").no_leidos, 1);
  U.lead1 = lead;
  U.dueno = lead.asignado_a === U.e1.id ? U.e1 : U.e2;
  U.otro = lead.asignado_a === U.e1.id ? U.e2 : U.e1;
});

test("Bandeja: cada ejecutivo ve solo las conversaciones de sus leads; el Jefe Local ve las del local", async () => {
  const lista = await ve(U.dueno.token, "wa.list");
  assert.equal(lista.status, 200, JSON.stringify(lista));
  assert.equal(lista.conversaciones.length, 1);
  assert.equal(lista.conversaciones[0].nombre, "Pedro Cliente");
  assert.equal(lista.conversaciones[0].no_leidos, 1);
  assert.equal(lista.conversaciones[0].ventanaAbierta, true);
  assert.equal((await ve(U.dueno.token, "wa.resumen")).noLeidos, 1);

  assert.equal((await ve(U.otro.token, "wa.list")).conversaciones.length, 0, "otro ejecutivo no la ve");
  assert.equal((await ve(U.otro.token, "wa.resumen")).noLeidos, 0);
  const id = lista.conversaciones[0].id;
  assert.equal((await ve(U.otro.token, "wa.conversacion", { id })).status, 404);
  assert.equal((await ve(U.otro.token, "wa.enviar", { id, texto: "hola" })).status, 404);
  assert.equal((await ve(U.jefe.token, "wa.list")).conversaciones.length, 1, "el Jefe Local ve las del local");

  const d = await ve(U.dueno.token, "wa.conversacion", { id });
  assert.equal(d.mensajes.length, 1);
  assert.equal(d.mensajes[0].direccion, "entrante");
  assert.equal(d.puedeEscribir, true);
  assert.equal(d.ventanaAbierta, true);

  // Al abrirla queda leída (y se marca como leída en el teléfono del cliente).
  assert.equal((await ve(U.dueno.token, "wa.leer", { id })).status, 200);
  assert.equal(conv("56911112222").no_leidos, 0);
  assert.ok(meta.llamadas.some((l) => l.cuerpo && l.cuerpo.status === "read" && l.cuerpo.message_id === "wamid.A1"));
  U.conv1 = id;
});

test("Responder dentro de las 24 horas: sale por la Cloud API, queda en la conversación y el lead pasa a «Contactado»", async () => {
  const r = await ve(U.dueno.token, "wa.enviar", { id: U.conv1, texto: "¡Hola Pedro! Sí, sigue disponible. ¿Quieres verlo mañana?" });
  assert.equal(r.status, 200, JSON.stringify(r));
  const env = enviosA("56911112222").pop();
  assert.equal(env.cuerpo.type, "text");
  assert.match(env.cuerpo.text.body, /sigue disponible/);
  assert.equal(env.auth, "Bearer EAAprueba");
  assert.equal(r.mensaje.direccion, "saliente");
  assert.equal(r.mensaje.estado, "enviado");
  assert.equal(r.mensaje.usuario_nombre, U.dueno.nombre);
  const lead = db.tablas.leads.find((l) => l.id === U.lead1.id);
  assert.equal(lead.etapa, "contactado", "el primer mensaje cuenta como contacto");
  assert.ok(lead.ultimo_contacto);
  assert.equal(conv("56911112222").ultima_direccion, "saliente");
  assert.equal((await ve(U.dueno.token, "wa.enviar", { id: U.conv1, texto: "   " })).error, "mensaje_vacio");

  // Estados: llegan desordenados (leído antes que entregado) y no retroceden.
  const wamid = r.mensaje.wamid;
  await webhook(estado(wamid, "read"));
  await webhook(estado(wamid, "delivered"));
  assert.equal(db.tablas.wa_mensajes.find((m) => m.wamid === wamid).estado, "leido");

  // Un error de Meta no deja el mensaje como enviado.
  meta.fallarEnvio = "Re-engagement message";
  const antes = db.tablas.wa_mensajes.length;
  const f = await ve(U.dueno.token, "wa.enviar", { id: U.conv1, texto: "otro" });
  assert.equal(f.status, 502);
  assert.equal(f.error, "whatsapp_error");
  assert.match(f.detalle, /Re-engagement/);
  assert.equal(db.tablas.wa_mensajes.length, antes);

  // Un mensaje que falla en el camino queda marcado con el motivo.
  const r2 = await ve(U.dueno.token, "wa.enviar", { id: U.conv1, texto: "¿A qué hora te acomoda?" });
  await webhook(estado(r2.mensaje.wamid, "failed", { errors: [{ code: 131026, title: "Message undeliverable" }] }));
  const m2 = db.tablas.wa_mensajes.find((m) => m.wamid === r2.mensaje.wamid);
  assert.equal(m2.estado, "fallido");
  assert.match(m2.error, /undeliverable/);
});

test("Pasadas 24 horas solo se envían plantillas aprobadas (las que el CRM puede completar)", async () => {
  meta.plantillas = [
    { name: "seguimiento_cotizacion", language: "es", status: "APPROVED", category: "MARKETING", components: [{ type: "HEADER", format: "TEXT", text: "Drive Futuro" }, { type: "BODY", text: "Hola {{1}}, ¿pudiste revisar la cotización del {{2}}?" }, { type: "FOOTER", text: "Responde para hablar con tu ejecutivo" }] },
    { name: "recordatorio_cita", language: "es", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Hola {{nombre}}, te esperamos mañana." }] },
    { name: "con_foto", language: "es", status: "APPROVED", category: "MARKETING", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Mira este auto" }] },
    { name: "pendiente", language: "es", status: "PENDING", category: "MARKETING", components: [{ type: "BODY", text: "Hola" }] },
  ];
  const c = db.tablas.wa_conversaciones.find((x) => x.id === U.conv1);
  c.ultimo_entrante_en = new Date(Date.now() - 25 * 3_600_000).toISOString();
  const d = await ve(U.dueno.token, "wa.conversacion", { id: U.conv1 });
  assert.equal(d.ventanaAbierta, false);
  assert.equal((await ve(U.dueno.token, "wa.enviar", { id: U.conv1, texto: "hola" })).error, "fuera_de_ventana");

  const pl = await ve(U.dueno.token, "wa.plantillas", { recargar: true });
  assert.deepEqual(pl.plantillas.map((p) => p.nombre), ["recordatorio_cita", "seguimiento_cotizacion"], "ni las de imagen ni las no aprobadas");
  const seg = pl.plantillas.find((p) => p.nombre === "seguimiento_cotizacion");
  assert.deepEqual(seg.variables, ["1", "2"]);

  const sinValores = await ve(U.dueno.token, "wa.enviar", { id: U.conv1, plantilla: { nombre: "seguimiento_cotizacion", idioma: "es", valores: ["Pedro"] } });
  assert.equal(sinValores.error, "plantilla_variables");
  assert.equal((await ve(U.dueno.token, "wa.enviar", { id: U.conv1, plantilla: { nombre: "con_foto", idioma: "es", valores: [] } })).error, "plantilla_invalida");

  const r = await ve(U.dueno.token, "wa.enviar", { id: U.conv1, plantilla: { nombre: "seguimiento_cotizacion", idioma: "es", valores: ["Pedro", "Toyota\nYaris 2020"] } });
  assert.equal(r.status, 200, JSON.stringify(r));
  const env = enviosA("56911112222").pop();
  assert.equal(env.cuerpo.type, "template");
  assert.equal(env.cuerpo.template.name, "seguimiento_cotizacion");
  assert.deepEqual(env.cuerpo.template.components[0].parameters, [{ type: "text", text: "Pedro" }, { type: "text", text: "Toyota Yaris 2020" }], "sin saltos de línea en las variables");
  assert.equal(r.mensaje.tipo, "template");
  assert.match(r.mensaje.texto, /Hola Pedro, ¿pudiste revisar la cotización del Toyota Yaris 2020\?/);

  const nom = await ve(U.dueno.token, "wa.enviar", { id: U.conv1, plantilla: { nombre: "recordatorio_cita", idioma: "es", valores: ["Pedro"] } });
  assert.equal(nom.status, 200);
  assert.deepEqual(enviosA("56911112222").pop().cuerpo.template.components[0].parameters, [{ type: "text", parameter_name: "nombre", text: "Pedro" }]);
});

test("Cliente que ya está en el CRM: su mensaje entra al lead que ya tiene, con su ejecutivo, sin crear otro", async () => {
  const l = await ve(U.e2.token, "leads.create", { cliente: { nombre: "Ana Conocida", telefono: "+56 9 8765 4321" }, lead: { tipo: "venta", fuente: "Llamada" } });
  assert.equal(l.status, 200, JSON.stringify(l));
  const nLeads = db.tablas.leads.length;
  assert.equal((await webhook(texto("56987654321", "Ana C.", "Hola, soy Ana"))).status, 200);
  assert.equal(db.tablas.leads.length, nLeads, "no crea otro lead");
  const c = conv("56987654321");
  assert.equal(c.lead_id, l.lead.id);
  assert.equal(c.cliente_id, l.cliente.id);
  assert.equal((await ve(U.e2.token, "wa.list")).conversaciones.some((x) => x.id === c.id), true);
  assert.equal((await ve(U.e1.token, "wa.list")).conversaciones.some((x) => x.id === c.id), false);

  // Si el Jefe Local reasigna el lead, la conversación se va con él.
  const re = await ve(U.jefe.token, "leads.reasignar", { id: l.lead.id, asignarA: U.e1.id });
  assert.equal(re.status, 200, JSON.stringify(re));
  assert.equal((await ve(U.e1.token, "wa.list")).conversaciones.some((x) => x.id === c.id), true);
  assert.equal((await ve(U.e2.token, "wa.list")).conversaciones.some((x) => x.id === c.id), false);
});

test("Desde el lead: escribir primero a un cliente exige plantilla; la conversación se crea con su teléfono", async () => {
  const l = await ve(U.e1.token, "leads.create", { cliente: { nombre: "Luis Nuevo", telefono: "9 5555 4444" }, lead: { tipo: "venta", fuente: "Llamada" } });
  const v = await ve(U.e1.token, "wa.conversacion", { leadId: l.lead.id });
  assert.equal(v.status, 200, JSON.stringify(v));
  assert.equal(v.conversacion, null);
  assert.equal(v.puedeEscribir, true);
  assert.equal(v.telefono, "56955554444");
  assert.equal((await ve(U.e2.token, "wa.conversacion", { leadId: l.lead.id })).status, 404, "otro ejecutivo no ve el lead");

  assert.equal((await ve(U.e1.token, "wa.enviar", { leadId: l.lead.id, texto: "Hola Luis" })).error, "fuera_de_ventana", "sin mensaje del cliente no hay ventana");
  const r = await ve(U.e1.token, "wa.enviar", { leadId: l.lead.id, plantilla: { nombre: "recordatorio_cita", idioma: "es", valores: ["Luis"] } });
  assert.equal(r.status, 200, JSON.stringify(r));
  const c = conv("56955554444");
  assert.equal(c.lead_id, l.lead.id);
  assert.equal(c.local_id, L1);
  assert.equal(enviosA("56955554444").length, 1);
  const v2 = await ve(U.e1.token, "wa.conversacion", { leadId: l.lead.id });
  assert.equal(v2.mensajes.length, 1);

  // Un cliente sin teléfono no se puede escribir.
  const s = await ve(U.e1.token, "leads.create", { cliente: { nombre: "Sin Fono", email: "sinfono@x.cl" }, lead: { tipo: "venta", fuente: "Llamada" } });
  const vs = await ve(U.e1.token, "wa.conversacion", { leadId: s.lead.id });
  assert.equal(vs.sinTelefono, true);
  assert.equal((await ve(U.e1.token, "wa.enviar", { leadId: s.lead.id, plantilla: { nombre: "recordatorio_cita", idioma: "es", valores: ["X"] } })).error, "cliente_sin_telefono");
});

test("Archivos: la foto que manda el cliente se guarda en el CRM; el ejecutivo envía fotos y PDF", async () => {
  meta.archivos.MEDIA77 = { mime: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) };
  assert.equal((await webhook(entrante("56911112222", "Pedro Cliente", { type: "image", image: { id: "MEDIA77", mime_type: "image/jpeg", caption: "Mi auto en parte de pago" } }))).status, 200);
  const m = db.tablas.wa_mensajes.filter((x) => x.tipo === "image" && x.direccion === "entrante").pop();
  assert.equal(m.texto, "Mi auto en parte de pago");
  assert.equal(m.media.guardado, true);
  assert.equal(conv("56911112222").ultimo_texto, "📷 Foto: Mi auto en parte de pago");
  const med = await ve(U.dueno.token, "wa.media", { mensajeId: m.id });
  assert.equal(med.status, 200, JSON.stringify(med));
  assert.equal(med.dataUrl, "data:image/jpeg;base64," + meta.archivos.MEDIA77.bytes.toString("base64"));
  assert.equal((await ve(U.otro.token, "wa.media", { mensajeId: m.id })).status, 404);

  // La ventana se abrió de nuevo con este mensaje: el ejecutivo responde con un PDF.
  const pdf = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 cotizacion").toString("base64");
  const r = await ve(U.dueno.token, "wa.enviar", { id: U.conv1, texto: "Te envío la cotización", archivo: { nombre: "Cotización Yaris.pdf", tipo: "application/pdf", dataUrl: pdf } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.ok(meta.llamadas.some((l) => l.ruta.endsWith("/PNID1/media") && l.cuerpo && l.cuerpo.form && l.cuerpo.type === "application/pdf"), "sube el archivo a Meta");
  const env = enviosA("56911112222").pop();
  assert.equal(env.cuerpo.type, "document");
  assert.equal(env.cuerpo.document.filename, "Cotización Yaris.pdf");
  assert.equal(env.cuerpo.document.caption, "Te envío la cotización");
  assert.equal((await ve(U.dueno.token, "wa.media", { mensajeId: r.mensaje.id })).dataUrl, pdf, "queda una copia en el CRM");
  const exe = "data:application/x-msdownload;base64,TVqQAAMAAAAEAAAA";
  assert.equal((await ve(U.dueno.token, "wa.enviar", { id: U.conv1, archivo: { nombre: "virus.exe", dataUrl: exe } })).error, "archivo_tipo_invalido");
});

test("Configuración: solo el Administrador ve el estado de los secretos y elige el local de los leads nuevos", async () => {
  const e = await ve(U.e1.token, "wa.estado");
  assert.equal(e.configurado, true);
  assert.equal(e.secretos, undefined);
  const a = await ve(admin, "wa.estado");
  assert.equal(a.puedeConfigurar, true);
  assert.deepEqual(a.secretos, { WA_TOKEN: true, WA_PHONE_NUMBER_ID: true, WA_WABA_ID: true, WA_APP_SECRET: true, WA_VERIFY_TOKEN: true });
  assert.equal(a.localEfectivo, L1);
  assert.equal((await ve(U.jefe.token, "wa.config_save", { localId: L1 })).status, 403);
  assert.equal((await ve(admin, "wa.config_save", { localId: "00000000-0000-0000-0000-000000000000" })).error, "local_invalido");
  assert.equal((await ve(admin, "wa.config_save", { localId: L1 })).status, 200);
  assert.equal((await ve(admin, "wa.estado")).localLeads, L1);
});
