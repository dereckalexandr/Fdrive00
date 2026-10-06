// Ejecutar con:  npm test
// Datos inventados. Se genera cada PDF y se lee de vuelta con pdf.js para verificar
// que es un archivo válido y que el texto quedó donde corresponde.
import test from "node:test";
import assert from "node:assert/strict";
import { buildInspeccionPdf, buildTasacionPdf, wrapText, textWidth, pdfFileName } from "../src/pdf-report.js";

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

const SECTIONS = Array.from({ length: 6 }, (_, s) => ({
  id: `s${s}`,
  title: `${s + 1}. Sección ${s + 1}`,
  items: Array.from({ length: 8 }, (_, i) => ({ id: `s${s}_i${i}`, label: `Ítem ${s + 1}.${i + 1}` })),
}));

const RECORD = {
  fecha: "2026-10-06", inscripcion: "ABCD.12-3", anio: "2025", marca: "TOYOTA", modelo: "FORTUNER",
  nroMotor: "1ABC123456", nroChasis: "9XYZW1AB2C0001234", nroSerie: "", nroVin: "", color: "BLANCO",
  propietarioNombre: "JUAN PEREZ GONZALEZ", propietarioRun: "12.345.678-5",
  checklist: {
    s0_i0: { estado: "Bueno", observacion: "Sin novedades" },
    s0_i1: { estado: "Malo", observacion: "Pérdida de aceite visible en la tapa de válvulas, se recomienda revisión urgente antes de la entrega del vehículo al cliente final " .repeat(2) },
  },
};

test("wrapText respeta el ancho máximo y no pierde palabras", () => {
  const text = "uno dos tres cuatro cinco seis siete ocho nueve diez once doce";
  const lines = wrapText(text, 80, 10);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(textWidth(l, 10) <= 80 + 0.01, `línea demasiado ancha: ${l}`);
  assert.equal(lines.join(" "), text);
});

test("wrapText corta palabras más largas que la línea", () => {
  const lines = wrapText("A".repeat(200), 100, 10);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(textWidth(l, 10) <= 100 + 0.01);
  assert.equal(lines.join(""), "A".repeat(200));
});

test("informe de inspección: PDF válido, multipágina y con los datos", async () => {
  const bytes = buildInspeccionPdf(RECORD, { sections: SECTIONS, inspectorNombre: "Ana Soto" });
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), "%PDF-");
  const pages = await readPdf(bytes);
  assert.ok(pages.length >= 2, `esperaba varias páginas, hubo ${pages.length}`);
  const all = pages.join(" ");
  for (const s of ["Informe de inspección", "ABCD.12-3", "TOYOTA", "FORTUNER", "JUAN PEREZ GONZALEZ", "12.345.678-5", "Ana Soto", "Sin novedades", "Sección 6"]) {
    assert.ok(all.includes(s), `falta "${s}" en el PDF`);
  }
  assert.ok(pages[0].includes(`Página 1 de ${pages.length}`));
  assert.ok(pages[pages.length - 1].includes(`Página ${pages.length} de ${pages.length}`));
});

test("la observación larga se envuelve completa (no se trunca)", async () => {
  const bytes = buildInspeccionPdf(RECORD, { sections: SECTIONS });
  const all = (await readPdf(bytes)).join(" ").replace(/\s+/g, " ");
  assert.ok(all.includes("entrega del vehículo al cliente final"));
});

test("caracteres fuera de Latin-1 no rompen el PDF", async () => {
  const rec = { ...RECORD, propietarioNombre: "ŁUKASZ Ñandú 日本" };
  const pages = await readPdf(buildInspeccionPdf(rec, { sections: SECTIONS }));
  assert.ok(pages.join(" ").includes("Ñandú"));
});

const T_SECTIONS = [
  { id: "carr", title: "1. Carrocería", type: "fixed", items: [{ id: "capot", label: "Capot" }, { id: "puerta", label: "Puerta", extra: { id: "vidrio", label: "Vidrio" } }] },
  { id: "motor", title: "2. Motor", type: "dynamic", slots: 3 },
  { id: "vacia", title: "3. Frenos", type: "dynamic", slots: 2 },
];
const getItems = (s) => (s.type === "dynamic" ? Array.from({ length: s.slots }, (_, i) => ({ id: `${s.id}_${i + 1}` })) : s.items);
const fmt = (n) => `$${Number(n).toLocaleString("es-CL")}`;

test("informe de tasación: datos, valores y filas dinámicas solo si están completas", async () => {
  const rec = {
    fecha: "2026-10-06", propietario: "JUAN PEREZ", vehiculo: "TOYOTA FORTUNER", patente: "ABCD12", anio: "2025",
    kilometraje: "45000", estadoGeneral: "Bueno", valorComercial: 25000000, observaciones: "Vehículo en buen estado general.",
    checklist: {
      capot: { estado: "Repintado", valor: 150000 },
      puerta: { estado: "Bueno", valor: 0, vidrio: "No original" },
      motor_1: { nombre: "Correa de distribución", estado: "Regular", valor: 80000 },
    },
  };
  const pages = await readPdf(buildTasacionPdf(rec, { sections: T_SECTIONS, getItems, fmt, inspectorNombre: "Ana Soto" }));
  const all = pages.join(" ");
  for (const s of ["Informe de tasación", "TOYOTA FORTUNER", "$25.000.000", "Repintado", "$150.000", "No original", "Correa de distribución", "$80.000", "Sin registros"]) {
    assert.ok(all.includes(s), `falta "${s}"`);
  }
});

test("pdfFileName es seguro para archivos", () => {
  assert.equal(pdfFileName("Inspeccion", { inscripcion: "TTHY.51-1", fecha: "2026-10-06" }), "Inspeccion_TTHY511_2026-10-06.pdf");
  assert.equal(pdfFileName("Tasacion", {}), "Tasacion_sin-patente_sin-fecha.pdf");
});
