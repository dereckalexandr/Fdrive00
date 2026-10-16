import { test } from "node:test";
import assert from "node:assert/strict";
import {
  portalNombre, portalEstadoNombre, anuncioNombre, folioAnuncio, sugerirAviso, validarTextoAnuncio, urlValida, validarPortal,
  elegibleParaAviso, estadoDeAnuncio, alertasAnuncio, consultasDeVehiculo, resumenAvisos,
} from "../supabase/functions/api/anuncios-core.js";

const AHORA = new Date("2026-06-10T15:00:00Z");
const VEH = { marca: "Toyota", modelo: "Yaris", version: "1.5 GLI", anio: 2018, km: 78000, transmision: "Automática", combustible: "Bencina", color: "Gris", precio_lista: 8990000, estado: "disponible", activo: true };

test("Nombres y folio", () => {
  assert.equal(folioAnuncio(3), "AVI-000003");
  assert.equal(portalNombre("facebook"), "Facebook Marketplace");
  assert.equal(portalEstadoNombre("pausado"), "Pausado");
  assert.equal(anuncioNombre("por_publicar"), "Por publicar");
});

test("Texto sugerido desde el inventario", () => {
  const s = sugerirAviso(VEH);
  assert.match(s.titulo, /^Toyota Yaris 1\.5 GLI 2018 · 78\.000 km · Automática$/);
  assert.match(s.descripcion, /Kilometraje: 78\.000 km/);
  assert.match(s.descripcion, /Precio: \$8\.990\.000/);
  assert.match(s.descripcion, /Color: Gris/);
  const minimo = sugerirAviso({ marca: "Kia", modelo: "Rio", anio: 2015, km: 0 });
  assert.ok(minimo.titulo.startsWith("Kia Rio 2015"));
  assert.ok(!/Precio|Color/.test(minimo.descripcion));
});

test("Texto del aviso: largo mínimo y máximo", () => {
  assert.equal(validarTextoAnuncio({ titulo: "Hola", descripcion: "x".repeat(20) }).error, "titulo_aviso_invalido");
  assert.equal(validarTextoAnuncio({ titulo: "Toyota Yaris 2018", descripcion: "corta" }).error, "descripcion_invalida");
  const ok = validarTextoAnuncio({ titulo: "  Toyota   Yaris 2018 ", descripcion: "Línea 1\r\nLínea 2 con detalles" });
  assert.ok(ok.ok);
  assert.equal(ok.value.titulo, "Toyota Yaris 2018");
  assert.ok(!ok.value.descripcion.includes("\r"));
  assert.equal(validarTextoAnuncio({ titulo: "t".repeat(300), descripcion: "d".repeat(5000) }).value.titulo.length, 120);
});

test("Publicación en un portal: enlace https obligatorio salvo en el sitio propio", () => {
  assert.ok(urlValida("https://www.chileautos.cl/vehiculos/detalles/123"));
  assert.ok(!urlValida("http://x.cl/a"));
  assert.ok(!urlValida("javascript:alert(1)"));
  assert.ok(!urlValida("https://"));
  assert.equal(validarPortal({ portal: "chileautos", estado: "publicado" }).error, "url_invalida");
  assert.equal(validarPortal({ portal: "chileautos", estado: "publicado", url: "ftp://x" }).error, "url_invalida");
  assert.ok(validarPortal({ portal: "chileautos", estado: "publicado", url: "https://www.chileautos.cl/a/1", venceEn: "2026-07-01" }).ok);
  assert.ok(validarPortal({ portal: "sitio_web", estado: "publicado" }).ok, "el sitio propio no necesita enlace");
  assert.ok(validarPortal({ portal: "yapo", estado: "pausado" }).ok, "pausar no exige enlace");
  assert.equal(validarPortal({ portal: "yapo", estado: "pausado", url: "malo" }).error, "url_invalida");
  assert.equal(validarPortal({ portal: "nada", estado: "publicado" }).error, "portal_invalido");
  assert.equal(validarPortal({ portal: "yapo", estado: "volando" }).error, "estado_portal_invalido");
  assert.equal(validarPortal({ portal: "sitio_web", estado: "publicado", venceEn: "mañana" }).error, "fecha_invalida");
  assert.equal(validarPortal(null).error, "portal_invalido");
});

test("Quién puede tener aviso y cómo queda su estado", () => {
  assert.ok(elegibleParaAviso(VEH).ok);
  assert.equal(elegibleParaAviso({ ...VEH, estado: "reservado" }).error, "vehiculo_no_disponible");
  assert.equal(elegibleParaAviso({ ...VEH, estado: "preparacion" }).error, "vehiculo_no_disponible");
  assert.equal(elegibleParaAviso({ ...VEH, activo: false }).error, "vehiculo_no_disponible");
  assert.equal(elegibleParaAviso(null).error, "vehiculo_no_disponible");
  assert.equal(elegibleParaAviso(VEH, { exigeValidacion: true, validacionEstado: "en_revision" }).error, "vehiculo_sin_validar");
  assert.ok(elegibleParaAviso(VEH, { exigeValidacion: true, validacionEstado: "aprobada" }).ok);

  assert.equal(estadoDeAnuncio([]), "por_publicar");
  assert.equal(estadoDeAnuncio([{ estado: "pendiente" }]), "por_publicar");
  assert.equal(estadoDeAnuncio([{ estado: "publicado" }, { estado: "baja" }]), "publicado");
  assert.equal(estadoDeAnuncio([{ estado: "pausado" }, { estado: "baja" }]), "pausado");
  assert.equal(estadoDeAnuncio([{ estado: "baja" }, { estado: "baja" }]), "baja");
});

test("Alertas: precio distinto, vehículo reservado o vendido y vencimientos", () => {
  const p = (o) => ({ portal: "chileautos", estado: "publicado", precio_publicado: 8990000, vence_en: null, ...o });
  assert.deepEqual(alertasAnuncio([p({})], VEH, AHORA), []);
  const precio = alertasAnuncio([p({})], { ...VEH, precio_lista: 8490000 }, AHORA);
  assert.equal(precio[0].tipo, "precio");
  assert.match(precio[0].texto, /\$8\.990\.000.*\$8\.490\.000/);
  assert.equal(alertasAnuncio([p({})], { ...VEH, estado: "reservado" }, AHORA)[0].tipo, "reservado");
  assert.equal(alertasAnuncio([p({})], { ...VEH, estado: "vendido" }, AHORA)[0].tipo, "vendido");
  assert.equal(alertasAnuncio([p({})], { ...VEH, activo: false }, AHORA)[0].tipo, "vendido");
  assert.equal(alertasAnuncio([p({ estado: "pausado" })], { ...VEH, estado: "reservado" }, AHORA).length, 0, "pausado y reservado: ya está bien");
  assert.equal(alertasAnuncio([p({ estado: "baja" })], { ...VEH, estado: "vendido" }, AHORA).length, 0);
  assert.equal(alertasAnuncio([p({ vence_en: "2026-06-11" })], VEH, AHORA)[0].tipo, "vence");
  assert.equal(alertasAnuncio([p({ vence_en: "2026-06-20" })], VEH, AHORA).length, 0);
  const v = alertasAnuncio([p({ vence_en: "2026-06-05" })], VEH, AHORA)[0];
  assert.equal(v.tipo, "vencido");
  assert.ok(v.grave);
  assert.equal(alertasAnuncio([p({ portal: "sitio_web", estado: "pendiente", vence_en: "2020-01-01" })], VEH, AHORA).length, 0, "lo no publicado no alerta");
});

test("Consultas por aviso: por portal según la fuente del lead", () => {
  const l = (vehiculo_id, fuente, creado_en = "2026-06-09T00:00:00Z") => ({ vehiculo_id, fuente, creado_en });
  const leads = [l("v1", "Chileautos"), l("v1", "chileautos"), l("v1", "Facebook Marketplace"), l("v1", "Sitio web"), l("v1", "Llamada"), l("v1", null), l("v2", "Yapo"), l("v1", "Yapo", "2026-01-01T00:00:00Z")];
  const c = consultasDeVehiculo(leads, "v1", "2026-06-01T00:00:00Z");
  assert.equal(c.total, 6);
  assert.deepEqual(c.porPortal, { chileautos: 2, facebook: 1, sitio_web: 1 });
  assert.equal(c.otras, 2);
  assert.equal(consultasDeVehiculo(leads, "v1").total, 7, "sin fecha cuenta todo");
  assert.equal(consultasDeVehiculo(leads, "nadie").total, 0);
});

test("Resumen del local", () => {
  const r = resumenAvisos([{ estado: "publicado" }, { estado: "publicado" }, { estado: "pausado" }, { estado: "baja" }], [{ portal: "yapo", estado: "publicado" }, { portal: "yapo", estado: "publicado" }, { portal: "chileautos", estado: "pausado" }]);
  assert.deepEqual(r.porEstado, { por_publicar: 0, publicado: 2, pausado: 1, baja: 1 });
  assert.deepEqual(r.porPortal, { yapo: 2 });
  assert.equal(r.total, 4);
});
