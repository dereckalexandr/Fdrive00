import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canalNombre, tipoPublicacionNombre, publicacionNombre, campaniaNombre, folioCampania, folioPublicacion, materialTipoNombre, materialEstadoNombre,
  validarCampania, validarResultadosCampania, estadoTrasGuardar, validarTransicionCampania, metricasCampania,
  validarPublicacion, publicacionesAtrasadas, resumenPublicaciones, validarMaterial,
} from "../supabase/functions/api/marketing-core.js";

const CAMP = { nombre: "Ofertas de octubre", canal: "instagram", objetivo: "Más consultas SUV", desde: "2026-10-01", hasta: "2026-10-31", presupuesto: 300000 };
const manana = () => new Date(Date.now() + 86_400_000).toISOString();

test("Nombres y folios", () => {
  assert.equal(folioCampania(7), "CAM-0007");
  assert.equal(folioPublicacion(12), "POST-00012");
  assert.equal(canalNombre("tiktok"), "TikTok");
  assert.equal(tipoPublicacionNombre("reel"), "Reel / video corto");
  assert.equal(publicacionNombre("programada"), "Programada");
  assert.equal(campaniaNombre("pendiente"), "Esperando aprobación");
  assert.equal(materialTipoNombre("fotos"), "Fotos profesionales");
  assert.equal(materialEstadoNombre("listo"), "Listo");
});

test("Campaña: datos válidos y errores", () => {
  const ok = validarCampania(CAMP);
  assert.ok(ok.ok);
  assert.equal(ok.value.presupuesto, 300000);
  assert.equal(validarCampania({ ...CAMP, presupuesto: "" }).value.presupuesto, 0, "vacío = sin costo");
  assert.equal(validarCampania({ ...CAMP, nombre: "ab" }).error, "nombre_campania_invalido");
  assert.equal(validarCampania({ ...CAMP, canal: "radio" }).error, "canal_invalido");
  assert.equal(validarCampania({ ...CAMP, desde: "ayer" }).error, "fecha_invalida");
  assert.equal(validarCampania({ ...CAMP, hasta: "2026-09-01" }).error, "fechas_invertidas");
  assert.equal(validarCampania({ ...CAMP, hasta: "2028-01-01" }).error, "fecha_invalida");
  assert.equal(validarCampania({ ...CAMP, presupuesto: -5 }).error, "presupuesto_invalido");
  assert.equal(validarCampania({ ...CAMP, presupuesto: 1.5 }).error, "presupuesto_invalido");
  assert.equal(validarCampania(null).error, "nombre_campania_invalido");
});

test("Resultados anotados a mano: el gasto no supera lo aprobado", () => {
  assert.ok(validarResultadosCampania({ gasto: 250000, alcance: 12000, impresiones: 30000, clics: 800 }, 300000).ok);
  assert.equal(validarResultadosCampania({ gasto: 300001 }, 300000).error, "gasto_excede_presupuesto");
  assert.equal(validarResultadosCampania({ gasto: 1 }, 0).error, "gasto_excede_presupuesto", "campaña sin costo: gasto cero");
  assert.equal(validarResultadosCampania({ gasto: 0, clics: -1 }, 100).error, "resultado_invalido");
  assert.equal(validarResultadosCampania({ gasto: "x" }, 100).error, "gasto_invalido");
  assert.deepEqual(validarResultadosCampania({}, 100).value, { gasto: 0, alcance: 0, impresiones: 0, clics: 0 });
});

test("Aprobación: subir el presupuesto de una campaña aprobada pide aprobar de nuevo", () => {
  assert.equal(estadoTrasGuardar(null, { presupuesto: 5 }), "borrador");
  assert.equal(estadoTrasGuardar({ estado: "aprobada", presupuesto_aprobado: 300000 }, { presupuesto: 300000 }), "aprobada");
  assert.equal(estadoTrasGuardar({ estado: "aprobada", presupuesto_aprobado: 300000 }, { presupuesto: 200000 }), "aprobada", "bajar no pide nada");
  assert.equal(estadoTrasGuardar({ estado: "aprobada", presupuesto_aprobado: 300000 }, { presupuesto: 400000 }), "pendiente");
  assert.equal(estadoTrasGuardar({ estado: "rechazada" }, { presupuesto: 1 }), "borrador");
  assert.equal(estadoTrasGuardar({ estado: "pendiente" }, { presupuesto: 9 }), "pendiente");
});

test("Estados de la campaña", () => {
  assert.ok(validarTransicionCampania("borrador", "enviar").ok);
  assert.ok(validarTransicionCampania("rechazada", "enviar").ok);
  assert.ok(!validarTransicionCampania("aprobada", "enviar").ok);
  assert.ok(validarTransicionCampania("pendiente", "aprobar").ok);
  assert.ok(!validarTransicionCampania("borrador", "aprobar").ok);
  assert.ok(validarTransicionCampania("aprobada", "resultados").ok);
  assert.ok(validarTransicionCampania("finalizada", "resultados").ok);
  assert.ok(!validarTransicionCampania("borrador", "resultados").ok);
  assert.ok(validarTransicionCampania("aprobada", "finalizar").ok);
  assert.ok(!validarTransicionCampania("finalizada", "cancelar").ok);
});

test("Métricas de una campaña: costo por lead y por venta", () => {
  const camp = { id: "c1", gasto: 200000, presupuesto_aprobado: 300000 };
  const leads = [{ id: "a", campania_id: "c1" }, { id: "b", campania_id: "c1" }, { id: "c", campania_id: "c1" }, { id: "d", campania_id: "c1" }, { id: "x", campania_id: "otra" }, { id: "y", campania_id: null }];
  const m = metricasCampania(camp, leads, new Map([["a", { monto: 9000000 }], ["b", { monto: 8000000 }], ["x", { monto: 1 }]]));
  assert.deepEqual(m, { leads: 4, ventas: 2, monto: 17000000, costoPorLead: 50000, costoPorVenta: 100000, conversion: 50, consumo: 67 });
  const vacia = metricasCampania({ id: "z", gasto: 100, presupuesto_aprobado: 0 }, [], new Map());
  assert.equal(vacia.costoPorLead, null);
  assert.equal(vacia.costoPorVenta, null);
  assert.equal(vacia.consumo, null);
  assert.equal(vacia.conversion, 0);
});

test("Publicación: título, red, fechas y enlace", () => {
  const ok = validarPublicacion({ titulo: "Reel Hyundai Venue", red: "instagram", tipo: "reel", estado: "programada", fechaProgramada: manana(), texto: "  Mira este SUV ", campaniaId: "c1", vehiculoId: "v1" });
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(ok.value.campania_id, "c1");
  assert.equal(ok.value.texto, "Mira este SUV");
  assert.equal(validarPublicacion({ titulo: "ab", red: "instagram" }).error, "titulo_publicacion_invalido");
  assert.equal(validarPublicacion({ titulo: "Algo bueno", red: "radio" }).error, "canal_invalido");
  assert.equal(validarPublicacion({ titulo: "Algo bueno", red: "tiktok", tipo: "gif" }).error, "tipo_publicacion_invalido");
  assert.equal(validarPublicacion({ titulo: "Algo bueno", red: "tiktok", estado: "volando" }).error, "estado_publicacion_invalido");
  assert.equal(validarPublicacion({ titulo: "Algo bueno", red: "tiktok", estado: "programada" }).error, "fecha_requerida");
  assert.equal(validarPublicacion({ titulo: "Algo bueno", red: "tiktok", fechaProgramada: "mañana" }).error, "fecha_invalida");
  assert.equal(validarPublicacion({ titulo: "Algo bueno", red: "tiktok", url: "http://x" }).error, "url_invalida");
  assert.ok(validarPublicacion({ titulo: "Idea suelta", red: "facebook" }).ok, "una idea no necesita fecha");
});

test("Calendario: atrasadas y resumen", () => {
  const ahora = new Date();
  const h = (n) => new Date(ahora.getTime() + n * 3_600_000).toISOString();
  const pubs = [
    { estado: "programada", fecha_programada: h(-3), red: "instagram" }, { estado: "programada", fecha_programada: h(5), red: "instagram" },
    { estado: "publicada", fecha_programada: h(-30), red: "tiktok" }, { estado: "idea", fecha_programada: null, red: "facebook" }, { estado: "cancelada", fecha_programada: h(2), red: "tiktok" },
  ];
  assert.equal(publicacionesAtrasadas(pubs, ahora).length, 1);
  const r = resumenPublicaciones(pubs);
  assert.deepEqual(r.porEstado, { idea: 1, produccion: 0, programada: 2, publicada: 1, cancelada: 1 });
  assert.deepEqual(r.porRed, { instagram: 2, tiktok: 1, facebook: 1 });
  assert.equal(r.total, 5);
});

test("Material por vehículo", () => {
  assert.ok(validarMaterial({ vehiculoId: "v1", tipo: "reel" }).ok);
  assert.equal(validarMaterial({ tipo: "reel" }).error, "vehiculo_invalido");
  assert.equal(validarMaterial({ vehiculoId: "v1", tipo: "gif" }).error, "tipo_material_invalido");
  assert.equal(validarMaterial({ vehiculoId: "v1", tipo: "fotos", estado: "casi" }).error, "estado_material_invalido");
  assert.equal(validarMaterial({ vehiculoId: "v1", tipo: "fotos", estado: "listo" }).error, "url_invalida", "listo exige el enlace");
  assert.equal(validarMaterial({ vehiculoId: "v1", tipo: "fotos", url: "ftp://x" }).error, "url_invalida");
  const ok = validarMaterial({ vehiculoId: "v1", tipo: "video", estado: "listo", url: "https://drive.google.com/drive/folders/abc", notas: "Vertical" });
  assert.ok(ok.ok);
  assert.equal(ok.value.estado, "listo");
});
