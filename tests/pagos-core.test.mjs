import { test } from "node:test";
import assert from "node:assert/strict";
import { validarPago, validarCuentaEmpresa, resumenPagos, verificarPagos, etiquetaCuenta, medioNombre, MEDIOS_PAGO } from "../supabase/functions/api/pagos-core.js";

const HOY = "2026-11-07";

test("Cada medio de pago declara si exige cuenta de la empresa y respaldo", () => {
  const exigenCuenta = MEDIOS_PAGO.filter((m) => m.requiereCuenta).map((m) => m.id);
  assert.deepEqual(exigenCuenta, ["transferencia", "deposito", "vale_vista"]);
  assert.equal(medioNombre("vale_vista"), "Vale vista");
  assert.ok(MEDIOS_PAGO.find((m) => m.id === "efectivo").requiereRespaldo);
  assert.ok(!MEDIOS_PAGO.find((m) => m.id === "credito").requiereRespaldo);
});

test("Validar un pago: medio, monto, fecha, cuenta y referencia", () => {
  const ok = validarPago({ medio: "transferencia", monto: "500000", fechaPago: "2026-11-05", cuentaId: "c1", referencia: "OP-1234" }, { hoy: HOY });
  assert.deepEqual(ok, { ok: true, value: { medio: "transferencia", monto: 500000, fecha_pago: "2026-11-05", cuenta_id: "c1", referencia: "OP-1234", notas: null } });
  assert.equal(validarPago({ medio: "x", monto: 1, fechaPago: HOY }, { hoy: HOY }).error, "medio_pago_invalido");
  assert.equal(validarPago({ medio: "efectivo", monto: 0, fechaPago: HOY }, { hoy: HOY }).error, "monto_invalido");
  assert.equal(validarPago({ medio: "efectivo", monto: 10.5, fechaPago: HOY }, { hoy: HOY }).error, "monto_invalido");
  assert.equal(validarPago({ medio: "efectivo", monto: 1000, fechaPago: "mañana" }, { hoy: HOY }).error, "fecha_pago_invalida");
  assert.equal(validarPago({ medio: "efectivo", monto: 1000, fechaPago: "2026-11-08" }, { hoy: HOY }).error, "fecha_pago_futura");
  assert.equal(validarPago({ medio: "deposito", monto: 1000, fechaPago: HOY, referencia: "123456" }, { hoy: HOY }).error, "cuenta_requerida");
  assert.equal(validarPago({ medio: "vale_vista", monto: 1000, fechaPago: HOY, cuentaId: "c1" }, { hoy: HOY }).error, "referencia_requerida");
  // Efectivo no exige cuenta: si se manda, se ignora.
  assert.equal(validarPago({ medio: "efectivo", monto: 1000, fechaPago: HOY, cuentaId: "c1" }, { hoy: HOY }).value.cuenta_id, null);
});

test("Cuenta bancaria de la empresa", () => {
  const c = validarCuentaEmpresa({ banco: "BCI", tipoCuenta: "Cuenta corriente", numeroCuenta: "12-345 678", alias: "BCI principal" });
  assert.equal(c.ok, true);
  assert.equal(c.value.numero_cuenta, "12-345678");
  assert.equal(c.value.activa, true);
  assert.equal(validarCuentaEmpresa({ banco: "B", numeroCuenta: "12345678" }).error, "banco_requerido");
  assert.equal(validarCuentaEmpresa({ banco: "BCI", numeroCuenta: "12" }).error, "numero_cuenta_invalido");
  assert.equal(validarCuentaEmpresa({ banco: "BCI", numeroCuenta: "12345678", activa: false }).value.activa, false);
  assert.equal(etiquetaCuenta({ banco: "BCI", tipo_cuenta: "Cuenta corriente", numero_cuenta: "123", alias: "Principal" }), "Principal (BCI · Cuenta corriente · 123)");
});

test("Resumen y verificación: los pagos vigentes deben sumar el precio y traer respaldo", () => {
  const archivo = [{ id: "a1" }];
  const pagos = [
    { medio: "transferencia", monto: 6000000, estado: "vigente", archivos: archivo },
    { medio: "efectivo", monto: 3000000, estado: "vigente", archivos: archivo },
    { medio: "efectivo", monto: 999, estado: "anulado", archivos: [] },
  ];
  const r = resumenPagos(pagos, 10000000);
  assert.equal(r.total, 9000000);
  assert.equal(r.falta, 1000000);
  assert.equal(r.cuadra, false);
  assert.equal(verificarPagos(pagos, 10000000).error, "pagos_no_cuadran");
  assert.equal(verificarPagos([], 10000000).error, "sin_pagos");
  const completo = [...pagos, { medio: "credito", monto: 1000000, estado: "vigente", archivos: [] }];
  assert.deepEqual(verificarPagos(completo, 10000000), { ok: true }, "el crédito de la financiera no exige respaldo");
  const sinRespaldo = [{ medio: "vale_vista", monto: 10000000, estado: "vigente", archivos: [] }];
  assert.equal(verificarPagos(sinRespaldo, 10000000).error, "pago_sin_respaldo");
  assert.equal(resumenPagos([{ medio: "efectivo", monto: 12, estado: "vigente", archivos: archivo }], 10).sobra, 2);
});
