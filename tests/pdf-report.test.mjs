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

test("informe de tasación: datos del vehículo y solo las piezas con valorización", async () => {
  const rec = {
    fecha: "2026-10-06", propietario: "JUAN PEREZ", vehiculo: "TOYOTA FORTUNER", patente: "ABCD12", anio: "2025",
    kilometraje: "45000", estadoGeneral: "Bueno", valorComercial: 25000000, observaciones: "Vehículo en buen estado general.",
    checklist: {
      capot: { estado: "Repintado", valor: 150000 },
      puerta: { estado: "Bueno", valor: 20000, vidrio: "No original" },
      motor_1: { nombre: "Correa de distribución", estado: "Regular", valor: 80000 },
      motor_2: { nombre: "Bujías (sin valor)", estado: "Malo", valor: 0 },
    },
  };
  const pages = await readPdf(buildTasacionPdf(rec, { sections: T_SECTIONS, getItems, fmt, inspectorNombre: "Ana Soto" }));
  const all = pages.join(" ");
  for (const s of ["Informe de tasación", "TOYOTA FORTUNER", "Repintado", "$150.000", "Vidrio: No original", "Correa de distribución", "$80.000"]) {
    assert.ok(all.includes(s), `falta "${s}"`);
  }
  // resumen: lo que no tiene valorización no aparece
  assert.ok(!all.includes("Bujías"), "una fila sin valorización no debe listarse");
  assert.ok(!all.includes("Sin registros"));
});

test("tasación: el valor comercial va al final y se le resta el total de valorizaciones", async () => {
  const rec = {
    fecha: "2026-10-06", vehiculo: "KIA RIO", valorComercial: 9000000,
    checklist: { capot: { estado: "Repintado", valor: 150000 }, motor_1: { nombre: "Correa", valor: 50000 } },
  };
  const pages = await readPdf(buildTasacionPdf(rec, { sections: T_SECTIONS, getItems, fmt }));
  const all = pages.join(" ").replace(/\s+/g, " ");
  const iResumen = all.indexOf("Resumen de valorización");
  assert.ok(iResumen > 0, "falta el bloque final");
  const cierre = all.slice(iResumen);
  assert.ok(cierre.includes("Valor comercial estimado $9.000.000"));
  assert.ok(cierre.includes("Menos: Total valorizaciones $200.000"));
  assert.ok(cierre.includes("Valor final $8.800.000"));
  // el valor comercial ya no se repite en el encabezado: solo aparece en el cierre
  assert.equal(all.split("$9.000.000").length - 1, 1);
});

test("tasación: si las valorizaciones superan el valor comercial, el valor final es negativo", async () => {
  const rec = { fecha: "2026-10-06", valorComercial: 100000, checklist: { capot: { valor: 150000 } } };
  const all = (await readPdf(buildTasacionPdf(rec, { sections: T_SECTIONS, getItems, fmt }))).join(" ").replace(/\s+/g, " ");
  assert.ok(/Valor final \$?-\$?50\.000/.test(all), "valor final negativo"); // "$-50.000" (fmt de la prueba) o "-$50.000" (clp de la app)
});

test("pdfFileName es seguro para archivos", () => {
  assert.equal(pdfFileName("Inspeccion", { inscripcion: "TTHY.51-1", fecha: "2026-10-06" }), "Inspeccion_TTHY511_2026-10-06.pdf");
  assert.equal(pdfFileName("Tasacion", {}), "Tasacion_sin-patente_sin-fecha.pdf");
});

test("tasación: subtotal por módulo y total general en el PDF", async () => {
  const rec = {
    fecha: "2026-10-06", vehiculo: "KIA RIO", patente: "WXYZ99", valorComercial: 9000000,
    checklist: {
      capot: { estado: "Repintado", valor: 150000 },
      puerta: { estado: "Bueno", valor: 25000 },
      motor_1: { nombre: "Correa", estado: "Regular", valor: 80000 },
      motor_2: { nombre: "Bujías", estado: "Malo", valor: 45000 },
    },
  };
  const all = (await readPdf(buildTasacionPdf(rec, { sections: T_SECTIONS, getItems, fmt }))).join(" ").replace(/\s+/g, " ");
  assert.ok(all.includes("Subtotal Carrocería $175.000"), "subtotal de Carrocería");
  assert.ok(all.includes("Subtotal Motor $125.000"), "subtotal de Motor");
  assert.ok(!all.includes("Subtotal Frenos"), "un módulo sin registros no muestra subtotal");
  assert.ok(all.includes("Menos: Total valorizaciones $300.000"), "total general = suma de subtotales");
  assert.ok(all.includes("Valor final $8.700.000"), "9.000.000 - 300.000");
});

test("tasación sin valores: total $0 y el PDF sigue siendo válido", async () => {
  const pages = await readPdf(buildTasacionPdf({ fecha: "2026-10-06", checklist: {} }, { sections: T_SECTIONS, getItems, fmt }));
  const all = pages.join(" ").replace(/\s+/g, " ");
  assert.ok(all.includes("Total valorizaciones $0"));
  assert.ok(all.includes("Sin piezas con valorización"));
});

test("tasación: las fotos no entran al PDF (ni imágenes ni peso extra)", async () => {
  const base = { fecha: "2026-10-07", vehiculo: "KIA RIO", valorComercial: 1000000, checklist: { capot: { estado: "Bueno", valor: 1000 } } };
  const conFotos = { ...base, checklist: { capot: { ...base.checklist.capot, fotos: ["f1", "f2", "f3"] }, puerta: { fotos: ["f4"] } } };
  const a = buildTasacionPdf(base, { sections: T_SECTIONS, getItems, fmt });
  const b = buildTasacionPdf(conFotos, { sections: T_SECTIONS, getItems, fmt });
  assert.equal(b.length, a.length, "el PDF con fotos pesa lo mismo que sin fotos");
  assert.ok(!Buffer.from(b).toString("latin1").includes("/Image"), "no debe haber objetos de imagen");
  const all = (await readPdf(b)).join(" ");
  assert.ok(!all.includes("f1") && !all.includes("foto"), "los ids de foto no aparecen en el texto");
});
