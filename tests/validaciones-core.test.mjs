import { test } from "node:test";
import assert from "node:assert/strict";
import {
  folioValidacion, validacionNombre, docNombre, tipoValidacionNombre, checklistPara, validarRevision, validarArchivo, claveArchivo,
  estadoDeValidacion, progreso, docsReutilizables, colaValidaciones, metricasValidador, validarTransicionValidacion,
} from "../supabase/functions/api/validaciones-core.js";

const doc = (clave, estado, extra = {}) => ({ clave, estado, requerido: true, grupo: "vehiculo", archivos: [], ...extra });

test("Nombres y folio", () => {
  assert.equal(folioValidacion(5), "VAL-000005");
  assert.equal(validacionNombre("en_revision"), "En revisión");
  assert.equal(docNombre("no_aplica"), "No aplica");
  assert.equal(tipoValidacionNombre("venta"), "Cierre de venta");
});

test("Documentos que se piden según el tipo", () => {
  assert.equal(checklistPara("vehiculo").length, 5);
  const venta = checklistPara("venta").map((d) => d.clave);
  assert.ok(venta.includes("cedula_cliente") && venta.includes("comprobante_pago") && !venta.includes("renta"));
  const fin = checklistPara("venta", { conFinanciamiento: true, conParteDePago: true }).map((d) => d.clave);
  assert.ok(fin.includes("renta") && fin.includes("antecedentes_credito") && fin.includes("docs_parte_pago"));
  const compra = checklistPara("compra");
  assert.ok(compra.some((d) => d.clave === "carnet_identidad") && compra.length === 11);
  assert.ok(compra.every((d) => d.requerido));
  assert.deepEqual(checklistPara("otro"), []);
  checklistPara("vehiculo")[0].nombre = "x";
  assert.notEqual(checklistPara("vehiculo")[0].nombre, "x", "cada llamada entrega copias");
});

test("Revisión: observar, rechazar y 'no aplica' exigen un motivo", () => {
  assert.ok(validarRevision({ estado: "aprobado" }).ok);
  assert.equal(validarRevision({ estado: "observado" }).error, "comentario_requerido");
  assert.equal(validarRevision({ estado: "rechazado", comentario: "  " }).error, "comentario_requerido");
  assert.equal(validarRevision({ estado: "no_aplica", comentario: "ok" }).error, "comentario_requerido");
  assert.equal(validarRevision({ estado: "pendiente" }).error, "estado_doc_invalido");
  assert.equal(validarRevision({ estado: "observado", comentario: "  Falta   el reverso " }).value.comentario, "Falta el reverso");
  assert.equal(validarRevision(null).error, "estado_doc_invalido");
});

test("Archivos: solo imagen JPEG o PDF y hasta 4 MB", () => {
  const ok = validarArchivo({ id: "abc12345", nombre: " cédula.pdf ", tipo: "application/pdf", tam: 100000 });
  assert.ok(ok.ok);
  assert.equal(ok.value.nombre, "cédula.pdf");
  assert.equal(validarArchivo({ id: "../x", tipo: "image/jpeg", tam: 10 }).error, "archivo_invalido");
  assert.equal(validarArchivo({ id: "abc12345", tipo: "text/html", tam: 10 }).error, "archivo_tipo_invalido");
  assert.equal(validarArchivo({ id: "abc12345", tipo: "image/jpeg", tam: 5 * 1024 * 1024 }).error, "archivo_muy_grande");
  assert.equal(validarArchivo({ id: "abc12345", tipo: "image/jpeg", tam: 0 }).error, "archivo_muy_grande");
  assert.equal(claveArchivo("v1", "a1"), "dval::v1::a1");
});

test("Estado de la validación según sus documentos", () => {
  assert.equal(estadoDeValidacion([doc("a", "pendiente"), doc("b", "pendiente")], false), "pendiente");
  assert.equal(estadoDeValidacion([doc("a", "pendiente")], true), "en_revision");
  assert.equal(estadoDeValidacion([doc("a", "aprobado"), doc("b", "observado")], true), "observada");
  assert.equal(estadoDeValidacion([doc("a", "observado"), doc("b", "rechazado")], true), "rechazada", "el rechazo pesa más");
  assert.equal(estadoDeValidacion([doc("a", "aprobado"), doc("b", "no_aplica")], true), "aprobada");
  assert.equal(estadoDeValidacion([doc("a", "aprobado"), doc("b", "pendiente", { requerido: false })], true), "aprobada", "lo opcional no bloquea");
  assert.equal(estadoDeValidacion([], true), "en_revision", "sin documentos no se aprueba sola");
});

test("Progreso y reutilización de documentos del vehículo", () => {
  const p = progreso([doc("a", "aprobado"), doc("b", "observado"), doc("c", "rechazado"), doc("d", "no_aplica"), doc("e", "pendiente"), doc("f", "pendiente", { archivos: [{ id: "x" }] })]);
  assert.deepEqual(p, { total: 6, aprobados: 1, observados: 1, rechazados: 1, porRevisar: 2, noAplica: 1, sinArchivo: 1 });
  const r = docsReutilizables([
    doc("padron", "aprobado", { archivos: [{ id: "a1" }], revisado_por: "Vera" }), doc("soap", "observado"), doc("cedula", "aprobado", { grupo: "cliente" }),
  ], "val1");
  assert.deepEqual(Object.keys(r), ["padron"]);
  assert.equal(r.padron.archivos[0].v, "val1");
  assert.equal(docsReutilizables([doc("p", "aprobado", { archivos: [{ id: "a", v: "origen" }] })], "otra").p.archivos[0].v, "origen");
});

test("Cola y métricas del Validador", () => {
  const ahora = new Date();
  const h = (n) => new Date(ahora.getTime() + n * 3_600_000).toISOString();
  const mes = ahora.toLocaleDateString("en-CA", { timeZone: "America/Santiago" }).slice(0, 7);
  const c = colaValidaciones([{ estado: "pendiente", solicitada_en: h(-9) }, { estado: "pendiente", solicitada_en: h(-1) }, { estado: "aprobada", solicitada_en: h(-50) }], ahora, 8);
  assert.equal(c.pendientes, 2);
  assert.equal(c.masAntiguaHoras, 9);
  assert.equal(c.atrasadas.length, 1);
  const f = (o) => ({ validador_id: "v1", estado: "aprobada", solicitada_en: h(-10), resuelta_en: h(-4), ...o });
  const m = metricasValidador([f({}), f({ solicitada_en: h(-20) }), f({ resuelta_en: "2020-01-01T00:00:00Z" }), f({ validador_id: "v2" }), f({ estado: "observada", resuelta_en: null }), f({ estado: "en_revision", resuelta_en: null })], "v1", mes);
  assert.equal(m.aprobadas, 2);
  assert.equal(m.tiempoMedioHoras, 11);
  assert.equal(m.abiertas, 2);
  assert.equal(m.conObservaciones, 1);
});

test("Transiciones de la cola", () => {
  assert.ok(validarTransicionValidacion("pendiente", "tomar").ok);
  assert.ok(!validarTransicionValidacion("en_revision", "tomar").ok);
  assert.ok(validarTransicionValidacion("observada", "revisar").ok);
  assert.ok(!validarTransicionValidacion("pendiente", "revisar").ok);
  assert.ok(!validarTransicionValidacion("aprobada", "revisar").ok);
  assert.ok(!validarTransicionValidacion("aprobada", "asignar").ok);
});
