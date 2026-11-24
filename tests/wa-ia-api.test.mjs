// Asistente con IA de WhatsApp fuera de horario, de punta a punta: Claude (simulado) busca en el inventario, anota en la ficha y deriva;
// se respetan los topes de gasto y de respuestas; y no interviene cuando no corresponde. Contra la función real, una base falsa,
// una Graph API simulada y un Claude simulado.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db, manejar, meta, ia, entorno } from "./helpers/api-env.mjs";
import { claveUsoMes } from "../supabase/functions/api/wa-ia-core.js";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1;
let n = 0;

const rut = (num) => {
  let s = 0; let m = 2;
  for (const d of String(num).split("").reverse()) { s += Number(d) * m; m = m === 7 ? 2 : m + 1; }
  const r = 11 - (s % 11);
  return `${String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${r === 11 ? "0" : r === 10 ? "K" : String(r)}`;
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
const entrante = (from, nombre, msg) => aviso({ contacts: [{ profile: { name: nombre }, wa_id: from }], messages: [{ from, id: `wamid.IA${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), ...msg }] });
const texto = (from, nombre, body) => entrante(from, nombre, { type: "text", text: { body } });
const lista = (from, nombre, id, titulo) => entrante(from, nombre, { type: "interactive", interactive: { type: "list_reply", list_reply: { id, title: titulo } } });
const boton = (from, nombre, id, titulo) => entrante(from, nombre, { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: titulo } } });
const conv = (t) => db.tablas.wa_conversaciones.find((c) => c.telefono === t);
const envios = (to) => meta.llamadas.filter((l) => l.metodo === "POST" && l.ruta.endsWith("/PNID1/messages") && l.cuerpo && l.cuerpo.to === to);
const delIa = (t) => db.tablas.wa_mensajes.filter((m) => m.direccion === "saliente" && m.usuario_id === "bot-ia" && conv(t) && m.conversacion_id === conv(t).id);
const uso = () => { const f = db.tablas.kv_store.find((r) => r.key === claveUsoMes()); return f ? JSON.parse(f.value) : null; };

// Horario de prueba: abierto solo un minuto al día (03:00 a 03:01), o sea cerrado siempre salvo en ese instante.
const DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const CERRADO = Object.fromEntries(DIAS.map((d) => [d, { abierto: true, desde: "03:00", hasta: "03:01" }]));
const IA = (extra = {}) => ({ activa: true, maxUsdMes: 10, maxPorConversacion: 15, ...extra });
const configurar = (token, ia_, extra = {}) => ve(token, "wa.bot_guardar", { config: { activo: true, empresa: "BuyCar", horario: CERRADO, ia: ia_, ...extra } });

// Respuestas de la API de Claude.
const USAGE = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 500, cache_read_input_tokens: 0 };
const resp = (content, stop = "end_turn", usage = USAGE) => ({ id: `msg_${++n}`, type: "message", role: "assistant", model: "claude-haiku-5-5", content, stop_reason: stop, usage });
const dice = (t) => [{ type: "text", text: t }];
const herramienta = (name, input, id = "toolu_1") => [{ type: "tool_use", id, name, input }];
const reiniciarIa = () => { ia.llamadas.length = 0; ia.guion.length = 0; ia.error = ""; };

/** El cliente completa el menú del asistente (queda en «listo» y con su lead de compra). */
async function completarMenu(T, perfil = "Cliente IA") {
  await webhook(texto(T, perfil, "Hola buenas noches"));
  await webhook(lista(T, perfil, "vender", "Vender mi auto"));
  await webhook(texto(T, perfil, perfil));
  await webhook(texto(T, perfil, "Toyota Yaris 2018 con 60.000 km"));
  await webhook(boton(T, perfil, "pm", "En la tarde"));
  assert.equal(conv(T).bot_estado.paso, "listo");
}

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  entorno.ANTHROPIC_API_KEY = "sk-ant-prueba";
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  await crear("jefe", "Julia Jefa", rut(12345678), ["jefe_local"], L1);
  await crear("v1", "Vera Vendedora", rut(6000000), ["ejecutivo"], L1, { otorgar: ["ventas.operar"], quitar: [] });
  await crear("c1", "Carla Compradora", rut(7654321), ["ejecutivo"], L1, { otorgar: ["compras.operar"], quitar: ["ventas.operar"] });
  const base = { activo: true, estado: "disponible", local_id: L1, fotos: ["f1"] };
  db.tablas.vehiculos.push(
    { ...base, id: "veh-yaris-a", patente: "AAAA11", marca: "Toyota", modelo: "Yaris", version: "1.5 SE", anio: 2020, km: 45000, color: "Rojo", transmision: "Automática", combustible: "Bencina", precio_lista: 9_490_000, precio_financiamiento: 8_990_000, costo: 6_100_000 },
    { ...base, id: "veh-yaris-m", patente: "BBBB22", marca: "Toyota", modelo: "Yaris", version: "1.5 XS", anio: 2018, km: 80000, transmision: "Manual", combustible: "Bencina", precio_lista: 7_990_000, costo: 5_000_000 },
    { ...base, id: "veh-vendido", patente: "CCCC33", marca: "Toyota", modelo: "Yaris", anio: 2019, km: 50000, precio_lista: 8_000_000, estado: "vendido" },
  );
});

test("Apagada (por defecto) o sin clave: una pregunta después del menú no llama a Claude", async () => {
  reiniciarIa();
  await configurar(U.jefe.token, IA({ activa: false }));
  const T = "56911000001";
  await completarMenu(T);
  const antes = envios(T).length;
  await webhook(texto(T, "Cliente IA", "¿Tienen un Yaris automático bajo 10 millones?"));
  assert.equal(ia.llamadas.length, 0, "con la IA apagada no se llama a Claude");
  assert.equal(envios(T).length, antes, "y el asistente de menú sigue en silencio");
  // Encendida, pero sin la clave cargada en Supabase: tampoco llama ni rompe nada.
  await configurar(U.jefe.token, IA());
  const clave = entorno.ANTHROPIC_API_KEY; delete entorno.ANTHROPIC_API_KEY;
  const r = await webhook(texto(T, "Cliente IA", "¿Y cuánto cuesta el Yaris rojo?"));
  entorno.ANTHROPIC_API_KEY = clave;
  assert.equal(r.status, 200);
  assert.equal(ia.llamadas.length, 0);
  assert.equal(envios(T).length, antes);
});

test("Pregunta de inventario: Claude busca, la función le entrega solo datos públicos y el cliente recibe la respuesta", async () => {
  reiniciarIa();
  await configurar(U.jefe.token, IA());
  const T = "56911000002";
  await completarMenu(T, "Pedro IA");
  ia.guion.push(
    resp(herramienta("buscar_inventario", { marca: "Toyota", modelo: "Yaris", precio_max: 10_000_000 }), "tool_use"),
    resp(dice("Sí, tengo dos Yaris: uno automático 2020 en *$9.490.000* ($8.990.000 con financiamiento). ¿Te interesa?")),
  );
  const antes = envios(T).length;
  const r = await webhook(texto(T, "Pedro IA", "¿Tienen un Yaris automático bajo 10 millones?"));
  assert.equal(r.status, 200);
  assert.equal(ia.llamadas.length, 2, "una llamada para pedir la herramienta y otra con su resultado");

  // Lo que se le pide a Claude.
  const c1 = ia.llamadas[0];
  assert.equal(c1.model, "claude-haiku-5-5");
  assert.equal(c1.output_config.effort, "low");
  assert.deepEqual(c1.tools.map((t) => t.name), ["buscar_inventario", "anotar_en_ficha", "derivar_a_ejecutivo"]);
  assert.equal(c1.system[0].cache_control.type, "ephemeral", "las instrucciones estables se guardan en caché");
  assert.match(c1.system[0].text, /asistente virtual de BuyCar/);
  assert.ok(!("cache_control" in c1.system[1]), "el contexto variable va después del punto de caché");
  assert.match(c1.system[1].text, /Atendemos lunes a domingo de 03:00 a 03:01/);
  assert.match(c1.system[1].text, /Nombre del cliente: Pedro IA/);
  assert.match(c1.system[1].text, /Vender mi auto/);
  assert.equal(c1.messages[0].role, "user");
  assert.equal(c1.messages[c1.messages.length - 1].role, "user");
  assert.match(c1.messages[c1.messages.length - 1].content, /Yaris automático bajo 10 millones/);

  // El resultado de la herramienta: va en UN mensaje de usuario, con los autos públicos y sin datos internos.
  const c2 = ia.llamadas[1];
  const ult = c2.messages[c2.messages.length - 1];
  assert.equal(ult.role, "user");
  assert.equal(ult.content.length, 1);
  assert.equal(ult.content[0].type, "tool_result");
  assert.equal(ult.content[0].tool_use_id, "toolu_1");
  assert.equal(c2.messages[c2.messages.length - 2].role, "assistant", "se devuelve lo que pidió Claude antes de darle el resultado");
  const datos = JSON.parse(ult.content[0].content);
  assert.equal(datos.total, 2, "no entra el auto vendido");
  assert.deepEqual(datos.autos.map((a) => a.auto), ["Toyota Yaris 1.5 XS", "Toyota Yaris 1.5 SE"]);
  assert.equal(datos.autos[1].enlace, "https://fdrive02.vercel.app/vehiculo/veh-yaris-a");
  for (const secreto of ["6100000", "5000000", "AAAA11", "BBBB22", "costo", "patente"]) assert.ok(!ult.content[0].content.includes(secreto), `no filtra «${secreto}»`);

  // Lo que recibe el cliente y lo que queda en la conversación.
  const e = envios(T);
  assert.equal(e.length, antes + 1);
  assert.match(e[e.length - 1].cuerpo.text.body, /tengo dos Yaris/);
  const guardado = delIa(T);
  assert.equal(guardado.length, 1);
  assert.equal(guardado[0].usuario_nombre, "Asistente IA");
  assert.equal(guardado[0].estado, "enviado");
  assert.equal(conv(T).bot_estado.paso, "listo", "el menú ya había terminado y sigue así");
});

test("Gasto: cada respuesta se suma al mes, con el precio del modelo y la caché", async () => {
  const u = uso();
  assert.equal(u.llamadas, 2);
  assert.equal(u.entrada, 2000);
  assert.equal(u.salida, 200);
  assert.equal(u.cache_escritura, 1000);
  // Haiku 5.5: 2000 × 0,10 + 200 × 0,50 + 1000 × 0,125 = 425 millonésimas de dólar.
  assert.ok(Math.abs(u.usd - 0.000425) < 1e-9, `usd = ${u.usd}`);
  const e = await ve(U.jefe.token, "wa.bot_estado");
  assert.equal(e.ia.claveCargada, true);
  assert.equal(e.ia.modelo, "claude-haiku-5-5");
  assert.equal(e.ia.uso.llamadas, 2);
  assert.equal(e.config.ia.maxUsdMes, 10);
  assert.equal((await ve(U.v1.token, "wa.bot_estado")).ia.uso, null, "un ejecutivo no ve el gasto");
});

test("Anotar en la ficha: lo que dijo el cliente queda en las notas y en el historial del lead", async () => {
  reiniciarIa();
  const T = "56911000003";
  await completarMenu(T, "Ana IA");
  ia.guion.push(
    resp(herramienta("anotar_en_ficha", { resumen: "Busca un Yaris automático hasta 10 millones, paga con crédito", visita_preferida: "sábado 11:00" }), "tool_use"),
    resp(dice("¡Perfecto, Ana! Dejé anotado que quieres venir el sábado a las 11:00. Un ejecutivo te confirma.")),
  );
  await webhook(texto(T, "Ana IA", "Me interesa el Yaris, puedo ir el sábado a las 11 y pagaría con crédito"));
  const lead = db.tablas.leads.find((l) => l.id === conv(T).lead_id);
  assert.match(lead.notas, /Asistente virtual \(IA\) anotó:\n• Busca un Yaris automático hasta 10 millones, paga con crédito\n• Visita preferida: sábado 11:00/);
  assert.ok(db.tablas.lead_eventos.some((x) => x.lead_id === lead.id && x.usuario_nombre === "Asistente IA" && /Visita preferida/.test(x.detalle)));
  assert.equal(conv(T).bot_estado.derivado, undefined, "anotar no deriva");
  assert.equal(delIa(T).length, 1);
});

test("Derivar a un ejecutivo: etiqueta la conversación, avisa, y la IA deja de responder", async () => {
  reiniciarIa();
  const T = "56911000004";
  await completarMenu(T, "Beto IA");
  // Claude deriva y, como a veces ocurre, no escribe texto: el servidor confirma al cliente por su cuenta.
  ia.guion.push(resp(herramienta("derivar_a_ejecutivo", { motivo: "quiere negociar el precio del Yaris" }), "tool_use"), resp([]));
  await webhook(texto(T, "Beto IA", "Quiero negociar el precio del Yaris, ¿me hacen un descuento?"));
  const e = envios(T);
  assert.match(e[e.length - 1].cuerpo.text.body, /^Listo, dejé tu consulta para un ejecutivo: te contactará .* desde las 03:00/);
  assert.deepEqual(conv(T).etiquetas, ["Pidió ejecutivo"]);
  assert.equal(conv(T).bot_estado.derivado, true);
  const lead = db.tablas.leads.find((l) => l.id === conv(T).lead_id);
  assert.match(lead.notas, /derivó a un ejecutivo: quiere negociar el precio del Yaris/);
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "whatsapp.ia_deriva"));
  // Ya derivada: otro mensaje no vuelve a llamar a Claude.
  const llamadas = ia.llamadas.length;
  const antes = envios(T).length;
  await webhook(texto(T, "Beto IA", "¿Y para cuándo me llaman? Es urgente"));
  assert.equal(ia.llamadas.length, llamadas);
  assert.equal(envios(T).length, antes);
});

test("Topes: gasto mensual y respuestas por conversación; al alcanzarlos la IA calla, sin romper nada", async () => {
  reiniciarIa();
  // Máximo de respuestas de IA por conversación.
  await configurar(U.jefe.token, IA({ maxPorConversacion: 1 }));
  const T = "56911000005";
  await completarMenu(T, "Carlos IA");
  ia.guion.push(resp(dice("Claro, ¿qué auto buscas?")));
  await webhook(texto(T, "Carlos IA", "Hola, quisiera consultar por autos"));
  assert.equal(ia.llamadas.length, 1);
  await webhook(texto(T, "Carlos IA", "Busco un SUV para la familia"));
  assert.equal(ia.llamadas.length, 1, "a la segunda ya no responde: el tope era 1 por conversación");
  assert.equal(delIa(T).length, 1);

  // Tope de gasto del mes: con lo gastado por encima del tope, no se llama.
  await configurar(U.jefe.token, IA({ maxUsdMes: 1 }));
  db.tablas.kv_store.find((r) => r.key === claveUsoMes()).value = JSON.stringify({ llamadas: 9, entrada: 1, salida: 1, cache_escritura: 0, cache_lectura: 0, usd: 1.5 });
  const T2 = "56911000006";
  await completarMenu(T2, "Diana IA");
  const antes = ia.llamadas.length;
  const r = await webhook(texto(T2, "Diana IA", "¿Tienen camionetas diésel?"));
  assert.equal(r.status, 200);
  assert.equal(ia.llamadas.length, antes, "con el tope de dólares alcanzado no se llama a Claude");
  // Tope en 0 = sin tope de gasto.
  await configurar(U.jefe.token, IA({ maxUsdMes: 0 }));
  ia.guion.push(resp(dice("Revisemos las camionetas.")));
  await webhook(texto(T2, "Diana IA", "¿Y camionetas 4x4 diésel tienen?"));
  assert.equal(ia.llamadas.length, antes + 1);
});

test("Si Claude falla o se niega, el cliente no queda con una conversación a medias", async () => {
  reiniciarIa();
  await configurar(U.jefe.token, IA());
  const T = "56911000007";
  await completarMenu(T, "Elena IA");
  const antes = envios(T).length;
  ia.error = "401 authentication_error: invalid x-api-key";
  const r = await webhook(texto(T, "Elena IA", "¿Tienen un auto económico para ciudad?"));
  assert.equal(r.status, 200, "el aviso de Meta se atiende igual");
  // El Administrador ve en la tarjeta que la última consulta falló y por qué (por ejemplo, una clave inválida).
  const falla = (await ve(U.jefe.token, "wa.bot_estado")).ia.ultimo;
  assert.equal(falla.ok, false);
  assert.match(falla.error, /invalid x-api-key/);
  assert.equal((await ve(U.v1.token, "wa.bot_estado")).ia.ultimo, null, "un ejecutivo no ve el detalle");
  assert.equal(envios(T).length, antes, "no se manda nada si Claude falla");
  assert.ok(db.tablas.wa_mensajes.some((m) => m.direccion === "entrante" && /auto económico/.test(m.texto || "")), "el mensaje del cliente queda para el ejecutivo");
  // Cuando Claude vuelve, sigue funcionando.
  ia.guion.push(resp(dice("Claro, tengo varias opciones económicas.")));
  await webhook(texto(T, "Elena IA", "¿Siguen ahí? Mi mensaje anterior no tuvo respuesta"));
  assert.equal(envios(T).length, antes + 1);
  assert.equal((await ve(U.jefe.token, "wa.bot_estado")).ia.ultimo.ok, true, "y la tarjeta vuelve a decir que funciona");

  // La IA se niega a responder (refusal): se deriva a una persona.
  const T2 = "56911000008";
  await completarMenu(T2, "Fabio IA");
  ia.guion.push(resp([], "refusal"));
  await webhook(texto(T2, "Fabio IA", "Dime algo que no corresponde responder"));
  const e = envios(T2);
  assert.match(e[e.length - 1].cuerpo.text.body, /^Esa consulta se la paso a un ejecutivo, que te contactará /);
  assert.deepEqual(conv(T2).etiquetas, ["Pidió ejecutivo"]);
});

test("No interviene si un ejecutivo ya le está escribiendo al cliente", async () => {
  reiniciarIa();
  const T = "56911000009";
  await completarMenu(T, "Gaby IA");
  const lead = db.tablas.leads.find((l) => l.id === conv(T).lead_id);
  assert.equal(lead.asignado_a, U.c1.id, "el lead de compra quedó con la compradora");
  const r = await ve(U.c1.token, "wa.enviar", { id: conv(T).id, texto: "Hola Gaby, soy Carla, ¿cómo estás?" });
  assert.equal(r.status, 200, JSON.stringify(r));
  const antes = envios(T).length;
  await webhook(texto(T, "Gaby IA", "Hola Carla, quería saber si compran autos con deuda"));
  assert.equal(ia.llamadas.length, 0);
  assert.equal(envios(T).length, antes);
});

test("Pregunta libre en medio del menú: la IA responde y el menú sigue esperando que elija", async () => {
  reiniciarIa();
  await configurar(U.jefe.token, IA());
  const T = "56911000010";
  await webhook(texto(T, "Hugo IA", "Hola buenas noches"));
  assert.equal(conv(T).bot_estado.paso, "necesidad");
  ia.guion.push(resp(dice("Estamos en Av. Principal 123. Cuando abramos te atendemos. ¿Qué necesitas hoy?")));
  await webhook(texto(T, "Hugo IA", "¿Cuál es la dirección del local?"));
  assert.equal(ia.llamadas.length, 1);
  assert.equal(conv(T).bot_estado.paso, "necesidad", "el menú sigue esperando");
  assert.equal(delIa(T).length, 1);
  // Una frase que el menú sí entiende («quiero comprar») la sigue atendiendo el menú, no la IA.
  await webhook(texto(T, "Hugo IA", "quiero comprar un auto"));
  assert.equal(ia.llamadas.length, 1);
  assert.equal(conv(T).bot_estado.paso, "nombre");
  // Con el menú pidiendo el nombre, lo que escriba es su respuesta, no una pregunta para la IA.
  await webhook(texto(T, "Hugo IA", "Hugo Soto Pérez"));
  assert.equal(ia.llamadas.length, 1);
  assert.equal(conv(T).bot_estado.datos.nombre, "Hugo Soto Pérez");
  // Respuestas de botones y mensajes muy cortos tampoco van a la IA.
  const T2 = "56911000011";
  await webhook(texto(T2, "Iris IA", "Hola buenas noches"));
  await webhook(texto(T2, "Iris IA", "Hola"));
  assert.equal(ia.llamadas.length, 1);
});

test("Cliente que ya tenía ejecutivo: la IA responde (con su nombre) en vez del aviso corto", async () => {
  reiniciarIa();
  const T = "56911000012";
  await webhook(texto(T, "Juan IA", "Hola buenas noches"));
  const lead = db.tablas.leads.find((l) => l.id === conv(T).lead_id);
  lead.creado_en = new Date(Date.now() - 3 * 86_400_000).toISOString();
  conv(T).bot_estado = null; conv(T).bot_actualizado = null;
  ia.guion.push(resp(dice("Hola Juan, con gusto te ayudo.")));
  await webhook(texto(T, "Juan IA", "¿Tienen novedades de mi consulta anterior?"));
  assert.equal(ia.llamadas.length, 1);
  assert.match(ia.llamadas[0].system[1].text, /Su ejecutivo es Vera Vendedora\./);
  const e = envios(T);
  assert.equal(e[e.length - 1].cuerpo.text.body, "Hola Juan, con gusto te ayudo.");
  assert.equal(conv(T).bot_estado.paso, "listo");
  assert.equal(conv(T).bot_estado.ia, true);
});

test("Configuración: solo el Administrador y el Jefe Local la cambian y se valida", async () => {
  assert.equal((await ve(U.v1.token, "wa.bot_guardar", { config: { activo: true, ia: IA() } })).status, 403);
  assert.equal((await configurar(U.jefe.token, IA({ maxUsdMes: -3 }))).error, "ia_config_invalida");
  assert.equal((await configurar(U.jefe.token, IA({ maxPorConversacion: 0 }))).error, "ia_config_invalida");
  const ok = await configurar(admin, IA({ maxUsdMes: 25, maxPorConversacion: 10 }));
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.deepEqual(ok.config.ia, { activa: true, maxUsdMes: 25, maxPorConversacion: 10 });
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "whatsapp.bot_config"));
});
