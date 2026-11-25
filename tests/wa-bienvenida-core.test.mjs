// Mensaje de bienvenida por WhatsApp a leads de formularios: configuración, plantilla sugerida y textos según el origen del lead.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BIENVENIDA_DEFECTO, PLANTILLA_SUGERIDA, VARIABLES_BIENVENIDA, validarConfigBienvenida, configBienvenida, descripcionSolicitud, cuandoContactar, valoresBienvenida,
  claveBienvenidaTelefono, claveBienvenidaDia, yaRecibioBienvenida, DIAS_SIN_REPETIR, esPeticionDeBaja, claveBajaTelefono, ETIQUETA_BAJA, TEXTO_CONFIRMA_BAJA,
} from "../supabase/functions/api/wa-bienvenida-core.js";
import { validarPlantillaNueva, variablesDe, armarPlantilla } from "../supabase/functions/api/whatsapp-core.js";
import { HORARIO_DEFECTO } from "../supabase/functions/api/wa-bot-core.js";

const stgo = (iso) => new Date(`${iso}-03:00`); // noviembre: horario de verano de Chile
const CERRADO = stgo("2026-11-24T22:00:00"); // martes en la noche
const ABIERTO = stgo("2026-11-24T15:00:00");

test("La plantilla sugerida es válida para Meta: servicio, 4 variables, no empieza ni termina con variable, con ejemplos", () => {
  const v = validarPlantillaNueva(PLANTILLA_SUGERIDA);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.value.category, "UTILITY");
  assert.equal(v.value.name, "bienvenida_formulario");
  assert.equal(variablesDe(PLANTILLA_SUGERIDA.cuerpo).length, VARIABLES_BIENVENIDA);
  assert.deepEqual(v.value.components.find((c) => c.type === "BODY").example.body_text, [PLANTILLA_SUGERIDA.ejemplos]);
  assert.equal(PLANTILLA_SUGERIDA.ejemplos.length, VARIABLES_BIENVENIDA);
});

test("Configuración: apagada por defecto; para encenderla hay que elegir una plantilla; se valida", () => {
  assert.deepEqual(BIENVENIDA_DEFECTO, { activa: false, plantilla: { nombre: "", idioma: "es" }, maxPorDia: 40 });
  assert.equal(validarConfigBienvenida({ activa: true }).error, "bienvenida_sin_plantilla");
  assert.deepEqual(validarConfigBienvenida({ activa: true, plantilla: { nombre: "bienvenida_formulario", idioma: "es" }, maxPorDia: "25" }).value, { activa: true, plantilla: { nombre: "bienvenida_formulario", idioma: "es" }, maxPorDia: 25 });
  assert.equal(validarConfigBienvenida({ activa: false }).ok, true, "apagada no necesita plantilla");
  assert.equal(validarConfigBienvenida({ plantilla: { nombre: "Nombre Con Espacios" } }).error, "bienvenida_config_invalida");
  assert.equal(validarConfigBienvenida({ plantilla: { nombre: "ok_nombre", idioma: "español" } }).error, "bienvenida_config_invalida");
  assert.equal(validarConfigBienvenida({ maxPorDia: 0 }).error, "bienvenida_config_invalida");
  assert.equal(validarConfigBienvenida({ maxPorDia: 1001 }).error, "bienvenida_config_invalida");
  assert.equal(validarConfigBienvenida({ maxPorDia: 2.5 }).error, "bienvenida_config_invalida");
  assert.deepEqual(configBienvenida(undefined), BIENVENIDA_DEFECTO);
  assert.deepEqual(configBienvenida("basura{"), BIENVENIDA_DEFECTO);
  assert.equal(configBienvenida(JSON.stringify({ activa: true, plantilla: { nombre: "mi_plantilla", idioma: "es_CL" } })).plantilla.idioma, "es_CL");
});

test("Qué recibimos: según el tipo de solicitud del sitio y el origen del lead", () => {
  assert.equal(descripcionSolicitud({ tipo: "consulta", vehiculo: "Toyota Yaris 2020" }), "tu consulta por el Toyota Yaris 2020");
  assert.equal(descripcionSolicitud({ tipo: "consulta" }), "tu consulta");
  assert.equal(descripcionSolicitud({ tipo: "visita", vehiculo: "Kia Rio 2019" }), "tu solicitud de visita para el Kia Rio 2019");
  assert.equal(descripcionSolicitud({ tipo: "financiamiento", vehiculo: "Kia Rio 2019" }), "tu solicitud de financiamiento para el Kia Rio 2019");
  assert.equal(descripcionSolicitud({ tipo: "vender" }), "tu solicitud para vender tu auto");
  assert.equal(descripcionSolicitud({ tipo: "consignar" }), "tu solicitud para consignar tu auto");
  assert.equal(descripcionSolicitud({ tipo: "renovar" }), "tu solicitud para renovar tu auto");
  assert.equal(descripcionSolicitud({ origen: "meta" }), "tu solicitud de información");
  assert.equal(descripcionSolicitud({ origen: "google" }), "tu solicitud de información");
  assert.equal(descripcionSolicitud({ origen: "web", vehiculo: "x".repeat(200) }).length, "tu consulta por el ".length + 60);
});

test("Cuándo lo contactan: a la brevedad en horario, la próxima apertura de noche, y para confirmar la visita", () => {
  assert.equal(cuandoContactar({ horario: HORARIO_DEFECTO, ahora: ABIERTO }), "a la brevedad");
  assert.equal(cuandoContactar({ horario: HORARIO_DEFECTO, ahora: CERRADO }), "mañana desde las 09:00");
  assert.equal(cuandoContactar({ horario: HORARIO_DEFECTO, ahora: stgo("2026-11-28T15:00:00") }), "el lunes desde las 09:00");
  assert.equal(cuandoContactar({ tipo: "visita", horario: HORARIO_DEFECTO, ahora: CERRADO }), "para confirmar tu visita");
  const cerrado = Object.fromEntries(Object.keys(HORARIO_DEFECTO).map((d) => [d, { abierto: false, desde: "09:00", hasta: "19:00" }]));
  assert.equal(cuandoContactar({ horario: cerrado, ahora: CERRADO }), "a la brevedad", "sin horario no se promete una hora");
  assert.equal(cuandoContactar({ ahora: CERRADO }), "mañana desde las 09:00", "sin configuración usa el horario por defecto");
});

test("Valores de la plantilla: nombre, qué recibimos, empresa y cuándo; con respaldos si falta algo; y el texto final queda bien", () => {
  const v = valoresBienvenida({ nombre: "Pedro Soto Pérez", tipo: "consulta", origen: "web", vehiculo: "Toyota Yaris 2020", empresa: "BuyCar", horario: HORARIO_DEFECTO, ahora: CERRADO });
  assert.deepEqual(v, ["Pedro", "tu consulta por el Toyota Yaris 2020", "BuyCar", "mañana desde las 09:00"]);
  assert.deepEqual(valoresBienvenida({ ahora: ABIERTO, origen: "meta" }), ["cliente", "tu solicitud de información", "nuestra automotora", "a la brevedad"]);
  assert.equal(valoresBienvenida({ nombre: "A".repeat(80) })[0].length, 30);
  // Armada con el mismo código que usa el servidor para enviar a Meta.
  const p = { nombre: "bienvenida_formulario", idioma: "es", cuerpo: PLANTILLA_SUGERIDA.cuerpo, pie: PLANTILLA_SUGERIDA.pie, encabezado: "", variables: ["1", "2", "3", "4"], nombradas: false };
  const a = armarPlantilla(p, v);
  assert.equal(a.ok, true);
  assert.equal(a.componentes[0].parameters.length, 4);
  assert.equal(a.texto, "Hola Pedro 👋 Recibimos tu consulta por el Toyota Yaris 2020. Un ejecutivo de BuyCar te contactará mañana desde las 09:00. Si quieres, puedes escribirnos por aquí y te ayudamos.\nMensaje automático");
});

test("Bajas: se entiende que el cliente pide no recibir más mensajes, sin confundir otras frases", () => {
  for (const t of ["No quiero recibir más mensajes", "Por favor dejen de escribirme", "STOP", "stop.", "Quiero darme de baja", "no me escriban más", "No quiero seguir recibiendo mensajes", "dejen de molestar!!", "Me pueden dar de baja?", "no quiero recibir mas mensajes por whatsapp", "No quiero que me escriban"]) {
    assert.equal(esPeticionDeBaja(t), true, t);
  }
  for (const t of ["Hola", "Quiero comprar un auto", "No tengo presupuesto todavía", "¿Tienen baja de precio?", "No quiero el rojo, prefiero el azul", "Gracias, escríbanme mañana", "No quiero recibir llamadas pero sí escríbanme", "no quiero recibir llamadas", "", "stop por favor espere un momento ".repeat(8)]) {
    assert.equal(esPeticionDeBaja(t), false, t);
  }
  assert.equal(claveBajaTelefono("+56 9 1234 5678"), "bienvenida::baja::56912345678");
  assert.equal(ETIQUETA_BAJA, "No contactar");
  assert.ok(TEXTO_CONFIRMA_BAJA.length < 300);
});

test("Sin repetir: un teléfono recibe la bienvenida una vez cada 7 días; las claves son por teléfono y por día de Chile", () => {
  assert.equal(DIAS_SIN_REPETIR, 7);
  const ahora = new Date("2026-11-24T20:00:00Z");
  assert.equal(yaRecibioBienvenida({ en: new Date(ahora.getTime() - 6 * 86_400_000).toISOString() }, ahora), true);
  assert.equal(yaRecibioBienvenida({ en: new Date(ahora.getTime() - 8 * 86_400_000).toISOString() }, ahora), false);
  assert.equal(yaRecibioBienvenida(null, ahora), false);
  assert.equal(yaRecibioBienvenida({ en: "basura" }, ahora), false);
  assert.equal(claveBienvenidaTelefono("+56 9 1234 5678"), "bienvenida::tel::56912345678");
  assert.equal(claveBienvenidaDia(new Date("2026-11-24T15:00:00-03:00")), "whatsapp::bienvenida::dia::2026-11-24");
  assert.equal(claveBienvenidaDia(new Date("2026-11-25T01:00:00Z")), "whatsapp::bienvenida::dia::2026-11-24", "a esa hora en Chile todavía es el día 24");
});
