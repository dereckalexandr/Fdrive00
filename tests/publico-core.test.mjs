import { test } from "node:test";
import assert from "node:assert/strict";
import {
  visibleEnCatalogo, vehiculoPublico, validarSolicitudWeb, cuotaReferencial, tipoLeadDe, resumenSolicitud, MENSAJES_WEB,
  ESPERA_MINIMA_MS, VIGENCIA_FORMULARIO_MS,
} from "../supabase/functions/api/publico-core.js";
import { cuotaEstimada } from "../supabase/functions/api/ventas-core.js";
import { validarConfig, configCompleta, CONFIG_DEFECTO } from "../supabase/functions/api/crm-core.js";

const AHORA = new Date("2026-10-19T15:00:00Z");
const base = (o = {}) => ({ tipo: "consulta", nombre: "Pedro Soto", telefono: "+56 9 1234 5678", email: "pedro@correo.cl", mensaje: "¿Sigue disponible?", vehiculoId: "v1", acepta: true, abiertoEn: AHORA.getTime() - 10_000, web: "", ...o });
const VEH = { id: "v1", patente: "ABCD12", marca: "Hyundai", modelo: "Venue", version: "1.6", anio: 2023, km: 56000, color: "Blanco", transmision: "Automática", combustible: "Bencina", precio_lista: 12480000, costo: 10000000, notas: "interno", estado: "disponible", activo: true, fotos: ["abc12345", "../malo"], local_id: "L1", creado_por: "u1" };

test("Qué vehículos se muestran: disponibles y reservados, activos y con precio", () => {
  assert.ok(visibleEnCatalogo(VEH));
  assert.ok(visibleEnCatalogo({ ...VEH, estado: "reservado" }));
  assert.ok(!visibleEnCatalogo({ ...VEH, estado: "preparacion" }));
  assert.ok(!visibleEnCatalogo({ ...VEH, estado: "vendido" }));
  assert.ok(!visibleEnCatalogo({ ...VEH, activo: false }));
  assert.ok(!visibleEnCatalogo({ ...VEH, precio_lista: null }));
  assert.ok(!visibleEnCatalogo({ ...VEH, precio_lista: 0 }));
  assert.ok(!visibleEnCatalogo(null));
});

test("Lo que sale al público: lista cerrada, sin patente, costo ni notas", () => {
  const p = vehiculoPublico(VEH);
  const texto = JSON.stringify(p);
  assert.ok(!/ABCD12|costo|10000000|interno|creado_por|u1|patente/i.test(texto), texto);
  assert.equal(p.precio, 12480000);
  assert.equal(p.reservado, false);
  assert.deepEqual(p.fotos, ["abc12345"], "descarta ids de foto raros");
  assert.equal(vehiculoPublico({ ...VEH, estado: "reservado" }).reservado, true);
  assert.equal(vehiculoPublico({ ...VEH, version: "", color: undefined }).version, null);
});

test("Solicitud de consulta: datos válidos y normalizados", () => {
  const r = validarSolicitudWeb(base({ nombre: "  Pedro   Soto " }), AHORA);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.contacto.nombre, "Pedro Soto");
  assert.equal(r.value.contacto.email, "pedro@correo.cl");
  assert.equal(r.value.vehiculoId, "v1");
  assert.equal(validarSolicitudWeb(base({ email: "" }), AHORA).value.contacto.email, null);
});

test("Anti-spam: campo trampa, tiempo mínimo y consentimiento", () => {
  const r1 = validarSolicitudWeb(base({ web: "http://spam.com" }), AHORA);
  assert.ok(!r1.ok && r1.silencioso, "el campo trampa lo llenan los robots");
  const r2 = validarSolicitudWeb(base({ abiertoEn: AHORA.getTime() - (ESPERA_MINIMA_MS - 500) }), AHORA);
  assert.ok(!r2.ok && r2.silencioso, "enviado al instante = robot");
  assert.equal(validarSolicitudWeb(base({ abiertoEn: AHORA.getTime() - VIGENCIA_FORMULARIO_MS - 1 }), AHORA).error, "formulario_vencido");
  assert.equal(validarSolicitudWeb(base({ abiertoEn: undefined }), AHORA).error, "formulario_invalido");
  assert.equal(validarSolicitudWeb(base({ abiertoEn: AHORA.getTime() + 60_000 }), AHORA).error, "formulario_invalido", "una hora del futuro no sirve");
  assert.equal(validarSolicitudWeb(base({ acepta: false }), AHORA).error, "consentimiento_requerido");
  assert.equal(validarSolicitudWeb(base({ acepta: "true" }), AHORA).error, "consentimiento_requerido", "debe ser un sí explícito");
});

test("Datos de contacto", () => {
  const mal = (o) => validarSolicitudWeb(base(o), AHORA).error;
  assert.equal(mal({ nombre: "Pe" }), "nombre_invalido");
  assert.equal(mal({ telefono: "123" }), "telefono_invalido");
  assert.equal(mal({ telefono: "1".repeat(20) }), "telefono_invalido");
  assert.equal(mal({ email: "no-es-correo" }), "email_invalido");
  assert.equal(mal({ tipo: "otra" }), "tipo_invalido");
  assert.equal(mal({ vehiculoId: "" }), "vehiculo_requerido");
  assert.equal(validarSolicitudWeb(base({ mensaje: "x".repeat(900) }), AHORA).value.mensaje.length, 500);
});

test("Visita: fecha entre ahora y 45 días", () => {
  const f = (h) => new Date(AHORA.getTime() + h * 3_600_000).toISOString();
  assert.ok(validarSolicitudWeb(base({ tipo: "visita", fechaHora: f(24) }), AHORA).ok);
  assert.equal(validarSolicitudWeb(base({ tipo: "visita", fechaHora: f(-48) }), AHORA).error, "fecha_invalida");
  assert.equal(validarSolicitudWeb(base({ tipo: "visita", fechaHora: f(24 * 60) }), AHORA).error, "fecha_invalida");
  assert.equal(validarSolicitudWeb(base({ tipo: "visita", fechaHora: "mañana" }), AHORA).error, "fecha_invalida");
});

test("Financiamiento: pie y plazo, y la cuota referencial", () => {
  assert.ok(validarSolicitudWeb(base({ tipo: "financiamiento", pie: 3000000, plazo: 48 }), AHORA).ok);
  assert.equal(validarSolicitudWeb(base({ tipo: "financiamiento", pie: "", plazo: 48 }), AHORA).error, "pie_invalido");
  assert.equal(validarSolicitudWeb(base({ tipo: "financiamiento", pie: -1, plazo: 48 }), AHORA).error, "pie_invalido");
  assert.equal(validarSolicitudWeb(base({ tipo: "financiamiento", pie: 0, plazo: 5 }), AHORA).error, "plazo_invalido");
  const c = cuotaReferencial(12480000, 3000000, 48, 1.5);
  assert.equal(c.montoFinanciar, 9480000);
  assert.equal(c.cuota, cuotaEstimada(9480000, 48, 1.5));
  assert.deepEqual(cuotaReferencial(1000000, 2000000, 12, 1.5), { montoFinanciar: 0, cuota: 0 }, "un pie mayor al precio no financia nada");
});

test("Vender o consignar: datos del vehículo del visitante", () => {
  const v = (o = {}) => base({ tipo: "vender", vehiculoId: undefined, patente: "ab-cd 12", marca: "Toyota", modelo: "Yaris", anio: 2018, km: 78000, modalidad: "consignar", ...o });
  const ok = validarSolicitudWeb(v(), AHORA);
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(ok.value.vende.patente, "ABCD12");
  assert.equal(tipoLeadDe(ok.value), "consignacion");
  assert.equal(tipoLeadDe(validarSolicitudWeb(v({ modalidad: "vender" }), AHORA).value), "compra");
  assert.equal(tipoLeadDe(validarSolicitudWeb(base(), AHORA).value), "venta");
  assert.equal(validarSolicitudWeb(v({ patente: "12" }), AHORA).error, "patente_invalida");
  assert.equal(validarSolicitudWeb(v({ marca: "" }), AHORA).error, "marca_modelo_requeridos");
  assert.equal(validarSolicitudWeb(v({ anio: 1900 }), AHORA).error, "anio_invalido");
  assert.equal(validarSolicitudWeb(v({ km: "" }), AHORA).error, "km_invalido");
  assert.match(resumenSolicitud(ok.value), /Quiere consignar: Toyota Yaris 2018 · 78\.000 km · ABCD12/);
});

test("Resumen para el ejecutivo y mensajes para el visitante", () => {
  const s = validarSolicitudWeb(base({ tipo: "financiamiento", pie: 3000000, plazo: 36 }), AHORA).value;
  assert.match(resumenSolicitud(s, "Hyundai Venue 2023"), /Cotiza financiamiento de Hyundai Venue 2023: pie \$3\.000\.000, 36 cuotas\. Mensaje: ¿Sigue disponible\?/);
  for (const e of ["consentimiento_requerido", "telefono_invalido", "formulario_vencido", "demasiadas_solicitudes"]) assert.ok(MENSAJES_WEB[e], e);
});

test("Datos del sitio en la configuración", () => {
  assert.equal(configCompleta(null).sitio_nombre, "Drive Futuro");
  assert.equal(validarConfig("sitio_whatsapp", "+56 9 1234-5678").value, "56912345678");
  assert.equal(validarConfig("sitio_whatsapp", "").value, "");
  assert.ok(!validarConfig("sitio_whatsapp", "abc").ok);
  assert.ok(!validarConfig("sitio_whatsapp", "123").ok);
  assert.equal(validarConfig("sitio_nombre", "  Mi   Automotora ").value, "Mi Automotora");
  assert.ok(!validarConfig("sitio_nombre", "x").ok);
  assert.ok(!validarConfig("sitio_direccion", "x".repeat(200)).ok);
  assert.equal(validarConfig("tasa_mensual_web", 1.456).value, 1.46);
  assert.ok(!validarConfig("tasa_mensual_web", -1).ok);
  assert.ok(!validarConfig("tasa_mensual_web", 11).ok);
  assert.ok(!validarConfig("tasa_mensual_web", null).ok);
  assert.equal(CONFIG_DEFECTO.tasa_mensual_web, 1.5);
});
