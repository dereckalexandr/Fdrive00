import { test } from "node:test";
import assert from "node:assert/strict";
import {
  telefonoWa, mismoTelefono, telefonoVisible, nombreDesdePerfil, estadoSiguiente, parsearWebhook, ventanaAbierta, validarTextoWa,
  resumenMensaje, variablesDe, plantillasUsables, armarPlantilla, validarArchivoWa,
} from "../supabase/functions/api/whatsapp-core.js";

test("Teléfonos: cualquier forma de escribir un celular chileno llega al formato de WhatsApp", () => {
  for (const t of ["912345678", "+56 9 1234 5678", "56912345678", "(+56) 9-1234-5678", "0056912345678", "12345678"]) assert.equal(telefonoWa(t), "56912345678", t);
  assert.equal(telefonoWa("+1 415 555 0100"), "14155550100");
  assert.equal(telefonoWa("123"), null);
  assert.equal(telefonoWa(""), null);
  assert.ok(mismoTelefono("9 1234 5678", "+56912345678"));
  assert.ok(!mismoTelefono("", ""));
  assert.equal(telefonoVisible("56912345678"), "+56 9 1234 5678");
  assert.equal(nombreDesdePerfil("  Pedro  ", "56912345678"), "Pedro");
  assert.equal(nombreDesdePerfil("", "56912345678"), "WhatsApp +56 9 1234 5678");
});

test("Estados de un mensaje enviado: no retroceden y un fallo siempre se anota", () => {
  assert.equal(estadoSiguiente("enviado", "entregado"), "entregado");
  assert.equal(estadoSiguiente("leido", "entregado"), "leido");
  assert.equal(estadoSiguiente("leido", "fallido"), "fallido");
  assert.equal(estadoSiguiente("fallido", "leido"), "fallido");
  assert.equal(estadoSiguiente("enviado", null), "enviado");
});

test("Aviso de Meta: mensajes de cada tipo y estados con su error", () => {
  const p = { entry: [{ changes: [
    { field: "messages", value: { metadata: { phone_number_id: "P1" }, contacts: [{ wa_id: "56911112222", profile: { name: "Pedro" } }], messages: [
      { from: "56911112222", id: "w1", timestamp: "1700000000", type: "text", text: { body: "hola" } },
      { from: "56911112222", id: "w2", timestamp: "1700000001", type: "document", document: { id: "M1", mime_type: "application/pdf", filename: "carnet.pdf" } },
      { from: "56911112222", id: "w3", timestamp: "1700000002", type: "location", location: { latitude: -33.4, longitude: -70.6, name: "Casa" } },
      { from: "56911112222", id: "w4", timestamp: "1700000003", type: "interactive", interactive: { type: "button_reply", button_reply: { title: "Sí, me interesa" } } },
      { from: "56911112222", id: "w5", timestamp: "1700000004", type: "unsupported" },
    ], statuses: [{ id: "s1", status: "failed", timestamp: "1700000005", errors: [{ code: 131047, title: "Re-engagement message", error_data: { details: "más de 24 horas" } }] }] } },
    { field: "account_update", value: {} },
  ] }] };
  const r = parsearWebhook(p);
  assert.equal(r.mensajes.length, 5);
  assert.deepEqual([r.mensajes[0].telefono, r.mensajes[0].nombre, r.mensajes[0].texto, r.mensajes[0].phoneNumberId], ["56911112222", "Pedro", "hola", "P1"]);
  assert.equal(r.mensajes[0].ts, new Date(1700000000 * 1000).toISOString());
  assert.deepEqual(r.mensajes[1].media, { id: "M1", mime: "application/pdf", nombre: "carnet.pdf" });
  assert.match(r.mensajes[2].texto, /Casa · https:\/\/maps\.google\.com\/\?q=-33\.4,-70\.6/);
  assert.equal(r.mensajes[3].tipo, "text");
  assert.equal(r.mensajes[3].texto, "Sí, me interesa");
  assert.equal(r.mensajes[4].tipo, "otro");
  assert.equal(r.estados[0].estado, "fallido");
  assert.match(r.estados[0].error, /Re-engagement message: más de 24 horas \(131047\)/);
  assert.deepEqual(parsearWebhook(null), { mensajes: [], estados: [] });
});

test("Ventana de 24 horas, texto y resumen", () => {
  const ahora = new Date("2026-11-18T12:00:00Z");
  assert.equal(ventanaAbierta("2026-11-17T12:30:00Z", ahora), true);
  assert.equal(ventanaAbierta("2026-11-17T11:59:00Z", ahora), false);
  assert.equal(ventanaAbierta(null, ahora), false);
  assert.equal(validarTextoWa("  hola  ").value, "hola");
  assert.equal(validarTextoWa("").error, "mensaje_vacio");
  assert.equal(validarTextoWa("x".repeat(4097)).error, "mensaje_muy_largo");
  assert.equal(resumenMensaje({ tipo: "image", texto: "" }), "📷 Foto");
  assert.equal(resumenMensaje({ tipo: "document", media: { nombre: "a.pdf" }, texto: "ok" }), "📄 a.pdf: ok");
  assert.equal(resumenMensaje({ tipo: "text", texto: "hola\nchao" }), "hola chao");
});

test("Plantillas: solo las aprobadas con variables en el cuerpo; se arman sin saltos de línea", () => {
  assert.deepEqual(variablesDe("Hola {{1}}, tu {{2}} y {{1}}"), ["1", "2"]);
  const lista = plantillasUsables([
    { name: "b", language: "es", status: "APPROVED", components: [{ type: "BODY", text: "Hola {{1}}" }, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sí" }] }] },
    { name: "a", language: "es_CL", status: "APPROVED", components: [{ type: "BODY", text: "Hola" }] },
    { name: "url", language: "es", status: "APPROVED", components: [{ type: "BODY", text: "x" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://x.cl/{{1}}" }] }] },
    { name: "hdr", language: "es", status: "APPROVED", components: [{ type: "HEADER", format: "TEXT", text: "Hola {{1}}" }, { type: "BODY", text: "x" }] },
    { name: "rech", language: "es", status: "REJECTED", components: [{ type: "BODY", text: "x" }] },
  ]);
  assert.deepEqual(lista.map((p) => p.nombre), ["a", "b"]);
  assert.deepEqual(lista[1].botones, ["Sí"]);
  const b = lista[1];
  assert.equal(armarPlantilla(b, []).error, "plantilla_variables");
  assert.equal(armarPlantilla(b, ["  "]).error, "plantilla_variables");
  const ok = armarPlantilla(b, ["Ana\n\tMaría"]);
  assert.equal(ok.texto, "Hola Ana María");
  assert.deepEqual(ok.componentes, [{ type: "body", parameters: [{ type: "text", text: "Ana María" }] }]);
  assert.deepEqual(armarPlantilla(lista[0], []).componentes, []);
});

test("Archivos para enviar: fotos JPG/PNG y PDF de hasta 5 MB", () => {
  const pdf = validarArchivoWa({ nombre: "a/b.pdf", dataUrl: "data:application/pdf;base64,JVBERi0=" });
  assert.equal(pdf.ok, true);
  assert.equal(pdf.value.tipo, "document");
  assert.equal(pdf.value.nombre, "a_b.pdf");
  assert.equal(pdf.value.bytes, 5);
  assert.equal(validarArchivoWa({ dataUrl: "data:image/png;base64,iVBORw==" }).value.tipo, "image");
  assert.equal(validarArchivoWa({ dataUrl: "data:image/gif;base64,R0lG" }).error, "archivo_tipo_invalido");
  assert.equal(validarArchivoWa({ dataUrl: "hola" }).error, "archivo_invalido");
  assert.equal(validarArchivoWa({ dataUrl: "data:application/pdf;base64," + "A".repeat(7 * 1024 * 1024) }).error, "archivo_muy_grande");
});

test("Plantillas nuevas: nombre técnico, variables numeradas con ejemplo, sin variable al inicio o al final", async () => {
  const { validarPlantillaNueva, nombrePlantilla, plantillasParaAdmin } = await import("../supabase/functions/api/whatsapp-core.js");
  assert.equal(nombrePlantilla("Seguimiento Cotización 2"), "seguimiento_cotizacion_2");
  const base = { nombre: "Recordatorio visita", categoria: "UTILITY", cuerpo: "Hola {{1}}, te esperamos el {{2}} en la sucursal.", ejemplos: ["Pedro", "viernes 20"] };
  const ok = validarPlantillaNueva({ ...base, encabezado: "Recordatorio", pie: "Drive Futuro", botones: ["Confirmo", "", "Cambiar hora"] });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.name, "recordatorio_visita");
  assert.equal(ok.value.language, "es");
  assert.deepEqual(ok.value.components.map((c) => c.type), ["HEADER", "BODY", "FOOTER", "BUTTONS"]);
  assert.deepEqual(ok.value.components[1].example.body_text, [["Pedro", "viernes 20"]]);
  assert.deepEqual(ok.value.components[3].buttons, [{ type: "QUICK_REPLY", text: "Confirmo" }, { type: "QUICK_REPLY", text: "Cambiar hora" }]);
  assert.equal(validarPlantillaNueva({ ...base, nombre: "x" }).error, "plantilla_nombre");
  assert.equal(validarPlantillaNueva({ ...base, categoria: "OTRA" }).error, "plantilla_categoria");
  assert.equal(validarPlantillaNueva({ ...base, cuerpo: "Hola {{1}} y {{3}} gracias." }).error, "plantilla_variables_numeradas");
  assert.equal(validarPlantillaNueva({ ...base, cuerpo: "Hola {{nombre}}, gracias." }).error, "plantilla_variables_numeradas");
  assert.equal(validarPlantillaNueva({ ...base, cuerpo: "{{1}}, te esperamos mañana." }).error, "plantilla_variable_borde");
  assert.equal(validarPlantillaNueva({ ...base, cuerpo: "Te esperamos mañana, {{1}}." }).error, "plantilla_variable_borde");
  assert.equal(validarPlantillaNueva({ ...base, ejemplos: ["Pedro"] }).error, "plantilla_ejemplos");
  assert.equal(validarPlantillaNueva({ ...base, encabezado: "Hola {{1}}" }).error, "plantilla_encabezado");
  assert.equal(validarPlantillaNueva({ ...base, botones: ["a", "b", "c", "d"] }).error, "plantilla_botones");
  const sinVars = validarPlantillaNueva({ nombre: "aviso general", categoria: "MARKETING", cuerpo: "Tenemos nuevos vehículos esta semana." });
  assert.equal(sinVars.ok, true);
  assert.equal(sinVars.value.components[0].example, undefined);
  const adm = plantillasParaAdmin([{ id: "1", name: "b", language: "es", category: "UTILITY", status: "REJECTED", rejected_reason: "INVALID_FORMAT", components: [{ type: "BODY", text: "x" }] }, { id: "2", name: "a", language: "es", category: "MARKETING", status: "APPROVED", rejected_reason: "NONE", components: [] }]);
  assert.deepEqual(adm.map((p) => [p.nombre, p.estadoNombre, p.motivo]), [["a", "Aprobada", ""], ["b", "Rechazada", "INVALID_FORMAT"]]);
});
