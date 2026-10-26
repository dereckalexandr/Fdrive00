/**
 * INFORMES PDF DE INSPECCIÓN Y TASACIÓN
 * ----------------------------------------------------------------
 * Generador de PDF propio, multipágina, sin librerías externas (igual que
 * la pre liquidación del ejecutivo, pero con saltos de página y ajuste de
 * texto). Solo usa las fuentes estándar Helvetica / Helvetica-Bold, que
 * todo visor de PDF trae incorporadas.
 *
 * Es código puro (no toca el DOM): se puede probar en Node. Los datos del
 * checklist se reciben por parámetro para no depender de App.jsx.
 * ----------------------------------------------------------------
 */

import { computeTasacionTotals, computeValorFinal } from "./tasacion-totals.js";
import { calcularCotizacion } from "../supabase/functions/api/ventas-core.js";

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 44;
const BOTTOM = 56; // deja espacio al pie de página
const CONTENT_W = PAGE_W - MARGIN * 2;

/* ---------- texto: codificación y medición ---------- */
const PDF_CHAR_MAP = { "—": 0x97, "–": 0x96, "−": 0x2d, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95 };
function sanitize(str) {
  return Array.from(String(str == null ? "" : str))
    .map((ch) => {
      const code = ch.codePointAt(0);
      if (code === 10 || code === 13 || code === 9) return " ";
      if (code <= 255) return String.fromCharCode(code);
      if (PDF_CHAR_MAP[ch] !== undefined) return String.fromCharCode(PDF_CHAR_MAP[ch]);
      return "?";
    })
    .join("");
}
const escapePdf = (s) => sanitize(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

// Anchos de Helvetica (unidades de 1/1000 em) para ASCII 32..126.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
function charWidth(ch) {
  let c = ch.normalize("NFD")[0]; // las letras con tilde miden como la letra base
  const code = c.charCodeAt(0);
  if (code >= 32 && code <= 126) return HELV[code - 32];
  return 556;
}
export function textWidth(str, size, bold = false) {
  let w = 0;
  for (const ch of String(str)) w += charWidth(ch);
  return (w / 1000) * size * (bold ? 1.07 : 1);
}

/** Parte `text` en líneas que quepan en `maxW` (rompe palabras muy largas). */
export function wrapText(text, maxW, size, bold = false) {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines = [];
  let cur = "";
  const push = () => { if (cur) lines.push(cur); cur = ""; };
  for (let word of words) {
    while (textWidth(word, size, bold) > maxW) {
      // palabra más larga que la línea: córtala por caracteres
      let cut = word.length;
      while (cut > 1 && textWidth(word.slice(0, cut), size, bold) > maxW) cut--;
      push();
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const candidate = cur ? `${cur} ${word}` : word;
    if (textWidth(candidate, size, bold) <= maxW) cur = candidate;
    else { push(); cur = word; }
  }
  push();
  return lines;
}

/* ---------- documento ---------- */
class PdfDoc {
  constructor(footerLabel) {
    this.footerLabel = footerLabel;
    this.pages = [];
    this.pageImages = []; // por página: índices de las imágenes que usa
    this.images = []; // imágenes JPEG ya leídas (ver leerJpeg)
    this.ops = null;
    this.y = 0;
    this.newPage();
  }
  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.pageImages.push(new Set());
    this.y = PAGE_H - MARGIN;
  }
  ensure(h) {
    if (this.y - h < BOTTOM) { this.newPage(); return true; }
    return false;
  }
  text(x, y, str, { size = 10, bold = false, gray = 0.1 } = {}) {
    this.ops.push(`${gray} g BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdf(str)}) Tj ET`);
  }
  rect(x, y, w, h, gray) { this.ops.push(`${gray} g ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); }
  line(x1, y1, x2, y2, gray = 0.8) { this.ops.push(`${gray} G 0.5 w ${x1} ${y1} m ${x2} ${y2} l S`); }

  gap(h) { this.y -= h; }

  /** Dibuja una imagen (de leerJpeg) dentro de la caja x,y,w,h (y = borde de abajo), sin deformarla. */
  image(img, x, y, w, h) {
    const k = Math.min(w / img.width, h / img.height);
    const dw = img.width * k, dh = img.height * k;
    let idx = this.images.indexOf(img);
    if (idx < 0) idx = this.images.push(img) - 1;
    this.pageImages[this.pageImages.length - 1].add(idx);
    this.ops.push(`q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${(x + (w - dw) / 2).toFixed(2)} ${(y + (h - dh) / 2).toFixed(2)} cm /Im${idx + 1} Do Q`);
  }

  title(main, sub) {
    this.text(MARGIN, this.y - 8, "DRIVE FUTURO", { size: 8, bold: true, gray: 0.45 });
    this.y -= 26;
    this.text(MARGIN, this.y, main, { size: 18, bold: true });
    this.y -= 18;
    if (sub) { this.text(MARGIN, this.y, sub, { size: 9, gray: 0.4 }); this.y -= 8; }
    this.line(MARGIN, this.y, PAGE_W - MARGIN, this.y, 0.6);
    this.y -= 16;
  }

  sectionBar(title) {
    this.ensure(40); // evita un título huérfano al pie de la página
    this.y -= 4;
    this.rect(MARGIN, this.y - 14, CONTENT_W, 18, 0.93);
    this.text(MARGIN + 6, this.y - 8, title, { size: 10.5, bold: true });
    this.y -= 26;
  }

  /** Pares etiqueta/valor en `cols` columnas. */
  fields(pairs, cols = 2) {
    const colW = CONTENT_W / cols;
    for (let i = 0; i < pairs.length; i += cols) {
      const row = pairs.slice(i, i + cols);
      const wrapped = row.map(([, v]) => wrapText(v || "—", colW - 10, 10));
      const h = 12 + Math.max(...wrapped.map((w) => w.length)) * 12 + 4;
      this.ensure(h);
      row.forEach(([label], c) => {
        const x = MARGIN + c * colW;
        this.text(x, this.y, label, { size: 7.5, gray: 0.5 });
        wrapped[c].forEach((ln, k) => this.text(x, this.y - 12 - k * 12, ln, { size: 10 }));
      });
      this.y -= h;
    }
  }

  paragraph(label, value) {
    const lines = wrapText(value || "—", CONTENT_W, 10);
    this.ensure(14 + 12);
    this.text(MARGIN, this.y, label, { size: 7.5, gray: 0.5 });
    this.y -= 12;
    for (const ln of lines) {
      this.ensure(12);
      this.text(MARGIN, this.y, ln, { size: 10 });
      this.y -= 12;
    }
    this.y -= 4;
  }

  /**
   * Tabla. cols: [{ title, w, align? }] (w en puntos; la suma debe ser CONTENT_W).
   * rows: arreglos de textos. Repite el encabezado al saltar de página.
   */
  table(cols, rows) {
    const drawHeader = () => {
      this.ensure(22);
      let x = MARGIN;
      for (const c of cols) {
        const tx = c.align === "right" ? x + c.w - 6 - textWidth(c.title, 7.5, true) : x + 6;
        this.text(tx, this.y - 8, c.title.toUpperCase(), { size: 7.5, bold: true, gray: 0.45 });
        x += c.w;
      }
      this.y -= 14;
      this.line(MARGIN, this.y, PAGE_W - MARGIN, this.y, 0.7);
      this.y -= 2;
    };
    drawHeader();
    for (const row of rows) {
      const wrapped = row.map((cell, i) => wrapText(cell === "" || cell == null ? "—" : cell, cols[i].w - 12, 9.5));
      const lines = Math.max(...wrapped.map((w) => w.length));
      const h = lines * 11.5 + 8;
      if (this.ensure(h)) drawHeader();
      let x = MARGIN;
      wrapped.forEach((ls, i) => {
        ls.forEach((ln, k) => {
          const c = cols[i];
          const tx = c.align === "right" ? x + c.w - 6 - textWidth(ln, 9.5) : x + 6;
          this.text(tx, this.y - 10 - k * 11.5, ln, { size: 9.5, gray: i === 0 ? 0.1 : 0.2 });
        });
        x += cols[i].w;
      });
      this.y -= h;
      this.line(MARGIN, this.y + 1, PAGE_W - MARGIN, this.y + 1, 0.9);
    }
    this.y -= 6;
  }

  /** Línea de subtotal/total con el monto alineado a la derecha. */
  totalLine(label, value, { big = false, bold = true } = {}) {
    const size = big ? 12 : 10;
    this.ensure(big ? 44 : 22);
    if (big) { this.y -= 4; this.line(MARGIN, this.y, PAGE_W - MARGIN, this.y, 0.4); this.y -= 6; }
    const base = this.y - (big ? 12 : 10);
    this.text(MARGIN + 6, base, label, { size, bold });
    this.text(PAGE_W - MARGIN - 6 - textWidth(value, size, bold), base, value, { size, bold });
    this.y -= big ? 24 : 18;
  }

  /** Devuelve el PDF como Uint8Array (bytes Latin-1). */
  build() {
    const total = this.pages.length;
    const pageContents = this.pages.map((ops, i) => {
      const footer = [
        `0.8 G 0.5 w ${MARGIN} 40 m ${PAGE_W - MARGIN} 40 l S`,
        `0.5 g BT /F1 8 Tf 1 0 0 1 ${MARGIN} 28 Tm (${escapePdf(this.footerLabel)}) Tj ET`,
        `0.5 g BT /F1 8 Tf 1 0 0 1 ${PAGE_W - MARGIN - 70} 28 Tm (${escapePdf(`Página ${i + 1} de ${total}`)}) Tj ET`,
      ];
      return [...ops, ...footer].join("\n");
    });

    // Objetos: 1 catálogo, 2 páginas, 3 Helvetica, 4 Helvetica-Bold, luego (página, contenido) por página.
    const objs = [];
    const pageObjNums = pageContents.map((_, i) => 5 + i * 2);
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objs[2] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${total} >>`;
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    const imageBase = 5 + total * 2;
    pageContents.forEach((content, i) => {
      const pn = 5 + i * 2;
      const usadas = Array.from(this.pageImages[i]);
      const xobj = usadas.length ? ` /XObject << ${usadas.map((n) => `/Im${n + 1} ${imageBase + n} 0 R`).join(" ")} >>` : "";
      objs[pn] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobj} >> /Contents ${pn + 1} 0 R >>`;
      objs[pn + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    });
    this.images.forEach((img, n) => {
      const cs = img.comps === 1 ? "/DeviceGray" : "/DeviceRGB";
      objs[imageBase + n] = `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n${img.data}\nendstream`;
    });

    let out = "%PDF-1.4\n";
    const offsets = [];
    for (let n = 1; n < objs.length; n++) {
      offsets[n] = out.length;
      out += `${n} 0 obj\n${objs[n]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let n = 1; n < objs.length; n++) out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}

/* ---------- informes ---------- */
const fechaLarga = (iso) => {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return isNaN(d) ? String(iso) : d.toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" });
};

/**
 * Informe de inspección.
 * @param record  datos guardados de la inspección
 * @param opts    { sections: CHECKLIST_SECTIONS, inspectorNombre }
 */
export function buildInspeccionPdf(record, { sections, inspectorNombre = "" }) {
  const pdf = new PdfDoc(`Informe de inspección · ${[record.marca, record.modelo].filter(Boolean).join(" ")} ${record.inscripcion || ""}`.trim());
  pdf.title("Informe de inspección", `${fechaLarga(record.fecha)}${inspectorNombre ? ` · Inspector: ${inspectorNombre}` : ""}`);

  pdf.sectionBar("Datos del vehículo");
  pdf.fields([
    ["INSCRIPCIÓN", record.inscripcion], ["AÑO", record.anio],
    ["MARCA", record.marca], ["MODELO", record.modelo],
    ["NRO MOTOR", record.nroMotor], ["NRO CHASIS", record.nroChasis],
    ["NRO SERIE", record.nroSerie], ["NRO VIN", record.nroVin],
    ["COLOR", record.color],
  ]);

  pdf.sectionBar("Datos del propietario");
  pdf.fields([["NOMBRE", record.propietarioNombre], ["R.U.N.", record.propietarioRun]]);

  const cols = [{ title: "Ítem", w: 215 }, { title: "Estado", w: 80 }, { title: "Observación", w: CONTENT_W - 295 }];
  for (const section of sections) {
    pdf.sectionBar(section.title);
    const rows = section.items.map((it) => {
      const st = (record.checklist || {})[it.id] || {};
      return [it.label, st.estado || "", st.observacion || ""];
    });
    pdf.table(cols, rows);
  }
  return pdf.build();
}

/**
 * Informe de tasación.
 * @param opts { sections: TASACION_SECTIONS, getItems(section), fmt(n) -> "$1.000", inspectorNombre }
 */
export function buildTasacionPdf(record, { sections, getItems, fmt, inspectorNombre = "" }) {
  const pdf = new PdfDoc(`Informe de tasación · ${record.vehiculo || ""} ${record.patente || ""}`.trim());
  pdf.title("Informe de tasación", `${fechaLarga(record.fecha)}${inspectorNombre ? ` · Inspector: ${inspectorNombre}` : ""}`);

  pdf.sectionBar("Datos de la tasación");
  pdf.fields([
    ["PROPIETARIO", record.propietario], ["VEHÍCULO", record.vehiculo],
    ["PATENTE", record.patente], ["AÑO", record.anio],
    ["KILOMETRAJE", record.kilometraje], ["ESTADO GENERAL", record.estadoGeneral],
  ]);
  if (record.observaciones) pdf.paragraph("OBSERVACIONES", record.observaciones);

  const checklist = record.checklist || {};
  const totals = computeTasacionTotals(checklist, sections, getItems);
  const final = computeValorFinal(record.valorComercial, totals.total);
  const cols = [{ title: "Pieza", w: 230 }, { title: "Estado", w: 120 }, { title: "Valorización", w: CONTENT_W - 350, align: "right" }];

  // Resumen: solo las piezas que tienen valorización.
  pdf.ensure(40);
  pdf.text(MARGIN, pdf.y - 6, "Resumen: se listan solo las piezas con valorización.", { size: 8.5, gray: 0.5 });
  pdf.gap(16);
  let listed = 0;
  for (const section of sections) {
    const rows = [];
    for (const it of getItems(section)) {
      const st = checklist[it.id] || {};
      const valor = Number(st.valor);
      if (!Number.isFinite(valor) || valor === 0) continue;
      const dynamic = section.type === "dynamic";
      let estado = st.estado || "";
      if (!dynamic && it.extra && st[it.extra.id]) estado = [estado, `${it.extra.label}: ${st[it.extra.id]}`].filter(Boolean).join(" · ");
      rows.push([dynamic ? (st.nombre || "(sin nombre)") : it.label, estado, fmt(valor)]);
    }
    if (rows.length === 0) continue;
    listed++;
    pdf.sectionBar(section.title);
    pdf.table(cols, rows);
    pdf.totalLine(`Subtotal ${section.title.replace(/^\d+\.\s*/, "")}`, fmt(totals.bySection[section.id]));
  }
  if (listed === 0) {
    pdf.ensure(20);
    pdf.text(MARGIN + 6, pdf.y - 4, "Sin piezas con valorización.", { size: 9.5, gray: 0.5 });
    pdf.gap(20);
  }

  // Cierre: valor comercial menos el total de valorizaciones.
  pdf.gap(8);
  pdf.ensure(120);
  pdf.sectionBar("Resumen de valorización");
  pdf.totalLine("Valor comercial estimado", fmt(final.valorComercial));
  pdf.totalLine("Menos: Total valorizaciones", fmt(final.total));
  pdf.totalLine("Valor final", fmt(final.final), { big: true });
  return pdf.build();
}

/**
 * Lee un JPEG en formato data URL ("data:image/jpeg;base64,...") y devuelve sus bytes (como texto Latin-1,
 * que es como este generador arma el PDF) y su tamaño. Devuelve null si no es un JPEG en gris o color.
 */
export function leerJpeg(dataUrl) {
  const m = /^data:image\/jpe?g;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  let bin;
  try { bin = atob(m[1]); } catch (e) { return null; }
  if (bin.charCodeAt(0) !== 0xff || bin.charCodeAt(1) !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bin.length) {
    if (bin.charCodeAt(i) !== 0xff) { i++; continue; }
    const marker = bin.charCodeAt(i + 1);
    if (marker === 0xff) { i++; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bin.charCodeAt(i + 5) << 8) | bin.charCodeAt(i + 6);
      const width = (bin.charCodeAt(i + 7) << 8) | bin.charCodeAt(i + 8);
      const comps = bin.charCodeAt(i + 9);
      if (!width || !height || (comps !== 1 && comps !== 3)) return null;
      return { data: bin, width, height, comps };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    i += 2 + ((bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3));
  }
  return null;
}

/**
 * Cotización para el cliente.
 * @param c  { numero, fecha, vigenciaHasta, cliente, vehiculo, precio_lista, descuento, parte_pago, financiamiento,
 *             notas, ejecutivo, local, condiciones, fotos: [dataUrl, ...] }
 * @param fmt  (n) -> "$1.000"
 */
export function buildCotizacionPdf(c, { fmt }) {
  const folio = `COT-${String(c.numero || 0).padStart(6, "0")}`;
  const v = c.vehiculo || {};
  const pdf = new PdfDoc(`Cotización ${folio} · ${[v.marca, v.modelo].filter(Boolean).join(" ")} · ${c.local || "Drive Futuro"}`);
  pdf.title(`Cotización ${folio}`, `${fechaLarga(c.fecha)}${c.vigenciaHasta ? ` · Válida hasta el ${fechaLarga(c.vigenciaHasta)}` : ""}`);

  const cli = c.cliente || {};
  pdf.sectionBar("Cliente");
  pdf.fields([["NOMBRE", cli.nombre], ["RUT", cli.rut], ["TELÉFONO", cli.telefono], ["CORREO", cli.email]]);

  pdf.sectionBar("Vehículo");
  pdf.fields([
    ["MARCA", v.marca], ["MODELO", [v.modelo, v.version].filter(Boolean).join(" ")],
    ["AÑO", v.anio], ["KILOMETRAJE", v.km != null ? `${Number(v.km).toLocaleString("es-CL")} km` : ""],
    ["TRANSMISIÓN", v.transmision], ["COMBUSTIBLE", v.combustible],
    ["COLOR", v.color], ["PATENTE", v.patente],
  ]);

  const fotos = (c.fotos || []).map(leerJpeg).filter(Boolean).slice(0, 2);
  if (fotos.length > 0) {
    const boxH = 165;
    pdf.ensure(boxH + 12);
    const boxW = fotos.length === 1 ? CONTENT_W : (CONTENT_W - 12) / 2;
    fotos.forEach((img, k) => pdf.image(img, MARGIN + k * (boxW + 12), pdf.y - boxH, boxW, boxH));
    pdf.y -= boxH + 12;
  }

  const calc = calcularCotizacion({ precioLista: c.precio_lista, descuento: c.descuento, parteDePago: c.parte_pago, financiamiento: c.financiamiento });
  pdf.sectionBar("Precio");
  pdf.totalLine("Precio de lista", fmt(c.precio_lista));
  if (Number(c.descuento) > 0) pdf.totalLine(`Descuento (${calc.descuentoPct.toLocaleString("es-CL")}%)`, `− ${fmt(c.descuento)}`);
  pdf.totalLine("Precio final", fmt(calc.precioFinal), { big: true });

  const pp = c.parte_pago || {};
  if (pp.tiene) {
    pdf.sectionBar("Vehículo en parte de pago");
    pdf.fields([
      ["VEHÍCULO", [pp.marca, pp.modelo].filter(Boolean).join(" ")], ["AÑO", pp.anio],
      ["KILOMETRAJE", pp.km != null ? `${Number(pp.km).toLocaleString("es-CL")} km` : ""], ["PATENTE", pp.patente],
    ]);
  }

  const fin = c.financiamiento || {};
  pdf.ensure(fin.quiere ? 260 : 150); // el resumen de pago va completo en una misma página
  pdf.sectionBar("Resumen de pago");
  pdf.totalLine("Precio final", fmt(calc.precioFinal));
  if (pp.tiene) pdf.totalLine("Menos: vehículo en parte de pago", `− ${fmt(calc.parte)}`);
  pdf.totalLine("Saldo a pagar", fmt(calc.saldo), { big: !fin.quiere });
  if (fin.quiere) {
    pdf.totalLine("Menos: pie", `− ${fmt(calc.pie)}`);
    pdf.totalLine("Monto a financiar", fmt(calc.montoFinanciar), { big: true });
    pdf.fields([
      ["PLAZO", fin.plazo_meses ? `${fin.plazo_meses} meses` : ""], ["BANCO / FINANCIERA", fin.banco],
      ["CUOTA MENSUAL ESTIMADA", calc.cuota ? fmt(calc.cuota) : ""], ["TASA MENSUAL REFERENCIAL", fin.tasa_mensual_pct ? `${fin.tasa_mensual_pct}%` : ""],
    ]);
    pdf.paragraph("AVISO", "La cuota es una estimación referencial. El monto, la tasa y las condiciones finales dependen de la evaluación de la entidad financiera.");
  }

  if (c.notas) pdf.paragraph("OBSERVACIONES", c.notas);
  if (c.condiciones) pdf.paragraph("CONDICIONES", c.condiciones);
  pdf.sectionBar("Su ejecutivo");
  pdf.fields([["NOMBRE", c.ejecutivo], ["LOCAL", c.local]]);
  return pdf.build();
}

/**
 * Nota de compra de un vehículo (se genera al concretar la compra, con todos los datos y documentos completos).
 * @param n  { folio, fecha, local, ejecutivo, aprobado_por, monto_final, medio_pago, fecha_pago, vehiculo, vendedor, permiso, revision_tecnica, soap, documentos }
 */
export function buildNotaCompraPdf(n, { fmt }) {
  const v = n.vehiculo || {};
  const pdf = new PdfDoc(`Nota de compra ${n.folio} · ${[v.marca, v.modelo].filter(Boolean).join(" ")} · ${n.local || "Drive Futuro"}`);
  pdf.title(`Nota de compra ${n.folio}`, fechaLarga(String(n.fecha || "").slice(0, 10)));
  const ven = n.vendedor || {};
  pdf.sectionBar("Vendedor");
  pdf.fields([["NOMBRE", ven.nombre], ["RUT", ven.rut], ["TELÉFONO", ven.telefono], ["CORREO", ven.email], ["DIRECCIÓN", ven.direccion], ["CUENTA CORRIENTE", ven.cuenta_corriente]]);
  pdf.sectionBar("Vehículo");
  pdf.fields([
    ["PATENTE", v.patente], ["MARCA", v.marca], ["MODELO", [v.modelo, v.version].filter(Boolean).join(" ")], ["AÑO", v.anio],
    ["KILOMETRAJE", v.km != null ? `${Number(v.km).toLocaleString("es-CL")} km` : ""], ["COLOR", v.color],
  ]);
  pdf.sectionBar("Pago");
  pdf.totalLine("Monto pagado al vendedor", fmt(n.monto_final), { big: true });
  pdf.fields([["MEDIO DE PAGO", n.medio_pago], ["FECHA DE PAGO", n.fecha_pago ? fechaLarga(String(n.fecha_pago).slice(0, 10)) : ""]]);
  const f = (d) => (d ? fechaLarga(String(d).slice(0, 10)) : "");
  pdf.sectionBar("Documentos con vencimiento");
  pdf.fields([
    ["PERMISO DE CIRCULACIÓN VENCE", f(n.permiso && n.permiso.vence_en)], ["PRECIO PAGADO DEL PERMISO", n.permiso && n.permiso.precio != null ? fmt(n.permiso.precio) : ""],
    ["REVISIÓN TÉCNICA VENCE", f(n.revision_tecnica && n.revision_tecnica.vence_en)], ["SOAP VENCE", f(n.soap && n.soap.vence_en)],
  ]);
  if ((n.documentos || []).length) pdf.paragraph("DOCUMENTOS RECIBIDOS", n.documentos.join(" · "));
  pdf.sectionBar("Compra realizada por");
  pdf.fields([["EJECUTIVO", n.ejecutivo], ["APROBADA POR", n.aprobado_por], ["LOCAL", n.local]]);
  return pdf.build();
}

/** Nombre de archivo seguro: Inspeccion_TTHY51_2026-10-06.pdf */
export function pdfFileName(prefix, record) {
  const id = String(record.inscripcion || record.patente || "").replace(/[^A-Za-z0-9]+/g, "") || "sin-patente";
  return `${prefix}_${id}_${String(record.fecha || "").slice(0, 10) || "sin-fecha"}.pdf`;
}
