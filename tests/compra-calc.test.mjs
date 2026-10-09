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
  assert.ok(buildChileautosUrl({ marca: "Toyota", modelo: "Land Cruiser Prado", anio: 2020, km: 50000 }).includes("Modelo.Land%20Cruiser."), "Land Cruiser está en la lista de excepciones");
  assert.ok(buildChileautosUrl({ marca: "Toyota", modelo: "Rav4 2.0", anio: 2020, km: 50000, excepciones: [] }).includes("Modelo.Rav4."), "sin excepciones: solo la primera palabra");
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
import { modeloParaChileautos, detalleModeloChileautos, EXCEPCIONES_MODELO } from "../src/compra-calc.js";

test("modeloParaChileautos usa solo la primera palabra (lo anterior al primer espacio)", () => {
  assert.equal(modeloParaChileautos("Yaris 1.5 GLI MT"), "Yaris");
  assert.equal(modeloParaChileautos("Accent RB 1.4"), "Accent");
  assert.equal(modeloParaChileautos("Rio 1,4 EX"), "Rio");
  assert.equal(modeloParaChileautos("  Yaris   1.5  "), "Yaris");
  assert.equal(modeloParaChileautos("Hilux 2.4 DX", []), "Hilux"); // sin ninguna excepción
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
  assert.equal(modeloParaChileautos("COROLLA CROSS 2.0 XEI", ex), "Corolla Cross"); // escritura de la lista
  assert.equal(modeloParaChileautos("Mazda 3 2.0 R", ex), "Mazda 3");
  assert.equal(modeloParaChileautos("Santa Fé GLS", ex), "Santa Fe"); // sin distinguir tildes; sale como en la lista
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

/* ---------- la lista de excepciones que entregó el administrador ---------- */
import { esModeloConocidoDeUnaPalabra } from "../src/compra-calc.js";

test("LISTA DEL ADMINISTRADOR: 'Corolla Cross' se busca completo y 'Corolla' solo", () => {
  assert.equal(modeloParaChileautos("COROLLA CROSS 2.0 XEI"), "Corolla Cross"); // sale con la escritura de la lista
  assert.equal(modeloParaChileautos("Corolla Cross"), "Corolla Cross");
  assert.equal(modeloParaChileautos("Corolla 1.8 XLI"), "Corolla");
});

test("LISTA DEL ADMINISTRADOR: Land Cruiser, Santa Fe, Grand Vitara, Yaris Sport y Yaris Cross se buscan completos", () => {
  const casos = [["LAND CRUISER PRADO 4.0", "Land Cruiser"], ["Land Cruiser", "Land Cruiser"], ["Santa Fe GLS 2.4", "Santa Fe"], ["GRAND VITARA 1.6 GLX", "Grand Vitara"],
    ["Yaris Sport 1.5", "Yaris Sport"], ["YARIS CROSS HYBRID", "Yaris Cross"], ["Yaris Cross", "Yaris Cross"]];
  for (const [entrada, esperado] of casos) assert.equal(modeloParaChileautos(entrada), esperado, entrada);
  // el modelo base sigue buscándose solo con su primera palabra
  assert.equal(modeloParaChileautos("Yaris 1.5 GLI"), "Yaris");
  assert.equal(modeloParaChileautos("Grand"), "Grand");
  assert.equal(modeloParaChileautos("Land"), "Land");
});

test("LISTA DEL ADMINISTRADOR: las tildes del texto pegado no cambian la búsqueda (Chileautos sí distingue tildes)", () => {
  assert.equal(modeloParaChileautos("Santa Fé GLS"), "Santa Fe");
  assert.equal(modeloParaChileautos("SANTA FE"), "Santa Fe");
});

test("CONVERSIÓN: 'CX5', 'CX 5' y 'CX-5' se buscan como 'CX-5'", () => {
  for (const e of ["CX5", "cx5", "CX 5", "cx 5", "CX-5", "CX5 2.0 R", "CX 5 2.0 R", "CX-5 2.0 R"]) assert.equal(modeloParaChileautos(e), "CX-5", e);
  assert.equal(modeloParaChileautos("CX 30 GT"), "CX-30");
  assert.equal(modeloParaChileautos("CX90"), "CX-90");
  assert.equal(modeloParaChileautos("CX-3"), "CX-3");
});

test("CONVERSIÓN: fuera del rango CX-3 a CX-90 no se convierte", () => {
  assert.equal(modeloParaChileautos("CX 91"), "CX");
  assert.equal(modeloParaChileautos("CX-100"), "CX-100");
  assert.equal(modeloParaChileautos("CX-2"), "CX-2");
});

test("CONVERSIÓN: las otras series también aceptan la forma separada o pegada (X1, A3, Q5, Tiggo 7)", () => {
  assert.equal(modeloParaChileautos("X 1 SDRIVE18I"), "X1");
  assert.equal(modeloParaChileautos("X7 XDRIVE40I"), "X7");
  assert.equal(modeloParaChileautos("A 3 SPORTBACK"), "A3");
  assert.equal(modeloParaChileautos("Q 5 TFSI"), "Q5");
  assert.equal(modeloParaChileautos("Tiggo7"), "Tiggo 7");
  assert.equal(modeloParaChileautos("TIGGO-7 PRO"), "Tiggo 7");
  assert.equal(modeloParaChileautos("Tiggo 8 Pro Max"), "Tiggo 8");
});

test("CONVERSIÓN: no toca modelos con guion que no son series (X-Trail, T-Cross) ni fuera de rango (X8, A8, Q9)", () => {
  for (const m of ["X-Trail", "T-Cross", "X8", "A8", "Q9"]) assert.equal(modeloParaChileautos(m), m, m);
});

test("LISTA DEL ADMINISTRADOR: 'Tiggo 2' a 'Tiggo 8' se buscan con su número; fuera de rango queda 'Tiggo'", () => {
  for (let n = 2; n <= 8; n++) assert.equal(modeloParaChileautos(`Tiggo ${n} Pro 1.5`), `Tiggo ${n}`, `Tiggo ${n}`);
  assert.equal(modeloParaChileautos("TIGGO 7 PRO"), "Tiggo 7");
  assert.equal(modeloParaChileautos("Tiggo 1"), "Tiggo");
  assert.equal(modeloParaChileautos("Tiggo 9"), "Tiggo");
  assert.equal(modeloParaChileautos("Tiggo Pro"), "Tiggo");
});

test("LISTA DEL ADMINISTRADOR: los modelos de una palabra (CX, X, A, Q, números y 3 letras) se conservan con su versión descartada", () => {
  const casos = [["CX-5 2.0 R", "CX-5"], ["CX-30 GT", "CX-30"], ["CX-90 PHEV", "CX-90"], ["X1 SDRIVE20I", "X1"], ["X7 XDRIVE40I", "X7"],
    ["208 ALLURE 1.2", "208"], ["3008 GT", "3008"], ["A1 SPORTBACK", "A1"], ["A7 TFSI", "A7"], ["Q3 TFSI", "Q3"], ["Q8 55", "Q8"], ["ASX 2.0", "ASX"], ["ZS EV", "ZS"]];
  for (const [entrada, esperado] of casos) assert.equal(modeloParaChileautos(entrada), esperado, entrada);
});

test("LISTA DEL ADMINISTRADOR: qué palabras se consideran modelos conocidos (rangos exactos)", () => {
  const si = ["CX-3", "CX-5", "CX-30", "CX-90", "x1", "X7", "1", "208", "9999", "ASX", "rav", "A1", "a7", "Q1", "Q8"];
  const no = ["CX-2", "CX-91", "CX-100", "X8", "X0", "0", "10000", "AB", "ABCD", "A8", "Q9", "Yaris", "Tiggo"];
  for (const p of si) assert.ok(esModeloConocidoDeUnaPalabra(p), `debería ser conocido: ${p}`);
  for (const p of no) assert.ok(!esModeloConocidoDeUnaPalabra(p), `no debería ser conocido: ${p}`);
});

test("LISTA DEL ADMINISTRADOR: la lista cargada tiene las 14 reglas (6 frases, 7 series y 1 secuencia)", () => {
  assert.equal(EXCEPCIONES_MODELO.length, 14);
  for (const f of ["Corolla Cross", "Land Cruiser", "Santa Fe", "Grand Vitara", "Yaris Sport", "Yaris Cross"]) assert.ok(EXCEPCIONES_MODELO.includes(f), f);
  assert.equal(EXCEPCIONES_MODELO.filter((e) => typeof e !== "string" && !e.secuencia).length, 7);
  assert.equal(EXCEPCIONES_MODELO.filter((e) => e && e.secuencia).length, 1);
});

test("SECUENCIA 'aaa' a 'zzz' + espacio + '111' a '999': se busca con las dos palabras (GLA 200, CLA 250…)", () => {
  const casos = [["GLA 200", "GLA 200"], ["gla 200 4matic", "gla 200"], ["CLA 250 AMG", "CLA 250"], ["GLC 300 D", "GLC 300"], ["GLE 450", "GLE 450"], ["NPR 816", "NPR 816"], ["RAV 400", "RAV 400"]];
  for (const [entrada, esperado] of casos) assert.equal(modeloParaChileautos(entrada), esperado, entrada);
  assert.equal(detalleModeloChileautos("CLA 250 AMG 4MATIC").omitido, "AMG 4MATIC");
});

test("SECUENCIA: bordes del número (111 y 999 entran; 110, 1000, 99 y 4 no)", () => {
  assert.equal(modeloParaChileautos("ABC 111"), "ABC 111");
  assert.equal(modeloParaChileautos("ABC 999"), "ABC 999");
  for (const n of ["110", "100", "1000", "99", "4", "0111", "20.0", "2,5", "abc"]) assert.equal(modeloParaChileautos(`ABC ${n}`), "ABC", `ABC ${n}`);
});

test("SECUENCIA: la primera palabra debe tener exactamente 3 letras", () => {
  for (const m of ["AB 200", "ABCD 200", "GL4 200", "GL- 200", "123 200"]) {
    assert.equal(modeloParaChileautos(m), m.split(" ")[0], m);
  }
});

/* ---------- letras y números pegados ("GLA200") ---------- */
test("SEPARACIÓN: 'GLA200' se separa con un espacio y se busca como 'GLA 200'", () => {
  const casos = [["GLA200", "GLA 200"], ["gla200", "gla 200"], ["GLA200 4MATIC", "GLA 200"], ["GLA200D", "GLA 200"], ["CLA250 AMG", "CLA 250"], ["GLC300D", "GLC 300"], ["ABC123", "ABC 123"], ["  GLA200  ", "GLA 200"]];
  for (const [entrada, esperado] of casos) assert.equal(modeloParaChileautos(entrada), esperado, entrada);
  assert.equal(detalleModeloChileautos("GLA200 4MATIC").omitido, "4MATIC");
  assert.equal(detalleModeloChileautos("GLA200D").omitido, "D");
});

test("SEPARACIÓN: respeta los mismos bordes (111 a 999) que la excepción con espacio", () => {
  for (const m of ["ABC110", "ABC1000", "GLA2000", "ABC99", "ABC4"]) assert.equal(modeloParaChileautos(m), m, m);
  assert.equal(modeloParaChileautos("ABC111"), "ABC 111");
  assert.equal(modeloParaChileautos("ABC999"), "ABC 999");
});

test("SEPARACIÓN: no rompe modelos de una palabra con número (NP300, RAV4, C3, i10, Q50, X70, 3008)", () => {
  for (const m of ["NP300", "RAV4", "C3", "i10", "Q50", "X70", "3008", "208", "ASX", "T-Cross", "X-Trail", "CX-5", "Yaris"]) {
    assert.equal(modeloParaChileautos(m), m, m);
  }
});

test("SEPARACIÓN: las series pegadas a una letra de versión se reconocen (X5M, Q5S, A4Avant)", () => {
  assert.equal(modeloParaChileautos("X5M"), "X5");
  assert.equal(modeloParaChileautos("Q5S"), "Q5");
  assert.equal(modeloParaChileautos("A4Avant"), "A4");
  assert.equal(modeloParaChileautos("CX5"), "CX-5");
  assert.equal(modeloParaChileautos("Tiggo7"), "Tiggo 7");
});

test("SEPARACIÓN: solo se separa la primera palabra, no la versión que viene después", () => {
  assert.equal(modeloParaChileautos("Yaris 1.5GLI"), "Yaris");
  assert.equal(modeloParaChileautos("GLA200 2.0T"), "GLA 200");
});

test("SEPARACIÓN: la dirección de búsqueda usa 'GLA 200' para una Mercedes pegada como GLA200", () => {
  const u = decodeURIComponent(buildChileautosUrl({ marca: "MERCEDES BENZ", modelo: "GLA200 1.3", anio: 2021, km: 40000 }));
  assert.ok(u.includes("Marca.Mercedes-Benz._.Modelo.GLA 200.)"), u);
});

test("SECUENCIA: no pisa a las otras reglas (Tiggo 7, CX 5, Yaris Cross, Land Cruiser siguen igual)", () => {
  assert.equal(modeloParaChileautos("Tiggo 7 Pro"), "Tiggo 7");
  assert.equal(modeloParaChileautos("CX 5"), "CX-5");
  assert.equal(modeloParaChileautos("Yaris Cross 1.5"), "Yaris Cross");
  assert.equal(modeloParaChileautos("Land Cruiser Prado"), "Land Cruiser");
  assert.equal(modeloParaChileautos("ASX 2.0"), "ASX");
  assert.equal(modeloParaChileautos("RAV 4"), "RAV");
  assert.equal(modeloParaChileautos("Clase C 200"), "Clase");
});

test("SECUENCIA: la dirección de búsqueda usa 'GLA 200' completo para una Mercedes", () => {
  const u = decodeURIComponent(buildChileautosUrl({ marca: "MERCEDES BENZ", modelo: "GLA 200 1.3", anio: 2021, km: 40000 }));
  assert.ok(u.includes("Marca.Mercedes-Benz._.Modelo.GLA 200.)"), u);
});

test("SECUENCIA: también funciona con una lista propia, con 'texto' y con rangos", () => {
  const ex = [{ secuencia: [{ texto: "Clase" }, { letras: 1 }] }];
  assert.equal(modeloParaChileautos("Clase C 200", ex), "Clase C");
  assert.equal(modeloParaChileautos("Clase 5", ex), "Clase");
});

test("sigue sin haber excepción para modelos que no están en la lista (Mazda 3 como texto, Grand i10, Santa Cruz)", () => {
  assert.equal(modeloParaChileautos("Grand i10 1.2"), "Grand");
  assert.equal(modeloParaChileautos("Santa Cruz"), "Santa");
  assert.equal(modeloParaChileautos("Land Rover"), "Land");
});

test("la dirección de búsqueda usa 'Tiggo 7' y 'Corolla Cross' completos con la lista cargada", () => {
  const u1 = decodeURIComponent(buildChileautosUrl({ marca: "Chery", modelo: "TIGGO 7 PRO", anio: 2022, km: 30000 }));
  const u2 = decodeURIComponent(buildChileautosUrl({ marca: "Toyota", modelo: "Corolla Cross 2.0", anio: 2022, km: 30000 }));
  assert.ok(u1.includes("Modelo.Tiggo 7.)"), u1);
  assert.ok(u2.includes("Modelo.Corolla Cross.)"), u2);
});

test("la dirección de búsqueda usa la primera palabra del modelo y nunca lleva puntos del motor (rompen la sintaxis de Chileautos)", () => {
  const esperado = buildChileautosUrl({ marca: "Toyota", modelo: "Yaris", anio: 2020, km: 60000 });
  for (const m of ["Yaris 1.5", "Yaris 1.5 GLI", "YARIS 1.5 GLI MT", "Yaris 1,5"]) {
    // Chileautos no distingue mayúsculas de minúsculas (comprobado en el sitio)
    assert.equal(buildChileautosUrl({ marca: "Toyota", modelo: m, anio: 2020, km: 60000 }).toLowerCase(), esperado.toLowerCase(), m);
  }
  const modeloEnUrl = decodeURIComponent(buildChileautosUrl({ marca: "Toyota", modelo: "Yaris Sport 1.5 GLI", anio: 2020, km: 60000 })).match(/Modelo\.([^)]*)\.\)/)[1];
  assert.equal(modeloEnUrl, "Yaris Sport"); // excepción de la lista
  assert.ok(!/\d\.\d/.test(modeloEnUrl));
});

test("la dirección de búsqueda usa los nombres convertidos (CX-5) y los de la lista (Santa Fe) con su codificación", () => {
  const cx = decodeURIComponent(buildChileautosUrl({ marca: "Mazda", modelo: "CX5 2.0 R", anio: 2021, km: 40000 }));
  const sf = buildChileautosUrl({ marca: "Hyundai", modelo: "Santa Fé GLS", anio: 2019, km: 80000 });
  assert.ok(cx.includes("Modelo.CX-5.)"), cx);
  assert.ok(sf.includes("Modelo.Santa%20Fe.)"), sf);
});

test("con una excepción cargada, la dirección usa el modelo completo de la lista", () => {
  const url = buildChileautosUrl({ marca: "Toyota", modelo: "Corolla Cross 2.0 XEI", anio: 2022, km: 30000, excepciones: ["Corolla Cross"] });
  assert.ok(decodeURIComponent(url).includes("Modelo.Corolla Cross.)"));
  assert.ok(!decodeURIComponent(url).includes("2.0"));
});

test("si el modelo empieza con un motor ('1.5 GLI'), igual se obtiene una dirección (no queda vacío)", () => {
  assert.notEqual(buildChileautosUrl({ marca: "Toyota", modelo: "1.5 GLI", anio: 2020, km: 60000 }), null);
});

/* ---------- la marca que se envía a Chileautos ---------- */
import { marcaParaChileautos, MARCAS_CHILEAUTOS } from "../src/compra-calc.js";

test("Mercedes Benz se busca como 'Mercedes-Benz' (con guion), con cualquier grafía de origen", () => {
  for (const m of ["MERCEDES BENZ", "Mercedes Benz", "mercedes benz", "mercedes  benz", "MERCEDES-BENZ", "Mercedes-Benz", "mercedez benz", "MERCEDEZ-BENZ", "Mercedez Benz", "mercedesbenz", " Mercedes Benz "]) {
    assert.equal(marcaParaChileautos(m), "Mercedes-Benz", JSON.stringify(m));
  }
});

test("las demás marcas quedan como vienen (solo se recortan espacios sobrantes)", () => {
  assert.equal(marcaParaChileautos("Toyota"), "Toyota");
  assert.equal(marcaParaChileautos("  Kia "), "Kia");
  assert.equal(marcaParaChileautos("Great  Wall"), "Great Wall");
  assert.equal(marcaParaChileautos("BMW"), "BMW");
  assert.equal(marcaParaChileautos("Mercedes"), "Mercedes");
  assert.equal(marcaParaChileautos("Mercedes-Benz Trucks"), "Mercedes-Benz Trucks");
  assert.equal(marcaParaChileautos(""), "");
  assert.equal(marcaParaChileautos(null), "");
});

test("la dirección de búsqueda lleva 'Mercedes-Benz' con guion aunque la marca venga con espacio", () => {
  for (const marca of ["MERCEDES BENZ", "Mercedez Benz", "Mercedes-Benz"]) {
    const url = buildChileautosUrl({ marca, modelo: "Clase", anio: 2020, km: 50000 });
    assert.ok(decodeURIComponent(url).includes("Marca.Mercedes-Benz._."), marca);
    assert.ok(!/Mercedes%20Benz|Mercedez/i.test(url), marca);
  }
});

test("una marca vacía sigue sin generar dirección", () => {
  assert.equal(buildChileautosUrl({ marca: "  ", modelo: "Yaris", anio: 2020, km: 50000 }), null);
});

test("la tabla de marcas tiene la regla de Mercedes-Benz", () => {
  assert.equal(MARCAS_CHILEAUTOS.length, 1);
  assert.equal(MARCAS_CHILEAUTOS[0].nombre, "Mercedes-Benz");
});
