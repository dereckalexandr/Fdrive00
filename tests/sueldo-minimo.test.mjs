import test from "node:test";
import assert from "node:assert/strict";
import { SUELDO_MINIMO_RESPALDO, extraerSueldoMinimo, elegirSueldoMinimo } from "../supabase/functions/api/sueldo-minimo-core.js";

test("Extrae el sueldo mínimo del texto de las páginas de referencia", () => {
  assert.equal(extraerSueldoMinimo("<title>Sueldo Mínimo Chile 2026: $553.553 — Líquido $452.917 | FinClaro</title>"), 553553);
  assert.equal(extraerSueldoMinimo("<p>Sueldo mínimo en Chile 2026: el ingreso mínimo mensual (IMM) vigente es de $553.553. Revisa los montos por edad</p>"), 553553);
  assert.equal(extraerSueldoMinimo("El sueldo&nbsp;mínimo legal es <b>$553.553</b> bruto."), 553553);
});

test("Entre varios montos, se queda con el que más se repite y descarta los fuera de rango", () => {
  const html = "Sueldo mínimo antes: $539.000. Sueldo mínimo vigente $553.553. Ingreso mínimo mensual: $553.553. Sueldo mínimo menores de 18: $402.082. Sueldo mínimo no remuneracional $356.815. Sueldo mínimo 2030 $9.999.999";
  assert.equal(extraerSueldoMinimo(html), 553553);
  assert.equal(extraerSueldoMinimo("Sin montos. Sueldo mínimo $50.000"), null);
  assert.equal(extraerSueldoMinimo(""), null);
  assert.equal(extraerSueldoMinimo(null), null);
});

test("Elige el valor más alto y nunca baja del de respaldo", () => {
  assert.equal(elegirSueldoMinimo([]), SUELDO_MINIMO_RESPALDO);
  assert.equal(elegirSueldoMinimo([null, NaN]), SUELDO_MINIMO_RESPALDO);
  assert.equal(elegirSueldoMinimo([539000]), SUELDO_MINIMO_RESPALDO, "una página desactualizada no lo baja");
  assert.equal(elegirSueldoMinimo([553553, 560000]), 560000, "un reajuste nuevo sube el valor");
  assert.equal(elegirSueldoMinimo([100]), SUELDO_MINIMO_RESPALDO);
});
