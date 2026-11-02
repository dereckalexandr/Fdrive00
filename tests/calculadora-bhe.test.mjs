import test from "node:test";
import assert from "node:assert/strict";
import { tasaRetencion, anioPorDefecto, calcularBoleta, RETENCION_POR_ANIO } from "../src/calculadora-bhe.js";

test("Retención por año de emisión (Ley 21.133)", () => {
  const esperado = { 2019: 10, 2020: 10.75, 2021: 11.5, 2022: 12.25, 2023: 13, 2024: 13.75, 2025: 14.5, 2026: 15.25, 2027: 16, 2028: 17 };
  for (const [a, t] of Object.entries(esperado)) assert.equal(tasaRetencion(Number(a)), t, a);
  assert.equal(tasaRetencion(2015), 10, "2019 o anterior: 10%");
  assert.equal(tasaRetencion(2031), 17, "desde 2028: 17%");
  assert.equal(tasaRetencion("x"), 10);
  assert.equal(Object.keys(RETENCION_POR_ANIO).length, 10);
  assert.equal(anioPorDefecto(new Date("2026-11-01")), 2026);
  assert.equal(anioPorDefecto(new Date("2040-01-01")), 2028);
});

test("Líquido de 500.000 en 2026: la boleta sale por 589.971 y la retención es 89.971", () => {
  const r = calcularBoleta({ monto: 500000, anio: 2026 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.comoLiquido, { liquido: 500000, bruto: 589971, retencion: 89971 });
});

test("Bruto de 800.000 en 2026: retención 122.000 y líquido 678.000", () => {
  const r = calcularBoleta({ monto: 800000, anio: 2026 });
  assert.deepEqual(r.comoBruto, { liquido: 678000, bruto: 800000, retencion: 122000 });
  assert.equal(r.tasa, 15.25);
  const cien = calcularBoleta({ monto: 100000, anio: 2026 });
  assert.deepEqual(cien.comoBruto, { liquido: 84750, bruto: 100000, retencion: 15250 });
});

test("En UF: 10 UF con la UF a 41.252,94", () => {
  const r = calcularBoleta({ monto: 10, moneda: "uf", uf: 41252.94, anio: 2026 });
  assert.equal(r.montoPesos, 412529);
  assert.deepEqual(r.comoBruto, { liquido: 349618, bruto: 412529, retencion: 62911 });
  assert.deepEqual(calcularBoleta({ monto: 10, moneda: "uf", uf: 0 }), { ok: false, error: "uf_invalida" });
});

test("Siempre cuadra: bruto - retención = líquido, y al revés el líquido queda exacto", () => {
  for (const anio of [2019, 2022, 2026, 2028]) for (const monto of [1, 999, 123456, 987654321]) {
    const r = calcularBoleta({ monto, anio });
    assert.equal(r.comoBruto.bruto - r.comoBruto.retencion, r.comoBruto.liquido);
    assert.equal(r.comoLiquido.bruto - r.comoLiquido.retencion, monto);
  }
});

test("Montos inválidos", () => {
  for (const monto of [0, -5, "abc", null, NaN, 1e15]) assert.deepEqual(calcularBoleta({ monto }), { ok: false, error: "monto_invalido" });
});
