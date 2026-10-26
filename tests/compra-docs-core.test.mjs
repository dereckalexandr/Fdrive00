import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOCS_COMPRA, checklistPara, reglaDocCompra, archivoPermitidoParaDoc, validarDatosDoc, validarDatosCliente, faltantesCompra, esChecklistCompraActual, filaDoc,
} from "../supabase/functions/api/validaciones-core.js";

const CLIENTE = { nombre: "Juan Pérez", rut: "12.345.678-5", telefono: "9 1234 5678", email: "juan@correo.cl", direccion: "Av. Siempre Viva 742", cuenta_corriente: "Banco Estado 123456789" };
const completos = () => DOCS_COMPRA.map((d) => ({ clave: d.clave, archivos: [{ id: "abc123" }], ...(d.vence ? { vence_en: "2027-03-31" } : {}), ...(d.precio ? { precio: 98000 } : {}) }));

test("Compra: los 11 documentos obligatorios, con su tipo de archivo, vencimiento y precio", () => {
  assert.deepEqual(checklistPara("compra").map((d) => d.clave), ["cav", "multas", "dicom", "pension_alimentos", "carnet_identidad", "informe_legal", "permiso_circulacion", "revision_tecnica", "soap", "padron", "contrato_compraventa"]);
  assert.ok(checklistPara("compra").every((d) => d.requerido));
  for (const c of ["cav", "multas", "dicom", "informe_legal"]) assert.equal(archivoPermitidoParaDoc(c, "image/jpeg").error, "archivo_solo_pdf", c);
  for (const c of ["pension_alimentos", "carnet_identidad", "permiso_circulacion", "revision_tecnica", "soap", "padron", "contrato_compraventa"]) {
    assert.ok(archivoPermitidoParaDoc(c, "image/jpeg").ok && archivoPermitidoParaDoc(c, "application/pdf").ok, c);
  }
  assert.equal(archivoPermitidoParaDoc("soap", "image/png").error, "archivo_tipo_invalido");
  assert.deepEqual(DOCS_COMPRA.filter((d) => d.vence).map((d) => d.clave), ["permiso_circulacion", "revision_tecnica", "soap"]);
  assert.deepEqual(DOCS_COMPRA.filter((d) => d.precio).map((d) => d.clave), ["permiso_circulacion"]);
  assert.deepEqual(Object.keys(filaDoc(DOCS_COMPRA[0])), ["clave", "nombre", "grupo", "requerido"], "solo las columnas que se guardan");
  assert.ok(esChecklistCompraActual(checklistPara("compra")));
  assert.ok(!esChecklistCompraActual([{ clave: "cedula_vendedor" }]));
});

test("Fecha de vencimiento y precio del permiso", () => {
  assert.deepEqual(validarDatosDoc("soap", { venceEn: "2027-03-31" }).value, { vence_en: "2027-03-31" });
  assert.equal(validarDatosDoc("soap", { venceEn: "31-03-2027" }).error, "vencimiento_invalido");
  assert.equal(validarDatosDoc("soap", { venceEn: "2027-02-31" }).error, "vencimiento_invalido");
  assert.equal(validarDatosDoc("soap", {}).error, "vencimiento_invalido");
  assert.deepEqual(validarDatosDoc("permiso_circulacion", { venceEn: "2027-03-31", precio: 98000 }).value, { vence_en: "2027-03-31", precio: 98000 });
  assert.equal(validarDatosDoc("permiso_circulacion", { venceEn: "2027-03-31" }).error, "precio_doc_invalido");
  assert.equal(validarDatosDoc("permiso_circulacion", { venceEn: "2027-03-31", precio: -5 }).error, "precio_doc_invalido");
  assert.equal(validarDatosDoc("cav", { venceEn: "2027-03-31" }).error, "doc_sin_datos");
});

test("Datos críticos del vendedor: RUT, nombre y apellido, teléfono, correo, dirección y cuenta corriente", () => {
  const ok = validarDatosCliente({ ...CLIENTE, cuentaCorriente: CLIENTE.cuenta_corriente });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.rut.replace(/\./g, ""), "12345678-5");
  const e = (o) => validarDatosCliente({ ...CLIENTE, cuentaCorriente: CLIENTE.cuenta_corriente, ...o }).error;
  assert.equal(e({ rut: "12.345.678-9" }), "rut_invalido");
  assert.equal(e({ nombre: "Juan" }), "nombre_apellido_requerido");
  assert.equal(e({ telefono: "123" }), "telefono_invalido");
  assert.equal(e({ email: "sin-arroba" }), "email_invalido");
  assert.equal(e({ direccion: "Calle" }), "direccion_requerida");
  assert.equal(e({ cuentaCorriente: "" }), "cuenta_corriente_requerida");
});

test("Faltantes: la compra solo se concreta con todos los datos y documentos", () => {
  assert.equal(faltantesCompra({ cliente: CLIENTE, docs: completos() }).length, 0);
  const vacio = faltantesCompra({ cliente: {}, docs: [] });
  assert.equal(vacio.length, 6 + 11);
  // Un documento sin archivo, o sin su vencimiento o precio, sigue faltando.
  const docs = completos();
  docs.find((d) => d.clave === "cav").archivos = [];
  delete docs.find((d) => d.clave === "soap").vence_en;
  delete docs.find((d) => d.clave === "permiso_circulacion").precio;
  const f = faltantesCompra({ cliente: { ...CLIENTE, direccion: "" }, docs }).map((x) => x.texto);
  assert.deepEqual(f, ["Dirección del vendedor", "Documento: CAV (certificado de anotaciones vigentes)", "Precio de pago de: Permiso de circulación", "Fecha de vencimiento de: SOAP"]);
});
