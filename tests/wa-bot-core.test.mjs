// Asistente de WhatsApp fuera de horario: horario de Chile, conversación paso a paso y mensajes de Meta.
import test from "node:test";
import assert from "node:assert/strict";
import {
  HORARIO_DEFECTO, validarConfigBot, configBot, estaAbierto, proximaApertura, textoHorario, interpretarNecesidad, avanzar, estadoInicial,
  mensajeInicio, mensajeFueraDeHorario, resumenBot, cuerpoMeta, textoParaConversacion, tipoLeadDeNecesidad, NECESIDADES,
} from "../supabase/functions/api/wa-bot-core.js";

// En noviembre Chile está en horario de verano (UTC-3): 15:00 en Santiago = 18:00Z.
const stgo = (iso) => new Date(`${iso}-03:00`);
const CFG = { activo: true, empresa: "BuyCar", horario: HORARIO_DEFECTO };

test("Horario: abierto y cerrado según la hora de Chile (no la del servidor)", () => {
  assert.equal(estaAbierto(HORARIO_DEFECTO, stgo("2026-11-24T15:00:00")), true, "martes 15:00");
  assert.equal(estaAbierto(HORARIO_DEFECTO, stgo("2026-11-24T08:59:00")), false, "antes de abrir");
  assert.equal(estaAbierto(HORARIO_DEFECTO, stgo("2026-11-24T09:00:00")), true, "justo a la apertura");
  assert.equal(estaAbierto(HORARIO_DEFECTO, stgo("2026-11-24T19:00:00")), false, "justo al cierre");
  assert.equal(estaAbierto(HORARIO_DEFECTO, stgo("2026-11-28T12:00:00")), true, "sábado de 10 a 14");
  assert.equal(estaAbierto(HORARIO_DEFECTO, stgo("2026-11-28T15:00:00")), false, "sábado después de las 14");
  assert.equal(estaAbierto(HORARIO_DEFECTO, stgo("2026-11-29T12:00:00")), false, "domingo cerrado");
  // 23:30 del martes en Chile ya es miércoles en UTC: sigue siendo martes para el local.
  assert.equal(estaAbierto(HORARIO_DEFECTO, new Date("2026-11-25T02:30:00Z")), false);
});

test("Próxima apertura: hoy, mañana o el lunes", () => {
  assert.equal(proximaApertura(HORARIO_DEFECTO, stgo("2026-11-24T07:00:00")), "hoy desde las 09:00");
  assert.equal(proximaApertura(HORARIO_DEFECTO, stgo("2026-11-24T20:00:00")), "mañana desde las 09:00");
  assert.equal(proximaApertura(HORARIO_DEFECTO, stgo("2026-11-27T20:00:00")), "mañana desde las 10:00", "el viernes en la noche: el sábado abre a las 10");
  assert.equal(proximaApertura(HORARIO_DEFECTO, stgo("2026-11-28T15:00:00")), "el lunes desde las 09:00", "el sábado en la tarde: el domingo no se atiende");
  const cerrado = Object.fromEntries(Object.keys(HORARIO_DEFECTO).map((d) => [d, { abierto: false, desde: "09:00", hasta: "19:00" }]));
  assert.equal(proximaApertura(cerrado, new Date()), "pronto");
});

test("Texto del horario agrupa los días iguales", () => {
  assert.equal(textoHorario(HORARIO_DEFECTO), "lunes a viernes de 09:00 a 19:00 y sábado de 10:00 a 14:00");
  assert.equal(textoHorario({ ...HORARIO_DEFECTO, mie: { abierto: false, desde: "09:00", hasta: "19:00" } }), "lunes a martes de 09:00 a 19:00 y jueves a viernes de 09:00 a 19:00 y sábado de 10:00 a 14:00");
});

test("Configuración: se valida y se completa con los valores por defecto", () => {
  assert.equal(validarConfigBot({ activo: true, empresa: "BuyCar" }).ok, true);
  assert.deepEqual(validarConfigBot({ activo: true }).value.horario, HORARIO_DEFECTO);
  assert.equal(validarConfigBot({ horario: { lun: { abierto: true, desde: "19:00", hasta: "09:00" } } }).error, "bot_horario_invalido");
  assert.equal(validarConfigBot({ horario: { lun: { abierto: true, desde: "9", hasta: "19:00" } } }).error, "bot_horario_invalido");
  assert.equal(validarConfigBot({ empresa: "x".repeat(61) }).error, "bot_config_invalida");
  assert.equal(validarConfigBot(null).error, "bot_config_invalida");
  // Un día cerrado puede tener cualquier hora válida; el asistente guardado en texto se lee igual.
  assert.equal(configBot(JSON.stringify({ activo: true, empresa: "BuyCar" })).activo, true);
  assert.equal(configBot("basura{").activo, false);
  assert.equal(configBot(undefined).activo, false);
});

test("Entiende lo que necesita el cliente cuando escribe con sus palabras", () => {
  assert.equal(interpretarNecesidad("Hola, quiero comprar un auto"), "comprar");
  assert.equal(interpretarNecesidad("busco una camioneta"), "comprar");
  assert.equal(interpretarNecesidad("¿Cuánto cuesta el precio del Yaris?"), "comprar");
  assert.equal(interpretarNecesidad("quiero VENDER mi auto"), "vender");
  assert.equal(interpretarNecesidad("ustedes compran autos? quiero tasar el mío"), "vender");
  assert.equal(interpretarNecesidad("me interesa consignar mi camioneta"), "consignar");
  assert.equal(interpretarNecesidad("tienen financiamiento? cuántas cuotas"), "financiar");
  assert.equal(interpretarNecesidad("hola"), null);
  assert.equal(interpretarNecesidad(""), null);
  assert.deepEqual(NECESIDADES.map((n) => tipoLeadDeNecesidad(n.id)), ["venta", "compra", "consignacion", "venta", "venta"]);
});

test("Conversación completa: lista → nombre → detalle → preferencia → cierre", () => {
  const noche = stgo("2026-11-24T22:00:00");
  const ini = mensajeInicio(CFG, noche);
  assert.equal(ini.tipo, "lista");
  assert.match(ini.texto, /asistente virtual de BuyCar/);
  assert.match(ini.texto, /lunes a viernes de 09:00 a 19:00/);
  assert.match(ini.texto, /mañana desde las 09:00/);
  assert.deepEqual(ini.filas.map((f) => f.id), ["comprar", "vender", "consignar", "financiar", "otra"]);

  let r = avanzar(estadoInicial(noche), { id: "vender", texto: "Vender mi auto" }, CFG, noche);
  assert.equal(r.estado.paso, "nombre");
  assert.equal(r.estado.datos.necesidad, "vender");
  assert.match(r.mensajes[0].texto, /¿Cómo te llamas\?/);

  r = avanzar(r.estado, { texto: "Pedro Pérez" }, CFG, noche);
  assert.equal(r.estado.paso, "detalle");
  assert.match(r.mensajes[0].texto, /Gracias, Pedro\. ¿Qué auto quieres vender\?/);

  r = avanzar(r.estado, { texto: "Toyota Yaris 2018, 60.000 km" }, CFG, noche);
  assert.equal(r.estado.paso, "contacto");
  assert.equal(r.mensajes[0].tipo, "botones");
  assert.deepEqual(r.mensajes[0].botones.map((b) => b.id), ["am", "pm", "igual"]);

  r = avanzar(r.estado, { id: "pm", texto: "En la tarde" }, CFG, noche);
  assert.equal(r.terminado, true);
  assert.equal(r.estado.paso, "listo");
  assert.match(r.mensajes[0].texto, /Listo, Pedro ✅/);
  assert.match(r.mensajes[0].texto, /mañana desde las 09:00 \(en la tarde\)/);
  assert.deepEqual(r.estado.datos, { necesidad: "vender", nombre: "Pedro Pérez", detalle: "Toyota Yaris 2018, 60.000 km", contacto: "pm" });
  assert.equal(resumenBot(r.estado.datos), "Asistente de WhatsApp (fuera de horario):\n• Necesita: Vender mi auto\n• Nombre: Pedro Pérez\n• Detalle: Toyota Yaris 2018, 60.000 km\n• Prefiere que lo contacten: En la tarde");
});

test("Si el cliente escribe en vez de tocar: se entiende, se repite una vez y luego se sigue sin atraparlo", () => {
  const t = stgo("2026-11-24T22:00:00");
  // Escribe «quiero comprar» en vez de elegir de la lista.
  let r = avanzar(estadoInicial(t), { texto: "quiero comprar un suv" }, CFG, t);
  assert.equal(r.estado.datos.necesidad, "comprar");
  // No se entiende: se repite la lista una vez.
  r = avanzar(estadoInicial(t), { texto: "asdf" }, CFG, t);
  assert.equal(r.estado.paso, "necesidad");
  assert.equal(r.mensajes[0].tipo, "lista");
  assert.match(r.mensajes[0].texto, /No te entendí/);
  // Vuelve a no entenderse: sigue como «otra consulta» con lo que escribió, y no pregunta el detalle de nuevo.
  r = avanzar(r.estado, { texto: "es sobre un reclamo" }, CFG, t);
  assert.equal(r.estado.datos.necesidad, "otra");
  assert.equal(r.estado.datos.detalle, "es sobre un reclamo");
  assert.equal(r.estado.paso, "nombre");
  r = avanzar(r.estado, { texto: "Ana" }, CFG, t);
  assert.equal(r.estado.paso, "contacto", "ya tenía el detalle: salta la pregunta");
  // Responde la preferencia con palabras.
  r = avanzar(r.estado, { texto: "mejor en la mañana" }, CFG, t);
  assert.equal(r.estado.datos.contacto, "am");
  // Preferencia libre que no se reconoce: se anota tal cual.
  const r2 = avanzar({ paso: "contacto", datos: { necesidad: "comprar", nombre: "Ana", detalle: "x" }, intentos: 0 }, { texto: "después de las 8 pm por favor" }, CFG, t);
  assert.equal(r2.estado.datos.contacto, "pm", "«pm» se entiende");
  const r3 = avanzar({ paso: "contacto", datos: { necesidad: "comprar", nombre: "Ana", detalle: "x" }, intentos: 0 }, { texto: "el jueves" }, CFG, t);
  assert.equal(r3.estado.datos.contactoTexto, "el jueves");
  assert.equal(r3.terminado, true);
  assert.match(resumenBot(r3.estado.datos), /Prefiere que lo contacten: el jueves/);
});

test("Una foto o un audio sirve como detalle del auto; sin nombre se sigue igual tras repetir una vez", () => {
  const t = stgo("2026-11-24T22:00:00");
  let r = avanzar({ paso: "detalle", datos: { necesidad: "vender", nombre: "Luis" }, intentos: 0 }, { tipo: "image", texto: "" }, CFG, t);
  assert.equal(r.estado.datos.detalle, "(envió un archivo; míralo en la conversación)");
  assert.equal(r.estado.paso, "contacto");
  r = avanzar({ paso: "nombre", datos: { necesidad: "comprar" }, intentos: 0 }, { tipo: "audio", texto: "" }, CFG, t);
  assert.equal(r.estado.paso, "nombre");
  assert.match(r.mensajes[0].texto, /Escríbeme tu nombre/);
  r = avanzar(r.estado, { tipo: "audio", texto: "" }, CFG, t);
  assert.equal(r.estado.paso, "detalle", "no lo deja atrapado");
  assert.equal(r.estado.datos.nombre, "");
});

test("Cliente que ya tiene ejecutivo: solo un aviso corto, con el nombre y cuándo lo atienden", () => {
  const t = stgo("2026-11-27T21:00:00");
  const m = mensajeFueraDeHorario(CFG, { nombre: "Pedro Pérez", ejecutivo: "Dereck Alexander" }, t);
  assert.equal(m.tipo, "texto");
  assert.equal(m.texto, "Hola Pedro, ahora estamos fuera de horario (atendemos lunes a viernes de 09:00 a 19:00 y sábado de 10:00 a 14:00). Dereck te responderá mañana desde las 10:00. ¡Gracias por escribirnos!");
  assert.match(mensajeFueraDeHorario(CFG, {}, t).texto, /^Hola, ahora estamos fuera de horario.*Un ejecutivo te responderá/);
});

test("Formato de Meta: botones (máx. 3, título ≤ 20) y listas (máx. 10 filas, título ≤ 24)", () => {
  const lista = cuerpoMeta(mensajeInicio(CFG));
  assert.equal(lista.type, "interactive");
  assert.equal(lista.interactive.type, "list");
  assert.equal(lista.interactive.action.button, "Elegir");
  const filas = lista.interactive.action.sections[0].rows;
  assert.deepEqual(filas.map((f) => f.id), ["comprar", "vender", "consignar", "financiar", "otra"]);
  assert.ok(filas.every((f) => f.title.length <= 24));
  assert.ok(lista.interactive.body.text.length <= 1024);
  const bot = cuerpoMeta({ tipo: "botones", texto: "x".repeat(2000), botones: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, titulo: "Título muy largo de un botón" })) });
  assert.equal(bot.interactive.type, "button");
  assert.equal(bot.interactive.action.buttons.length, 3);
  assert.ok(bot.interactive.action.buttons.every((b) => b.reply.title.length <= 20));
  assert.equal(bot.interactive.body.text.length, 1024);
  assert.deepEqual(cuerpoMeta({ tipo: "texto", texto: "hola" }), { type: "text", text: { body: "hola", preview_url: false } });
  // Lo que ve el ejecutivo en la conversación lleva las opciones.
  assert.match(textoParaConversacion(mensajeInicio(CFG)), /▫️ Comprar un auto\n▫️ Vender mi auto/);
  assert.equal(textoParaConversacion({ tipo: "texto", texto: "hola" }), "hola");
});
