// Asistente de WhatsApp fuera de horario, de punta a punta: la configuración, la conversación con botones y listas,
// el cambio de tipo del lead con reasignación por tipo y rotación, y los casos en que NO debe intervenir.
// Contra la función real, una base falsa y una Graph API simulada.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db, manejar, meta } from "./helpers/api-env.mjs";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1;
let n = 0;

// RUT chileno válido a partir de un número (para crear usuarios de prueba).
const rut = (num) => {
  let s = 0; let m = 2;
  for (const d of String(num).split("").reverse()) { s += Number(d) * m; m = m === 7 ? 2 : m + 1; }
  const r = 11 - (s % 11);
  const dv = r === 11 ? "0" : r === 10 ? "K" : String(r);
  return `${String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}`;
};
async function crear(clave, nombre, run, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut: run, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut: run, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}
async function webhook(payload) {
  const cuerpo = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", "secreto-app-prueba").update(cuerpo).digest("hex");
  const res = await manejar(new Request("http://x/api?whatsapp=1", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: cuerpo }));
  return { status: res.status, texto: await res.text() };
}
const aviso = (value) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "56220000000", phone_number_id: "PNID1" }, ...value } }] }] });
const entrante = (from, nombre, msg) => aviso({ contacts: [{ profile: { name: nombre }, wa_id: from }], messages: [{ from, id: `wamid.BOT${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), ...msg }] });
const texto = (from, nombre, body) => entrante(from, nombre, { type: "text", text: { body } });
const lista = (from, nombre, id, titulo) => entrante(from, nombre, { type: "interactive", interactive: { type: "list_reply", list_reply: { id, title: titulo } } });
const boton = (from, nombre, id, titulo) => entrante(from, nombre, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: titulo } } });
const conv = (t) => db.tablas.wa_conversaciones.find((c) => c.telefono === t);
const envios = (to) => meta.llamadas.filter((l) => l.metodo === "POST" && l.ruta.endsWith("/PNID1/messages") && l.cuerpo && l.cuerpo.to === to);
const delBot = (to) => db.tablas.wa_mensajes.filter((m) => m.direccion === "saliente" && m.usuario_id === "bot" && conv(to) && m.conversacion_id === conv(to).id);

// Horarios de prueba: «siempre cerrado» (el asistente interviene) y «siempre abierto» (no interviene).
const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const CERRADO = Object.fromEntries(DIAS.map((d) => [d, { abierto: false, desde: "09:00", hasta: "19:00" }]));
const ABIERTO = Object.fromEntries(DIAS.map((d) => [d, { abierto: true, desde: "00:00", hasta: "23:59" }]));
const configurar = (token, config) => ve(token, "wa.bot_guardar", { config });

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  await crear("jefe", "Julia Jefa", rut(12345678), ["jefe_local"], L1);
  await crear("v1", "Vera Vendedora", rut(6000000), ["ejecutivo"], L1, { otorgar: ["ventas.operar"], quitar: [] });
  await crear("c1", "Carla Compradora", rut(7654321), ["ejecutivo"], L1, { otorgar: ["compras.operar"], quitar: ["ventas.operar"] });
});

test("Configuración: apagado por defecto; la cambian el Administrador y el Jefe Local, no un ejecutivo; se valida", async () => {
  const e = await ve(U.v1.token, "wa.bot_estado");
  assert.equal(e.status, 200, JSON.stringify(e));
  assert.equal(e.config.activo, false);
  assert.equal(e.puedeConfigurar, false);
  assert.equal(e.horarioTexto, "lunes a viernes de 09:00 a 19:00 y sábado de 10:00 a 14:00");
  assert.equal((await configurar(U.v1.token, { activo: true, horario: CERRADO })).status, 403);
  assert.equal((await configurar(U.jefe.token, { activo: true, horario: { lun: { abierto: true, desde: "19:00", hasta: "09:00" } } })).error, "bot_horario_invalido");
  const ok = await configurar(U.jefe.token, { activo: false, empresa: "BuyCar", horario: CERRADO });
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(ok.config.empresa, "BuyCar");
  assert.equal((await ve(U.jefe.token, "wa.bot_estado")).puedeConfigurar, true);
  assert.equal((await ve(admin, "wa.bot_estado")).config.empresa, "BuyCar");
  assert.ok(db.tablas.bitacora.some((a) => a.accion === "whatsapp.bot_config"));
});

test("Apagado: el cliente escribe fuera de horario y el asistente no responde nada", async () => {
  assert.equal((await webhook(texto("56900000001", "Sin Bot", "Hola"))).status, 200);
  assert.equal(envios("56900000001").length, 0);
  assert.equal(conv("56900000001").bot_estado, null);
});

test("En horario laboral el asistente tampoco interviene, aunque esté encendido", async () => {
  await configurar(U.jefe.token, { activo: true, empresa: "BuyCar", horario: ABIERTO });
  assert.equal((await webhook(texto("56900000002", "De Día", "Hola"))).status, 200);
  assert.equal(envios("56900000002").length, 0);
  await configurar(U.jefe.token, { activo: true, empresa: "BuyCar", horario: CERRADO });
});

test("Cliente nuevo fuera de horario: lista → nombre → detalle → preferencia → lead de compra reasignado a quien compra", async () => {
  const T = "56900000010";
  assert.equal((await webhook(texto(T, "Pedro WA", "Hola buenas noches"))).status, 200);
  // Primero entra como siempre: lead de venta repartido entre los vendedores.
  const lead = db.tablas.leads.find((l) => l.id === conv(T).lead_id);
  assert.equal(lead.tipo, "venta");
  assert.equal(lead.asignado_a, U.v1.id);

  // El asistente responde con la lista de opciones.
  let e = envios(T);
  assert.equal(e.length, 1);
  assert.equal(e[0].cuerpo.type, "interactive");
  assert.equal(e[0].cuerpo.interactive.type, "list");
  assert.match(e[0].cuerpo.interactive.body.text, /asistente de BuyCar/);
  assert.deepEqual(e[0].cuerpo.interactive.action.sections[0].rows.map((r) => r.id), ["comprar", "vender", "consignar", "financiar", "otra"]);
  assert.equal(conv(T).bot_estado.paso, "necesidad");
  const salida = delBot(T)[0];
  assert.equal(salida.usuario_nombre, "Asistente");
  assert.match(salida.texto, /▫️ Vender mi auto/);
  assert.equal(conv(T).no_leidos, 1, "el mensaje del cliente sigue sin leer para el ejecutivo");

  // Toca «Vender mi auto» (la respuesta de la lista llega con el id de la fila).
  await webhook(lista(T, "Pedro WA", "vender", "Vender mi auto"));
  e = envios(T);
  assert.equal(e.length, 2);
  assert.match(e[1].cuerpo.text.body, /¿Cómo te llamas\?/);
  assert.equal(conv(T).bot_estado.paso, "nombre");
  assert.ok(db.tablas.wa_mensajes.some((m) => m.direccion === "entrante" && m.texto === "Vender mi auto"), "lo que tocó queda en la conversación");

  await webhook(texto(T, "Pedro WA", "Pedro Pérez"));
  assert.match(envios(T)[2].cuerpo.text.body, /Gracias, Pedro\. ¿Qué auto quieres vender\?/);

  await webhook(texto(T, "Pedro WA", "Toyota Yaris 2018 con 60.000 km"));
  const b = envios(T)[3];
  assert.equal(b.cuerpo.interactive.type, "button");
  assert.deepEqual(b.cuerpo.interactive.action.buttons.map((x) => x.reply.id), ["am", "pm", "igual"]);
  assert.equal(db.tablas.leads.find((l) => l.id === lead.id).tipo, "venta", "hasta no terminar, el lead no cambia");

  await webhook(boton(T, "Pedro WA", "pm", "En la tarde"));
  const cierre = envios(T)[4];
  assert.match(cierre.cuerpo.text.body, /Listo, Pedro ✅/);
  assert.match(cierre.cuerpo.text.body, /\(en la tarde\)/);
  assert.equal(conv(T).bot_estado.paso, "listo");

  // El lead queda como compra, con los datos, reasignado a quien compra, y el cliente con su nombre.
  const final = db.tablas.leads.find((l) => l.id === lead.id);
  assert.equal(final.tipo, "compra");
  assert.equal(final.asignado_a, U.c1.id, "pasó del vendedor al comprador");
  assert.match(final.notas, /Necesita: Vender mi auto/);
  assert.match(final.notas, /Detalle: Toyota Yaris 2018 con 60.000 km/);
  assert.match(final.notas, /Prefiere que lo contacten: En la tarde/);
  assert.equal(db.tablas.clientes.find((c) => c.id === conv(T).cliente_id).nombre, "Pedro Pérez");
  const ev = db.tablas.lead_eventos.filter((x) => x.lead_id === lead.id && x.usuario_nombre === "Asistente");
  assert.equal(ev.length, 1);
  assert.match(ev[0].detalle, /ahora lo atiende Carla Compradora/);
  assert.ok(db.tablas.bitacora.some((a) => a.accion === "whatsapp.bot"));

  // Si el cliente sigue escribiendo, el asistente calla: lo lee el ejecutivo en la mañana.
  await webhook(texto(T, "Pedro WA", "Gracias, quedo atento"));
  assert.equal(envios(T).length, 5);
  assert.equal(conv(T).no_leidos, 6);
});

test("Si el tipo no cambia de grupo (comprar) el lead conserva a su vendedor; sin nadie habilitado para consignar queda sin asignar", async () => {
  const A = "56900000020";
  await webhook(texto(A, "Ana WA", "Hola"));
  await webhook(lista(A, "Ana WA", "comprar", "Comprar un auto"));
  await webhook(texto(A, "Ana WA", "Ana Rojas"));
  assert.match(envios(A)[2].cuerpo.text.body, /¿Qué auto buscas\?/);
  await webhook(texto(A, "Ana WA", "Una SUV hasta 12 millones"));
  await webhook(boton(A, "Ana WA", "am", "En la mañana"));
  const la = db.tablas.leads.find((l) => l.id === conv(A).lead_id);
  assert.equal(la.tipo, "venta");
  assert.equal(la.asignado_a, U.v1.id);
  assert.match(la.notas, /Necesita: Comprar un auto/);

  const B = "56900000021";
  await webhook(texto(B, "Beto WA", "Hola"));
  await webhook(lista(B, "Beto WA", "consignar", "Consignar mi auto"));
  await webhook(texto(B, "Beto WA", "Beto"));
  await webhook(texto(B, "Beto WA", "Suzuki Swift 2020"));
  await webhook(boton(B, "Beto WA", "igual", "Me da igual"));
  const lb = db.tablas.leads.find((l) => l.id === conv(B).lead_id);
  assert.equal(lb.tipo, "consignacion");
  assert.equal(lb.asignado_a, null, "nadie tiene la habilitación de Consignaciones");
  assert.match(db.tablas.lead_eventos.filter((x) => x.lead_id === lb.id && x.usuario_nombre === "Asistente")[0].detalle, /quedó sin asignar/);
});

test("Si el cliente escribe en vez de tocar, se entiende; si no se entiende, se repite la lista una vez y luego se sigue", async () => {
  const T = "56900000030";
  await webhook(texto(T, "Lucho", "Hola"));
  await webhook(texto(T, "Lucho", "quiero tasar mi camioneta"));
  assert.equal(conv(T).bot_estado.datos.necesidad, "vender");
  const U2 = "56900000031";
  await webhook(texto(U2, "Mari", "Hola"));
  await webhook(texto(U2, "Mari", "asdf qwer"));
  assert.match(envios(U2)[1].cuerpo.interactive.body.text, /No te entendí/);
  assert.equal(conv(U2).bot_estado.paso, "necesidad");
  await webhook(texto(U2, "Mari", "es un reclamo por una garantía"));
  assert.equal(conv(U2).bot_estado.datos.necesidad, "otra");
  assert.equal(conv(U2).bot_estado.datos.detalle, "es un reclamo por una garantía");
});

test("Si un ejecutivo ya le está escribiendo al cliente, el asistente se queda en silencio", async () => {
  const T = "56900000040";
  await webhook(texto(T, "Hugo WA", "Hola"));
  assert.equal(envios(T).length, 1);
  const dueno = conv(T);
  const lead = db.tablas.leads.find((l) => l.id === dueno.lead_id);
  const quien = lead.asignado_a === U.v1.id ? U.v1 : U.c1;
  const r = await ve(quien.token, "wa.enviar", { id: dueno.id, texto: "Hola Hugo, soy tu ejecutivo, ¿en qué te ayudo?" });
  assert.equal(r.status, 200, JSON.stringify(r));
  const antes = envios(T).length;
  await webhook(lista(T, "Hugo WA", "comprar", "Comprar un auto"));
  assert.equal(envios(T).length, antes, "el asistente no responde si un humano escribió hace poco");
  assert.equal(conv(T).bot_estado.paso, "necesidad", "el estado queda como estaba");
});

test("Cliente que ya tenía lead hace rato: un aviso corto con el nombre de su ejecutivo, una sola vez", async () => {
  const T = "56900000050";
  await webhook(texto(T, "Rita WA", "Hola"));
  await webhook(lista(T, "Rita WA", "comprar", "Comprar un auto"));
  // Se vuelve un cliente antiguo: el lead ya no es «recién llegado» y la conversación del asistente se reinicia.
  const lead = db.tablas.leads.find((l) => l.id === conv(T).lead_id);
  lead.creado_en = new Date(Date.now() - 3 * 86_400_000).toISOString();
  conv(T).bot_estado = null; conv(T).bot_actualizado = null;
  const antes = envios(T).length;
  await webhook(texto(T, "Rita WA", "¿Tienen novedades?"));
  const e = envios(T);
  assert.equal(e.length, antes + 1);
  const ult = e[e.length - 1].cuerpo;
  assert.equal(ult.type, "text");
  assert.match(ult.text.body, /^Hola Rita, ahora estamos fuera de horario \(atendemos /);
  assert.match(ult.text.body, /Vera te responderá/);
  await webhook(texto(T, "Rita WA", "¿Alguien?"));
  assert.equal(envios(T).length, antes + 1, "no repite el aviso en las siguientes 12 horas");
});

test("Reacciones y fallos de Meta: el asistente no estorba (el mensaje del cliente siempre queda guardado)", async () => {
  const T = "56900000060";
  await webhook(entrante(T, "Fer", { type: "reaction", reaction: { message_id: "x", emoji: "👍" } }));
  assert.equal(envios(T).length, 0, "una reacción no abre una conversación con el asistente");
  // Meta rechaza el envío del asistente: el webhook igual responde 200 y el mensaje queda en la bandeja.
  meta.fallarEnvio = "Re-engagement message";
  const r = await webhook(texto("56900000061", "Gus", "Hola"));
  meta.fallarEnvio = "";
  assert.equal(r.status, 200);
  assert.ok(db.tablas.wa_mensajes.some((m) => m.direccion === "entrante" && m.texto === "Hola" && m.conversacion_id === conv("56900000061").id));
  assert.equal(conv("56900000061").bot_estado, null, "sin respuesta enviada no queda una conversación a medias");
});
