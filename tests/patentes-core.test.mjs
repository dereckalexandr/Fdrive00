import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarPatente, patenteValida, marcaLegible, combustibleLegible, transmisionLegible, normalizarRespuestaBoostr, limiteDiario, limiteWeb } from "../supabase/functions/api/patentes-core.js";

test("Patente: se normaliza y se valida (formato actual y antiguo)", () => {
  assert.equal(normalizarPatente(" gp-dd.74 "), "GPDD74");
  assert.equal(normalizarPatente("GPDD74-8"), "GPDD74");
  for (const ok of ["GPDD74", "AB1234"]) assert.ok(patenteValida(ok), ok);
  for (const mal of ["", "GPD74", "GPDD7", "1234AB", "ABCDEF", "GPDD745"]) assert.ok(!patenteValida(mal), mal);
});

test("Marca: nombre legible y siglas en mayúscula", () => {
  assert.equal(marcaLegible("SUBARU"), "Subaru");
  assert.equal(marcaLegible("BMW"), "BMW");
  assert.equal(marcaLegible("MERCEDES BENZ"), "Mercedes Benz");
  assert.equal(marcaLegible("  kia  "), "Kia");
});

test("Combustible y transmisión: se llevan a las opciones del CRM", () => {
  assert.equal(combustibleLegible("GASOLINA"), "Bencina");
  assert.equal(combustibleLegible("DIESEL"), "Diesel");
  assert.equal(combustibleLegible("PETRÓLEO"), "Diesel");
  assert.equal(combustibleLegible("HIBRIDO"), "Híbrido");
  assert.equal(combustibleLegible("ELÉCTRICO"), "Eléctrico");
  assert.equal(combustibleLegible("GNC"), "");
  assert.equal(transmisionLegible("MANUAL"), "Mecánica");
  assert.equal(transmisionLegible("MECANICA"), "Mecánica");
  assert.equal(transmisionLegible("AUTOMATICA"), "Automática");
  assert.equal(transmisionLegible("CVT"), "Automática");
  assert.equal(transmisionLegible(""), "");
});

test("Respuesta de Boostr (plan gratuito): marca, modelo, año y tipo", () => {
  const r = normalizarRespuestaBoostr({ status: "success", data: { plate: "GPDD74", dv: "8", make: "SUBARU", model: "NEW WRX S AWD CVT 2.0T", year: 2014, type: "AUTOMOVIL", engine: "H983322" } }, "GPDD74");
  assert.equal(r.ok, true);
  assert.deepEqual(r.vehiculo, { patente: "GPDD74", marca: "Subaru", modeloCompleto: "NEW WRX S AWD CVT 2.0T", anio: 2014, tipo: "AUTOMOVIL" });
});

test("Respuesta de Boostr: nunca pasan los datos del dueño ni el chasis", () => {
  const r = normalizarRespuestaBoostr({
    status: "success",
    data: { plate: "EL2801", make: "FORD", model: "GALAXIE", year: 1966, type: "AUTOMOVIL", chassis: "9C170406", engine: "170406", owner: { fullname: "JUAN PEREZ", documentNumber: "12.345.678-5" }, color: "NEGRO", gas_type: "GASOLINA", kilometers: 76944 },
  }, "EL2801");
  const t = JSON.stringify(r);
  for (const prohibido of ["JUAN", "PEREZ", "12.345.678-5", "9C170406", "owner", "chassis"]) assert.ok(!t.includes(prohibido), prohibido);
  assert.equal(r.vehiculo.color, "NEGRO");
  assert.equal(r.vehiculo.combustible, "Bencina");
  assert.equal(r.vehiculo.kmRevisionTecnica, 76944);
});

test("Respuesta de Boostr: no encontrada, inválida o con datos incompletos", () => {
  assert.deepEqual(normalizarRespuestaBoostr({ status: "error", data: "", code: "V-02", message: "No encontramos datos asociados a la patente ingresada" }), { ok: false, error: "no_encontrada" });
  assert.deepEqual(normalizarRespuestaBoostr({ status: "error", message: "Algo raro" }), { ok: false, error: "respuesta_invalida" });
  assert.deepEqual(normalizarRespuestaBoostr(null), { ok: false, error: "respuesta_invalida" });
  assert.deepEqual(normalizarRespuestaBoostr("hola"), { ok: false, error: "respuesta_invalida" });
  assert.deepEqual(normalizarRespuestaBoostr({ status: "success", data: { plate: "GPDD74" } }), { ok: false, error: "no_encontrada" });
  const sinAnio = normalizarRespuestaBoostr({ status: "success", data: { make: "KIA", model: "RIO", year: "abc" } }, "GPDD74");
  assert.equal(sinAnio.vehiculo.anio, null);
  assert.equal(normalizarRespuestaBoostr({ status: "success", data: { make: "KIA", model: "RIO", year: 3000 } }, "GPDD74").vehiculo.anio, null, "un año imposible no se acepta");
});

test("Cupo diario: el configurado si es válido; si no, el del plan gratuito", () => {
  assert.equal(limiteDiario("50"), 50);
  assert.equal(limiteDiario(undefined), 5);
  assert.equal(limiteDiario("abc"), 5);
  assert.equal(limiteDiario("0"), 5);
  assert.equal(limiteDiario("-3"), 5);
  assert.equal(limiteDiario("999999"), 5);
});

test("Sitio web: puede gastar la mitad del cupo diario (mínimo 1)", () => {
  assert.equal(limiteWeb(5), 2);
  assert.equal(limiteWeb(50), 25);
  assert.equal(limiteWeb(1), 1);
  assert.equal(limiteWeb(2), 1);
});
