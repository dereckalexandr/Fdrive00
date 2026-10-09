import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePatente, isPatenteValida, splitModeloVersion, calcularFiltros, buildChileautosUrl,
  parseAvisosPegados, esPrecioSimbolico, estimarCompra, DESCUENTO_COMPRA, INCREMENTO_PUBLICACION, N_PRIMEROS,
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
  assert.ok(buildChileautosUrl({ marca: "Toyota", modelo: "Land Cruiser Prado", anio: 2020, km: 50000, excepciones: ["Land Cruiser"] }).includes("Modelo.Land%20Cruiser."));
  assert.ok(buildChileautosUrl({ marca: "Toyota", modelo: "Land Cruiser Prado", anio: 2020, km: 50000 }).includes("Modelo.Land."), "sin excepción: solo la primera palabra");
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

test("estimarCompra: promedio de los 5 primeros; publicación = promedio + 500.000; compra = promedio − 2 millones", () => {
  const r = estimarCompra([av("a", 8000000), av("b", 9000000), av("c", 10000000), av("d", 11000000), av("e", 12000000), av("f", 13000000), av("g", 14000000)], F);
  assert.equal(r.ok, true);
  assert.equal(r.primeros.length, 5);
  assert.equal(r.promedioPrimeros, 10000000);                       // (8+9+10+11+12)/5; el 6.º y el 7.º no entran
  assert.equal(r.publicacion, 10000000 + INCREMENTO_PUBLICACION);   // 10.500.000
  assert.equal(r.publicacion, 10500000);
  assert.equal(r.compra, 10000000 - DESCUENTO_COMPRA);              // 8.000.000
});

test("las constantes del módulo: 5 avisos, +$500.000 de publicación, −$2.000.000 de compra", () => {
  assert.equal(N_PRIMEROS, 5);
  assert.equal(INCREMENTO_PUBLICACION, 500000);
  assert.equal(DESCUENTO_COMPRA, 2000000);
});

test("el precio de publicación ya no depende del resto de la página, solo de los 5 primeros", () => {
  const baratos = [8000000, 8200000, 8400000, 8600000, 8800000];
  const a = estimarCompra([...baratos, 9000000, 9500000].map((p, i) => av("a" + i, p)), F);
  const b = estimarCompra([...baratos, 30000000, 40000000].map((p, i) => av("b" + i, p)), F);
  assert.equal(a.publicacion, b.publicacion);
});

test("estimarCompra ordena de menor a mayor aunque lleguen desordenados", () => {
  const r = estimarCompra([av("a", 12000000), av("b", 8000000), av("c", 11000000), av("d", 9000000), av("e", 10000000), av("f", 13000000)], F);
  assert.deepEqual(r.primeros.map((p) => p.precio), [8000000, 9000000, 10000000, 11000000, 12000000]);
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
  assert.equal(r.promedioPrimeros, Math.round((8200000 + 8500000 + 8800000 + 8850000 + 9200000) / 5));
  assert.equal(r.compra, r.promedioPrimeros - DESCUENTO_COMPRA);
  assert.equal(r.publicacion, r.promedioPrimeros + INCREMENTO_PUBLICACION);
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

/* ---------- margen bruto ---------- */
import { MARGENES_BRUTOS, MARGEN_BRUTO_DEFECTO } from "../src/compra-calc.js";

test("la lista de margen bruto tiene exactamente las 12 opciones pedidas", () => {
  assert.deepEqual(MARGENES_BRUTOS, [1500000, 2000000, 2500000, 3000000, 3500000, 4000000, 5000000, 6000000, 7000000, 8000000, 9000000, 10000000]);
});

test("el margen bruto por defecto es $2.000.000 y está en la lista", () => {
  assert.equal(MARGEN_BRUTO_DEFECTO, 2000000);
  assert.ok(MARGENES_BRUTOS.includes(MARGEN_BRUTO_DEFECTO));
});

const CINCO = [av("a", 8000000), av("b", 9000000), av("c", 10000000), av("d", 11000000), av("e", 12000000)];

test("el precio de compra es el precio promedio menos el margen bruto elegido", () => {
  for (const m of MARGENES_BRUTOS) {
    const r = estimarCompra(CINCO, F, { margenBruto: m });
    assert.equal(r.promedioPrimeros, 10000000);
    assert.equal(r.compra, 10000000 - m, `margen ${m}`);
    assert.equal(r.margenBruto, m);
  }
});

test("el margen bruto no cambia el precio promedio ni el de publicación", () => {
  const a = estimarCompra(CINCO, F, { margenBruto: 1500000 });
  const b = estimarCompra(CINCO, F, { margenBruto: 10000000 });
  assert.equal(a.promedioPrimeros, b.promedioPrimeros);
  assert.equal(a.publicacion, b.publicacion);
});

test("sin elegir margen se usa el valor por defecto", () => {
  assert.equal(estimarCompra(CINCO, F).compra, 10000000 - MARGEN_BRUTO_DEFECTO);
  assert.equal(estimarCompra(CINCO, F, { margenBruto: "" }).compra, 10000000 - MARGEN_BRUTO_DEFECTO);
});

test("si el margen supera al precio promedio, la compra queda en $0 y se avisa", () => {
  const baratos = [av("a", 3000000), av("b", 3100000), av("c", 3200000), av("d", 3300000), av("e", 3400000)];
  const r = estimarCompra(baratos, F, { margenBruto: 10000000 });
  assert.equal(r.compra, 0);
  assert.ok(r.advertencias.some((w) => /margen bruto/.test(w)));
});

/* ---------- el modelo que se envía a Chileautos ---------- */
import { modeloParaChileautos, EXCEPCIONES_MODELO } from "../src/compra-calc.js";

test("modeloParaChileautos usa solo la primera palabra (lo anterior al primer espacio)", () => {
  assert.equal(modeloParaChileautos("Yaris 1.5 GLI MT"), "Yaris");
  assert.equal(modeloParaChileautos("YARIS SPORT 1.5"), "YARIS");
  assert.equal(modeloParaChileautos("Accent RB 1.4"), "Accent");
  assert.equal(modeloParaChileautos("Rio 1,4 EX"), "Rio");
  assert.equal(modeloParaChileautos("  Yaris   Sport  "), "Yaris");
});

test("modeloParaChileautos deja igual los modelos de una sola palabra, aunque tengan guion o números", () => {
  for (const m of ["Yaris", "CX-5", "208", "2008", "T-Cross", "X-Trail", "NP300", "Corolla"]) {
    assert.equal(modeloParaChileautos(m), m);
  }
  assert.equal(modeloParaChileautos(""), "");
  assert.equal(modeloParaChileautos(null), "");
});

test("EXCEPCIONES: los modelos de varias palabras de la lista se buscan completos", () => {
  const ex = ["Land Cruiser", "Corolla Cross", "Santa Fe", "Mazda 3"];
  assert.equal(modeloParaChileautos("Land Cruiser Prado 4.0", ex), "Land Cruiser");
  assert.equal(modeloParaChileautos("COROLLA CROSS 2.0 XEI", ex), "COROLLA CROSS");
  assert.equal(modeloParaChileautos("Mazda 3 2.0 R", ex), "Mazda 3");
  assert.equal(modeloParaChileautos("Santa Fé GLS", ex), "Santa Fé"); // sin distinguir tildes
  // lo que no está en la lista sigue usando solo la primera palabra
  assert.equal(modeloParaChileautos("Corolla 1.8 XLI", ex), "Corolla");
  assert.equal(modeloParaChileautos("Yaris Sport", ex), "Yaris");
  // la excepción debe coincidir desde el comienzo y palabra por palabra
  assert.equal(modeloParaChileautos("Cruiser Land", ex), "Cruiser");
  assert.equal(modeloParaChileautos("Land", ex), "Land");
});

test("EXCEPCIONES: gana la más larga si hay varias que coinciden", () => {
  assert.equal(modeloParaChileautos("Land Cruiser Prado 4.0", ["Land Cruiser", "Land Cruiser Prado"]), "Land Cruiser Prado");
});

test("EXCEPCIONES: la lista que usa la app hoy está vacía (se completa con las del administrador)", () => {
  assert.deepEqual(EXCEPCIONES_MODELO, []);
});

test("la dirección de búsqueda usa la primera palabra del modelo y nunca lleva puntos del motor (rompen la sintaxis de Chileautos)", () => {
  const esperado = buildChileautosUrl({ marca: "Toyota", modelo: "Yaris", anio: 2020, km: 60000 });
  for (const m of ["Yaris 1.5", "Yaris 1.5 GLI", "YARIS 1.5 GLI MT", "Yaris 1,5", "Yaris Sport 1.5 GLI"]) {
    // Chileautos no distingue mayúsculas de minúsculas (comprobado en el sitio)
    assert.equal(buildChileautosUrl({ marca: "Toyota", modelo: m, anio: 2020, km: 60000 }).toLowerCase(), esperado.toLowerCase(), m);
  }
  const modeloEnUrl = decodeURIComponent(buildChileautosUrl({ marca: "Toyota", modelo: "Yaris Sport 1.5 GLI", anio: 2020, km: 60000 })).match(/Modelo\.([^)]*)\.\)/)[1];
  assert.equal(modeloEnUrl, "Yaris");
  assert.ok(!/\d\.\d/.test(modeloEnUrl));
});

test("con una excepción cargada, la dirección usa el modelo completo de la lista", () => {
  const url = buildChileautosUrl({ marca: "Toyota", modelo: "Corolla Cross 2.0 XEI", anio: 2022, km: 30000, excepciones: ["Corolla Cross"] });
  assert.ok(decodeURIComponent(url).includes("Modelo.Corolla Cross.)"));
  assert.ok(!decodeURIComponent(url).includes("2.0"));
});

test("si el modelo empieza con un motor ('1.5 GLI'), igual se obtiene una dirección (no queda vacío)", () => {
  assert.notEqual(buildChileautosUrl({ marca: "Toyota", modelo: "1.5 GLI", anio: 2020, km: 60000 }), null);
});
