// Asistente con IA de WhatsApp: reglas puras (costos, inventario público, historial de la conversación, instrucciones y herramientas).
import test from "node:test";
import assert from "node:assert/strict";
import {
  costoUsd, validarIa, sumarUso, claveUsoMes, USO_VACIO, instruccionesIa, HERRAMIENTAS_IA, contextoIa, buscarInventario, historialParaClaude,
  textoDeRespuesta, notaIa, IA_DEFECTO, MODELO_IA_DEFECTO,
} from "../supabase/functions/api/wa-ia-core.js";
import { configBot, validarConfigBot } from "../supabase/functions/api/wa-bot-core.js";

test("Costo estimado: precios por millón de tokens del modelo, con caché", () => {
  assert.equal(MODELO_IA_DEFECTO, "claude-haiku-5-5");
  // Haiku 5.5: $0,10 entrada · $0,50 salida · $0,125 escritura de caché · $0,01 lectura de caché (por millón).
  assert.equal(costoUsd("claude-haiku-5-5", { input_tokens: 1_000_000 }), 0.1);
  assert.equal(costoUsd("claude-haiku-5-5", { output_tokens: 1_000_000 }), 0.5);
  assert.ok(Math.abs(costoUsd("claude-haiku-5-5", { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 500, cache_read_input_tokens: 2000 }) - (100 + 50 + 62.5 + 20) / 1e6) < 1e-12);
  assert.equal(costoUsd("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 12);
  assert.equal(costoUsd("claude-opus-5-5", { input_tokens: 1_000_000 }), 4);
  assert.equal(costoUsd("modelo-desconocido", { input_tokens: 1_000_000 }), 4, "un modelo desconocido se cobra como el más caro");
  assert.equal(costoUsd("claude-haiku-5-5", undefined), 0);
});

test("Gasto del mes: se suma respuesta a respuesta y la clave cambia con el mes de Chile", () => {
  let u = sumarUso(undefined, "claude-haiku-5-5", { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 500 });
  u = sumarUso(u, "claude-haiku-5-5", { input_tokens: 200, output_tokens: 50, cache_read_input_tokens: 1500 });
  assert.equal(u.llamadas, 2);
  assert.equal(u.entrada, 1200);
  assert.equal(u.salida, 150);
  assert.equal(u.cache_escritura, 500);
  assert.equal(u.cache_lectura, 1500);
  assert.ok(Math.abs(u.usd - (212.5 + (20 + 25 + 15)) / 1e6) < 1e-9);
  assert.deepEqual(sumarUso(null, "claude-haiku-5-5", {}).entrada, USO_VACIO.entrada);
  assert.equal(claveUsoMes(new Date("2026-11-24T15:00:00-03:00")), "whatsapp::ia::uso::2026-11");
  assert.equal(claveUsoMes(new Date("2026-12-01T01:00:00-03:00")), "whatsapp::ia::uso::2026-12");
  assert.equal(claveUsoMes(new Date("2026-12-01T01:00:00Z")), "whatsapp::ia::uso::2026-11", "a esa hora en Chile todavía es noviembre");
});

test("Configuración de la IA: apagada por defecto, con tope de gasto y de respuestas por conversación", () => {
  assert.deepEqual(IA_DEFECTO, { activa: false, maxUsdMes: 10, maxPorConversacion: 15 });
  assert.deepEqual(validarIa(undefined).value, IA_DEFECTO);
  assert.deepEqual(validarIa({ activa: true, maxUsdMes: "25.5", maxPorConversacion: 8 }).value, { activa: true, maxUsdMes: 25.5, maxPorConversacion: 8 });
  assert.equal(validarIa({ maxUsdMes: -1 }).error, "ia_config_invalida");
  assert.equal(validarIa({ maxUsdMes: "mucho" }).error, "ia_config_invalida");
  assert.equal(validarIa({ maxPorConversacion: 0 }).error, "ia_config_invalida");
  assert.equal(validarIa({ maxPorConversacion: 2.5 }).error, "ia_config_invalida");
  assert.equal(validarIa({ maxPorConversacion: 101 }).error, "ia_config_invalida");
  // Va dentro de la configuración del asistente; una configuración antigua sin IA queda con la IA apagada.
  assert.deepEqual(configBot(JSON.stringify({ activo: true, empresa: "BuyCar" })).ia, IA_DEFECTO);
  assert.equal(validarConfigBot({ activo: true, ia: { activa: true, maxUsdMes: -5 } }).error, "ia_config_invalida");
  assert.equal(validarConfigBot({ activo: true, ia: { activa: true, maxUsdMes: 5 } }).value.ia.activa, true);
});

const AUTOS = [
  { id: "a1", marca: "Toyota", modelo: "Yaris", version: "1.5 SE", anio: 2020, km: 45000, color: "Rojo", transmision: "Automática", combustible: "Bencina", precio_lista: 9_490_000, precio_financiamiento: 8_990_000, estado: "disponible", activo: true, costo: 6_000_000, patente: "ABCD12", notas: "interno" },
  { id: "a2", marca: "Toyota", modelo: "Yaris", version: "1.5 XS", anio: 2018, km: 80000, color: "Gris", transmision: "Manual", combustible: "Bencina", precio_lista: 7_990_000, estado: "disponible", activo: true },
  { id: "a3", marca: "Suzuki", modelo: "Swift", version: "GL", anio: 2021, km: 30000, transmision: "Manual", combustible: "Bencina", precio_lista: 8_500_000, estado: "reservado", activo: true },
  { id: "a4", marca: "Kia", modelo: "Sportage", version: "EX", anio: 2022, km: 20000, transmision: "Automática", combustible: "Diésel", precio_lista: 18_900_000, estado: "disponible", activo: true },
  { id: "a5", marca: "Mazda", modelo: "CX-5", anio: 2019, km: 60000, transmision: "Automática", combustible: "Bencina", precio_lista: 14_000_000, estado: "vendido", activo: true },
  { id: "a6", marca: "Chevrolet", modelo: "Spark", anio: 2017, km: 90000, precio_lista: 0, estado: "disponible", activo: true },
  { id: "a7", marca: "Nissan", modelo: "Versa", anio: 2019, km: 70000, precio_lista: 8_000_000, estado: "disponible", activo: false },
];
const SITIO = "https://fdrive02.vercel.app/";

test("Inventario para la IA: solo autos disponibles o reservados con precio, con los datos que ve cualquier visitante", () => {
  const r = buscarInventario(AUTOS, {}, SITIO);
  assert.equal(r.total, 4, "no entran el vendido, el sin precio ni el archivado");
  assert.deepEqual(r.autos.map((a) => a.auto), ["Toyota Yaris 1.5 XS", "Toyota Yaris 1.5 SE", "Kia Sportage EX", "Suzuki Swift GL"], "por precio, y el reservado al final");
  const yaris = r.autos.find((a) => a.auto === "Toyota Yaris 1.5 SE");
  assert.deepEqual(yaris, { auto: "Toyota Yaris 1.5 SE", anio: 2020, km: 45000, color: "Rojo", transmision: "Automática", combustible: "Bencina", estado: "disponible", precio_lista: "$9.490.000", precio_con_financiamiento: "$8.990.000", enlace: "https://fdrive02.vercel.app/vehiculo/a1" });
  const texto = JSON.stringify(r);
  for (const secreto of ["6000000", "ABCD12", "interno", "costo", "patente"]) assert.ok(!texto.includes(secreto), `no debe filtrar «${secreto}»`);
  assert.equal(r.autos.find((a) => a.auto.startsWith("Suzuki")).estado, "reservado");
  assert.equal(r.autos.find((a) => a.auto.startsWith("Toyota Yaris 1.5 XS")).precio_con_financiamiento, null);
});

test("Inventario: filtros por marca, modelo, año, precio, kilometraje, transmisión, combustible y texto libre", () => {
  const f = (filtros) => buscarInventario(AUTOS, filtros, SITIO).autos.map((a) => a.auto);
  assert.deepEqual(f({ marca: "toyota", modelo: "YARIS", transmision: "automatica" }), ["Toyota Yaris 1.5 SE"], "sin importar tildes ni mayúsculas");
  assert.deepEqual(f({ precio_max: 9_000_000 }), ["Toyota Yaris 1.5 XS", "Suzuki Swift GL"]);
  assert.deepEqual(f({ anio_desde: 2021 }), ["Kia Sportage EX", "Suzuki Swift GL"]);
  assert.deepEqual(f({ anio_hasta: 2018 }), ["Toyota Yaris 1.5 XS"]);
  assert.deepEqual(f({ km_max: 30000 }), ["Kia Sportage EX", "Suzuki Swift GL"]);
  assert.deepEqual(f({ combustible: "diesel" }), ["Kia Sportage EX"], "«diesel» encuentra «Diésel»");
  assert.deepEqual(f({ texto: "sportage" }), ["Kia Sportage EX"]);
  assert.deepEqual(f({ texto: "xs" }), ["Toyota Yaris 1.5 XS"]);
  assert.deepEqual(f({ marca: "Ferrari" }), []);
  assert.deepEqual(f({ precio_max: "nueve" }), [], "un filtro que no es número no encuentra nada en vez de mostrar todo");
  assert.equal(buscarInventario(AUTOS, null, SITIO).total, 4);
  assert.equal(buscarInventario(null, {}, SITIO).total, 0);
});

test("Inventario: nunca más de 5 autos por respuesta, pero informa cuántos hay en total", () => {
  const muchos = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, marca: "Toyota", modelo: "Corolla", anio: 2015 + (i % 8), km: 1000 * i, precio_lista: 5_000_000 + i * 100_000, estado: "disponible", activo: true }));
  const r = buscarInventario(muchos, { marca: "Toyota" }, SITIO);
  assert.equal(r.total, 12);
  assert.equal(r.mostrados, 5);
  assert.equal(r.autos.length, 5);
});

test("Historial: mensajes del cliente como «user», los del asistente como «assistant», unidos, empezando y terminando por el cliente", () => {
  const filas = [
    { direccion: "saliente", texto: "Hola, soy el asistente" }, // parte por un mensaje del asistente: se descarta
    { direccion: "entrante", tipo: "text", texto: "Hola" },
    { direccion: "entrante", tipo: "text", texto: "¿Tienen un Yaris?" },
    { direccion: "saliente", texto: "Sí, tenemos uno 😊" },
    { direccion: "entrante", tipo: "image", texto: "" },
    { direccion: "entrante", tipo: "audio", texto: "" },
    { direccion: "entrante", tipo: "image", texto: "mira este" },
    { direccion: "saliente", texto: "" }, // sin texto: se ignora
    { direccion: "saliente", texto: "Cuéntame más" }, // termina en el asistente: se descarta
  ];
  assert.deepEqual(historialParaClaude(filas), [
    { role: "user", content: "Hola\n¿Tienen un Yaris?" },
    { role: "assistant", content: "Sí, tenemos uno 😊" },
    { role: "user", content: "[el cliente envió una foto]\n[el cliente envió un audio]\n[el cliente envió una foto] mira este" },
  ]);
  assert.deepEqual(historialParaClaude([]), []);
  assert.deepEqual(historialParaClaude([{ direccion: "saliente", texto: "solo yo" }]), []);
  const largo = Array.from({ length: 60 }, (_, i) => ({ direccion: i % 2 ? "saliente" : "entrante", tipo: "text", texto: `m${i}` }));
  largo.push({ direccion: "entrante", tipo: "text", texto: "último" });
  const h = historialParaClaude(largo, 10);
  assert.equal(h[0].role, "user");
  assert.equal(h[h.length - 1].role, "user");
  assert.ok(h.reduce((n, x) => n + x.content.split("\n").length, 0) <= 10, "solo los últimos mensajes");
  assert.equal(historialParaClaude([{ direccion: "entrante", tipo: "text", texto: "x".repeat(5000) }])[0].content.length, 1200);
});

test("Instrucciones: estables (se guardan en caché), con el nombre de la empresa y con los límites claros", () => {
  const a = instruccionesIa("BuyCar");
  assert.equal(instruccionesIa("BuyCar"), a, "mismo texto cada vez: si cambiara, la caché no serviría");
  assert.match(a, /asistente virtual de BuyCar/);
  assert.match(a, /inteligencia artificial/);
  assert.match(a, /SIEMPRE la herramienta buscar_inventario/);
  assert.match(a, /No negocies ni ofrezcas descuentos/);
  assert.match(a, /derivar_a_ejecutivo/);
  assert.match(instruccionesIa(""), /asistente virtual de la automotora/);
  assert.ok(!/\d{1,2}:\d{2}/.test(a), "sin horas ni fechas dentro del texto estable");
});

test("Herramientas: solo buscar, anotar y derivar; esquemas válidos y en un orden fijo", () => {
  assert.deepEqual(HERRAMIENTAS_IA.map((h) => h.name), ["buscar_inventario", "anotar_en_ficha", "derivar_a_ejecutivo"]);
  for (const h of HERRAMIENTAS_IA) {
    assert.equal(h.input_schema.type, "object");
    assert.ok(h.description.length > 30);
    for (const r of h.input_schema.required || []) assert.ok(h.input_schema.properties[r], `${h.name}: «${r}» está declarado`);
  }
  assert.deepEqual(HERRAMIENTAS_IA[0].input_schema.properties.transmision.enum, ["manual", "automatica"]);
  assert.deepEqual(HERRAMIENTAS_IA[1].input_schema.required, ["resumen"]);
  assert.deepEqual(HERRAMIENTAS_IA[2].input_schema.required, ["motivo"]);
});

test("Contexto variable, texto de la respuesta y notas de la ficha", () => {
  const c = contextoIa({ horarioTexto: "lunes a viernes de 09:00 a 19:00", proxima: "mañana desde las 09:00", nombre: "Pedro", ejecutivo: "Vera", necesidad: "Comprar un auto", derivado: true });
  assert.match(c, /Atendemos lunes a viernes de 09:00 a 19:00; un ejecutivo puede contactar al cliente mañana desde las 09:00/);
  assert.match(c, /Nombre del cliente: Pedro\./);
  assert.match(c, /Su ejecutivo es Vera\./);
  assert.match(c, /Comprar un auto/);
  assert.match(c, /ya fue derivada/);
  assert.ok(!/Nombre del cliente/.test(contextoIa({})));
  assert.equal(textoDeRespuesta([{ type: "thinking", thinking: "" }, { type: "text", text: "Hola" }, { type: "tool_use", name: "x" }, { type: "text", text: "¿en qué te ayudo?" }]), "Hola\n¿en qué te ayudo?");
  assert.equal(textoDeRespuesta([{ type: "text", text: "a\n\n\n\nb" }]), "a\n\nb");
  assert.equal(textoDeRespuesta(undefined), "");
  assert.equal(notaIa({ resumen: "Busca un SUV hasta 15 millones", visita_preferida: "sábado 11:00" }), "Asistente virtual (IA) anotó:\n• Busca un SUV hasta 15 millones\n• Visita preferida: sábado 11:00");
  assert.equal(notaIa({ motivo: "quiere negociar el precio" }), "Asistente virtual (IA) derivó a un ejecutivo: quiere negociar el precio");
  assert.equal(notaIa({ motivo: "" }), "Asistente virtual (IA) derivó a un ejecutivo: sin motivo indicado");
  assert.ok(notaIa({ resumen: "x".repeat(2000) }).length < 450);
});
