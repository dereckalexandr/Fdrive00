import test from "node:test";
import assert from "node:assert/strict";
import { extractChileautosListings, buildBookmarkletHref } from "../src/chileautos-bookmarklet.js";

// DOM mínimo: solo lo que usa el extractor (anclas, ancestros con innerText, body).
function tarjeta({ texto, href }) {
  const card = { innerText: texto, parentElement: { innerText: "x".repeat(2000) + "$1 CLP", parentElement: null }, getAttribute: () => null };
  const ancla = { innerText: "Ver detalles", parentElement: card, getAttribute: (n) => (n === "href" ? href : null) };
  return ancla;
}
const doc = (anclas, cuerpo = "") => ({ querySelectorAll: () => anclas, body: { innerText: cuerpo } });
const loc = { href: "https://www.chileautos.cl/vehiculos/?q=..." };

const T1 = "2019 Toyota Yaris\n1.5 GLI 4X2 MT 4P\n$8.200.000 CLP\nSedán\nManual\nBencina\n84.000 km\nAutomotora X\nSantiago\nContactar vendedor\nVer detalles";
const H1 = "/vehiculos/detalles/2019-toyota-yaris-1-5-gli-4x2-mt-4p/CP-AD-8561346/?gts=CP-AD-8561346";

test("extrae año, versión, precio, km, id y enlace de una tarjeta real", () => {
  const r = extractChileautosListings(doc([tarjeta({ texto: T1, href: H1 })]), loc);
  assert.equal(r.fuente, "chileautos");
  assert.equal(r.listings.length, 1);
  assert.deepEqual(r.listings[0], {
    id: "CP-AD-8561346", titulo: "2019 Toyota Yaris", version: "1.5 GLI 4X2 MT 4P",
    transmision: "Manual", combustible: "Bencina",
    anio: 2019, km: 84000, precio: 8200000, destacado: false,
    href: "/vehiculos/detalles/2019-toyota-yaris-1-5-gli-4x2-mt-4p/CP-AD-8561346/",
  });
  assert.equal(r.sinResultados, false);
  assert.equal(r.url, loc.href);
});

test("tarjetas reales de Chileautos: con y sin contador de fotos delante del título", () => {
  const conFotos = "5\n2019 Toyota Yaris\n1.5 GLI 4X2 E MT 4P\n$8.200.000 CLP\nSedán\nManual\nBencina\n84.000 km\nParticular\nMetropolitana de Santiago\nContactar vendedor\nVer detalles";
  const sinFotos = "2019 Toyota Yaris\n1.5 GLI 4X2 E MT 4P\n$8.800.000 CLP\nSedán\nManual\nBencina\n72.300 km\nParticular\nBío Bío\nContactar vendedor\nVer detalles";
  const r = extractChileautosListings(doc([
    tarjeta({ texto: conFotos, href: "/vehiculos/detalles/2019-toyota-yaris-1-5-gli-4x2-e-mt-4p/CL-AD-19642560/" }),
    tarjeta({ texto: sinFotos, href: "/vehiculos/detalles/2019-toyota-yaris-1-5-gli-4x2-e-mt-4p/CL-AD-18825492/" }),
  ]), loc);
  for (const l of r.listings) {
    assert.equal(l.titulo, "2019 Toyota Yaris");
    assert.equal(l.version, "1.5 GLI 4X2 E MT 4P");
    assert.equal(l.anio, 2019);
  }
  assert.deepEqual(r.listings.map((l) => [l.precio, l.km]), [[8200000, 84000], [8800000, 72300]]);
});

test("lee la transmisión y el combustible de cada tarjeta (automática, diésel, híbrido, eléctrico)", () => {
  const t = (trans, comb) => `2022 Marca Modelo\nVersión\n$10.000.000 CLP\nSUV\n${trans}\n${comb}\n40.000 km\nParticular`;
  const casos = [["Automática", "Diesel"], ["Automático", "Híbrido"], ["Automática", "Eléctrico"], ["Manual", "Bencina"], ["Automática", "Híbrido enchufable"]];
  const r = extractChileautosListings(doc(casos.map(([tr, co], i) => tarjeta({ texto: t(tr, co), href: `/vehiculos/detalles/2022-marca-modelo/CL-AD-${i}1/` }))), loc);
  assert.deepEqual(r.listings.map((l) => [l.transmision, l.combustible]), casos);
});

test("si la tarjeta no trae transmisión o combustible, quedan vacíos (no se inventan)", () => {
  const r = extractChileautosListings(doc([tarjeta({ texto: "2018 Marca Modelo\nVersión\n$8.000.000 CLP\n50.000 km", href: "/vehiculos/detalles/2018-marca-modelo/CL-AD-5/" })]), loc);
  assert.equal(r.listings[0].transmision, "");
  assert.equal(r.listings[0].combustible, "");
});

test("marca como destacado el aviso con rankingType en su enlace", () => {
  const h = "/vehiculos/detalles/2025-ssangyong-rexton/GI-AD-943171/?gts=GI-AD-943171&rankingType=topspotnitro";
  const r = extractChileautosListings(doc([tarjeta({ texto: "2025 SsangYong Rexton\n2.2T\n$34.990.000 CLP\n18.621 km", href: h })]), loc);
  assert.equal(r.listings[0].destacado, true);
  assert.equal(r.listings[0].precio, 34990000);
});

test("ignora el mismo aviso repetido (carrusel + lista) y conserva el orden de la página", () => {
  const t2 = "2020 Toyota Yaris\nGLI\n$8.500.000 CLP\n74.000 km";
  const r = extractChileautosListings(doc([
    tarjeta({ texto: T1, href: H1 }),
    tarjeta({ texto: t2, href: "/vehiculos/detalles/2020-toyota-yaris/CP-AD-100/" }),
    tarjeta({ texto: T1, href: H1 }),
  ]), loc);
  assert.deepEqual(r.listings.map((l) => l.id), ["CP-AD-8561346", "CP-AD-100"]);
});

test("sin precio publicado: precio 0 (la app lo descartará); sin km: km 0", () => {
  const r = extractChileautosListings(doc([tarjeta({ texto: "2018 Toyota Yaris\nGLI\n$ 100 CLP\nContactar vendedor", href: "/vehiculos/detalles/2018-toyota-yaris/CP-AD-7/" })]), loc);
  assert.equal(r.listings[0].km, 0);
  assert.equal(r.listings[0].precio, 100);
});

test("si el texto no empieza con el año, lo toma del enlace", () => {
  const r = extractChileautosListings(doc([tarjeta({ texto: "Toyota Yaris\nGLI\n$8.200.000 CLP\n50.000 km", href: "/vehiculos/detalles/2021-toyota-yaris-gli/CP-AD-9/" })]), loc);
  assert.equal(r.listings[0].anio, 2021);
});

test("detecta la página 'Vehículos parecidos a lo que buscas' (sin resultados exactos)", () => {
  const r = extractChileautosListings(doc([], "Vehículos parecidos a lo que buscas\n..."), loc);
  assert.equal(r.sinResultados, true);
  assert.deepEqual(r.listings, []);
});

test("buildBookmarkletHref genera un 'javascript:' ejecutable que copia el JSON", async () => {
  const href = buildBookmarkletHref();
  assert.ok(href.startsWith("javascript:"));
  const codigo = decodeURIComponent(href.slice("javascript:".length));
  // Se ejecuta con un navegador falso para verificar que no hay errores de sintaxis ni referencias externas.
  let copiado = null;
  const anclas = [tarjeta({ texto: T1, href: H1 })];
  const fake = {
    document: { querySelectorAll: () => anclas, body: { innerText: "", appendChild() {} }, createElement: () => ({ setAttribute() {}, remove() {}, select() {}, style: {} }) },
    location: { href: "https://www.chileautos.cl/x" },
    navigator: { clipboard: { writeText: (t) => { copiado = t; return Promise.resolve(); } } },
    setTimeout: () => 0,
    prompt: () => {},
  };
  new Function("document", "location", "navigator", "setTimeout", "prompt", codigo)(fake.document, fake.location, fake.navigator, fake.setTimeout, fake.prompt);
  await new Promise((r) => setImmediate(r));
  const data = JSON.parse(copiado);
  assert.equal(data.fuente, "chileautos");
  assert.equal(data.listings[0].precio, 8200000);
});
