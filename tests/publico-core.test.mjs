import { test } from "node:test";
import assert from "node:assert/strict";
import {
  visibleEnCatalogo, vehiculoPublico, validarSolicitudWeb, cuotaReferencial, tipoLeadDe, resumenSolicitud, MENSAJES_WEB,
  ESPERA_MINIMA_MS, VIGENCIA_FORMULARIO_MS, validarTelefonoInternacional, PAISES,
}  from "../supabase/functions/api/publico-core.js";
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
  const v = (o = {}) => base({ tipo: "vender", vehiculoId: undefined, patente: "ab-cd 12", marca: "Toyota", modelo: "Yaris", anio: 2018, km: 78000, modalidad: "consignar", transmision: "Automática", combustible: "Bencina", duenos: 2, prenda: "no", mantenciones: "si", precioEsperado: 8500000, ...o });
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
  assert.match(resumenSolicitud(ok.value), /2 dueños · prenda: no · mantenciones en la marca: sí · precio esperado \$8\.500\.000/);
  assert.deepEqual([ok.value.vende.duenos, ok.value.vende.prenda, ok.value.vende.mantenciones, ok.value.vende.precioEsperado], [2, "no", "si", 8500000]);
});

test("Vender o consignar: todos los datos son obligatorios", () => {
  const v = (o = {}) => base({ tipo: "vender", vehiculoId: undefined, patente: "ABCD12", marca: "Toyota", modelo: "Yaris", anio: 2018, km: 78000, modalidad: "vender", transmision: "Automática", combustible: "Bencina", duenos: 1, prenda: "no", mantenciones: "no", precioEsperado: 8000000, ...o });
  assert.ok(validarSolicitudWeb(v(), AHORA).ok);
  const e = (o) => validarSolicitudWeb(v(o), AHORA).error;
  assert.equal(e({ email: "" }), "email_requerido");
  assert.equal(e({ mensaje: "" }), "mensaje_requerido");
  assert.equal(e({ mensaje: "  " }), "mensaje_requerido");
  assert.equal(e({ transmision: "" }), "transmision_invalida");
  assert.equal(e({ transmision: "CVT" }), "transmision_invalida");
  assert.equal(e({ combustible: "" }), "combustible_invalido");
  assert.equal(e({ combustible: "Gas" }), "combustible_invalido");
  assert.equal(e({ duenos: "" }), "duenos_invalido");
  assert.equal(e({ duenos: 0 }), "duenos_invalido");
  assert.equal(e({ duenos: 31 }), "duenos_invalido");
  assert.equal(e({ duenos: 1.5 }), "duenos_invalido");
  assert.equal(e({ prenda: "" }), "prenda_invalida");
  assert.equal(e({ prenda: "tal vez" }), "prenda_invalida");
  assert.equal(e({ mantenciones: "" }), "mantenciones_invalidas");
  assert.equal(e({ mantenciones: undefined }), "mantenciones_invalidas");
  assert.equal(e({ precioEsperado: "" }), "precio_esperado_invalido");
  assert.equal(e({ precioEsperado: 0 }), "precio_esperado_invalido");
  assert.equal(e({ precioEsperado: -5 }), "precio_esperado_invalido");
  for (const k of ["duenos", "prenda", "mantenciones", "precio_esperado"]) assert.ok(MENSAJES_WEB[k === "precio_esperado" ? "precio_esperado_invalido" : k === "duenos" ? "duenos_invalido" : k === "prenda" ? "prenda_invalida" : "mantenciones_invalidas"]);
  // Las demás solicitudes no exigen correo ni comentario.
  assert.ok(validarSolicitudWeb(base({ email: "", mensaje: "" }), AHORA).ok);
});

test("Teléfono con código de país: se arma el número internacional y se valida por país", () => {
  const t = (codigoPais, telefono) => validarSolicitudWeb(base({ codigoPais, telefono }), AHORA);
  assert.equal(t("56", "9 1234 5678").value.contacto.telefono, "+56912345678");
  assert.equal(t("+56", "912345678").value.contacto.telefono, "+56912345678");
  assert.equal(t("56", "0912345678").value.contacto.telefono, "+56912345678", "un 0 al comienzo se ignora");
  assert.equal(t("56", "91234567").error, "telefono_invalido", "Chile: 9 dígitos");
  assert.equal(t("56", "9123456789").error, "telefono_invalido");
  assert.equal(t("54", "11 2345 6789").value.contacto.telefono, "+541123456789");
  assert.equal(t("51", "912345678").value.contacto.telefono, "+51912345678");
  assert.equal(t("1", "212 555 0123").value.contacto.telefono, "+12125550123");
  assert.equal(t("54", "123").error, "telefono_invalido");
  assert.equal(t("999", "912345678").error, "codigo_pais_invalido");
  assert.equal(t("abc", "912345678").error, "codigo_pais_invalido");
  assert.equal(t("56", "").error, "telefono_invalido");
  assert.ok(MENSAJES_WEB.codigo_pais_invalido);
  assert.equal(validarTelefonoInternacional("56", "9 8765 4321").value, "+56987654321");
  assert.ok(PAISES.some((p) => p.id === "CL" && p.codigo === "56") && PAISES[0].id === "CL", "Chile va primero");
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

test("Renovar (cambiar mi auto por otro): exige el vehículo deseado y todos los datos del auto actual; es un lead de venta", () => {
  const r = (o = {}) => base({ tipo: "renovar", vehiculoId: "v1", patente: "ab-cd 12", marca: "Toyota", modelo: "Yaris", anio: 2016, km: 90000, transmision: "Automática", combustible: "Bencina", duenos: 2, prenda: "no", mantenciones: "si", precioEsperado: 5000000, ...o });
  const ok = validarSolicitudWeb(r(), AHORA);
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(tipoLeadDe(ok.value), "venta", "va al reparto de ventas");
  assert.equal(ok.value.vehiculoId, "v1");
  assert.equal(ok.value.vende.patente, "ABCD12");
  assert.equal(ok.value.vende.modalidad, "cambiar");
  assert.match(resumenSolicitud(ok.value, "Hyundai Venue 2023"), /Quiere cambiar su Toyota Yaris 2016 · 90\.000 km · ABCD12 por Hyundai Venue 2023/);
  assert.match(resumenSolicitud(ok.value, "Hyundai Venue 2023"), /2 dueños · prenda: no · mantenciones en la marca: sí · precio esperado \$5\.000\.000/);
  const e = (o) => validarSolicitudWeb(r(o), AHORA).error;
  assert.equal(e({ vehiculoId: "" }), "vehiculo_requerido");
  assert.equal(e({ email: "" }), "email_requerido");
  assert.equal(e({ mensaje: "" }), "mensaje_requerido");
  assert.equal(e({ patente: "12" }), "patente_invalida");
  assert.equal(e({ km: "" }), "km_invalido");
  assert.equal(e({ duenos: "" }), "duenos_invalido");
  assert.equal(e({ prenda: "" }), "prenda_invalida");
  assert.equal(e({ mantenciones: "" }), "mantenciones_invalidas");
  assert.equal(e({ precioEsperado: "" }), "precio_esperado_invalido");
});
