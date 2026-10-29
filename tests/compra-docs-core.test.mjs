import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BANCOS_CHILE, TIPOS_CUENTA, validarCuentaBancaria, DOCS_COMPRA, checklistPara, reglaDocCompra, archivoPermitidoParaDoc, validarDatosDoc, validarDatosCliente, faltantesCompra, esChecklistCompraActual, filaDoc,
} from "../supabase/functions/api/validaciones-core.js";

const CLIENTE = { nombre: "Juan Pérez", rut: "12.345.678-5", telefono: "9 1234 5678", email: "juan@correo.cl", direccion: "Av. Siempre Viva 742", comuna: "Providencia", banco: "BancoEstado", tipo_cuenta: "Cuenta RUT", numero_cuenta: "123456789" };
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
  const base = { ...CLIENTE, tipoCuenta: CLIENTE.tipo_cuenta, numeroCuenta: CLIENTE.numero_cuenta };
  const ok = validarDatosCliente(base);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.rut.replace(/\./g, ""), "12345678-5");
  const e = (o) => validarDatosCliente({ ...base, ...o }).error;
  assert.equal(e({ rut: "12.345.678-9" }), "rut_invalido");
  assert.equal(e({ nombre: "Juan" }), "nombre_apellido_requerido");
  assert.equal(e({ telefono: "123" }), "telefono_invalido");
  assert.equal(e({ email: "sin-arroba" }), "email_invalido");
  assert.equal(e({ direccion: "Calle" }), "direccion_requerida");
  assert.equal(e({ comuna: "" }), "comuna_invalida");
  assert.equal(e({ comuna: "Narnia" }), "comuna_invalida");
  assert.equal(ok.value.comuna, "Providencia");
  // El RUT se verifica con su dígito verificador (módulo 11): un número cualquiera no pasa.
  assert.equal(e({ rut: "11.111.111-2" }), "rut_invalido");
  assert.equal(e({ rut: "12345678" }), "rut_invalido");
  assert.equal(e({ rut: "12.345.67K-5" }), "rut_invalido");
  assert.equal(validarDatosCliente({ ...base, rut: "7.654.321-6" }).ok, true);
  assert.equal(e({ banco: "" }), "banco_invalido");
  assert.equal(e({ banco: "Banco Inventado" }), "banco_invalido");
  assert.equal(e({ tipoCuenta: "Libreta" }), "tipo_cuenta_invalido");
  assert.equal(e({ numeroCuenta: "12" }), "numero_cuenta_invalido");
  assert.equal(e({ numeroCuenta: "12ab5678" }), "numero_cuenta_invalido");
  assert.equal(validarDatosCliente({ ...base, numeroCuenta: "12.345-678 9" }).value.numero_cuenta, "123456789", "se guarda solo con dígitos");
});

test("Faltantes: la compra solo se concreta con todos los datos y documentos", () => {
  assert.equal(faltantesCompra({ cliente: CLIENTE, docs: completos() }).length, 0);
  const vacio = faltantesCompra({ cliente: {}, docs: [] });
  assert.equal(vacio.length, 9 + 11);
  // Un documento sin archivo, o sin su vencimiento o precio, sigue faltando.
  const docs = completos();
  docs.find((d) => d.clave === "cav").archivos = [];
  delete docs.find((d) => d.clave === "soap").vence_en;
  delete docs.find((d) => d.clave === "permiso_circulacion").precio;
  const f = faltantesCompra({ cliente: { ...CLIENTE, direccion: "" }, docs }).map((x) => x.texto);
  assert.deepEqual(f, ["Dirección del vendedor", "Documento: CAV (certificado de anotaciones vigentes)", "Precio de pago de: Permiso de circulación", "Fecha de vencimiento de: SOAP"]);
});

test("Cuenta bancaria: banco y tipo de cuenta de listas, y el número", () => {
  assert.ok(BANCOS_CHILE.includes("Banco de Chile") && BANCOS_CHILE.includes("BancoEstado") && BANCOS_CHILE.includes("Banco Santander Chile"));
  assert.deepEqual(TIPOS_CUENTA, ["Cuenta corriente", "Cuenta vista", "Cuenta RUT", "Cuenta de ahorro"]);
  assert.deepEqual(validarCuentaBancaria({ banco: "Scotiabank Chile", tipoCuenta: "Cuenta corriente", numeroCuenta: "00-123.456" }).value, { banco: "Scotiabank Chile", tipo_cuenta: "Cuenta corriente", numero_cuenta: "00123456" });
  assert.equal(validarCuentaBancaria({ tipoCuenta: "Cuenta vista", numeroCuenta: "123456" }).error, "banco_invalido");
  assert.equal(validarCuentaBancaria({ banco: "Banco de Chile", numeroCuenta: "123456" }).error, "tipo_cuenta_invalido");
  assert.equal(validarCuentaBancaria({ banco: "Banco de Chile", tipoCuenta: "Cuenta vista" }).error, "numero_cuenta_invalido");
});

test("Consignación: los mismos documentos que la compra, sin Dicom ni Pensión de alimentos y con Contrato de consignación", async () => {
  const { DOCS_CONSIGNACION, faltantesConsignacion } = await import("../supabase/functions/api/validaciones-core.js");
  assert.deepEqual(DOCS_CONSIGNACION.map((d) => d.clave), ["cav", "multas", "carnet_identidad", "informe_legal", "permiso_circulacion", "revision_tecnica", "soap", "padron", "contrato_consignacion"]);
  assert.equal(DOCS_CONSIGNACION.find((d) => d.clave === "contrato_consignacion").nombre, "Contrato de consignación");
  assert.deepEqual(checklistPara("consignacion").map((d) => d.clave), DOCS_CONSIGNACION.map((d) => d.clave));
  assert.ok(checklistPara("consignacion").every((d) => d.requerido));
  assert.ok(reglaDocCompra("contrato_consignacion").tipos.includes("image/jpeg"), "el contrato acepta imagen o PDF");
  const docs = DOCS_CONSIGNACION.map((d) => ({ clave: d.clave, archivos: [{ id: "abc123" }], ...(d.vence ? { vence_en: "2027-03-31" } : {}), ...(d.precio ? { precio: 98000 } : {}) }));
  assert.equal(faltantesConsignacion({ cliente: CLIENTE, docs }).length, 0);
  const vacio = faltantesConsignacion({ cliente: {}, docs: [] });
  assert.equal(vacio.length, 9 + 9);
  assert.ok(vacio.some((f) => f.texto === "RUT del dueño") && vacio.some((f) => f.texto === "Banco del dueño"));
  assert.ok(!vacio.some((f) => /Dicom|Pensión/.test(f.texto)));
});
