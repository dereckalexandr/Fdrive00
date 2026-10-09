import test from "node:test";
import assert from "node:assert/strict";
import { extractPatenteChile, buildPatenteBookmarkletHref } from "../src/patente-bookmarklet.js";
import { parseDatosPatente } from "../src/compra-calc.js";

// Todos los datos de personas de estas pruebas son INVENTADOS.
const DUENO = "Nombre\nPEDRO INVENTADO SOTO\nRUT\n11.111.111-1\nDirección\nCALLE FALSA 123";
const loc = { href: "https://www.patentechile.com/resultados?ppu=SJXH57", origin: "https://www.patentechile.com", pathname: "/resultados" };

// DOM mínimo: texto visible (innerText) y, opcionalmente, elementos con hermanos (tablas, listas de definición).
function doc({ texto = "", pares = [], titulo = "" } = {}) {
  const els = [];
  for (const [etiqueta, valor] of pares) {
    const fila = { nextElementSibling: null, parentElement: null };
    const th = { children: [], textContent: etiqueta, nextElementSibling: null, parentElement: fila };
    const td = { children: [], textContent: valor, nextElementSibling: null, parentElement: fila };
    th.nextElementSibling = td;
    els.push(th, td);
  }
  return { body: { innerText: texto }, title: titulo, querySelectorAll: () => els };
}
const extraer = (d, l = loc) => extractPatenteChile(d, l);

test("etiqueta y valor en líneas seguidas", () => {
  const r = extraer(doc({ texto: `Resultado de la búsqueda\nPatente\nSJXH57\nMarca\nTOYOTA\nModelo\nYARIS\nAño\n2020\n${DUENO}` }));
  assert.deepEqual([r.patente, r.marca, r.modelo, r.anio], ["SJXH57", "TOYOTA", "YARIS", 2020]);
});

test("formato 'Etiqueta: valor'", () => {
  const r = extraer(doc({ texto: "Patente: SJXH57\nMarca: TOYOTA\nModelo: YARIS SPORT\nAño: 2020\nColor: ROJO" }));
  assert.deepEqual([r.patente, r.marca, r.modelo, r.anio], ["SJXH57", "TOYOTA", "YARIS SPORT", 2020]);
});

test("columnas de tabla separadas por tabulaciones", () => {
  const r = extraer(doc({ texto: "PPU\tSJXH57\nMarca\tKIA\nModelo\tRIO 5\nAño\t2019" }));
  assert.deepEqual([r.patente, r.marca, r.modelo, r.anio], ["SJXH57", "KIA", "RIO 5", 2019]);
});

test("todo en una sola línea ('Marca: X  Modelo: Y  Año: Z')", () => {
  const r = extraer(doc({ texto: "Marca: TOYOTA  Modelo: YARIS  Año: 2020" }));
  assert.deepEqual([r.marca, r.modelo, r.anio], ["TOYOTA", "YARIS", 2020]);
});

test("pares etiqueta/valor del HTML (th/td) aunque el texto visible no sirva", () => {
  const r = extraer(doc({ pares: [["Marca:", "HYUNDAI"], ["Modelo", "ACCENT"], ["Año:", "2018"], ["Patente", "ab-cd12"]] }));
  assert.deepEqual([r.marca, r.modelo, r.anio, r.patente], ["HYUNDAI", "ACCENT", 2018, "ABCD12"]);
});

test("las tildes, mayúsculas y espacios de las etiquetas no importan", () => {
  const r = extraer(doc({ texto: "MARCA :\nSUZUKI\nmodelo\nSWIFT\nAÑO\n2021" }));
  assert.deepEqual([r.marca, r.modelo, r.anio], ["SUZUKI", "SWIFT", 2021]);
});

test("si falta un valor, no toma la etiqueta siguiente como valor", () => {
  const r = extraer(doc({ texto: "Marca\nModelo\nYARIS\nAño\n2020" }));
  assert.equal(r.marca, "");
  assert.equal(r.modelo, "YARIS");
});

test("la patente se toma de la dirección o del título si la ficha no la rotula", () => {
  assert.equal(extraer(doc({ texto: "Marca: KIA\nModelo: RIO\nAño: 2019" })).patente, "SJXH57");
  assert.equal(extraer(doc({ texto: "Marca: KIA", titulo: "Resultados para TTHY51" }), { href: "https://x/y", pathname: "/y", origin: "https://x" }).patente, "TTHY51");
});

test("PRIVACIDAD: nunca copia nombre, RUT ni dirección del dueño (ficha completa)", () => {
  const r = extraer(doc({ texto: `Patente\nSJXH57\nMarca\nTOYOTA\nModelo\nYARIS\nAño\n2020\n${DUENO}`, pares: [["Nombre", "PEDRO INVENTADO SOTO"], ["RUT", "11.111.111-1"], ["Marca", "TOYOTA"]] }));
  const json = JSON.stringify(r);
  for (const prohibido of ["PEDRO", "INVENTADO", "SOTO", "11.111.111", "CALLE FALSA", "123"]) {
    assert.ok(!json.includes(prohibido), `no debe copiar "${prohibido}"`);
  }
  assert.deepEqual(Object.keys(r).sort(), ["anio", "capturadoEl", "fuente", "marca", "modelo", "patente", "url"].sort());
});

test("PRIVACIDAD: si no encuentra el vehículo, copia solo los NOMBRES de los campos, nunca sus valores", () => {
  const r = extraer(doc({ texto: `Resultado\nPropietario:\nPEDRO INVENTADO SOTO\nRUT:\n11.111.111-1\nNombre\nPEDRO INVENTADO SOTO\nDirección:\nCALLE FALSA 123` }));
  assert.equal(r.marca, "");
  assert.ok(Array.isArray(r.etiquetas) && r.etiquetas.length > 0);
  const json = JSON.stringify(r);
  for (const prohibido of ["PEDRO", "INVENTADO", "11.111.111", "CALLE FALSA"]) assert.ok(!json.includes(prohibido), `no debe copiar "${prohibido}"`);
  assert.ok(r.etiquetas.includes("Propietario:"));
});

test("la dirección copiada no incluye la consulta (solo sitio y ruta)", () => {
  const r = extraer(doc({ texto: "Marca: KIA\nModelo: RIO\nAño: 2019" }));
  assert.equal(r.url, "https://www.patentechile.com/resultados");
});

test("el marcador 'javascript:' se ejecuta, copia el JSON y avisa", async () => {
  const href = buildPatenteBookmarkletHref();
  assert.ok(href.startsWith("javascript:"));
  const codigo = decodeURIComponent(href.slice("javascript:".length));
  let copiado = null;
  const avisos = [];
  const d = doc({ texto: `Patente\nSJXH57\nMarca\nTOYOTA\nModelo\nYARIS\nAño\n2020\n${DUENO}` });
  d.body.appendChild = (el) => avisos.push(el.textContent);
  d.createElement = () => ({ setAttribute() {}, remove() {}, select() {}, style: {} });
  new Function("document", "location", "navigator", "setTimeout", "prompt", codigo)(
    d, loc, { clipboard: { writeText: (t) => { copiado = t; return Promise.resolve(); } } }, () => 0, () => {}
  );
  await new Promise((r) => setImmediate(r));
  const data = JSON.parse(copiado);
  assert.deepEqual([data.fuente, data.patente, data.marca, data.modelo, data.anio], ["patentechile", "SJXH57", "TOYOTA", "YARIS", 2020]);
  assert.ok(!copiado.includes("PEDRO") && !copiado.includes("11.111.111"));
  assert.ok(avisos[0].includes("TOYOTA YARIS 2020"));
});

/* ---------- validación en la app ---------- */
test("parseDatosPatente acepta los cuatro datos y normaliza la patente", () => {
  const r = parseDatosPatente(JSON.stringify({ fuente: "patentechile", patente: "sj-xh57", marca: "TOYOTA", modelo: "YARIS", anio: 2020, extra: "NO SE USA" }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { patente: "SJXH57", marca: "TOYOTA", modelo: "YARIS", anio: 2020 });
});

test("parseDatosPatente: rechaza texto vacío, no-JSON y otra fuente", () => {
  assert.equal(parseDatosPatente("").ok, false);
  assert.equal(parseDatosPatente("hola").ok, false);
  assert.equal(parseDatosPatente('{"fuente":"chileautos","listings":[]}').ok, false);
});

test("parseDatosPatente: si falta marca, modelo o año, devuelve el error y las etiquetas de diagnóstico", () => {
  const r = parseDatosPatente(JSON.stringify({ fuente: "patentechile", patente: "SJXH57", marca: "", modelo: "", anio: 0, etiquetas: ["Propietario:", "Fecha:"] }));
  assert.equal(r.ok, false);
  assert.match(r.error, /No pude leer marca, modelo y año/);
  assert.deepEqual(r.etiquetas, ["Propietario:", "Fecha:"]);
});
