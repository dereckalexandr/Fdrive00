/**
 * Lee una planilla subida por el usuario (cartola del banco) y la devuelve como tabla: array de filas (array de celdas).
 * Formatos: CSV o TXT (separado por ; , o tabulador), Excel .xlsx (zip con XML) y .xls que en realidad son tablas HTML
 * (así exportan varios bancos). Un .xls binario antiguo no se puede leer: se pide guardarlo como .xlsx o .csv.
 * Sin librerías externas: el .xlsx se descomprime con DecompressionStream (navegadores actuales y Node 18+).
 */

const decodificar = (bytes) => {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return new TextDecoder("windows-1252").decode(bytes); }
};

/** CSV con comillas; detecta el separador por la primera línea con datos. */
export function leerCsv(texto) {
  const t = String(texto).replace(/^﻿/, "");
  const muestra = t.split(/\r?\n/).slice(0, 20).join("\n");
  const cuenta = (c) => (muestra.match(new RegExp(c === "\t" ? "\t" : `\\${c}`, "g")) || []).length;
  const sep = [";", "\t", ","].sort((a, b) => cuenta(b) - cuenta(a))[0];
  const filas = []; let fila = []; let celda = ""; let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { celda += '"'; i++; } else if (c === '"') comillas = false; else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(celda); celda = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; fila.push(celda); filas.push(fila); fila = []; celda = ""; }
    else celda += c;
  }
  if (celda || fila.length) { fila.push(celda); filas.push(fila); }
  return filas.map((f) => f.map((x) => x.trim())).filter((f) => f.some((x) => x !== ""));
}

const entidades = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, "&");

/** Tabla HTML (los «.xls» de algunos bancos): toma la tabla con más filas. */
export function leerHtml(html) {
  const tablas = String(html).match(/<table[\s\S]*?<\/table>/gi) || [];
  let mejor = [];
  for (const tb of tablas) {
    const filas = (tb.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((tr) => (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [])
      .map((td) => entidades(td.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim()));
    if (filas.length > mejor.length) mejor = filas;
  }
  return mejor.filter((f) => f.some((x) => x !== ""));
}

/** Entradas de un zip (solo las que se piden), descomprimidas. */
async function leerZip(buf, quiere) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error("planilla_ilegible");
  const total = dv.getUint16(fin + 10, true);
  let p = dv.getUint32(fin + 16, true);
  const out = {};
  for (let k = 0; k < total; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true);
    const tamC = dv.getUint32(p + 20, true);
    const nLen = dv.getUint16(p + 28, true); const xLen = dv.getUint16(p + 30, true); const cLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const nombre = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nLen));
    p += 46 + nLen + xLen + cLen;
    if (!quiere(nombre)) continue;
    const ini = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const datos = buf.subarray(ini, ini + tamC);
    if (metodo === 0) out[nombre] = new TextDecoder().decode(datos);
    else if (metodo === 8) {
      const ds = new Blob([datos]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      out[nombre] = await new Response(ds).text();
    }
  }
  return out;
}

const textoXml = (frag) => entidades((String(frag).match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<t[^>]*>|<\/t>/g, "")).join(""));
const columnaANumero = (ref) => { const l = /^[A-Z]+/.exec(ref)[0]; let n = 0; for (const c of l) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };

/** Excel .xlsx: la primera hoja. Números como número (las fechas quedan como número de serie de Excel). */
export async function leerXlsx(bytes) {
  const z = await leerZip(bytes, (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n) || n === "xl/workbook.xml");
  const hojas = Object.keys(z).filter((n) => n.startsWith("xl/worksheets/")).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
  if (!hojas.length) throw new Error("planilla_ilegible");
  const compartidos = ((z["xl/sharedStrings.xml"] || "").match(/<si>[\s\S]*?<\/si>/g) || []).map(textoXml);
  const xml = z[hojas[0]];
  const filas = [];
  for (const fila of xml.match(/<row[^>]*>[\s\S]*?<\/row>|<row[^>]*\/>/g) || []) {
    const celdas = [];
    for (const c of fila.match(/<c\s[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const ref = (/\sr="([A-Z]+)\d+"/.exec(c) || [])[1];
      const tipo = (/\st="([^"]+)"/.exec(c) || [])[1];
      const v = (/<v>([\s\S]*?)<\/v>/.exec(c) || [])[1];
      let valor = "";
      if (tipo === "s") valor = compartidos[Number(v)] ?? "";
      else if (tipo === "inlineStr") valor = textoXml(c);
      else if (tipo === "str" || tipo === "b" || tipo === "e") valor = entidades(v ?? "");
      else if (v !== undefined) valor = Number(v);
      const col = ref ? columnaANumero(ref) : celdas.length;
      while (celdas.length < col) celdas.push("");
      celdas[col] = valor;
    }
    filas.push(celdas);
  }
  return filas.filter((f) => f.some((x) => x !== "" && x !== undefined));
}

/** Lee el archivo según su contenido (no solo la extensión). */
export async function leerPlanilla(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return leerXlsx(bytes); // «PK»: zip (xlsx)
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error("planilla_xls_antiguo"); // Excel 97-2003 binario
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) throw new Error("planilla_pdf");
  const texto = decodificar(bytes);
  if (/<table/i.test(texto.slice(0, 20000))) return leerHtml(texto);
  return leerCsv(texto);
}
