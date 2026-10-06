import test from "node:test";
import assert from "node:assert/strict";
import { computeTasacionTotals } from "../src/tasacion-totals.js";

const SECTIONS = [
  { id: "carr", type: "fixed", items: [{ id: "capot" }, { id: "puerta" }] },
  { id: "motor", type: "dynamic", slots: 3 },
  { id: "vacia", type: "fixed", items: [{ id: "aceite" }] },
];
const getItems = (s) => (s.type === "dynamic" ? Array.from({ length: s.slots }, (_, i) => ({ id: `${s.id}_${i + 1}` })) : s.items);

test("suma por módulo y total general", () => {
  const t = computeTasacionTotals({
    capot: { valor: 150000 }, puerta: { valor: 50000 },
    motor_1: { valor: 80000 }, motor_3: { valor: 20000 },
  }, SECTIONS, getItems);
  assert.deepEqual(t.bySection, { carr: 200000, motor: 100000, vacia: 0 });
  assert.equal(t.total, 300000);
});

test("el total es exactamente la suma de los subtotales", () => {
  const t = computeTasacionTotals({ capot: { valor: 1 }, motor_2: { valor: 2 }, aceite: { valor: 3 } }, SECTIONS, getItems);
  assert.equal(t.total, Object.values(t.bySection).reduce((a, b) => a + b, 0));
});

test("valores vacíos o de texto no rompen la suma", () => {
  const t = computeTasacionTotals({ capot: { valor: "" }, puerta: { valor: "abc" }, motor_1: { valor: "25000" }, aceite: {} }, SECTIONS, getItems);
  assert.equal(t.bySection.carr, 0);
  assert.equal(t.bySection.motor, 25000); // un número guardado como texto cuenta
  assert.equal(t.total, 25000);
});

test("ítems que ya no existen en el checklist no suman", () => {
  const t = computeTasacionTotals({ capot: { valor: 100 }, item_eliminado: { valor: 999999 } }, SECTIONS, getItems);
  assert.equal(t.total, 100);
});

test("sin checklist devuelve ceros", () => {
  assert.deepEqual(computeTasacionTotals(undefined, SECTIONS, getItems), { bySection: { carr: 0, motor: 0, vacia: 0 }, total: 0 });
});
