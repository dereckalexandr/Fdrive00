import { test } from "node:test";
import assert from "node:assert/strict";
import { camposDesdePatente, aplicarCampos } from "../src/datos-patente.js";

test("Del modelo con versión pegada al modelo comercial y su versión", () => {
  const a = camposDesdePatente({ marca: "Subaru", modeloCompleto: "NEW WRX S AWD CVT 2.0T", anio: 2014 });
  assert.equal(a.marca, "Subaru");
  assert.equal(a.modelo, "Wrx", "se omite «New» y se queda el nombre del modelo");
  assert.equal(a.anio, "2014");
  assert.equal(a.version, "S AWD CVT 2.0T", "la versión queda tal como viene, sin el «New» del comienzo");

  const b = camposDesdePatente({ marca: "Toyota", modeloCompleto: "YARIS 1.5 GLI", anio: 2019 });
  assert.equal(b.modelo, "Yaris");
  assert.equal(b.version, "1.5 GLI");
  assert.equal(camposDesdePatente({ marca: "Toyota", modeloCompleto: "RAV4 2.5 LIMITED", anio: 2020 }).modelo, "RAV4", "un modelo con números queda en mayúsculas");

  const c = camposDesdePatente({ marca: "Kia", modeloCompleto: "RIO", anio: 2020 });
  assert.equal(c.modelo, "Rio");
  assert.equal(c.version, "");
});

test("Solo se entregan los datos extra que el proveedor sabe (color, transmisión, combustible)", () => {
  const plano = camposDesdePatente({ marca: "Kia", modeloCompleto: "RIO", anio: 2020 });
  assert.deepEqual(Object.keys(plano).sort(), ["anio", "marca", "modelo", "version"]);
  const pago = camposDesdePatente({ marca: "Kia", modeloCompleto: "RIO 5", anio: 2020, color: "BLANCO", transmision: "Mecánica", combustible: "Bencina", version: "EX 1.4" });
  assert.equal(pago.color, "Blanco");
  assert.equal(pago.transmision, "Mecánica");
  assert.equal(pago.combustible, "Bencina");
  assert.equal(pago.version, "EX 1.4", "si el proveedor trae versión, esa manda");
});

test("Un año desconocido no pisa el que ya estaba", () => {
  const c = camposDesdePatente({ marca: "Kia", modeloCompleto: "RIO", anio: null });
  assert.equal(c.anio, "");
  const r = aplicarCampos({ marca: "Kia", modelo: "Rio", anio: "2020", km: "5" }, c, { pisar: true });
  assert.equal(r.valores.anio, "2020");
  assert.equal(r.valores.km, "5", "lo que el proveedor no sabe (kilometraje) no se toca");
});

test("Aplicar datos: informa qué campos cambiaron; sin «pisar» respeta lo ya escrito", () => {
  const campos = { marca: "Subaru", modelo: "Wrx", version: "S AWD", anio: "2014" };
  const base = { patente: "GPDD74", marca: "", modelo: "Impreza", version: "", anio: "", km: "80000" };
  const a = aplicarCampos(base, campos);
  assert.deepEqual(a.valores, { patente: "GPDD74", marca: "Subaru", modelo: "Impreza", version: "S AWD", anio: "2014", km: "80000" });
  assert.deepEqual(a.llenados.sort(), ["anio", "marca", "version"]);
  const b = aplicarCampos(base, campos, { pisar: true });
  assert.equal(b.valores.modelo, "Wrx");
  assert.deepEqual(b.llenados.sort(), ["anio", "marca", "modelo", "version"]);
  const c = aplicarCampos(b.valores, campos, { pisar: true });
  assert.deepEqual(c.llenados, [], "si ya coincide, no se informa nada");
});
