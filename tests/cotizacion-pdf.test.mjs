// PDF de la cotización. Se genera y se lee de vuelta con pdf.js para comprobar que es un archivo válido.
import test from "node:test";
import assert from "node:assert/strict";
import { buildCotizacionPdf, leerJpeg } from "../src/pdf-report.js";

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

async function readPdf(bytes) {
  const pdf = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => it.str).join(" "));
  }
  return pages;
}
const fmt = (n) => `$${Math.round(Number(n)).toLocaleString("es-CL")}`;
const comoTexto = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join("");

/** Un "JPEG" con solo la cabecera necesaria (SOI + SOF0): alcanza para probar lectura e incrustación. */
function jpegFalso(w, h, comps = 3) {
  const bytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 8 + comps * 3, 0x08, h >> 8, h & 255, w >> 8, w & 255, comps];
  for (let c = 0; c < comps; c++) bytes.push(c + 1, 0x11, 0x00);
  bytes.push(0xff, 0xd9);
  return `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
}

const COT = {
  numero: 123, fecha: "2026-10-14", vigenciaHasta: "2026-10-21",
  cliente: { nombre: "Cecilia Mora Soto", rut: "11.111.111-1", telefono: "+56 9 8765 4321", email: "ceci@mail.cl" },
  vehiculo: { marca: "Toyota", modelo: "Yaris", version: "1.5 GLI", anio: 2020, km: 45000, color: "Gris", transmision: "Automática", combustible: "Bencina", patente: "ABCD12" },
  precio_lista: 9500000, descuento: 300000,
  parte_pago: { tiene: true, patente: "AB1234", marca: "Kia", modelo: "Rio", anio: 2015, km: 90000, valor: 3000000 },
  financiamiento: { quiere: true, pie: 2000000, banco: "Banco X", plazo_meses: 36, tasa_mensual_pct: 1 },
  notas: "Incluye segundo juego de llaves.", ejecutivo: "Eva Uno", local: "Casa matriz",
  condiciones: "Cotización sujeta a disponibilidad del vehículo.", fotos: [],
};

test("Se lee el tamaño de un JPEG y se rechaza lo que no lo es", () => {
  const j = leerJpeg(jpegFalso(640, 480));
  assert.deepEqual([j.width, j.height, j.comps], [640, 480, 3]);
  assert.equal(leerJpeg(jpegFalso(64, 32, 1)).comps, 1);
  assert.equal(leerJpeg(jpegFalso(64, 32, 4)), null, "CMYK no se soporta");
  assert.equal(leerJpeg("data:image/png;base64,iVBORw0KGgo="), null);
  assert.equal(leerJpeg("hola"), null);
  assert.equal(leerJpeg(""), null);
  assert.equal(leerJpeg(null), null);
  assert.equal(leerJpeg(`data:image/jpeg;base64,${Buffer.from([1, 2, 3, 4]).toString("base64")}`), null);
});

test("Cotización: PDF válido con folio, cliente, vehículo y precios", async () => {
  const bytes = buildCotizacionPdf(COT, { fmt });
  assert.equal(comoTexto(bytes.slice(0, 5)), "%PDF-");
  const t = (await readPdf(bytes)).join(" ");
  for (const esperado of ["COT-000123", "Cecilia Mora Soto", "11.111.111-1", "Toyota", "Yaris 1.5 GLI", "ABCD12", "Eva Uno", "Casa matriz", "Incluye segundo juego de llaves", "disponibilidad del vehículo"]) {
    assert.ok(t.includes(esperado), `falta «${esperado}»`);
  }
  assert.ok(t.includes("$9.500.000") && t.includes("$300.000") && t.includes("$9.200.000"), "lista, descuento y precio final");
  assert.ok(/3,2\s*%/.test(t), "porcentaje de descuento");
});

test("Cotización: resumen de pago con parte de pago, pie, monto a financiar y cuota", async () => {
  const t = (await readPdf(buildCotizacionPdf(COT, { fmt }))).join(" ");
  assert.ok(t.includes("Vehículo en parte de pago") && t.includes("Kia Rio"));
  assert.ok(t.includes("$3.000.000"), "valor de la parte de pago");
  assert.ok(t.includes("$6.200.000"), "saldo = 9.200.000 − 3.000.000");
  assert.ok(t.includes("$2.000.000"), "pie");
  assert.ok(t.includes("$4.200.000"), "monto a financiar = 6.200.000 − 2.000.000");
  assert.ok(t.includes("36 meses") && t.includes("Banco X"));
  assert.ok(/CUOTA MENSUAL ESTIMADA\s+\$1\.\d{3}\.\d{3}|CUOTA MENSUAL ESTIMADA/.test(t));
  assert.ok(t.includes("estimación referencial"), "aviso de que la cuota es referencial");
});

test("Cotización sencilla: sin descuento, parte de pago ni financiamiento no aparecen esas secciones", async () => {
  const simple = { ...COT, descuento: 0, parte_pago: {}, financiamiento: {}, notas: "" };
  const t = (await readPdf(buildCotizacionPdf(simple, { fmt }))).join(" ");
  assert.ok(!t.includes("Descuento"), "sin descuento no se muestra la línea");
  assert.ok(!t.includes("parte de pago"));
  assert.ok(!t.includes("Monto a financiar") && !t.includes("CUOTA"));
  assert.ok(t.includes("Saldo a pagar") && t.includes("$9.500.000"));
});

test("Fotos: se incrustan como imágenes JPEG y el PDF sigue siendo válido", async () => {
  const sin = comoTexto(buildCotizacionPdf(COT, { fmt }));
  assert.ok(!sin.includes("/DCTDecode"), "sin fotos no hay imágenes");

  const con = buildCotizacionPdf({ ...COT, fotos: [jpegFalso(800, 600), jpegFalso(600, 800), jpegFalso(10, 10)] }, { fmt });
  const texto = comoTexto(con);
  assert.equal((texto.match(/\/DCTDecode/g) || []).length, 2, "máximo dos fotos");
  assert.ok(texto.includes("/Width 800") && texto.includes("/Height 600"));
  assert.ok(texto.includes("/XObject <<") && /\/Im1 \d+ 0 R/.test(texto));
  assert.ok((await readPdf(con)).join(" ").includes("COT-000123"), "pdf.js lo abre");

  // Todas las posiciones de la tabla de referencias apuntan al inicio de su objeto.
  const inicio = parseInt(/startxref\n(\d+)/.exec(texto)[1], 10);
  assert.ok(texto.slice(inicio).startsWith("xref"));
  const filas = texto.slice(inicio).split("\n").slice(3).filter((l) => /^\d{10} 00000 n/.test(l));
  filas.forEach((fila, k) => assert.ok(texto.slice(parseInt(fila, 10)).startsWith(`${k + 1} 0 obj`), `objeto ${k + 1}`));
  assert.ok(filas.length >= 8);
});

test("Fotos que no son JPEG se omiten sin romper el PDF", async () => {
  const bytes = buildCotizacionPdf({ ...COT, fotos: ["data:image/png;base64,iVBORw0KGgo=", "basura", jpegFalso(100, 100)] }, { fmt });
  assert.equal((comoTexto(bytes).match(/\/DCTDecode/g) || []).length, 1);
  assert.ok((await readPdf(bytes)).join(" ").includes("COT-000123"));
});

test("Una cotización larga pasa a una segunda página con su pie", async () => {
  const largo = { ...COT, notas: "Observación larga. ".repeat(260), condiciones: "Condición. ".repeat(260) };
  const pages = await readPdf(buildCotizacionPdf(largo, { fmt }));
  assert.ok(pages.length >= 2);
  assert.ok(pages.every((p, i) => p.includes(`Página ${i + 1} de ${pages.length}`)));
});
