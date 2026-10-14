import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MODULOS_COMISION, TRAMOS_ESTANDAR, etiquetaTramo, getTramo, proximoTramo, validarTramos, validarComision,
  tramosDe, tramosEfectivos, modulosPersonalizados, calcularProduccion,
} from "../supabase/functions/api/comisiones-core.js";

/** Lee los tramos estándar directamente de src/App.jsx para comprobar que no se desfasen. */
function tramosDeApp(nombre) {
  const fuente = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const bloque = new RegExp(`const ${nombre} = \\[([\\s\\S]*?)\\];`).exec(fuente);
  assert.ok(bloque, `no se encontró ${nombre} en App.jsx`);
  return [...bloque[1].matchAll(/min: (\d+), max: (Infinity|\d+), rate: ([\d.]+)/g)].map((m) => ({
    min: Number(m[1]), max: m[2] === "Infinity" ? null : Number(m[2]), rate: Number(m[3]),
  }));
}

test("Los tramos estándar coinciden con los del perfil de Ejecutivo actual (App.jsx)", () => {
  assert.deepEqual(TRAMOS_ESTANDAR.compras, tramosDeApp("TIERS_COMPRAS"));
  assert.deepEqual(TRAMOS_ESTANDAR.ventas, tramosDeApp("TIERS_VENTAS"));
  assert.deepEqual(TRAMOS_ESTANDAR.seguros, tramosDeApp("TIERS_SEGUROS"));
  assert.deepEqual(TRAMOS_ESTANDAR.creditos, tramosDeApp("TIERS_CREDITOS"));
  assert.deepEqual(TRAMOS_ESTANDAR.consignaciones, tramosDeApp("TIERS_CONSIGNACIONES"));
  // Inspecciones usa la misma tabla en todos los perfiles.
  assert.deepEqual(TRAMOS_ESTANDAR.inspecciones, tramosDeApp("TIERS_INSPECCIONES_DERECK"));
  assert.equal(MODULOS_COMISION.length, 6);
});

test("Tramo según la cantidad: el último rige para cantidades mayores", () => {
  const v = TRAMOS_ESTANDAR.ventas;
  assert.equal(getTramo(0, v), null);
  assert.equal(getTramo(-2, v), null);
  assert.equal(getTramo(1, v).rate, 75000);
  assert.equal(getTramo(3, v).rate, 75000);
  assert.equal(getTramo(4, v).rate, 90000);
  assert.equal(getTramo(10, v).rate, 90000);
  assert.equal(getTramo(11, v).rate, 110000);
  assert.equal(getTramo(500, v).rate, 110000);
  // Tope numérico: pasado el último tramo, rige el último (igual que el perfil actual).
  assert.equal(getTramo(99, TRAMOS_ESTANDAR.inspecciones).rate, 35000);
  assert.equal(etiquetaTramo({ min: 1, max: 3 }), "1 a 3");
  assert.equal(etiquetaTramo({ min: 11, max: null }), "11 o más");
});

test("Cuántas unidades faltan para el siguiente tramo", () => {
  const v = TRAMOS_ESTANDAR.ventas;
  assert.deepEqual(proximoTramo(0, v), { faltan: 1, tramo: v[0] });
  assert.equal(proximoTramo(2, v).faltan, 2);
  assert.equal(proximoTramo(2, v).tramo.rate, 90000);
  assert.equal(proximoTramo(10, v).faltan, 1);
  assert.equal(proximoTramo(11, v), null, "ya está en el último tramo");
  assert.equal(proximoTramo(1, []), null);
});

test("Producción: cantidad × monto del tramo, aplicado a TODAS las unidades del mes", () => {
  const t = tramosEfectivos(null);
  const p3 = calcularProduccion({ ventasN: 3 }, t);
  const p4 = calcularProduccion({ ventasN: 4 }, t);
  assert.equal(p3.ventas.total, 3 * 75000);
  assert.equal(p4.ventas.total, 4 * 90000, "al pasar al tramo 4-10 las 4 ventas pagan 90.000, no solo la cuarta");
  assert.equal(p4.ventas.tramo, "4 a 10");
  assert.equal(calcularProduccion({ ventasN: 12 }, t).ventas.total, 12 * 110000);
  assert.equal(calcularProduccion({ ventasN: 0 }, t).ventas.total, 0);
  assert.equal(calcularProduccion({ segurosN: 5 }, t).seguros.total, 5 * 50000);
  assert.equal(calcularProduccion({ comprasN: 7 }, t).compras.total, 7 * 200000);
  assert.equal(calcularProduccion({ inspeccionesN: 4 }, t).inspecciones.total, 4 * 35000);
});

test("Producción de créditos: porcentaje del tramo sobre la suma de comisiones de las financieras", () => {
  const t = tramosEfectivos(null);
  assert.equal(calcularProduccion({ creditosN: 2, creditosComision: 1000000 }, t).creditos.total, 150000);
  assert.equal(calcularProduccion({ creditosN: 4, creditosComision: 1000000 }, t).creditos.total, 250000);
  assert.equal(calcularProduccion({ creditosN: 7, creditosComision: 1000000 }, t).creditos.total, 280000);
  assert.equal(calcularProduccion({ creditosN: 0, creditosComision: 500000 }, t).creditos.total, 0);
});

test("Producción de consignaciones: suma de márgenes netos (25 % del margen bruto), como en el perfil actual", () => {
  const t = tramosEfectivos(null);
  const p = calcularProduccion({ consigRows: [{ precioVenta: 10000000, precioPiso: 9000000, descuentos: 200000 }, { precioVenta: 5000000, precioPiso: 4500000, descuentos: 0 }] }, t);
  assert.equal(p.consignaciones.sumaMargenBruto, 800000 + 500000);
  assert.equal(p.consignaciones.total, Math.round(800000 * 0.25) + Math.round(500000 * 0.25));
});

test("Producción total: suma de todos los módulos", () => {
  const t = tramosEfectivos(null);
  const p = calcularProduccion({ ventasN: 5, segurosN: 2, creditosN: 4, creditosComision: 800000, comprasN: 1, inspeccionesN: 2 }, t);
  assert.equal(p.total, 5 * 90000 + 2 * 35000 + 800000 * 0.25 + 1 * 100000 + 2 * 35000);
});

test("Tramos propios de una persona reemplazan a los estándar, solo en ese módulo", () => {
  const comision = { tramos: { ventas: [{ min: 1, max: 10, rate: 100000 }, { min: 11, max: null, rate: 110000 }] } };
  const t = tramosEfectivos(comision);
  assert.equal(t.ventas.length, 2);
  assert.deepEqual(t.seguros, TRAMOS_ESTANDAR.seguros, "lo demás sigue siendo estándar");
  assert.equal(calcularProduccion({ ventasN: 4 }, t).ventas.total, 4 * 100000);
  assert.deepEqual(modulosPersonalizados(comision), ["ventas"]);
  assert.deepEqual(modulosPersonalizados(null), []);
  // Tramos guardados dañados se ignoran y rigen los estándar.
  assert.deepEqual(tramosDe({ tramos: { ventas: [{ min: 0, max: 3, rate: 1 }] } }, "ventas"), TRAMOS_ESTANDAR.ventas);
});

test("Validar tramos: orden, sin superposición, solo el último sin tope", () => {
  const ok = validarTramos([{ min: 11, max: "", rate: 110000 }, { min: 1, max: 10, rate: 100000 }], "monto");
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, [{ min: 1, max: 10, rate: 100000 }, { min: 11, max: null, rate: 110000 }]);

  const malos = [
    [], null, "x",
    [{ min: 0, max: 5, rate: 1000 }],
    [{ min: 1, max: 0, rate: 1000 }],
    [{ min: 1, max: 5, rate: -1 }],
    [{ min: 1, max: 5, rate: 1000.5 }],
    [{ min: 1, max: 5, rate: 1000 }, { min: 5, max: 9, rate: 2000 }],
    [{ min: 1, max: "", rate: 1000 }, { min: 5, max: 9, rate: 2000 }],
    [{ min: 1, max: 5, rate: "abc" }],
  ];
  for (const m of malos) assert.equal(validarTramos(m, "monto").ok, false, JSON.stringify(m));
  assert.equal(validarTramos(Array.from({ length: 13 }, (_, i) => ({ min: i + 1, max: i + 1, rate: 1 })), "monto").ok, false);
});

test("Validar tramos porcentuales: entre 0 y 1", () => {
  assert.ok(validarTramos([{ min: 1, max: "", rate: 0.25 }], "porcentaje").ok);
  assert.equal(validarTramos([{ min: 1, max: "", rate: 25 }], "porcentaje").ok, false, "25 no es una fracción: se espera 0,25");
  assert.equal(validarTramos([{ min: 1, max: "", rate: 0.123456 }], "porcentaje").value[0].rate, 0.1235);
});

test("Validar la comisión de una persona: ignora módulos vacíos o desconocidos y señala el que falla", () => {
  const ok = validarComision({ tramos: { ventas: [{ min: 1, max: "", rate: 90000 }], seguros: [], inventado: [{ min: 1, rate: 1 }] } });
  assert.ok(ok.ok);
  assert.deepEqual(Object.keys(ok.value.tramos), ["ventas"]);
  assert.deepEqual(validarComision(null).value, { tramos: {} });
  const mal = validarComision({ tramos: { creditos: [{ min: 1, max: "", rate: 28 }] } });
  assert.equal(mal.ok, false);
  assert.equal(mal.modulo, "creditos");
});

import { tramosAUi, uiAComision, errorDeTramos } from "../supabase/functions/api/comisiones-core.js";

test("Editor de tramos: ida y vuelta entre lo guardado y lo que se escribe en pantalla", () => {
  const guardado = { tramos: { ventas: [{ min: 1, max: 10, rate: 100000 }, { min: 11, max: null, rate: 110000 }], creditos: [{ min: 1, max: 3, rate: 0.2 }, { min: 4, max: null, rate: 0.285 }] } };
  const ui = tramosAUi(guardado);
  assert.deepEqual(ui.ventas, [{ min: 1, max: 10, rate: 100000 }, { min: 11, max: "", rate: 110000 }], "sin tope se muestra vacío");
  assert.deepEqual(ui.creditos.map((f) => f.rate), [20, 28.5], "los porcentajes se escriben como 20, no 0,2");
  assert.equal(ui.seguros, undefined, "lo no personalizado no aparece");
  // Lo que escribe la persona se convierte y se valida igual que en el servidor.
  const vuelta = validarComision(uiAComision(ui));
  assert.ok(vuelta.ok);
  assert.deepEqual(vuelta.value, guardado);
  assert.equal(errorDeTramos(ui), "");
  assert.deepEqual(tramosAUi(null), {});
  assert.deepEqual(uiAComision({}), { tramos: {} });
});

test("Editor de tramos: los errores nombran el módulo", () => {
  const ui = { creditos: [{ min: 1, max: 5, rate: 20 }, { min: 4, max: "", rate: 25 }] };
  assert.match(errorDeTramos(ui), /Créditos/);
  assert.match(errorDeTramos({ ventas: [{ min: "", max: "", rate: 1000 }] }), /Ventas/, "una fila sin 'desde' no es válida");
  assert.match(errorDeTramos({ ventas: [{ min: 1, max: "", rate: "abc" }] }), /Ventas/);
  assert.equal(errorDeTramos({ ventas: [{ min: 1, max: "", rate: 90000 }] }), "");
});
