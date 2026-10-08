import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePatente, isPatenteValida, splitModeloVersion, calcularFiltros, buildChileautosUrl,
  parseAvisosPegados, esPrecioSimbolico, estimarCompra, DESCUENTO_COMPRA,
} from "../src/compra-calc.js";

/* ---------- patente y datos del CAV ---------- */
test("normalizePatente: quita puntos/guiones, pasa a mayúsculas y descarta el dígito verificador del CAV", () => {
  assert.equal(normalizePatente("TTHY.51-1"), "TTHY51");
  assert.equal(normalizePatente(" bcdf12 "), "BCDF12");
  assert.equal(normalizePatente(""), "");
  assert.equal(normalizePatente(null), "");
});

test("isPatenteValida: formato actual (4 letras + 2 dígitos) y antiguo (2 letras + 4 dígitos)", () => {
  assert.ok(isPatenteValida("TTHY51"));
  assert.ok(isPatenteValida("AB1234"));
  assert.ok(!isPatenteValida("TTHY5"));
  assert.ok(!isPatenteValida("12ABCD"));
  assert.ok(!isPatenteValida(""));
});

test("splitModeloVersion separa la primera palabra (modelo) del resto (versión)", () => {
  assert.deepEqual(splitModeloVersion("FORTUNER OTTO 2.7 AUT"), { modelo: "FORTUNER", version: "OTTO 2.7 AUT" });
  assert.deepEqual(splitModeloVersion("YARIS"), { modelo: "YARIS", version: "" });
  assert.deepEqual(splitModeloVersion(""), { modelo: "", version: "" });
});

/* ---------- dirección de búsqueda ---------- */
test("calcularFiltros: año ±1 y kilometraje ±20 % redondeado a miles", () => {
  assert.deepEqual(calcularFiltros({ anio: 2020, km: 60000 }), { anioMin: 2019, anioMax: 2021, kmMin: 48000, kmMax: 72000 });
  assert.deepEqual(calcularFiltros({ anio: 2020, km: 60000, margenAnio: 0 }), { anioMin: 2020, anioMax: 2020, kmMin: 48000, kmMax: 72000 });
  assert.equal(calcularFiltros({ anio: 2020, km: 12345 }).kmMin, 9000);
  assert.equal(calcularFiltros({ anio: 2020, km: 12345 }).kmMax, 15000);
});

test("buildChileautosUrl usa la sintaxis comprobada en el sitio", () => {
  const url = buildChileautosUrl({ marca: "Toyota", modelo: "Yaris", anio: 2020, km: 60000 });
  assert.equal(
    url,
    "https://www.chileautos.cl/vehiculos/?q=(And.(C.Marca.Toyota._.Modelo.Yaris.)_.Ano.range(2019..2021)._.Kilometraje.range(48000..72000).)&sort=~Price"
  );
});

test("buildChileautosUrl codifica espacios y devuelve null si falta un dato obligatorio", () => {
  assert.ok(buildChileautosUrl({ marca: "Toyota", modelo: "Land Cruiser Prado", anio: 2020, km: 50000 }).includes("Modelo.Land%20Cruiser%20Prado."));
  assert.equal(buildChileautosUrl({ marca: "", modelo: "Yaris", anio: 2020, km: 50000 }), null);
  assert.equal(buildChileautosUrl({ marca: "Toyota", modelo: "Yaris", anio: 2020, km: 0 }), null);
  assert.equal(buildChileautosUrl({ marca: "Toyota", modelo: "Yaris", anio: "", km: 50000 }), null);
});

test("buildChileautosUrl: km con puntos ('60.000') se interpreta bien", () => {
  const url = buildChileautosUrl({ marca: "Kia", modelo: "Rio", anio: 2019, km: "60.000" });
  assert.ok(url.includes("Kilometraje.range(48000..72000)"));
});

/* ---------- texto pegado ---------- */
test("parseAvisosPegados valida el texto que copia el marcador", () => {
  assert.equal(parseAvisosPegados("").ok, false);
  assert.equal(parseAvisosPegados("hola").ok, false);
  assert.equal(parseAvisosPegados('{"fuente":"otra","listings":[]}').ok, false);
  const ok = parseAvisosPegados('{"fuente":"chileautos","listings":[],"sinResultados":false}');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data.listings, []);
});

/* ---------- precios simbólicos ---------- */
test("esPrecioSimbolico detecta los precios de relleno vistos en Chileautos", () => {
  for (const p of [100001, 111111, 123456, 100010, 1000001, 5555555]) assert.ok(esPrecioSimbolico(p), String(p));
  for (const p of [8200000, 9390000, 12990000, 100000, 1000000, 15990000]) assert.ok(!esPrecioSimbolico(p), String(p));
});

/* ---------- estimación ---------- */
const av = (id, precio, extra = {}) => ({ id, precio, anio: 2020, km: 60000, destacado: false, ...extra });
const F = { anioMin: 2019, anioMax: 2021, kmMin: 48000, kmMax: 72000 };

test("estimarCompra: promedio de los 4 primeros, publicación = promedio de todos, compra = promedio4 − 2 millones", () => {
  const r = estimarCompra([av("a", 8000000), av("b", 9000000), av("c", 10000000), av("d", 11000000), av("e", 12000000), av("f", 13000000)], F);
  assert.equal(r.ok, true);
  assert.equal(r.promedioPrimeros, 9500000);          // (8+9+10+11)/4
  assert.equal(r.publicacion, 10500000);              // (8+9+10+11+12+13)/6
  assert.equal(r.compra, 9500000 - DESCUENTO_COMPRA); // 7.500.000
  assert.equal(r.primeros.length, 4);
});

test("estimarCompra ordena de menor a mayor aunque lleguen desordenados", () => {
  const r = estimarCompra([av("a", 12000000), av("b", 8000000), av("c", 11000000), av("d", 9000000), av("e", 10000000)], F);
  assert.deepEqual(r.primeros.map((p) => p.precio), [8000000, 9000000, 10000000, 11000000]);
});

test("estimarCompra descarta destacados, sin precio, repetidos y fuera de filtro", () => {
  const r = estimarCompra([
    av("a", 8000000), av("b", 9000000), av("c", 10000000), av("d", 11000000),
    av("p", 1500000, { destacado: true }),
    av("s", 0),
    av("a", 8000000),                    // repetido
    av("y", 9000000, { anio: 2015 }),    // año fuera
    av("k", 9000000, { km: 150000 }),    // km fuera
  ], F);
  const motivos = Object.fromEntries(r.descartados.map((d) => [d.id + (d.motivo === "Aviso repetido" ? "!" : ""), d.motivo]));
  assert.equal(motivos.p, "Aviso destacado (patrocinado)");
  assert.equal(motivos.s, "Sin precio");
  assert.equal(motivos["a!"], "Aviso repetido");
  assert.equal(motivos.y, "Año fuera del filtro");
  assert.equal(motivos.k, "Kilometraje fuera del filtro");
  assert.equal(r.validos.length, 4);
});

test("estimarCompra descarta precios simbólicos y muy bajos, como en la lista real de Chileautos", () => {
  const r = estimarCompra([
    av("x1", 100000), av("x2", 100001), av("x3", 111111), av("x4", 123456),   // relleno
    av("m", 3000000),                                                          // muy bajo respecto al resto
    av("a", 8200000), av("b", 8500000), av("c", 8800000), av("d", 8850000), av("e", 9200000),
  ], F);
  assert.equal(r.ok, true);
  const bajos = r.descartados.filter((d) => /simbólico|muy bajo/i.test(d.motivo)).map((d) => d.id).sort();
  assert.deepEqual(bajos, ["m", "x1", "x2", "x3", "x4"]);
  assert.equal(r.promedioPrimeros, Math.round((8200000 + 8500000 + 8800000 + 8850000) / 4));
  assert.equal(r.compra, r.promedioPrimeros - DESCUENTO_COMPRA);
});

test("estimarCompra con menos de 4 avisos válidos avisa y usa los que hay", () => {
  const r = estimarCompra([av("a", 9000000), av("b", 10000000)], F);
  assert.equal(r.ok, true);
  assert.equal(r.primeros.length, 2);
  assert.equal(r.promedioPrimeros, 9500000);
  assert.ok(r.advertencias.some((w) => /Solo hay 2 avisos/.test(w)));
});

test("estimarCompra sin avisos válidos devuelve error", () => {
  assert.equal(estimarCompra([], F).ok, false);
  assert.equal(estimarCompra([av("a", 0), av("b", 5000000, { destacado: true })], F).ok, false);
  assert.equal(estimarCompra(null, F).ok, false);
});

test("estimarCompra: el precio de compra nunca es negativo", () => {
  const r = estimarCompra([av("a", 1500000), av("b", 1600000), av("c", 1700000), av("d", 1800000)], F);
  assert.equal(r.compra, 0);
  assert.ok(r.advertencias.some((w) => /\$0/.test(w)));
});

/* ---------- transmisión y combustible ---------- */
import { TRANSMISIONES, COMBUSTIBLES } from "../src/compra-calc.js";

const BASE = { marca: "Toyota", modelo: "Yaris", anio: 2020, km: 60000 };
const G = "(C.Marca.Toyota._.Modelo.Yaris.)";
const R = "Ano.range(2019..2021)._.Kilometraje.range(48000..72000)";
const url = (extra) => buildChileautosUrl({ ...BASE, ...extra });
const q = (cuerpo) => `https://www.chileautos.cl/vehiculos/?q=${cuerpo}&sort=~Price`;

test("las listas del módulo: Mecánica/Automática y Bencina/Diesel/Híbrido/Eléctrico", () => {
  assert.deepEqual(TRANSMISIONES.map((t) => t.label), ["Mecánica", "Automática"]);
  assert.deepEqual(COMBUSTIBLES.map((c) => c.label), ["Bencina", "Diesel", "Híbrido", "Eléctrico"]);
});

test("sin transmisión ni combustible la dirección no cambia", () => {
  assert.equal(url({}), q(`(And.${G}_.${R}.)`));
  assert.equal(url({ transmision: "", combustible: "" }), q(`(And.${G}_.${R}.)`));
});

test("Mecánica se pide a Chileautos como 'Manual' (con tilde en el nombre del filtro)", () => {
  assert.equal(url({ transmision: "manual" }), q(`(And.${G}_.${R}._.Transmisi%C3%B3n.Manual.)`));
});

test("Automática pide 'Automática' y también 'Automático'", () => {
  assert.equal(
    url({ transmision: "automatica" }),
    q(`(And.${G}_.(Or.Transmisi%C3%B3n.Autom%C3%A1tica._.Transmisi%C3%B3n.Autom%C3%A1tico.)_.${R}.)`)
  );
});

test("combustible: los acentos de Híbrido y Eléctrico se conservan (sin tilde Chileautos devuelve 0)", () => {
  assert.ok(url({ combustible: "bencina" }).includes("._.Combustible.Bencina.)"));
  assert.ok(url({ combustible: "diesel" }).includes("._.Combustible.Diesel.)"));
  assert.ok(url({ combustible: "hibrido" }).includes("Combustible.H%C3%ADbrido.)"));
  assert.ok(url({ combustible: "electrico" }).includes("Combustible.El%C3%A9ctrico.)"));
});

test("transmisión y combustible juntos", () => {
  assert.equal(url({ transmision: "manual", combustible: "bencina" }), q(`(And.${G}_.${R}._.Transmisi%C3%B3n.Manual._.Combustible.Bencina.)`));
  assert.equal(
    url({ transmision: "automatica", combustible: "hibrido" }),
    q(`(And.${G}_.(Or.Transmisi%C3%B3n.Autom%C3%A1tica._.Transmisi%C3%B3n.Autom%C3%A1tico.)_.${R}._.Combustible.H%C3%ADbrido.)`)
  );
});

test("un valor desconocido de transmisión o combustible se ignora (no rompe la dirección)", () => {
  assert.equal(url({ transmision: "cvt", combustible: "gas" }), q(`(And.${G}_.${R}.)`));
});

test("estimarCompra descarta avisos de otra transmisión o combustible (red de seguridad)", () => {
  const F2 = { ...F, transmision: "manual", combustible: "bencina" };
  const r = estimarCompra([
    av("a", 8000000, { transmision: "Manual", combustible: "Bencina" }),
    av("b", 8200000, { transmision: "Automática", combustible: "Bencina" }),
    av("c", 8400000, { transmision: "Manual", combustible: "Diesel" }),
    av("d", 8600000, { transmision: "Manual", combustible: "Bencina" }),
    av("e", 8800000),                                              // sin datos: no se descarta
  ], F2);
  const m = Object.fromEntries(r.descartados.map((d) => [d.id, d.motivo]));
  assert.equal(m.b, "Transmisión fuera del filtro");
  assert.equal(m.c, "Combustible fuera del filtro");
  assert.deepEqual(r.validos.map((v) => v.id), ["a", "d", "e"]);
});

test("estimarCompra: 'Automático' y 'Automática' cuentan como automática; las tildes no importan", () => {
  const F2 = { ...F, transmision: "automatica", combustible: "hibrido" };
  const r = estimarCompra([
    av("a", 9000000, { transmision: "Automático", combustible: "Híbrido" }),
    av("b", 9100000, { transmision: "Automática", combustible: "Hibrido enchufable" }),
    av("c", 9200000, { transmision: "Manual", combustible: "Híbrido" }),
  ], F2);
  assert.deepEqual(r.validos.map((v) => v.id), ["a", "b"]);
});
