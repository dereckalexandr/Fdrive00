// Prueba el autocompletado del CAV con un PDF, sin abrir la app.
// Uso:  node scripts/probar-cav.mjs "C:\ruta\al\cav.pdf" [--mostrar] [--texto]
//   --mostrar  muestra también nombre y RUN del propietario (por defecto van ocultos)
//   --texto    imprime el texto extraído línea por línea (útil si un campo no se detecta)
import { readFileSync } from "node:fs";
import { parseCavFields } from "../src/cav-fields.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) { console.error('Uso: node scripts/probar-cav.mjs "ruta.pdf" [--mostrar] [--texto]'); process.exit(1); }
const mostrar = args.includes("--mostrar");

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true }).promise;

// Misma agrupación por línea visual que extractPdfText() en src/cav-parser.js
const lines = [];
for (let i = 1; i <= pdf.numPages; i++) {
  const content = await (await pdf.getPage(i)).getTextContent();
  const items = content.items.filter((it) => typeof it.str === "string" && it.str.length > 0);
  let y = null, cur = [];
  for (const it of items) {
    const yy = Math.round(it.transform[5]);
    if (y === null || Math.abs(yy - y) > 2) { if (cur.length) lines.push(cur.join(" ")); cur = [it.str]; y = yy; }
    else cur.push(it.str);
  }
  if (cur.length) lines.push(cur.join(" "));
}
const text = lines.join("\n");

if (args.includes("--texto")) console.log(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
if (!text.trim()) { console.log("El PDF no tiene texto (¿es un escaneo?). Haría falta OCR."); process.exit(0); }

const fields = parseCavFields(text);
const oculto = new Set(["propietarioNombre", "propietarioRun"]);
const esperados = ["inscripcion", "marca", "modelo", "nroMotor", "nroChasis", "nroSerie", "nroVin", "color", "propietarioNombre", "propietarioRun"];
for (const k of esperados) {
  const v = fields[k];
  const shown = v === undefined ? "— (no detectado)" : (oculto.has(k) && !mostrar ? `[${v.length} caracteres]` : v);
  console.log(k.padEnd(18), shown);
}
console.log(`\n${Object.keys(fields).length} de ${esperados.length} campos detectados.`);
