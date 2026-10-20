import { test } from "node:test";
import assert from "node:assert/strict";
import { soloDigitos, aDigitos, conMiles } from "../src/dinero.js";

test("Montos: puntos de miles al escribir", () => {
  assert.equal(conMiles("1250000"), "1.250.000");
  assert.equal(conMiles("999"), "999");
  assert.equal(conMiles("1000"), "1.000");
  assert.equal(conMiles(""), "");
  assert.equal(conMiles(null), "");
  assert.equal(conMiles("007"), "7");
  assert.equal(conMiles("0"), "0");
});

test("Montos: lo que escribe la persona vuelve a dígitos limpios", () => {
  assert.equal(soloDigitos("1.250.000"), "1250000");
  assert.equal(soloDigitos("$ 1.250.000 pesos"), "1250000");
  assert.equal(soloDigitos("-5"), "5");
});

test("Montos: lo que viene de la base de datos (números o texto con decimales) no se corrompe", () => {
  assert.equal(aDigitos(9890000), "9890000");
  assert.equal(aDigitos("9890000"), "9890000");
  assert.equal(aDigitos("9890000.00"), "9890000", "no debe convertirse en 989000000");
  assert.equal(aDigitos("9890000.60"), "9890001");
  assert.equal(conMiles("9890000.00"), "9.890.000");
  assert.equal(conMiles(12480000), "12.480.000");
  assert.equal(aDigitos(NaN), "");
  assert.equal(aDigitos(-3), "0");
});
