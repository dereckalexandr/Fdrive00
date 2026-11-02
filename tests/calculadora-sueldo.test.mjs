import test from "node:test";
import assert from "node:assert/strict";
import { PARAMETROS, TRAMOS_IMPUESTO, impuestoUnico, calcularLiquido, calcularDesdeLiquido } from "../src/calculadora-sueldo.js";

const P = { ...PARAMETROS, uf: 40000, utm: 72440 };

test("Impuesto único: coincide con la tabla mensual del SII de noviembre 2026", () => {
  assert.equal(impuestoUnico(977_940, 72440), 0, "hasta 13,5 UTM está exento");
  assert.equal(impuestoUnico(2_000_000, 72440), Math.round(2_000_000 * 0.04 - 39_117.6));
  assert.equal(impuestoUnico(3_000_000, 72440), Math.round(3_000_000 * 0.08 - 126_045.6));
  assert.equal(impuestoUnico(5_000_000, 72440), Math.round(5_000_000 * 0.135 - 325_255.6));
  assert.equal(impuestoUnico(30_000_000, 72440), Math.round(30_000_000 * 0.4 - 2_812_120.8));
  assert.equal(impuestoUnico(0, 72440), 0);
  assert.equal(TRAMOS_IMPUESTO.length, 8);
});

test("Sueldo base de 1.000.000 con AFP Habitat y Fonasa: líquido sin impuesto", () => {
  const r = calcularLiquido({ sueldoBase: 1_000_000, afp: "habitat", salud: "fonasa", contrato: "indefinido" }, P);
  assert.equal(r.imponible, 1_000_000);
  assert.equal(r.descuentos.afp, 112_700); // 10% + 1,27%
  assert.equal(r.descuentos.salud, 70_000);
  assert.equal(r.descuentos.cesantia, 6_000);
  assert.equal(r.descuentos.impuesto, 0);
  assert.equal(r.liquido, 811_300);
});

test("Contrato a plazo fijo no paga seguro de cesantía; sin AFP no se descuenta AFP", () => {
  const r = calcularLiquido({ sueldoBase: 1_000_000, afp: "ninguna", contrato: "plazo_fijo" }, P);
  assert.equal(r.descuentos.cesantia, 0);
  assert.equal(r.descuentos.afp, 0);
});

test("Los no imponibles suman al líquido y no a la renta imponible", () => {
  const sin = calcularLiquido({ sueldoBase: 1_000_000 }, P);
  const con = calcularLiquido({ sueldoBase: 1_000_000, colacion: 50_000, movilizacion: 30_000 }, P);
  assert.equal(con.imponible, sin.imponible);
  assert.equal(con.liquido - sin.liquido, 80_000);
});

test("Tope imponible: AFP y salud se calculan hasta 90 UF", () => {
  const r = calcularLiquido({ sueldoBase: 10_000_000, afp: "uno", contrato: "plazo_fijo" }, P);
  const tope = 90 * 40000;
  assert.equal(r.superaTope, true);
  assert.equal(r.descuentos.salud, Math.round(tope * 0.07));
  assert.equal(r.descuentos.afp, Math.round(tope * 0.1046));
});

test("Isapre: se descuenta el plan en UF y nunca menos del 7% legal", () => {
  const caro = calcularLiquido({ sueldoBase: 1_000_000, salud: "isapre", planSaludUf: 3 }, P);
  assert.equal(caro.descuentos.salud, 120_000);
  const barato = calcularLiquido({ sueldoBase: 1_000_000, salud: "isapre", planSaludUf: 0.5 }, P);
  assert.equal(barato.descuentos.salud, 70_000);
});

test("Gratificación legal: 25% del sueldo con tope de 4,75 sueldos mínimos al año", () => {
  const normal = calcularLiquido({ sueldoBase: 600_000, gratificacion: true }, P);
  assert.equal(normal.haberes.gratificacion, 150_000);
  const alto = calcularLiquido({ sueldoBase: 3_000_000, gratificacion: true }, P);
  assert.equal(alto.haberes.gratificacion, Math.round((4.75 * P.sueldoMinimo) / 12));
  assert.equal(alto.imponible, 3_000_000 + alto.haberes.gratificacion);
});

test("Días ausente descuentan del sueldo base; horas extra con 50% de recargo", () => {
  const aus = calcularLiquido({ sueldoBase: 900_000, diasLaborales: 30, diasAusente: 3 }, P);
  assert.equal(aus.haberes.sueldoBase, 810_000);
  const he = calcularLiquido({ sueldoBase: 1_000_000, horasExtra: 10 }, { ...P, jornadaSemanal: 42 });
  const valorHora = Math.round(((1_000_000 * 12) / (52 * 42)) * 1.5);
  assert.equal(he.haberes.horasExtra, valorHora * 10);
});

test("Entradas raras: negativos, texto y vacíos se toman como cero", () => {
  const r = calcularLiquido({ sueldoBase: "abc", bonos: -5, horasExtra: null, diasAusente: 99 }, P);
  assert.equal(r.liquido, 0);
  assert.equal(calcularLiquido(undefined, P).liquido, 0);
});

test("Desde el líquido: encuentra el sueldo base mínimo que llega a ese líquido", () => {
  const entrada = { afp: "habitat", salud: "fonasa", contrato: "indefinido", gratificacion: true, colacion: 40_000 };
  for (const objetivo of [600_000, 1_000_000, 2_500_000, 6_000_000]) {
    const d = calcularDesdeLiquido(objetivo, entrada, P);
    assert.equal(d.ok, true);
    assert.ok(d.resultado.liquido >= objetivo, "llega al líquido pedido");
    const uno = calcularLiquido({ ...entrada, sueldoBase: d.sueldoBase - 1 }, P);
    assert.ok(uno.liquido < objetivo, "con un peso menos de sueldo base ya no llega");
  }
});

test("Desde el líquido: rechaza valores inválidos y los inalcanzables", () => {
  assert.deepEqual(calcularDesdeLiquido(0, {}, P), { ok: false, error: "liquido_invalido" });
  assert.deepEqual(calcularDesdeLiquido("x", {}, P), { ok: false, error: "liquido_invalido" });
  assert.deepEqual(calcularDesdeLiquido(10_000_000_000, {}, P), { ok: false, error: "fuera_de_rango" });
  const solo = calcularDesdeLiquido(80_000, { colacion: 100_000 }, P);
  assert.equal(solo.sueldoBase, 0, "si los no imponibles ya bastan, el sueldo base es 0");
});

test("Semana corrida: comisión ÷ días hábiles (redondeado) × días festivos y domingos", async () => {
  const { calcularSemanaCorrida } = await import("../src/calculadora-sueldo.js");
  assert.deepEqual(calcularSemanaCorrida({ comision: 1_000_000, diasHabiles: 26, diasInhabiles: 4 }), { porDia: 38_462, semanaCorrida: 153_848 });
  assert.deepEqual(calcularSemanaCorrida({ comision: 900_000, diasHabiles: 25, diasInhabiles: 5 }), { porDia: 36_000, semanaCorrida: 180_000 });
  assert.deepEqual(calcularSemanaCorrida({ comision: 500_000, diasHabiles: 0, diasInhabiles: 4 }), { porDia: 0, semanaCorrida: 0 }, "sin días hábiles no se divide");
  assert.deepEqual(calcularSemanaCorrida({ comision: "x", diasHabiles: -3, diasInhabiles: null }), { porDia: 0, semanaCorrida: 0 });
  const conSemana = calcularLiquido({ sueldoBase: 600_000, semanaCorrida: 153_848 }, P);
  assert.equal(conSemana.imponible, 753_848, "la semana corrida es parte de la renta imponible");
});
