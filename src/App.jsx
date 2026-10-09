import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { extractPdfText, parseCavFields } from "./cav-parser.js";
import { buildInspeccionPdf, buildTasacionPdf, pdfFileName } from "./pdf-report.js";
import { saveDraft, loadDraft, clearDraft, isMeaningful } from "./drafts.js";
import { computeTasacionTotals, computeValorFinal } from "./tasacion-totals.js";
import { normalizePatente, isPatenteValida, splitModeloVersion, parseKm, calcularFiltros, buildChileautosUrl, parseAvisosPegados, estimarCompra, parseDatosPatente, TRANSMISIONES, COMBUSTIBLES, MARGENES_BRUTOS, MARGEN_BRUTO_DEFECTO } from "./compra-calc.js";
import { buildBookmarkletHref } from "./chileautos-bookmarklet.js";
import { buildPatenteBookmarkletHref } from "./patente-bookmarklet.js";
import { photoKey, photoPrefix, makePhotoId, compressImage, collectPhotoIds, diffIds, MAX_PHOTOS_PER_ITEM, MAX_PHOTOS_PER_TASACION } from "./photos.js";

/* =========================================================
   TRAMOS Y CÁLCULOS
========================================================= */
const TIERS_COMPRAS = [
  { min: 1, max: 5, rate: 100000, label: "1 a 5" },
  { min: 6, max: Infinity, rate: 200000, label: "6 o más" },
];
const TIERS_VENTAS = [
  { min: 1, max: 3, rate: 75000, label: "1 a 3" },
  { min: 4, max: 10, rate: 90000, label: "4 a 10" },
  { min: 11, max: Infinity, rate: 110000, label: "11 o más" },
];
const TIERS_SEGUROS = [
  { min: 1, max: 3, rate: 35000, label: "1 a 3" },
  { min: 4, max: 10, rate: 50000, label: "4 a 10" },
  { min: 11, max: Infinity, rate: 65000, label: "11 o más" },
];
const TIERS_CREDITOS = [
  { min: 1, max: 3, rate: 0.15, label: "1 a 3" },
  { min: 4, max: 6, rate: 0.25, label: "4 a 6" },
  { min: 7, max: Infinity, rate: 0.28, label: "7 o más" },
];
const TIERS_CONSIGNACIONES = [
  { min: 1, max: 3, rate: 0.15, label: "1 a 3" },
  { min: 4, max: 8, rate: 0.2, label: "4 a 8" },
  { min: 9, max: Infinity, rate: 0.25, label: "9 o más" },
];
const FINANCIERAS = ["Autofin", "BK", "Global", "Dily", "Otros"];
const N_FILAS = 15;
const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const MESES_LARGO = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const monthLabel = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MESES_LARGO[m - 1] || ""} ${y}`;
};

/* =========================================================
   GENERADOR DE PDF PROPIO (sin librerías externas, sin CDN)
   Construye el archivo PDF byte a byte para evitar los bloqueos
   del sandbox de artifacts frente a scripts externos.
========================================================= */
const PDF_CHAR_MAP = { "\u2014": 0x97, "\u2013": 0x96, "\u2212": 0x2d, "\u2018": 0x91, "\u2019": 0x92, "\u201C": 0x93, "\u201D": 0x94, "\u2022": 0x95 };
function pdfSanitizeText(str) {
  return Array.from(String(str == null ? "" : str))
    .map((ch) => {
      const code = ch.codePointAt(0);
      if (code <= 255) return String.fromCharCode(code);
      if (PDF_CHAR_MAP[ch] !== undefined) return String.fromCharCode(PDF_CHAR_MAP[ch]);
      return "?";
    })
    .join("");
}
function pdfEscape(str) {
  return pdfSanitizeText(str).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
function pdfDashes(widthPt, size = 10) {
  return "-".repeat(Math.max(1, Math.floor(widthPt / (size * 0.6))));
}
function buildSimplePdf(lines) {
  const ops = ["BT"];
  let curFont = null, curSize = null;
  lines.forEach((l) => {
    if (l.font !== curFont || l.size !== curSize) {
      ops.push(`/${l.font} ${l.size} Tf`);
      curFont = l.font; curSize = l.size;
    }
    ops.push(`1 0 0 1 ${l.x} ${l.y} Tm`);
    ops.push(`(${pdfEscape(l.text)}) Tj`);
  });
  ops.push("ET");
  const contentStream = ops.join("\n");

  const objects = {};
  objects[1] = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  objects[2] = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
  objects[3] = "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>\nendobj\n";
  objects[4] = `4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`;
  objects[5] = "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n";
  objects[6] = "6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n";
  objects[7] = "7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>\nendobj\n";

  let body = "%PDF-1.4\n";
  const offsets = {};
  for (let i = 1; i <= 7; i++) { offsets[i] = body.length; body += objects[i]; }
  const xrefStart = body.length;
  let xref = "xref\n0 8\n0000000000 65535 f \n";
  for (let i = 1; i <= 7; i++) { xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`; }
  const trailer = `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  const full = body + xref + trailer;

  const bytes = new Uint8Array(full.length);
  for (let i = 0; i < full.length; i++) bytes[i] = full.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: "application/pdf" });
}

function buildPreLiquidacionPdf({ vendor, ym, totals, record, liquido, afpList = [], ufValor = DEFAULT_UF_VALOR }) {
  const periodoLabel = monthLabel(ym);
  const fechaGeneracion = new Date().toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" });
  const breakdown = [
    { label: `Compras de vehículos (${record.comprasN || 0})`, value: clp(totals.compras) },
    { label: `Ventas (${record.ventasN || 0})`, value: clp(totals.ventas) },
    { label: `Seguros (${record.segurosN || 0})`, value: clp(totals.seguros) },
    { label: `Créditos (${record.creditosN || 0})`, value: clp(totals.creditos) },
    { label: `Consignaciones (${record.consigN || 0})`, value: clp(totals.consignaciones) },
    { label: `Inspecciones (${record.inspeccionesN || 0})`, value: clp(totals.inspecciones || 0) },
  ];
  const totalHaberes = totals.total + toNum(record.sueldoBase) + toNum(record.semanaCorrida) + toNum(record.bonosImponibles) + gratificacionValor(record.sueldoBase, record.gratificacionActiva);
  const afpNombre = (afpList.find((a) => a.id === record.afpId) || {}).nombre || "Sin AFP";
  const afpComisionPct = getAfpTotalPct(afpList, record.afpId);
  const afpComisionValor = calcAfpComisionValor(afpList, record.afpId, totalHaberes);
  const usaIsapre = record.tipoSalud === "isapre";
  const saludValor = calcSaludValor(record.tipoSalud, record.isapreUF, ufValor, totalHaberes);
  const apvValor = calcIsapreValor(record.descuentosLiquidacion, ufValor);
  const totalDescuento = apvValor + toNum(record.impuestos) + afpComisionValor + saludValor;
  const haberesRows = [
    { label: "Producción", value: clp(totals.total) },
    { label: "Sueldo base ($553.553) período 2026", value: clp(record.sueldoBase) },
    { label: "Semana Corrida", value: clp(record.semanaCorrida) },
    { label: "Bonos Imponibles", value: clp(record.bonosImponibles) },
    { label: record.gratificacionActiva === false ? "Gratificación (desactivada)" : "Gratificación", value: clp(gratificacionValor(record.sueldoBase, record.gratificacionActiva)) },
  ];
  const descuentoRows = [
    { label: `Comisión AFP (${afpNombre}, ${afpComisionPct}%)`, value: clp(afpComisionValor) },
    { label: usaIsapre ? "Descuento Salud (Isapre)" : "Descuento Salud (Fonasa 7%)", value: clp(saludValor) },
    { label: "APV en UF", value: `${toNum(record.descuentosLiquidacion)} UF = ${clp(apvValor)}` },
    { label: "Impuestos", value: clp(record.impuestos) },
  ];

  const MARGIN_L = 50, VALUE_X = 340, LINE_H = 16;
  const lines = [];
  let y = 780;
  const put = (x, text, font, size) => lines.push({ x, y, text, font, size });

  put(MARGIN_L, "Informe de Pre Liquidación", "F2", 16); y -= 26;
  put(MARGIN_L, vendor.nombre, "F2", 12); y -= 18;
  put(MARGIN_L, `RUT: ${vendor.rut}`, "F1", 10); y -= 14;
  put(MARGIN_L, `Período: ${periodoLabel}`, "F1", 10); y -= 14;
  put(MARGIN_L, `Fecha de generación: ${fechaGeneracion}`, "F1", 10); y -= 26;

  put(MARGIN_L, "Resumen de producción del mes", "F2", 12); y -= 18;
  breakdown.forEach((b) => {
    put(MARGIN_L, b.label, "F1", 10);
    put(VALUE_X, b.value, "F1", 10);
    y -= LINE_H;
  });
  put(MARGIN_L, pdfDashes(495), "F3", 10); y -= LINE_H;
  put(MARGIN_L, "Total producción", "F2", 10);
  put(VALUE_X, clp(totals.total), "F2", 10); y -= 28;

  put(MARGIN_L, "Pre Liquidación", "F2", 12); y -= 18;
  put(MARGIN_L, "Días trabajados", "F1", 10);
  put(VALUE_X, record.diasTrabajados || "-", "F1", 10); y -= LINE_H + 4;

  put(MARGIN_L, "Haberes", "F2", 11); y -= LINE_H;
  haberesRows.forEach((r) => {
    put(MARGIN_L, r.label, "F1", 10);
    put(VALUE_X, r.value, "F1", 10);
    y -= LINE_H;
  });
  put(MARGIN_L, pdfDashes(495), "F3", 10); y -= LINE_H;
  put(MARGIN_L, "Total Haberes", "F2", 10);
  put(VALUE_X, clp(totalHaberes), "F2", 10); y -= LINE_H + 6;

  put(MARGIN_L, "Descuento", "F2", 11); y -= LINE_H;
  descuentoRows.forEach((r) => {
    put(MARGIN_L, r.label, "F1", 10);
    put(VALUE_X, r.value, "F1", 10);
    y -= LINE_H;
  });
  put(MARGIN_L, "Los impuestos legales deben ser verificados en la liquidación final junto a contabilidad.", "F1", 8); y -= LINE_H;
  put(MARGIN_L, pdfDashes(495), "F3", 10); y -= LINE_H;
  put(MARGIN_L, "Total Descuento", "F2", 10);
  put(VALUE_X, clp(totalDescuento), "F2", 10); y -= LINE_H + 6;

  put(MARGIN_L, "Anticipos", "F1", 10);
  put(VALUE_X, `-${clp(record.anticipos)}`, "F1", 10); y -= LINE_H + 6;

  put(MARGIN_L, pdfDashes(495), "F3", 10); y -= 22;
  put(MARGIN_L, "Líquido a pago", "F2", 14);
  put(VALUE_X, clp(liquido), "F2", 14); y -= 22;

  put(MARGIN_L, "El monto para los descuentos de salud y de AFP pueden variar, debido a la UF.", "F1", 8); y -= 12;
  put(MARGIN_L, "Se recomienda generar la pre liquidación el mismo día del pago de remuneración.", "F1", 8);

  return buildSimplePdf(lines);
}

/* --- Tramos personalizados: solo para el ejecutivo Dereck Rodríguez (RUT 16610963-9) --- */
const TIERS_COMPRAS_DERECK = [
  { min: 1, max: 10, rate: 200000, label: "1 a 10" },
  { min: 11, max: Infinity, rate: 210000, label: "11 o más" },
];
const TIERS_VENTAS_DERECK = [
  { min: 1, max: 10, rate: 100000, label: "1 a 10" },
  { min: 11, max: Infinity, rate: 110000, label: "11 o más" },
];
const TIERS_SEGUROS_DERECK = [
  { min: 1, max: 10, rate: 50000, label: "1 a 10" },
  { min: 11, max: Infinity, rate: 55000, label: "11 o más" },
];
const TIERS_CONSIGNACIONES_DERECK = [
  { min: 1, max: 10, rate: 0.25, label: "1 a 10" },
  { min: 11, max: Infinity, rate: 0.3, label: "11 o más" },
];
const TIERS_CREDITOS_DERECK = [
  { min: 1, max: 3, rate: 0.2, label: "1 a 3" },
  { min: 4, max: 6, rate: 0.25, label: "4 a 6" },
  { min: 7, max: Infinity, rate: 0.28, label: "7 o más" },
];
const TIERS_INSPECCIONES_DERECK = [
  { min: 1, max: 10, rate: 35000, label: "1 a 10" },
];
const normalizeRut = (rut) => (rut || "").replace(/[.\s]/g, "").toUpperCase();
const CUSTOM_RUT = normalizeRut("16610963-9");

function hasCustomTiers(vendor) {
  return !!vendor && normalizeRut(vendor.rut) === CUSTOM_RUT;
}

function resolveTiers(vendor) {
  const custom = (vendor && vendor.tramos) || {};
  const pick = (key, fallback) => (custom[key] && custom[key].length > 0 ? custom[key] : fallback);
  if (hasCustomTiers(vendor)) {
    return {
      compras: pick("compras", TIERS_COMPRAS_DERECK),
      ventas: pick("ventas", TIERS_VENTAS_DERECK),
      seguros: pick("seguros", TIERS_SEGUROS_DERECK),
      creditos: pick("creditos", TIERS_CREDITOS_DERECK),
      consignaciones: pick("consignaciones", TIERS_CONSIGNACIONES_DERECK),
      inspecciones: pick("inspecciones", TIERS_INSPECCIONES_DERECK),
    };
  }
  return {
    compras: pick("compras", TIERS_COMPRAS),
    ventas: pick("ventas", TIERS_VENTAS),
    seguros: pick("seguros", TIERS_SEGUROS),
    creditos: pick("creditos", TIERS_CREDITOS),
    consignaciones: pick("consignaciones", TIERS_CONSIGNACIONES),
    inspecciones: pick("inspecciones", TIERS_INSPECCIONES_DERECK),
  };
}
const DEFAULT_TIERS = resolveTiers(null);

/* --- Módulos activables por ejecutivo (definidos al crear el perfil) --- */
const MODULE_DEFS = [
  { key: "compras", label: "Compra de vehículos", tipo: "monto", unidad: "$ por unidad" },
  { key: "ventas", label: "Ventas", tipo: "monto", unidad: "$ por unidad" },
  { key: "seguros", label: "Seguros", tipo: "monto", unidad: "$ por unidad" },
  { key: "creditos", label: "Créditos", tipo: "porcentaje", unidad: "% sobre comisión" },
  { key: "consignaciones", label: "Consignaciones", tipo: "porcentaje", unidad: "% sobre margen" },
  { key: "inspecciones", label: "Inspecciones", tipo: "monto", unidad: "$ por unidad" },
];
function isModuleEnabled(vendor, key) {
  if (vendor && Array.isArray(vendor.modules)) return vendor.modules.includes(key);
  // Perfiles creados antes de este sistema: mantienen su comportamiento original.
  if (key === "inspecciones") return hasCustomTiers(vendor);
  return true;
}
function emptyModuleConfig() {
  return Object.fromEntries(MODULE_DEFS.map((m) => [m.key, { enabled: false, tramos: [] }]));
}
// tramos crudos del formulario: [{ desde, hasta, valor }] -> formato { min, max, rate, label } usado por resolveTiers
function normalizeTramos(rawTramos, tipo) {
  return rawTramos
    .filter((t) => String(t.desde).trim() !== "" && String(t.valor).trim() !== "")
    .map((t) => {
      const min = parseInt(t.desde, 10) || 1;
      const hasHasta = String(t.hasta).trim() !== "";
      const max = hasHasta ? parseInt(t.hasta, 10) : Infinity;
      const valorNum = toNum(t.valor);
      const rate = tipo === "porcentaje" ? valorNum / 100 : valorNum;
      const label = hasHasta ? `${min} a ${max}` : `${min} o más`;
      return { min, max, rate, label };
    })
    .sort((a, b) => a.min - b.min);
}

function getTier(n, tiers) {
  if (!n || n <= 0) return null;
  return tiers.find((t) => n >= t.min && n <= t.max) || tiers[tiers.length - 1];
}
const clp = (n) =>
  (n || 0).toLocaleString("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const toNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const calcGratificacion = (sueldoBase) => Math.round(toNum(sueldoBase) * 0.25);
const gratificacionValor = (sueldoBase, activa) => (activa === false ? 0 : calcGratificacion(sueldoBase));
const AFP_PORCENTAJE_BASE = 10;
function getAfpComisionPct(afpList, afpId) {
  const afp = (afpList || []).find((a) => a.id === afpId);
  return afp ? toNum(afp.comision) : 0;
}
function getAfpTotalPct(afpList, afpId) {
  const afp = (afpList || []).find((a) => a.id === afpId);
  return afp ? AFP_PORCENTAJE_BASE + toNum(afp.comision) : 0;
}
const calcAfpComisionValor = (afpList, afpId, totalHaberes) => Math.round((totalHaberes * getAfpTotalPct(afpList, afpId)) / 100);
const FONASA_PCT = 7;
const MARGEN_NETO_PCT = 0.25;
const calcFonasaValor = (totalHaberes) => Math.round((totalHaberes * FONASA_PCT) / 100);
const calcIsapreValor = (isapreUF, ufValor) => Math.round(toNum(isapreUF) * toNum(ufValor));
const calcSaludValor = (tipoSalud, isapreUF, ufValor, totalHaberes) =>
  tipoSalud === "isapre" ? calcIsapreValor(isapreUF, ufValor) : calcFonasaValor(totalHaberes);
const pad2 = (n) => String(n).padStart(2, "0");
const currentYM = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const currentYear = () => new Date().getFullYear();

function emptyRecord() {
  return {
    comprasN: 0,
    ventasN: 0,
    segurosN: 0,
    creditosN: 0,
    creditosRows: Array.from({ length: N_FILAS }, () => ({ financiera: "", comision: 0 })),
    consigN: 0,
    consigRows: Array.from({ length: N_FILAS }, () => ({ cliente: "", precioVenta: 0, precioPiso: 0, descuentos: 0 })),
    inspeccionesN: 0,
    sueldoBase: 553553,
    diasTrabajados: "30",
    semanaCorrida: 0,
    bonosImponibles: 0,
    gratificacionActiva: true,
    anticipos: 0,
    descuentosLiquidacion: 0,
    impuestos: 0,
    afpId: "",
    tipoSalud: "fonasa",
    isapreUF: 0,
  };
}

function computeTotals(record, tierSet = DEFAULT_TIERS) {
  const compras = record.comprasN * (getTier(record.comprasN, tierSet.compras)?.rate || 0);
  const ventas = record.ventasN * (getTier(record.ventasN, tierSet.ventas)?.rate || 0);
  const seguros = record.segurosN * (getTier(record.segurosN, tierSet.seguros)?.rate || 0);
  const sumaComisiones = record.creditosRows.reduce((a, r) => a + toNum(r.comision), 0);
  const creditos = sumaComisiones * (getTier(record.creditosN, tierSet.creditos)?.rate || 0);
  const margenesBrutos = record.consigRows.map(
    (r) => toNum(r.precioVenta) - toNum(r.precioPiso) - toNum(r.descuentos)
  );
  const margenesNetos = margenesBrutos.map((m) => Math.round(m * MARGEN_NETO_PCT));
  const sumaMargenBruto = margenesBrutos.reduce((a, b) => a + b, 0);
  const sumaMargenNeto = margenesNetos.reduce((a, b) => a + b, 0);
  const consignaciones = sumaMargenNeto;
  const inspecciones = (record.inspeccionesN || 0) * (getTier(record.inspeccionesN, tierSet.inspecciones)?.rate || 0);
  return {
    compras, ventas, seguros, creditos, consignaciones, inspecciones,
    sumaComisiones, sumaMargenBruto, sumaMargenNeto,
    total: compras + ventas + seguros + creditos + consignaciones + inspecciones,
  };
}

/* =========================================================
   PERSISTENCIA (window.storage — compartida entre admin y ejecutivos)
========================================================= */
const DEFAULT_AFP_LIST = [
  { id: "uno", nombre: "AFP Uno", comision: 0.46 },
  { id: "modelo", nombre: "AFP Modelo", comision: 0.58 },
  { id: "planvital", nombre: "AFP PlanVital", comision: 1.16 },
  { id: "habitat", nombre: "AFP Habitat", comision: 1.27 },
  { id: "capital", nombre: "AFP Capital", comision: 1.44 },
  { id: "cuprum", nombre: "AFP Cuprum", comision: 1.44 },
  { id: "provida", nombre: "AFP ProVida", comision: 1.45 },
];
async function loadAfpList() {
  try {
    const res = await window.storage.get("afp_config", true);
    return res ? JSON.parse(res.value) : DEFAULT_AFP_LIST;
  } catch (e) { return DEFAULT_AFP_LIST; }
}
async function saveAfpList(list) {
  try { await window.storage.set("afp_config", JSON.stringify(list), true); return true; }
  catch (e) { return false; }
}
const DEFAULT_UF_VALOR = 39000;
async function loadUfValor() {
  try {
    const res = await window.storage.get("uf_valor", true);
    return res ? JSON.parse(res.value) : DEFAULT_UF_VALOR;
  } catch (e) { return DEFAULT_UF_VALOR; }
}
async function saveUfValor(valor) {
  try { await window.storage.set("uf_valor", JSON.stringify(valor), true); return true; }
  catch (e) { return false; }
}

/* --- Autenticación del administrador ---
   La validación vive en la Edge Function (supabase/functions/api); aquí solo
   queda la regla de formato para la clave adicional. */
function isValidAdminPassword(pw) {
  return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{8,}$/.test(pw || "");
}
function authErrorMessage(e, fallback) {
  const m = e && e.message;
  if (m === "too_many_attempts") return "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
  if (m === "server_not_configured") return "El servidor de acceso no está configurado.";
  return fallback;
}

async function loadVendors() {
  try {
    const res = await window.storage.get("vendors", true);
    return res ? JSON.parse(res.value) : [];
  } catch (e) { return []; }
}
async function saveVendors(vendors) {
  try { await window.storage.set("vendors", JSON.stringify(vendors), true); } catch (e) {}
}
async function loadRecord(vendorId, ym) {
  try {
    const res = await window.storage.get(`record::${vendorId}::${ym}`, true);
    return res ? JSON.parse(res.value) : emptyRecord();
  } catch (e) { return emptyRecord(); }
}
async function saveRecord(vendorId, ym, record) {
  try { await window.storage.set(`record::${vendorId}::${ym}`, JSON.stringify(record), true); return true; }
  catch (e) { return false; }
}
async function deleteVendorEverywhere(vendorId, vendors) {
  const next = vendors.filter((v) => v.id !== vendorId);
  await saveVendors(next);
  try {
    const listRes = await window.storage.list(`record::${vendorId}::`, true);
    if (listRes && listRes.keys) {
      for (const k of listRes.keys) { try { await window.storage.delete(k, true); } catch (e) {} }
    }
  } catch (e) {}
  return next;
}
function genId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin caracteres ambiguos
  const rnd = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(rnd, (n) => chars[n % chars.length]).join("");
}
function getProfileLink(vendorId) {
  try {
    const base = window.location.href.split("?")[0];
    return `${base}?vendor=${vendorId}`;
  } catch (e) { return `?vendor=${vendorId}`; }
}
function getInspectorLink(inspectorId) {
  try {
    const base = window.location.href.split("?")[0];
    return `${base}?inspector=${inspectorId}`;
  } catch (e) { return `?inspector=${inspectorId}`; }
}

/* --- Inspectores --- */
async function loadInspectors() {
  try {
    const res = await window.storage.get("inspectors", true);
    return res ? JSON.parse(res.value) : [];
  } catch (e) { return []; }
}
async function saveInspectors(inspectors) {
  try { await window.storage.set("inspectors", JSON.stringify(inspectors), true); } catch (e) {}
}
async function saveInspeccion(inspectorId, id, data) {
  try { await window.storage.set(`inspeccion::${inspectorId}::${id}`, JSON.stringify(data), true); return true; }
  catch (e) { return false; }
}
async function loadInspeccionesFor(inspectorId) {
  try {
    const listRes = await window.storage.list(`inspeccion::${inspectorId}::`, true);
    if (!listRes || !listRes.keys) return [];
    const out = [];
    for (const k of listRes.keys) {
      try { const res = await window.storage.get(k, true); if (res) out.push({ id: k, data: JSON.parse(res.value) }); } catch (e) {}
    }
    out.sort((a, b) => (b.data.guardadoEl || "").localeCompare(a.data.guardadoEl || ""));
    return out;
  } catch (e) { return []; }
}
async function loadAllInspecciones() {
  try {
    const listRes = await window.storage.list("inspeccion::", true);
    if (!listRes || !listRes.keys) return [];
    const out = [];
    for (const k of listRes.keys) {
      try { const res = await window.storage.get(k, true); if (res) out.push({ id: k, data: JSON.parse(res.value) }); } catch (e) {}
    }
    out.sort((a, b) => (b.data.guardadoEl || "").localeCompare(a.data.guardadoEl || ""));
    return out;
  } catch (e) { return []; }
}
async function saveTasacion(inspectorId, id, data) {
  try { await window.storage.set(`tasacion::${inspectorId}::${id}`, JSON.stringify(data), true); return true; }
  catch (e) { return false; }
}
async function deleteInspeccion(key) {
  try { return await window.storage.delete(key, true); } catch (e) { return null; }
}
async function deleteTasacion(key) {
  try { return await window.storage.delete(key, true); } catch (e) { return null; }
}
async function loadTasacionesFor(inspectorId) {
  try {
    const listRes = await window.storage.list(`tasacion::${inspectorId}::`, true);
    if (!listRes || !listRes.keys) return [];
    const out = [];
    for (const k of listRes.keys) {
      try { const res = await window.storage.get(k, true); if (res) out.push({ id: k, data: JSON.parse(res.value) }); } catch (e) {}
    }
    out.sort((a, b) => (b.data.guardadoEl || "").localeCompare(a.data.guardadoEl || ""));
    return out;
  } catch (e) { return []; }
}
async function loadAllTasaciones() {
  try {
    const listRes = await window.storage.list("tasacion::", true);
    if (!listRes || !listRes.keys) return [];
    const out = [];
    for (const k of listRes.keys) {
      try { const res = await window.storage.get(k, true); if (res) out.push({ id: k, data: JSON.parse(res.value) }); } catch (e) {}
    }
    out.sort((a, b) => (b.data.guardadoEl || "").localeCompare(a.data.guardadoEl || ""));
    return out;
  } catch (e) { return []; }
}
async function deleteInspectorEverywhere(inspectorId, inspectors) {
  const next = inspectors.filter((i) => i.id !== inspectorId);
  await saveInspectors(next);
  try {
    const listRes = await window.storage.list(`inspeccion::${inspectorId}::`, true);
    if (listRes && listRes.keys) {
      for (const k of listRes.keys) { try { await window.storage.delete(k, true); } catch (e) {} }
    }
  } catch (e) {}
  try {
    const listRes2 = await window.storage.list(`tasacion::${inspectorId}::`, true);
    if (listRes2 && listRes2.keys) {
      for (const k of listRes2.keys) { try { await window.storage.delete(k, true); } catch (e) {} }
    }
  } catch (e) {}
  try {
    const listRes3 = await window.storage.list(photoPrefix(inspectorId), true); // fotos de sus tasaciones
    if (listRes3 && listRes3.keys) {
      for (const k of listRes3.keys) { try { await window.storage.delete(k, true); } catch (e) {} }
    }
  } catch (e) {}
  return next;
}

/* --- Checklist de inspección: agregar aquí nuevas secciones/ítems a futuro --- */
const CHECKLIST_SECTIONS = [
  {
    id: "motor",
    title: "1. Motor y accesorios",
    items: [
      { id: "ruidos_anormales", label: "Ruidos anormales" },
      { id: "fugas_aceite", label: "Fugas de aceite" },
      { id: "fugas_aire", label: "Fugas de aire" },
      { id: "fugas_agua", label: "Fugas de agua" },
      { id: "fugas_bencina", label: "Fugas de bencina" },
      { id: "fugas_liquidos", label: "Fugas de líquidos" },
      { id: "necesita_afinamiento", label: "Necesita afinamiento" },
      { id: "estado_bateria", label: "Estado de la batería" },
      { id: "estado_alternador", label: "Estado del alternador" },
      { id: "estado_bobina", label: "Estado de bobina" },
      { id: "estado_distribucion", label: "Estado de distribución" },
      { id: "estado_cables", label: "Estado de cables" },
      { id: "estado_correas", label: "Estado de correas" },
      { id: "estado_sistema_cargas", label: "Estado sistema cargas" },
      { id: "estado_sistema_refrigerante", label: "Estado sistema refrigerante" },
      { id: "estado_general_motor", label: "Estado general motor" },
    ],
  },
  {
    id: "transmision",
    title: "2. Transmisión",
    items: [
      { id: "estado_caja_mecanica", label: "Estado caja mecánica" },
      { id: "estado_embrague", label: "Estado de embrague" },
      { id: "estado_caja_automatica", label: "Estado caja automática" },
      { id: "estado_homocineticas", label: "Estado Homocinéticas" },
      { id: "estado_llantas", label: "Estado de llantas" },
      { id: "estado_neumaticos", label: "Estado neumáticos" },
    ],
  },
  {
    id: "chasis",
    title: "3. Chasis",
    items: [
      { id: "sistema_frenos", label: "Sistema de frenos" },
      { id: "sistema_direccion", label: "Sistema de dirección" },
      { id: "sistema_suspension", label: "Sistema de suspensión" },
    ],
  },
  {
    id: "sistema_electrico",
    title: "4. Sistema eléctrico",
    items: [
      { id: "estado_luces", label: "Estado de luces" },
      { id: "estado_bocina", label: "Estado de bocina" },
      { id: "estado_limpia_parabrisas", label: "Estado limpia parabrisas" },
      { id: "estado_instrumentos", label: "Estado instrumentos" },
      { id: "estado_radio", label: "Estado radio" },
      { id: "estado_calefaccion_defrost", label: "Estado Calefacción y defrost" },
    ],
  },
  {
    id: "carroceria",
    title: "5. Carrocería",
    items: [
      { id: "tablero_instrumentos", label: "Tablero instrumentos" },
      { id: "tapiceria", label: "Tapicería" },
      { id: "frente_vehiculo", label: "Frente vehículo" },
      { id: "costado_piloto", label: "Costado piloto" },
      { id: "costado_copiloto", label: "Costado copiloto" },
      { id: "posterior_vehiculo", label: "Posterior vehículo" },
      { id: "parabrisas_carroceria", label: "Parabrisas" },
      { id: "vidrios_general", label: "Vidrios general" },
    ],
  },
  {
    id: "datos_identificacion",
    title: "6. Datos de identificación",
    items: [
      { id: "vin_corresponde_padron_chasis", label: "Número de VIN corresponde en padrón y chasis" },
      { id: "motor_corresponde_padron_motor", label: "Número de motor corresponde en padrón y motor" },
    ],
  },
];
function emptyInspeccion() {
  return {
    cavFileName: "",
    cavFileData: "",
    fecha: new Date().toISOString().slice(0, 10),
    inscripcion: "",
    anio: "",
    marca: "",
    modelo: "",
    nroMotor: "",
    nroChasis: "",
    nroSerie: "",
    nroVin: "",
    color: "",
    propietarioNombre: "",
    propietarioRun: "",
    checklist: {},
  };
}

/* --- Tasaciones --- */
function emptyTasacion() {
  return {
    propietario: "",
    fecha: new Date().toISOString().slice(0, 10),
    vehiculo: "",
    patente: "",
    anio: "",
    kilometraje: "",
    valorComercial: 0,
    estadoGeneral: "",
    observaciones: "",
    inspeccionId: "",
    checklist: {},
  };
}

const ESTADOS_DOCUMENTO = ["Al día", "Atrasado"];
const ESTADOS_SI_NO = ["Sí", "No"];
const ESTADOS_CARROCERIA = ["Bueno", "Reparado", "Dañado", "Repintado", "Rayado", "Piquete", "Abollado"];
const ESTADOS_INTERIOR = ["Bueno", "Regular", "Dañado", "No aplica"];
const ESTADOS_VIDRIO = ["Vidrio original", "No original"];

/* --- Checklist de tasación: agregar aquí nuevas secciones/ítems a futuro --- */
const TASACION_SECTIONS = [
  {
    id: "carroceria",
    title: "1. Carrocería",
    type: "fixed",
    estadoOptions: ESTADOS_CARROCERIA,
    items: [
      { id: "parabrisas", label: "Parabrisas" },
      { id: "capot", label: "Capot" },
      { id: "mascara", label: "Máscara" },
      { id: "foco_delantero_derecho", label: "Foco delantero derecho" },
      { id: "foco_delantero_izquierdo", label: "Foco delantero izquierdo" },
      { id: "frente", label: "Frente" },
      { id: "parachoques_delantero", label: "Parachoques delantero" },
      { id: "tapabarro_delantero_izquierdo", label: "Tapabarro delantero izquierdo" },
      { id: "puerta_delantera_izquierda", label: "Puerta delantera izquierda", extra: { id: "vidrio", label: "Vidrio", options: ESTADOS_VIDRIO } },
      { id: "puerta_trasera_izquierda", label: "Puerta trasera izquierda", extra: { id: "vidrio", label: "Vidrio", options: ESTADOS_VIDRIO } },
      { id: "tapabarro_trasero_izquierdo", label: "Tapabarro trasero izquierdo" },
      { id: "portalon", label: "Portalón" },
      { id: "luneta_trasera", label: "Luneta trasera" },
      { id: "foco_trasero_izquierdo", label: "Foco trasero izquierdo" },
      { id: "foco_trasero_derecho", label: "Foco trasero derecho" },
      { id: "frente_trasero", label: "Frente trasero" },
      { id: "parachoques_trasero", label: "Parachoques trasero" },
      { id: "tapabarro_trasero_derecho", label: "Tapabarro trasero derecho" },
      { id: "puerta_trasera_derecha", label: "Puerta trasera derecha", extra: { id: "vidrio", label: "Vidrio", options: ESTADOS_VIDRIO } },
      { id: "puerta_delantera_derecha", label: "Puerta delantera derecha", extra: { id: "vidrio", label: "Vidrio", options: ESTADOS_VIDRIO } },
      { id: "tapabarro_delantero_derecho", label: "Tapabarro delantero derecho" },
      { id: "techo_capota", label: "Techo o capota" },
      { id: "chasis_carroceria", label: "Chasis" },
      { id: "piso_base", label: "Piso o base" },
    ],
  },
  {
    id: "interior",
    title: "2. Interior",
    type: "fixed",
    estadoOptions: ESTADOS_INTERIOR,
    items: [
      { id: "tablero_tasacion", label: "Tablero" },
      { id: "tapiceria_asientos", label: "Tapicería asientos" },
      { id: "techo_interior", label: "Techo interior" },
      { id: "alfombras", label: "Alfombras" },
      { id: "revestimientos_puertas", label: "Revestimientos puertas" },
      { id: "salpicadera", label: "Salpicadera" },
    ],
  },
  {
    id: "neumaticos_tasacion",
    title: "3. Neumáticos",
    type: "fixed",
    items: [
      { id: "neum_delantero_derecho", label: "Delantero derecho" },
      { id: "neum_delantero_izquierdo", label: "Delantero izquierdo" },
      { id: "neum_trasero_derecho", label: "Trasero derecho" },
      { id: "neum_trasero_izquierdo", label: "Trasero izquierdo" },
      { id: "neum_repuesto", label: "Repuesto" },
    ],
  },
  { id: "motor_tasacion", title: "4. Sistema motor", type: "dynamic", slots: 5 },
  { id: "transmision_tasacion", title: "5. Sistema de transmisión", type: "dynamic", slots: 5 },
  { id: "frenos_tasacion", title: "6. Sistema de frenos", type: "dynamic", slots: 5 },
  { id: "electrico_tasacion", title: "7. Sistema eléctrico", type: "dynamic", slots: 5 },
  { id: "direccion_tasacion", title: "8. Sistema de dirección", type: "dynamic", slots: 5 },
  { id: "suspension_tasacion", title: "9. Sistema de suspensión", type: "dynamic", slots: 5 },
  {
    id: "documentacion",
    title: "10. Documentación",
    type: "fixed",
    items: [
      { id: "permiso_circulacion", label: "Permiso de circulación", estadoOptions: ESTADOS_DOCUMENTO },
      { id: "revision_tecnica", label: "Revisión técnica", estadoOptions: ESTADOS_DOCUMENTO },
      { id: "soap", label: "SOAP", estadoOptions: ESTADOS_DOCUMENTO },
      { id: "padron", label: "Padrón", estadoOptions: ESTADOS_SI_NO },
    ],
  },
  {
    id: "aceite_bateria_vidrios",
    title: "11. Aceite y Batería",
    type: "fixed",
    items: [
      { id: "aceite", label: "Aceite" },
      { id: "bateria_tasacion", label: "Batería" },
    ],
  },
];
function getTasacionSectionItems(section) {
  if (section.type === "dynamic") {
    return Array.from({ length: section.slots }, (_, i) => ({ id: `${section.id}_${i + 1}`, label: "", dynamic: true }));
  }
  return section.items;
}

/* =========================================================
   COMPONENTES DE FORMULARIO
========================================================= */
function NumberField({ value, onChange, readOnly = false, disabled = false }) {
  if (readOnly) {
    return <div className="w-full px-2 py-1.5 text-right font-mono text-sm text-stone-700">{(value || 0).toLocaleString("es-CL")}</div>;
  }
  return (
    <input
      type="number" min="0"
      value={value === 0 ? "" : value}
      placeholder="0"
      disabled={disabled}
      onChange={(e) => onChange(toNum(e.target.value))}
      className={`w-full border px-2 py-1.5 font-mono text-sm text-right focus:outline-none focus:ring-2 focus:ring-amber-500 ${
        disabled ? "border-stone-200 bg-stone-100 text-stone-400 cursor-not-allowed" : "border-stone-300 bg-white text-stone-900"
      }`}
    />
  );
}

function TextField({ label, value, onChange, readOnly = false, placeholder = "" }) {
  return (
    <div>
      <label className="text-xs text-stone-500 block mb-1">{label}</label>
      {readOnly ? (
        <div className="w-full px-2 py-1.5 text-sm text-stone-700">{value || "—"}</div>
      ) : (
        <input
          type="text"
          value={value || ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
      )}
    </div>
  );
}

const ESTADOS_CHECKLIST = ["Bueno", "Regular", "Malo", "No aplica"];

function PdfDropzone({ fileName, fileData, onFileLoaded, onRemove, readOnly = false }) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const processFile = (file) => {
    if (!file) return;
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) { setError("Solo se aceptan archivos en formato PDF."); return; }
    setError("");
    const reader = new FileReader();
    reader.onload = () => onFileLoaded(file.name, reader.result);
    reader.onerror = () => setError("No se pudo leer el archivo, intenta nuevamente.");
    reader.readAsDataURL(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    processFile(file);
  };

  const handleInputChange = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    processFile(file);
  };

  if (readOnly) {
    return fileData ? (
      <a href={fileData} download={fileName || "archivo.pdf"} className="text-sm text-amber-700 hover:underline">{fileName || "Ver PDF"}</a>
    ) : (
      <p className="text-sm text-stone-500">Sin archivo cargado.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current && inputRef.current.click()}
        className={`cursor-pointer border-2 border-dashed p-8 text-center transition-colors ${dragOver ? "border-amber-500 bg-amber-50" : "border-stone-300 bg-stone-50 hover:bg-stone-100"}`}
      >
        <p className="text-sm text-stone-600 md:hidden">Toca para seleccionar el PDF</p>
        <p className="text-sm text-stone-600 hidden md:block">Arrastra aquí tu archivo PDF, o haz clic para seleccionarlo</p>
        <p className="text-xs text-stone-400 mt-1">Solo formato PDF</p>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={handleInputChange} className="hidden" />
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      {fileName && (
        <div className="flex items-center gap-3 text-sm text-stone-600">
          <span>Archivo cargado: {fileName}</span>
          <a href={fileData} download={fileName} onClick={(e) => e.stopPropagation()} className="text-amber-700 hover:underline">Ver</a>
          <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="text-rose-600 hover:underline">Quitar</button>
        </div>
      )}
    </div>
  );
}

/* ---------- Módulos plegables (agrupan cada parte del formulario) ---------- */
function Module({ id, title, badge, meta, accent = "border-sky-600", open, onToggle, children }) {
  const rootRef = useRef(null);
  // Segunda flecha, al final del módulo: lo contrae y deja su encabezado a la vista
  // (si no, en un módulo largo la página quedaría varias pantallas más abajo).
  const collapseFromBottom = () => {
    onToggle(id);
    // Salto directo (no suave): la página se acorta mientras se contrae y un scroll animado se cancelaría a medias.
    setTimeout(() => {
      if (rootRef.current) rootRef.current.scrollIntoView({ block: "nearest" });
    }, 30);
  };
  return (
    <div ref={rootRef} className={`bg-white border border-stone-200 border-l-4 ${accent}`}>
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-4 text-left min-h-[52px]"
      >
        <div>
          <h3 className="font-serif text-lg text-stone-900">{title}</h3>
          {meta && <p className="text-xs font-mono text-stone-500 mt-0.5">{meta}</p>}
        </div>
        <span className="flex items-center gap-3 shrink-0">
          {badge && (
            <span className={`text-xs px-2 py-0.5 border ${badge.done ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-stone-50 text-stone-500 border-stone-200"}`}>
              {badge.text}
            </span>
          )}
          <span aria-hidden="true" className="text-stone-400 text-xs">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && (
        <div className="px-4 md:px-5 pb-3">
          {children}
          <button
            type="button"
            onClick={collapseFromBottom}
            aria-label={`Contraer ${title}`}
            className="mt-4 w-full flex items-center justify-center gap-2 border-t border-stone-200 pt-3 pb-1 min-h-[44px] text-sm text-stone-500 hover:text-stone-800"
          >
            <span aria-hidden="true" className="text-xs">▲</span> Contraer
          </button>
        </div>
      )}
    </div>
  );
}
const sectionName = (title) => String(title).replace(/^\d+\.\s*/, "");
function SubtotalRow({ title, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-stone-200 pt-3 mt-4">
      <span className="text-sm text-stone-600">Subtotal {sectionName(title)}</span>
      <span className="font-mono text-lg text-stone-900">{clp(value)}</span>
    </div>
  );
}
// Valor comercial estimado − total de valorizaciones = valor final (historial de tasaciones).
function ValorFinalResumen({ record }) {
  const totals = computeTasacionTotals(record.checklist, TASACION_SECTIONS, getTasacionSectionItems);
  const vf = computeValorFinal(record.valorComercial, totals.total);
  return (
    <dl className="mt-2 text-xs text-stone-600 max-w-xs">
      <div className="flex justify-between gap-3"><dt>Valor comercial estimado</dt><dd className="font-mono">{clp(vf.valorComercial)}</dd></div>
      <div className="flex justify-between gap-3"><dt>Menos: Total valorizaciones</dt><dd className="font-mono">{clp(vf.total)}</dd></div>
      <div className="flex justify-between gap-3 border-t border-stone-300 mt-1 pt-1 text-sm font-semibold text-stone-900"><dt>Valor final</dt><dd className="font-mono">{clp(vf.final)}</dd></div>
    </dl>
  );
}
function TotalCard({ value }) {
  return (
    <div className="bg-stone-900 text-stone-100 px-4 py-4 md:px-5 flex items-baseline justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-widest text-stone-400">Total valorizaciones</p>
        <p className="text-xs text-stone-400 mt-0.5">Suma de los subtotales de todos los módulos</p>
      </div>
      <span className="font-mono text-2xl">{clp(value)}</span>
    </div>
  );
}
const countBadge = (done, total) => ({ text: `${done}/${total}`, done: total > 0 && done >= total });

function useModules(ids, initiallyOpen) {
  const [open, setOpen] = useState(() => Object.fromEntries(ids.map((id) => [id, initiallyOpen.includes(id)])));
  return {
    open,
    toggle: (id) => setOpen((o) => ({ ...o, [id]: !o[id] })),
    setAll: (value) => setOpen(Object.fromEntries(ids.map((id) => [id, value]))),
  };
}

function ModuleToolbar({ modules }) {
  return (
    <div className="flex justify-end gap-4 text-xs">
      <button type="button" onClick={() => modules.setAll(true)} className="text-stone-500 hover:underline py-1">Expandir todo</button>
      <button type="button" onClick={() => modules.setAll(false)} className="text-stone-500 hover:underline py-1">Contraer todo</button>
    </div>
  );
}

const hasText = (v) => String(v == null ? "" : v).trim() !== "";
const INSPECCION_VEHICULO_KEYS = ["inscripcion", "anio", "marca", "modelo", "nroMotor", "nroChasis", "color"];

function InspeccionForm({ record, onFieldChange, onChecklistChange, readOnly = false }) {
  const fechaDisplay = record.fecha
    ? new Date(`${record.fecha}T00:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" })
    : "—";

  const moduleIds = ["cav", "vehiculo", "propietario", ...CHECKLIST_SECTIONS.map((s) => s.id)];
  const modules = useModules(moduleIds, readOnly ? moduleIds : ["cav"]);

  const [autoFillMsg, setAutoFillMsg] = useState("");
  const [autoFilling, setAutoFilling] = useState(false);

  const handleCavLoaded = async (name, data) => {
    onFieldChange("cavFileName", name);
    onFieldChange("cavFileData", data);
    setAutoFillMsg("");
    setAutoFilling(true);
    try {
      const text = await extractPdfText(data);
      const fields = parseCavFields(text);
      const filledKeys = Object.keys(fields).filter((key) => fields[key] && !record[key]);
      filledKeys.forEach((key) => onFieldChange(key, fields[key]));
      setAutoFillMsg(
        filledKeys.length > 0
          ? `Se autocompletaron ${filledKeys.length} campo(s) desde el CAV. Verifica los datos antes de guardar.`
          : "No se detectaron datos automáticamente en este PDF (puede ser una imagen escaneada). Completa los campos manualmente."
      );
      // Abre los módulos que se acaban de llenar para que el inspector los revise.
      if (filledKeys.some((k) => INSPECCION_VEHICULO_KEYS.includes(k) && !modules.open.vehiculo)) modules.toggle("vehiculo");
      if (filledKeys.some((k) => k.startsWith("propietario")) && !modules.open.propietario) modules.toggle("propietario");
    } catch (e) {
      console.warn("No se pudo leer el CAV automáticamente:", e);
      setAutoFillMsg("No se pudo leer el contenido del PDF automáticamente. Completa los campos manualmente.");
    } finally {
      setAutoFilling(false);
    }
  };

  const vehiculoDone = INSPECCION_VEHICULO_KEYS.filter((k) => hasText(record[k])).length;
  const propietarioDone = ["propietarioNombre", "propietarioRun"].filter((k) => hasText(record[k])).length;

  return (
    <div className="flex flex-col gap-3">
      <ModuleToolbar modules={modules} />

      <Module id="cav" title="CAV" open={modules.open.cav} onToggle={modules.toggle}
        badge={{ text: record.cavFileName ? "Cargado" : "Sin archivo", done: !!record.cavFileName }}>
        <PdfDropzone
          fileName={record.cavFileName}
          fileData={record.cavFileData}
          onFileLoaded={handleCavLoaded}
          onRemove={() => { onFieldChange("cavFileName", ""); onFieldChange("cavFileData", ""); }}
          readOnly={readOnly}
        />
        {autoFilling && <p className="text-xs text-stone-500 mt-2">Leyendo el CAV para autocompletar datos…</p>}
        {!autoFilling && autoFillMsg && <p className="text-xs text-stone-500 mt-2">{autoFillMsg}</p>}
      </Module>

      <Module id="vehiculo" title="Datos del vehículo" open={modules.open.vehiculo} onToggle={modules.toggle}
        badge={countBadge(vehiculoDone, INSPECCION_VEHICULO_KEYS.length)}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-stone-500 block mb-1">Fecha del día</label>
            <div className="w-full px-2 py-1.5 text-sm text-stone-700 bg-stone-50 border border-stone-200">{fechaDisplay}</div>
          </div>
          <TextField label="Inscripción" value={record.inscripcion} onChange={(v) => onFieldChange("inscripcion", v)} readOnly={readOnly} />
          <TextField label="Año" value={record.anio} onChange={(v) => onFieldChange("anio", v)} readOnly={readOnly} />
          <TextField label="Marca" value={record.marca} onChange={(v) => onFieldChange("marca", v)} readOnly={readOnly} />
          <TextField label="Modelo" value={record.modelo} onChange={(v) => onFieldChange("modelo", v)} readOnly={readOnly} />
          <TextField label="Nro Motor" value={record.nroMotor} onChange={(v) => onFieldChange("nroMotor", v)} readOnly={readOnly} />
          <TextField label="Nro Chasis" value={record.nroChasis} onChange={(v) => onFieldChange("nroChasis", v)} readOnly={readOnly} />
          <TextField label="Nro Serie" value={record.nroSerie} onChange={(v) => onFieldChange("nroSerie", v)} readOnly={readOnly} />
          <TextField label="Nro Vin" value={record.nroVin} onChange={(v) => onFieldChange("nroVin", v)} readOnly={readOnly} />
          <TextField label="Color" value={record.color} onChange={(v) => onFieldChange("color", v)} readOnly={readOnly} />
        </div>
      </Module>

      <Module id="propietario" title="Datos del propietario" open={modules.open.propietario} onToggle={modules.toggle}
        badge={countBadge(propietarioDone, 2)}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TextField label="Nombre" value={record.propietarioNombre} onChange={(v) => onFieldChange("propietarioNombre", v)} readOnly={readOnly} />
          <TextField label="R.U.N." value={record.propietarioRun} onChange={(v) => onFieldChange("propietarioRun", v)} readOnly={readOnly} />
        </div>
      </Module>

      {CHECKLIST_SECTIONS.map((section) => {
        const done = section.items.filter((it) => record.checklist?.[it.id]?.estado).length;
        return (
          <Module key={section.id} id={section.id} title={section.title} open={modules.open[section.id]} onToggle={modules.toggle}
            badge={countBadge(done, section.items.length)}>
            <div className="flex flex-col gap-4">
              {section.items.map((item) => {
                const itemState = record.checklist?.[item.id] || { estado: "", observacion: "" };
                return (
                  <div key={item.id} className="grid grid-cols-1 md:grid-cols-3 gap-3 border-b border-stone-100 pb-4">
                    <div className="text-sm font-medium md:font-normal text-stone-700 flex items-center">{item.label}</div>
                    <div>
                      {readOnly ? (
                        <div className="text-sm text-stone-700">{itemState.estado || "—"}</div>
                      ) : (
                        <select
                          value={itemState.estado}
                          onChange={(e) => onChecklistChange(item.id, { estado: e.target.value })}
                          className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        >
                          <option value="">Seleccionar</option>
                          {ESTADOS_CHECKLIST.map((op) => <option key={op} value={op}>{op}</option>)}
                        </select>
                      )}
                    </div>
                    <div>
                      {readOnly ? (
                        <div className="text-sm text-stone-500">{itemState.observacion || "—"}</div>
                      ) : (
                        <input
                          type="text"
                          value={itemState.observacion || ""}
                          placeholder="Observaciones"
                          onChange={(e) => onChecklistChange(item.id, { observacion: e.target.value })}
                          className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Module>
        );
      })}
    </div>
  );
}

/* ---------- Fotos de la tasación: botón (+) por caja, miniaturas y visor ---------- */
const photoCache = new Map(); // id -> data URL (evita volver a descargar la misma foto)

function PhotoThumb({ inspectorId, photoId, onOpen }) {
  const [src, setSrc] = useState(photoCache.get(photoId) || null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (photoCache.has(photoId)) { setSrc(photoCache.get(photoId)); return undefined; }
    let alive = true;
    (async () => {
      const res = await window.storage.get(photoKey(inspectorId, photoId), true);
      if (!alive) return;
      if (res && res.value) { photoCache.set(photoId, res.value); setSrc(res.value); } else setFailed(true);
    })();
    return () => { alive = false; };
  }, [photoId, inspectorId]);
  return (
    <button
      type="button"
      onClick={() => src && onOpen(photoId)}
      aria-label="Ver foto"
      className="w-14 h-14 shrink-0 border border-stone-300 bg-stone-100 overflow-hidden flex items-center justify-center text-xs text-stone-400"
    >
      {src ? <img src={src} alt="Foto de la pieza" className="w-full h-full object-cover" /> : failed ? "!" : "…"}
    </button>
  );
}

function PhotoLightbox({ photoId, onClose, onRemove }) {
  const src = photoCache.get(photoId);
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" role="dialog" aria-label="Foto" onClick={onClose}>
      <div className="flex items-center justify-between p-3" onClick={(e) => e.stopPropagation()}>
        {onRemove ? (
          <button type="button" onClick={() => { if (window.confirm("¿Quitar esta foto?")) onRemove(photoId); }} className="text-rose-300 text-sm px-3 py-2 border border-rose-300/50">Quitar foto</button>
        ) : <span />}
        <button type="button" onClick={onClose} className="text-white text-sm px-3 py-2 border border-white/40">Cerrar</button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-2">
        {src && <img src={src} alt="Foto de la pieza" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />}
      </div>
    </div>
  );
}

// `photos` = { inspectorId, busy, errors, add(itemId, file), remove(itemId, photoId) }.
// Con `viewOnly` (vista del administrador) solo se muestran las fotos: sin botón (+) ni opción de quitar.
function PhotoStrip({ itemId, label, fotos, photos }) {
  const list = fotos || [];
  const inputRef = useRef(null);
  const [openId, setOpenId] = useState(null);
  const busy = !!(photos.busy && photos.busy[itemId]);
  const full = list.length >= MAX_PHOTOS_PER_ITEM;
  if (photos.viewOnly) {
    if (list.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 mt-3">
        {list.map((id) => <PhotoThumb key={id} inspectorId={photos.inspectorId} photoId={id} onOpen={setOpenId} />)}
        <span className="text-xs text-stone-400">{list.length} foto{list.length === 1 ? "" : "s"}</span>
        {openId && <PhotoLightbox photoId={openId} onClose={() => setOpenId(null)} />}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 mt-3">
      <button
        type="button"
        disabled={busy || full}
        onClick={() => inputRef.current && inputRef.current.click()}
        aria-label={`Agregar foto: ${label}`}
        title={full ? `Máximo ${MAX_PHOTOS_PER_ITEM} fotos` : "Agregar foto"}
        className="w-14 h-14 shrink-0 border-2 border-dashed border-stone-300 text-stone-500 text-2xl leading-none hover:bg-stone-50 disabled:opacity-40"
      >
        {busy ? "…" : "+"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) photos.add(itemId, f); }}
      />
      {list.map((id) => <PhotoThumb key={id} inspectorId={photos.inspectorId} photoId={id} onOpen={setOpenId} />)}
      {list.length > 0 && <span className="text-xs text-stone-400">{list.length}/{MAX_PHOTOS_PER_ITEM}</span>}
      {photos.errors[itemId] && <p className="w-full text-xs text-rose-600">{photos.errors[itemId]}</p>}
      {openId && <PhotoLightbox photoId={openId} onClose={() => setOpenId(null)} onRemove={(id) => { setOpenId(null); photos.remove(itemId, id); }} />}
    </div>
  );
}

const TASACION_DATOS_KEYS = ["propietario", "vehiculo", "patente", "anio", "kilometraje", "valorComercial", "estadoGeneral"];

function TasacionForm({ record, onFieldChange, onChecklistChange, readOnly = false, inspeccionLabel = "", photos = null }) {
  const fechaDisplay = record.fecha
    ? new Date(`${record.fecha}T00:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" })
    : "—";

  const moduleIds = ["datos", ...TASACION_SECTIONS.map((s) => s.id)];
  const modules = useModules(moduleIds, readOnly ? moduleIds : ["datos"]);
  const totals = computeTasacionTotals(record.checklist, TASACION_SECTIONS, getTasacionSectionItems);
  const datosDone = TASACION_DATOS_KEYS.filter((k) => (k === "valorComercial" ? toNum(record[k]) > 0 : hasText(record[k]))).length;

  return (
    <div className="flex flex-col gap-3">
      <ModuleToolbar modules={modules} />

      <Module id="datos" title="Tasación" accent="border-violet-600" open={modules.open.datos} onToggle={modules.toggle}
        badge={countBadge(datosDone, TASACION_DATOS_KEYS.length)}>
        {inspeccionLabel && <p className="text-xs text-violet-700 bg-violet-50 border border-violet-200 px-3 py-2 mb-4">Basada en la {inspeccionLabel}</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TextField label="Propietario" value={record.propietario} onChange={(v) => onFieldChange("propietario", v)} readOnly={readOnly} />
          <div>
            <label className="text-xs text-stone-500 block mb-1">Fecha del día</label>
            <div className="w-full px-2 py-1.5 text-sm text-stone-700 bg-stone-50 border border-stone-200">{fechaDisplay}</div>
          </div>
          <TextField label="Vehículo" value={record.vehiculo} onChange={(v) => onFieldChange("vehiculo", v)} readOnly={readOnly} />
          <TextField label="Patente" value={record.patente} onChange={(v) => onFieldChange("patente", v)} readOnly={readOnly} />
          <TextField label="Año" value={record.anio} onChange={(v) => onFieldChange("anio", v)} readOnly={readOnly} />
          <TextField label="Kilometraje" value={record.kilometraje} onChange={(v) => onFieldChange("kilometraje", v)} readOnly={readOnly} />
          <div>
            <label className="text-xs text-stone-500 block mb-1">Valor comercial estimado</label>
            <NumberField value={toNum(record.valorComercial)} onChange={(v) => onFieldChange("valorComercial", v)} readOnly={readOnly} />
          </div>
          <TextField label="Estado general" value={record.estadoGeneral} onChange={(v) => onFieldChange("estadoGeneral", v)} readOnly={readOnly} placeholder="Ej. Bueno" />
          <div className="md:col-span-3">
            <label className="text-xs text-stone-500 block mb-1">Observaciones</label>
            {readOnly ? (
              <div className="w-full px-2 py-1.5 text-sm text-stone-700">{record.observaciones || "—"}</div>
            ) : (
              <textarea
                value={record.observaciones || ""}
                onChange={(e) => onFieldChange("observaciones", e.target.value)}
                rows={3}
                className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            )}
          </div>
        </div>
      </Module>

      <TasacionChecklist checklist={record.checklist || {}} onItemChange={onChecklistChange} readOnly={readOnly} modules={modules} totals={totals} photos={readOnly ? (photos && photos.viewOnly ? photos : null) : photos} />

      <TotalCard value={totals.total} />
    </div>
  );
}

function TasacionChecklist({ checklist, onItemChange, readOnly = false, modules, totals, photos = null }) {
  return (
    <>
      {TASACION_SECTIONS.map((section) => {
        const items = getTasacionSectionItems(section);
        const done = items.filter((it) => {
          const st = checklist[it.id];
          return st && (section.type === "dynamic" ? (st.nombre || st.estado || toNum(st.valor) > 0) : st.estado);
        }).length;
        const subtotal = totals.bySection[section.id] || 0;
        const meta = subtotal > 0 ? `Subtotal ${clp(subtotal)}` : null;
        const badge = section.type === "dynamic" ? { text: `${done} fila${done === 1 ? "" : "s"}`, done: done > 0 } : countBadge(done, items.length);

        if (section.type === "dynamic") {
          return (
            <Module key={section.id} id={section.id} title={section.title} accent="border-violet-600" open={modules.open[section.id]} onToggle={modules.toggle} badge={badge} meta={meta}>
              <div className="flex flex-col">
                {items.map((item) => {
                  const state = checklist[item.id] || { nombre: "", estado: "", valor: 0 };
                  const estadoOptions = section.estadoOptions || ESTADOS_CHECKLIST;
                  return (
                    <div key={item.id} className="border-b border-stone-100 py-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
                      <div>
                        <label className="text-xs text-stone-400 block mb-1 md:hidden">Nombre de pieza</label>
                        {readOnly ? (
                          <div className="px-2 py-1.5 text-sm text-stone-700">{state.nombre || "—"}</div>
                        ) : (
                          <input
                            type="text"
                            value={state.nombre || ""}
                            placeholder="Nombre de la pieza"
                            onChange={(e) => onItemChange(item.id, { nombre: e.target.value })}
                            className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                        )}
                      </div>
                      <div>
                        <label className="text-xs text-stone-400 block mb-1 md:hidden">Estado</label>
                        {readOnly ? (
                          <div className="px-2 py-1.5 text-sm text-stone-700">{state.estado || "—"}</div>
                        ) : (
                          <select
                            value={state.estado}
                            onChange={(e) => onItemChange(item.id, { estado: e.target.value })}
                            className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          >
                            <option value="">Seleccionar</option>
                            {estadoOptions.map((op) => <option key={op} value={op}>{op}</option>)}
                          </select>
                        )}
                      </div>
                      <div>
                        <label className="text-xs text-stone-400 block mb-1 md:hidden">Valorización</label>
                        <NumberField value={toNum(state.valor)} onChange={(v) => onItemChange(item.id, { valor: v })} readOnly={readOnly} />
                      </div>
                    </div>
                    {photos && <PhotoStrip itemId={item.id} label={state.nombre || section.title} fotos={state.fotos} photos={photos} />}
                    </div>
                  );
                })}
              </div>
              <SubtotalRow title={section.title} value={subtotal} />
            </Module>
          );
        }

        return (
          <Module key={section.id} id={section.id} title={section.title} accent="border-violet-600" open={modules.open[section.id]} onToggle={modules.toggle} badge={badge} meta={meta}>
            <div className="flex flex-col gap-4">
              {items.map((item) => {
                const state = checklist[item.id] || { nombre: "", estado: "", valor: 0 };
                const estadoOptions = item.estadoOptions || section.estadoOptions || ESTADOS_CHECKLIST;
                return (
                  <div key={item.id} className="flex flex-col gap-3 border-b border-stone-100 pb-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="text-sm font-medium md:font-normal text-stone-700 flex items-center">{item.label}</div>
                      <div>
                        {readOnly ? (
                          <div className="text-sm text-stone-700">{state.estado || "—"}</div>
                        ) : (
                          <select
                            value={state.estado}
                            onChange={(e) => onItemChange(item.id, { estado: e.target.value })}
                            className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          >
                            <option value="">Seleccionar</option>
                            {estadoOptions.map((op) => <option key={op} value={op}>{op}</option>)}
                          </select>
                        )}
                      </div>
                      <div>
                        <NumberField value={toNum(state.valor)} onChange={(v) => onItemChange(item.id, { valor: v })} readOnly={readOnly} />
                      </div>
                    </div>
                    {item.extra && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="text-xs text-stone-500 flex items-center">{item.extra.label}</div>
                        <div>
                          {readOnly ? (
                            <div className="text-sm text-stone-700">{state[item.extra.id] || "—"}</div>
                          ) : (
                            <select
                              value={state[item.extra.id] || ""}
                              onChange={(e) => onItemChange(item.id, { [item.extra.id]: e.target.value })}
                              className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                            >
                              <option value="">Seleccionar</option>
                              {item.extra.options.map((op) => <option key={op} value={op}>{op}</option>)}
                            </select>
                          )}
                        </div>
                      </div>
                    )}
                    {photos && <PhotoStrip itemId={item.id} label={item.label} fotos={state.fotos} photos={photos} />}
                  </div>
                );
              })}
            </div>
            <SubtotalRow title={section.title} value={subtotal} />
          </Module>
        );
      })}
    </>
  );
}

function TierModule({ accent, title, unit, count, onCount, tiers, readOnly = false }) {
  const tier = getTier(count, tiers);
  const rate = tier ? tier.rate : 0;
  const total = count * rate;
  const borderColor = { amber: "border-amber-500", teal: "border-teal-600", indigo: "border-indigo-500", cyan: "border-cyan-600" }[accent];
  const textColor = { amber: "text-amber-700", teal: "text-teal-700", indigo: "text-indigo-700", cyan: "text-cyan-700" }[accent];
  return (
    <div className={`bg-white border border-stone-200 border-l-4 ${borderColor} p-5 flex flex-col gap-4`}>
      <div>
        <h3 className="font-serif text-lg text-stone-900">{title}</h3>
        <p className="text-xs text-stone-500 mt-0.5">{unit} realizadas este mes</p>
      </div>
      <NumberField value={count} onChange={onCount} readOnly={readOnly} />
      <div className="text-xs text-stone-500 leading-relaxed">
        {tiers.map((t) => (
          <div key={t.label} className={`flex justify-between py-0.5 ${tier && tier.label === t.label ? `${textColor} font-semibold` : ""}`}>
            <span>{t.label}</span>
            <span className="font-mono">{clp(t.rate)} c/u</span>
          </div>
        ))}
      </div>
      <div className="border-t border-stone-200 pt-3 mt-auto flex items-baseline justify-between">
        <span className="text-sm text-stone-600">Producción</span>
        <span className="font-mono text-xl text-stone-900">{clp(total)}</span>
      </div>
    </div>
  );
}

function CreditosModule({ count, onCount, rows, onRowChange, readOnly = false, tiers = TIERS_CREDITOS }) {
  const [expanded, setExpanded] = useState(false);
  const tier = getTier(count, tiers);
  const rate = tier ? tier.rate : 0;
  const sumaComisiones = rows.reduce((acc, r) => acc + toNum(r.comision), 0);
  const total = sumaComisiones * rate;
  return (
    <div className="bg-white border border-stone-200 border-l-4 border-rose-500 p-5">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-5">
        <div>
          <h3 className="font-serif text-lg text-stone-900">Créditos</h3>
          <p className="text-xs text-stone-500 mt-0.5">Créditos realizados este mes</p>
        </div>
        <div className="w-full md:w-40"><NumberField value={count} onChange={onCount} readOnly={readOnly} /></div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-stone-500 mb-4">
        {tiers.map((t) => (
          <span key={t.label} className={tier && tier.label === t.label ? "text-rose-700 font-semibold" : ""}>
            {t.label}: {(t.rate * 100).toFixed(0)}% sobre comisión
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((s) => !s)}
        className="flex items-center gap-1.5 text-sm text-rose-700 hover:underline mb-3"
      >
        <span>{expanded ? "▲" : "▼"}</span>
        {expanded ? "Ocultar detalle de créditos" : `Ver detalle de créditos (${rows.filter((r) => r.financiera || toNum(r.comision) > 0).length} de ${rows.length} filas usadas)`}
      </button>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
                <th className="py-2 pr-2 w-8">#</th>
                <th className="py-2 pr-2">Financiera</th>
                <th className="py-2 pr-2 text-right">Comisión ($)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-stone-100">
                  <td className="py-1.5 pr-2 text-stone-400 font-mono">{i + 1}</td>
                  <td className="py-1.5 pr-2">
                    {readOnly ? (
                      <div className="px-2 py-1.5 text-sm text-stone-700">{row.financiera || "—"}</div>
                    ) : (
                      <select value={row.financiera} onChange={(e) => onRowChange(i, "financiera", e.target.value)}
                        className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500">
                        <option value="">Seleccionar</option>
                        {FINANCIERAS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 w-40"><NumberField value={toNum(row.comision)} onChange={(v) => onRowChange(i, "comision", v)} readOnly={readOnly} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="py-2 pr-2 text-right text-sm text-stone-600">Suma de comisiones</td>
                <td className="py-2 pr-2 text-right font-mono text-sm text-stone-900">{clp(sumaComisiones)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="border-t border-stone-200 pt-3 mt-4 flex items-baseline justify-between">
        <span className="text-sm text-stone-600">Producción ({sumaComisiones ? (rate * 100).toFixed(0) : 0}% sobre {clp(sumaComisiones)})</span>
        <span className="font-mono text-xl text-stone-900">{clp(total)}</span>
      </div>
    </div>
  );
}

function ConsignacionesModule({ count, onCount, rows, onRowChange, readOnly = false, tiers = TIERS_CONSIGNACIONES }) {
  const [expanded, setExpanded] = useState(false);
  const margenesBrutos = rows.map((r) => toNum(r.precioVenta) - toNum(r.precioPiso) - toNum(r.descuentos));
  const margenesNetos = margenesBrutos.map((m) => Math.round(m * MARGEN_NETO_PCT));
  const sumaMargenBruto = margenesBrutos.reduce((a, b) => a + b, 0);
  const sumaMargenNeto = margenesNetos.reduce((a, b) => a + b, 0);
  const total = sumaMargenNeto;
  const filasUsadas = rows.filter((r) => r.cliente || toNum(r.precioVenta) > 0 || toNum(r.precioPiso) > 0 || toNum(r.descuentos) > 0).length;
  return (
    <div className="bg-white border border-stone-200 border-l-4 border-violet-500 p-5">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-5">
        <div>
          <h3 className="font-serif text-lg text-stone-900">Consignaciones</h3>
          <p className="text-xs text-stone-500 mt-0.5">Consignaciones realizadas este mes</p>
        </div>
        <div className="w-full md:w-40"><NumberField value={count} onChange={onCount} readOnly={readOnly} /></div>
      </div>
      <p className="text-xs text-stone-500 mb-4">La producción corresponde a la suma de todos los Márgenes Netos, sin aplicar porcentaje adicional.</p>

      <button
        type="button"
        onClick={() => setExpanded((s) => !s)}
        className="flex items-center gap-1.5 text-sm text-violet-700 hover:underline mb-3"
      >
        <span>{expanded ? "▲" : "▼"}</span>
        {expanded ? "Ocultar detalle de consignaciones" : `Ver detalle de consignaciones (${filasUsadas} de ${rows.length} filas usadas)`}
      </button>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
                <th className="py-2 pr-2 w-8">#</th>
                <th className="py-2 pr-2">Cliente</th>
                <th className="py-2 pr-2 text-right">Precio venta unidad</th>
                <th className="py-2 pr-2 text-right">Precio piso cliente</th>
                <th className="py-2 pr-2 text-right">Total descuentos</th>
                <th className="py-2 pr-2 text-right">Margen Bruto</th>
                <th className="py-2 pr-2 text-right">Margen Neto</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-stone-100">
                  <td className="py-1.5 pr-2 text-stone-400 font-mono">{i + 1}</td>
                  <td className="py-1.5 pr-2 w-48">
                    {readOnly ? (
                      <div className="px-2 py-1.5 text-sm text-stone-700 truncate" title={row.cliente || ""}>{row.cliente || "—"}</div>
                    ) : (
                      <input
                        type="text"
                        value={row.cliente || ""}
                        maxLength={150}
                        placeholder="Nombre del cliente"
                        onChange={(e) => onRowChange(i, "cliente", e.target.value)}
                        className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    )}
                  </td>
                  <td className="py-1.5 pr-2 w-36"><NumberField value={toNum(row.precioVenta)} onChange={(v) => onRowChange(i, "precioVenta", v)} readOnly={readOnly} /></td>
                  <td className="py-1.5 pr-2 w-36"><NumberField value={toNum(row.precioPiso)} onChange={(v) => onRowChange(i, "precioPiso", v)} readOnly={readOnly} /></td>
                  <td className="py-1.5 pr-2 w-36"><NumberField value={toNum(row.descuentos)} onChange={(v) => onRowChange(i, "descuentos", v)} readOnly={readOnly} /></td>
                  <td className="py-1.5 pr-2 text-right font-mono text-stone-700">{clp(margenesBrutos[i])}</td>
                  <td className="py-1.5 pr-2 text-right font-mono text-stone-900">{clp(margenesNetos[i])}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="py-2 pr-2 text-right text-sm text-stone-600">Suma de márgenes</td>
                <td className="py-2 pr-2 text-right font-mono text-sm text-stone-700">{clp(sumaMargenBruto)}</td>
                <td className="py-2 pr-2 text-right font-mono text-sm text-stone-900">{clp(sumaMargenNeto)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="border-t border-stone-200 pt-3 mt-4 flex items-baseline justify-between">
        <span className="text-sm text-stone-600">Producción (suma de Márgenes Netos)</span>
        <span className="font-mono text-xl text-stone-900">{clp(total)}</span>
      </div>
    </div>
  );
}

function ProductionSummary({ totals, title = "Resumen de producción" }) {
  const breakdown = [
    { label: "Compras", value: totals.compras, color: "bg-amber-500" },
    { label: "Ventas", value: totals.ventas, color: "bg-teal-600" },
    { label: "Seguros", value: totals.seguros, color: "bg-indigo-500" },
    { label: "Créditos", value: totals.creditos, color: "bg-rose-500" },
    { label: "Consignaciones", value: totals.consignaciones, color: "bg-violet-500" },
    { label: "Inspecciones", value: totals.inspecciones || 0, color: "bg-cyan-600" },
  ];
  const maxTotal = Math.max(totals.total, 1);
  return (
    <div className="bg-white border border-stone-200 p-5">
      <h3 className="font-serif text-lg text-stone-900 mb-4">{title}</h3>
      <div className="flex h-3 w-full overflow-hidden bg-stone-100 mb-4">
        {breakdown.map((b) => <div key={b.label} className={b.color} style={{ width: `${(Math.max(b.value, 0) / maxTotal) * 100}%` }} />)}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-5">
        {breakdown.map((b) => (
          <div key={b.label}>
            <div className="flex items-center gap-2 mb-1"><span className={`w-2.5 h-2.5 ${b.color}`} /><span className="text-xs text-stone-500">{b.label}</span></div>
            <p className="font-mono text-sm text-stone-900">{clp(b.value)}</p>
          </div>
        ))}
      </div>
      <div className="border-t border-stone-200 pt-4 flex items-baseline justify-between">
        <span className="font-serif text-lg text-stone-900">Total producción</span>
        <span className="font-mono text-2xl text-stone-900">{clp(totals.total)}</span>
      </div>
    </div>
  );
}

function LiquidacionModule({
  sueldoBase, diasTrabajados, semanaCorrida, bonosImponibles, gratificacionActiva, anticipos, descuentosLiquidacion, impuestos, afpId, afpList = [],
  tipoSalud, isapreUF, ufValor = DEFAULT_UF_VALOR,
  onChange, totalProduccion, readOnly = false, onGenerate,
}) {
  const gratificacionOn = gratificacionActiva !== false;
  const gratificacion = gratificacionValor(sueldoBase, gratificacionActiva);
  const totalHaberes = totalProduccion + toNum(sueldoBase) + toNum(semanaCorrida) + toNum(bonosImponibles) + gratificacion;
  const afpComisionPct = getAfpTotalPct(afpList, afpId);
  const afpComisionValor = calcAfpComisionValor(afpList, afpId, totalHaberes);
  const fonasaValor = calcFonasaValor(totalHaberes);
  const isapreValor = calcIsapreValor(isapreUF, ufValor);
  const usaIsapre = tipoSalud === "isapre";
  const saludValor = calcSaludValor(tipoSalud, isapreUF, ufValor, totalHaberes);
  const apvValor = calcIsapreValor(descuentosLiquidacion, ufValor);
  const totalDescuento = apvValor + toNum(impuestos) + afpComisionValor + saludValor;
  const liquido = totalHaberes - totalDescuento - toNum(anticipos);

  const [showCalc, setShowCalc] = useState(false);
  const [expandedHaberes, setExpandedHaberes] = useState(false);
  const [expandedDescuento, setExpandedDescuento] = useState(false);
  const [calcComision, setCalcComision] = useState(0);
  const [calcDiasHabiles, setCalcDiasHabiles] = useState(0);
  const [calcDiasFestivos, setCalcDiasFestivos] = useState(0);
  const calcDivision = calcDiasHabiles > 0 ? Math.round(Math.round(calcComision) / Math.round(calcDiasHabiles)) : 0;
  const calcResultado = Math.round(calcDivision * Math.round(calcDiasFestivos));

  const aplicarCalculo = () => {
    onChange("semanaCorrida", calcResultado);
    setShowCalc(false);
  };

  return (
    <div className="bg-white border border-stone-200 border-l-4 border-emerald-600 p-5 flex flex-col gap-5">
      <div>
        <h3 className="font-serif text-lg text-stone-900">Pre Liquidación</h3>
      </div>

      <div>
        <label className="text-xs text-stone-500 block mb-1">Días trabajados</label>
        {readOnly ? (
          <div className="w-full px-2 py-1.5 text-sm text-stone-700 max-w-xs">{diasTrabajados || "—"}</div>
        ) : (
          <input
            type="text"
            value={diasTrabajados || ""}
            onChange={(e) => onChange("diasTrabajados", e.target.value)}
            placeholder="Ej. 30"
            className="w-full max-w-xs border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        )}
      </div>

      {/* Haberes */}
      <div className="border border-stone-200 bg-stone-50 p-4">
        <div className="flex items-center justify-between mb-1">
          <h4 className="font-serif text-base text-stone-900">Haberes</h4>
          <button
            type="button"
            onClick={() => setExpandedHaberes((s) => !s)}
            className="flex items-center gap-1.5 text-sm text-emerald-700 hover:underline"
          >
            <span>{expandedHaberes ? "▲" : "▼"}</span>
            {expandedHaberes ? "Ocultar detalle" : "Ver detalle"}
          </button>
        </div>

        {expandedHaberes && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-3">
              <div>
                <label className="text-xs text-stone-500 block mb-1">Producción</label>
                <div className="w-full px-2 py-1.5 text-right font-mono text-sm text-stone-700 bg-white border border-stone-200">{clp(totalProduccion)}</div>
              </div>
              <div>
                <label className="text-xs text-stone-500 block mb-1">Sueldo base ($553.553) período 2026</label>
                <NumberField value={toNum(sueldoBase)} onChange={(v) => onChange("sueldoBase", v)} readOnly={readOnly} />
              </div>
              <div>
                <label className="text-xs text-stone-500 block mb-1 flex items-center justify-between gap-2">
                  <span>Semana Corrida</span>
                  {!readOnly && (
                    <button type="button" onClick={() => setShowCalc((s) => !s)} className="text-xs text-emerald-700 hover:underline normal-case font-normal">
                      {showCalc ? "Cerrar calculadora" : "Calculadora"}
                    </button>
                  )}
                </label>
                <NumberField value={toNum(semanaCorrida)} onChange={(v) => onChange("semanaCorrida", v)} readOnly={readOnly} />
              </div>
              <div>
                <label className="text-xs text-stone-500 block mb-1">Bonos Imponibles</label>
                <NumberField value={toNum(bonosImponibles)} onChange={(v) => onChange("bonosImponibles", v)} readOnly={readOnly} />
              </div>
              <div>
                <label className="text-xs text-stone-500 block mb-1 flex items-center justify-between gap-2">
                  <span>Gratificación{!gratificacionOn && <span className="text-stone-400"> — desactivada</span>}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => onChange("gratificacionActiva", !gratificacionOn)}
                      className="text-xs text-emerald-700 hover:underline normal-case font-normal"
                    >
                      {gratificacionOn ? "Desactivar" : "Activar"}
                    </button>
                  )}
                </label>
                <div className={`w-full px-2 py-1.5 text-right font-mono text-sm border ${gratificacionOn ? "bg-white text-stone-700 border-stone-200" : "bg-stone-100 text-stone-400 border-stone-200"}`}>
                  {clp(gratificacion)}
                </div>
              </div>
            </div>

            {showCalc && !readOnly && (
              <div className="border border-emerald-300 bg-emerald-50 p-4 flex flex-col gap-3 mt-4">
                <h4 className="font-serif text-sm text-stone-900">Calculadora de Semana Corrida</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-stone-500 block mb-1">Total comisión del mes</label>
                    <NumberField value={calcComision} onChange={setCalcComision} />
                  </div>
                  <div>
                    <label className="text-xs text-stone-500 block mb-1">Días hábiles del mes</label>
                    <NumberField value={calcDiasHabiles} onChange={setCalcDiasHabiles} />
                  </div>
                  <div>
                    <label className="text-xs text-stone-500 block mb-1">Días festivos y domingos</label>
                    <NumberField value={calcDiasFestivos} onChange={setCalcDiasFestivos} />
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-emerald-200 pt-3">
                  <span>Comisión ÷ días hábiles (redondeado)</span>
                  <span className="font-mono">{clp(calcDivision)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-emerald-200 pt-3">
                  <span className="text-sm text-stone-600">Resultado (÷ redondeado × días festivos y domingos, redondeado)</span>
                  <span className="font-mono text-lg text-emerald-700">{clp(calcResultado)}</span>
                </div>
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setShowCalc(false)} className="border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50">Cancelar</button>
                  <button type="button" onClick={aplicarCalculo} className="bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-emerald-700">Agregar a Semana Corrida</button>
                </div>
              </div>
            )}
          </>
        )}

        <div className="border-t border-stone-300 mt-4 pt-3 flex items-baseline justify-between">
          <span className="text-sm text-stone-600">Total Haberes (Producción + Sueldo base + Semana Corrida + Bonos Imponibles + Gratificación)</span>
          <span className="font-mono text-lg text-stone-900">{clp(totalHaberes)}</span>
        </div>
      </div>

      {/* Descuento AFP */}
      <div className="border border-stone-200 bg-stone-50 p-4">
        <div className="flex items-center justify-between mb-1">
          <h4 className="font-serif text-base text-stone-900">Descuento AFP</h4>
          <button
            type="button"
            onClick={() => setExpandedDescuento((s) => !s)}
            className="flex items-center gap-1.5 text-sm text-emerald-700 hover:underline"
          >
            <span>{expandedDescuento ? "▲" : "▼"}</span>
            {expandedDescuento ? "Ocultar detalle" : "Ver detalle"}
          </button>
        </div>

        {expandedDescuento && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-3">
              <div>
                <label className="text-xs text-stone-500 block mb-1">AFP</label>
                {readOnly ? (
                  <div className="w-full px-2 py-1.5 text-sm text-stone-700">
                    {(afpList.find((a) => a.id === afpId) || {}).nombre || "—"}
                  </div>
                ) : (
                  <select
                    value={afpId || ""}
                    onChange={(e) => onChange("afpId", e.target.value)}
                    className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">Seleccionar</option>
                    {afpList.map((a) => (
                      <option key={a.id} value={a.id}>{a.nombre} (10% + {a.comision}% = {(AFP_PORCENTAJE_BASE + toNum(a.comision)).toFixed(2)}%)</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="text-xs text-stone-500 block mb-1">Comisión AFP (10% + comisión = {afpComisionPct}% sobre Haberes)</label>
                <div className="w-full px-2 py-1.5 text-right font-mono text-sm text-stone-700 bg-white border border-stone-200">{clp(afpComisionValor)}</div>
              </div>
              <div>
                <label className="text-xs text-stone-500 block mb-1">APV en UF</label>
                <NumberField value={toNum(descuentosLiquidacion)} onChange={(v) => onChange("descuentosLiquidacion", v)} readOnly={readOnly} />
              </div>
              <div>
                <label className="text-xs text-stone-500 block mb-1">APV en pesos (UF a {clp(ufValor)})</label>
                <div className="w-full px-2 py-1.5 text-right font-mono text-sm text-stone-700 bg-white border border-stone-200">{clp(apvValor)}</div>
              </div>
            </div>

            <div className="border-t border-stone-200 mt-4 pt-4">
              <h5 className="text-sm font-medium text-stone-700 mb-3">Descuento Salud</h5>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs text-stone-500 block mb-1">Tipo de salud</label>
                  {readOnly ? (
                    <div className="w-full px-2 py-1.5 text-sm text-stone-700">{usaIsapre ? "Isapre" : "Fonasa"}</div>
                  ) : (
                    <select
                      value={tipoSalud || "fonasa"}
                      onChange={(e) => onChange("tipoSalud", e.target.value)}
                      className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      <option value="fonasa">Fonasa</option>
                      <option value="isapre">Isapre</option>
                    </select>
                  )}
                </div>
                <div>
                  <label className="text-xs text-stone-500 block mb-1">
                    Fonasa (7% sobre Haberes){usaIsapre && <span className="text-stone-400"> — no aplica</span>}
                  </label>
                  <div className={`w-full px-2 py-1.5 text-right font-mono text-sm border border-stone-200 ${usaIsapre ? "bg-stone-100 text-stone-400" : "bg-white text-stone-700"}`}>
                    {clp(fonasaValor)}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-stone-500 block mb-1">
                    Isapre (monto en UF){!usaIsapre && <span className="text-stone-400"> — bloqueado</span>}
                  </label>
                  <NumberField value={toNum(isapreUF)} onChange={(v) => onChange("isapreUF", v)} readOnly={readOnly} disabled={!usaIsapre} />
                </div>
                <div>
                  <label className="text-xs text-stone-500 block mb-1">
                    Isapre en pesos (UF a {clp(ufValor)}){!usaIsapre && <span className="text-stone-400"> — no aplica</span>}
                  </label>
                  <div className={`w-full px-2 py-1.5 text-right font-mono text-sm border border-stone-200 ${!usaIsapre ? "bg-stone-100 text-stone-400" : "bg-white text-stone-700"}`}>
                    {clp(isapreValor)}
                  </div>
                </div>
              </div>
              <div className="border-t border-stone-200 mt-4 pt-3 flex items-baseline justify-between">
                <span className="text-sm text-stone-600">Total Salud aplicado</span>
                <span className="font-mono text-lg text-stone-900">{clp(saludValor)}</span>
              </div>
            </div>
          </>
        )}

        <div className="border-t border-stone-300 mt-4 pt-3 flex items-baseline justify-between">
          <span className="text-sm text-stone-600">Total Descuento (Comisión AFP + Descuento Salud + APV + Impuestos)</span>
          <span className="font-mono text-lg text-stone-900">{clp(totalDescuento)}</span>
        </div>
      </div>

      <div>
        <label className="text-xs text-stone-500 block mb-1">Anticipos</label>
        <div className="max-w-xs">
          <NumberField value={toNum(anticipos)} onChange={(v) => onChange("anticipos", v)} readOnly={readOnly} />
        </div>
      </div>

      <div>
        <label className="text-xs text-stone-500 block mb-1">Impuestos</label>
        <div className="max-w-xs">
          <NumberField value={toNum(impuestos)} onChange={(v) => onChange("impuestos", v)} readOnly={readOnly} />
        </div>
        <p className="text-xs text-stone-400 mt-1">Los impuestos legales deben ser verificados en la liquidación final junto a contabilidad.</p>
      </div>

      <div className="border-t border-stone-200 pt-3 flex items-baseline justify-between">
        <span className="text-sm text-stone-600">Líquido a pago (Total Haberes − Total Descuento − Anticipos)</span>
        <span className="font-mono text-2xl text-emerald-700">{clp(liquido)}</span>
      </div>
      {!readOnly && onGenerate && (
        <div className="flex justify-end pt-1">
          <button type="button" onClick={onGenerate} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800">
            Generar Pre Liquidación
          </button>
        </div>
      )}
    </div>
  );
}

function ReportModal({ vendor, ym, totals, record, afpList = [], ufValor = DEFAULT_UF_VALOR, onClose }) {
  const [downloadError, setDownloadError] = useState("");

  const totalHaberes = totals.total + toNum(record.sueldoBase) + toNum(record.semanaCorrida) + toNum(record.bonosImponibles) + gratificacionValor(record.sueldoBase, record.gratificacionActiva);
  const afpComisionPct = getAfpTotalPct(afpList, record.afpId);
  const afpComisionValor = calcAfpComisionValor(afpList, record.afpId, totalHaberes);
  const afpNombre = (afpList.find((a) => a.id === record.afpId) || {}).nombre || "—";
  const fonasaValor = calcFonasaValor(totalHaberes);
  const isapreValor = calcIsapreValor(record.isapreUF, ufValor);
  const usaIsapre = record.tipoSalud === "isapre";
  const saludValor = usaIsapre ? isapreValor : fonasaValor;
  const apvValor = calcIsapreValor(record.descuentosLiquidacion, ufValor);
  const totalDescuento = apvValor + toNum(record.impuestos) + afpComisionValor + saludValor;
  const liquido = totalHaberes - totalDescuento - toNum(record.anticipos);
  const fechaGeneracion = new Date().toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" });
  const periodoLabel = monthLabel(ym);

  const breakdown = [
    { label: `Compras de vehículos (${record.comprasN || 0})`, value: totals.compras },
    { label: `Ventas (${record.ventasN || 0})`, value: totals.ventas },
    { label: `Seguros (${record.segurosN || 0})`, value: totals.seguros },
    { label: `Créditos (${record.creditosN || 0})`, value: totals.creditos },
    { label: `Consignaciones (${record.consigN || 0})`, value: totals.consignaciones },
    { label: `Inspecciones (${record.inspeccionesN || 0})`, value: totals.inspecciones || 0 },
  ];

  const handleDownload = () => {
    setDownloadError("");
    try {
      const blob = buildPreLiquidacionPdf({ vendor, ym, totals, record, liquido, afpList, ufValor });
      const url = URL.createObjectURL(blob);
      const safeName = (vendor.nombre || "ejecutivo").trim().replace(/\s+/g, "_");
      const a = document.createElement("a");
      a.href = url;
      a.download = `pre-liquidacion-${safeName}-${ym}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setDownloadError("No se pudo generar el archivo en este navegador. Prueba con Ctrl+P (Cmd+P en Mac) y elige 'Guardar como PDF'.");
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900/60 flex items-center justify-center p-4 z-50">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #pre-liquidacion-report, #pre-liquidacion-report * { visibility: visible; }
          #pre-liquidacion-report { position: absolute; top: 0; left: 0; width: 100%; padding: 24px; }
        }
      `}</style>
      <div className="bg-white max-w-2xl w-full max-h-full overflow-y-auto">
        <div id="pre-liquidacion-report" className="p-8">
          <div className="mb-6 border-b border-stone-300 pb-4">
            <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">Informe de Pre Liquidación</p>
            <h2 className="font-serif text-2xl text-stone-900">{vendor.nombre}</h2>
            <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-stone-600 mt-2">
              <span>RUT: {vendor.rut}</span>
              <span>Período: {periodoLabel}</span>
              <span>Fecha de generación: {fechaGeneracion}</span>
            </div>
          </div>

          <h3 className="font-serif text-lg text-stone-900 mb-3">Resumen de producción del mes</h3>
          <table className="w-full border-collapse text-sm mb-6">
            <tbody>
              {breakdown.map((b) => (
                <tr key={b.label} className="border-b border-stone-100">
                  <td className="py-1.5 text-stone-600">{b.label}</td>
                  <td className="py-1.5 text-right font-mono text-stone-900">{clp(b.value)}</td>
                </tr>
              ))}
              <tr className="border-t border-stone-300 font-medium">
                <td className="py-2 text-stone-900">Total producción</td>
                <td className="py-2 text-right font-mono text-stone-900">{clp(totals.total)}</td>
              </tr>
            </tbody>
          </table>

          <h3 className="font-serif text-lg text-stone-900 mb-3">Pre Liquidación</h3>
          <table className="w-full border-collapse text-sm mb-6">
            <tbody>
              <tr className="border-b border-stone-100">
                <td className="py-1.5 text-stone-600">Días trabajados</td>
                <td className="py-1.5 text-right font-mono text-stone-900">{record.diasTrabajados || "—"}</td>
              </tr>
              <tr>
                <td colSpan={2} className="pt-3 pb-1 text-xs uppercase tracking-wide text-stone-400">Haberes</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="py-1.5 text-stone-600 pl-2">Producción</td>
                <td className="py-1.5 text-right font-mono text-stone-900">{clp(totals.total)}</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="py-1.5 text-stone-600 pl-2">Sueldo base ($553.553) período 2026</td>
                <td className="py-1.5 text-right font-mono text-stone-900">{clp(record.sueldoBase)}</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="py-1.5 text-stone-600 pl-2">Semana Corrida</td>
                <td className="py-1.5 text-right font-mono text-stone-900">{clp(record.semanaCorrida)}</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="py-1.5 text-stone-600 pl-2">Bonos Imponibles</td>
                <td className="py-1.5 text-right font-mono text-stone-900">{clp(record.bonosImponibles)}</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="py-1.5 text-stone-600 pl-2">{record.gratificacionActiva === false ? "Gratificación (desactivada)" : "Gratificación"}</td>
                <td className="py-1.5 text-right font-mono text-stone-900">{clp(gratificacionValor(record.sueldoBase, record.gratificacionActiva))}</td>
              </tr>
              <tr className="border-b border-stone-300 font-medium">
                <td className="py-1.5 text-stone-900 pl-2">Total Haberes</td>
                <td className="py-1.5 text-right font-mono text-stone-900">{clp(totalHaberes)}</td>
              </tr>
              <tr>
                <td colSpan={2} className="pt-3 pb-1 text-xs uppercase tracking-wide text-stone-400">Descuento AFP</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="py-1.5 text-stone-600 pl-2">Comisión AFP ({afpNombre}, {afpComisionPct}%)</td>
                <td className="py-1.5 text-right font-mono text-stone-900">{clp(afpComisionValor)}</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="py-1.5 text-stone-600 pl-2">{usaIsapre ? "Descuento Salud (Isapre)" : "Descuento Salud (Fonasa 7%)"}</td>
                <td className="py-1.5 text-right font-mono text-stone-900">{clp(saludValor)}</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="py-1.5 text-stone-600 pl-2">APV en UF</td>
                <td className="py-1.5 text-right font-mono text-stone-900">{toNum(record.descuentosLiquidacion)} UF = {clp(apvValor)}</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="py-1.5 text-stone-600 pl-2">Impuestos</td>
                <td className="py-1.5 text-right font-mono text-stone-900">{clp(record.impuestos)}</td>
              </tr>
              <tr>
                <td colSpan={2} className="pb-2 pl-2 text-xs text-stone-400 italic">Los impuestos legales deben ser verificados en la liquidación final junto a contabilidad.</td>
              </tr>
              <tr className="border-b border-stone-300 font-medium">
                <td className="py-1.5 text-stone-900 pl-2">Total Descuento</td>
                <td className="py-1.5 text-right font-mono text-stone-900">{clp(totalDescuento)}</td>
              </tr>
              <tr className="border-b border-stone-100">
                <td className="py-1.5 text-stone-600 pt-3">Anticipos</td>
                <td className="py-1.5 text-right font-mono text-stone-900 pt-3">−{clp(record.anticipos)}</td>
              </tr>
            </tbody>
          </table>

          <div className="border-t-2 border-stone-900 pt-4 flex items-baseline justify-between">
            <span className="font-serif text-xl text-stone-900">Líquido a pago</span>
            <span className="font-mono text-3xl text-emerald-700">{clp(liquido)}</span>
          </div>
          <p className="text-xs text-stone-400 mt-2">
            El monto para los descuentos de salud y de AFP pueden variar, debido a la UF. Se recomienda generar la pre liquidación el mismo día del pago de remuneración.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2 p-4 border-t border-stone-200">
          {downloadError && <p className="text-xs text-rose-600">{downloadError}</p>}
          <p className="text-xs text-stone-400">El PDF se genera en tu navegador y se descarga a la carpeta de descargas configurada por tu navegador.</p>
          <div className="flex gap-3">
            <button onClick={onClose} className="border border-stone-300 px-4 py-2 text-sm text-stone-600 hover:bg-stone-50">Cerrar</button>
            <button onClick={handleDownload} className="bg-emerald-600 text-white px-4 py-2 text-sm hover:bg-emerald-700">
              Descargar PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   VISTA ANUAL (reutilizable: ejecutivo y admin)
========================================================= */
function AnnualView({ vendor, year, onYearChange, afpList = [], ufValor = DEFAULT_UF_VALOR }) {
  const [rows, setRows] = useState(null);
  const tierSet = resolveTiers(vendor);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRows(null);
      const arr = [];
      for (let m = 1; m <= 12; m++) {
        const ym = `${year}-${pad2(m)}`;
        const rec = await loadRecord(vendor.id, ym);
        const totals = computeTotals(rec, tierSet);
        const totalHaberesMes = totals.total + toNum(rec.sueldoBase) + toNum(rec.semanaCorrida) + toNum(rec.bonosImponibles) + gratificacionValor(rec.sueldoBase, rec.gratificacionActiva);
        const afpComisionMes = calcAfpComisionValor(afpList, rec.afpId, totalHaberesMes);
        const saludMes = calcSaludValor(rec.tipoSalud, rec.isapreUF, ufValor, totalHaberesMes);
        const apvMes = calcIsapreValor(rec.descuentosLiquidacion, ufValor);
        const liquido = totalHaberesMes - toNum(rec.anticipos) - apvMes - toNum(rec.impuestos) - afpComisionMes - saludMes;
        arr.push({ ym, label: MESES[m - 1], totals, liquido });
      }
      if (!cancelled) setRows(arr);
    })();
    return () => { cancelled = true; };
  }, [vendor.id, year, afpList, ufValor]);

  if (!rows) return <p className="text-sm text-stone-500 py-6">Cargando datos anuales…</p>;

  const annualTotal = rows.reduce((a, r) => a + r.totals.total, 0);
  const annualLiquido = rows.reduce((a, r) => a + r.liquido, 0);
  const chartData = rows.map((r) => ({ mes: r.label, "Producción": Math.round(r.totals.total), "Líquido a pago": Math.round(r.liquido) }));
  const cat = rows.reduce((acc, r) => ({
    compras: acc.compras + r.totals.compras,
    ventas: acc.ventas + r.totals.ventas,
    seguros: acc.seguros + r.totals.seguros,
    creditos: acc.creditos + r.totals.creditos,
    consignaciones: acc.consignaciones + r.totals.consignaciones,
    inspecciones: acc.inspecciones + (r.totals.inspecciones || 0),
    total: acc.total + r.totals.total,
  }), { compras: 0, ventas: 0, seguros: 0, creditos: 0, consignaciones: 0, inspecciones: 0, total: 0 });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <button onClick={() => onYearChange(year - 1)} className="border border-stone-300 px-3 py-1 text-sm text-stone-600 hover:bg-stone-50">← {year - 1}</button>
        <div className="flex gap-8 text-center">
          <div>
            <p className="text-xs uppercase tracking-widest text-stone-400">Producción anual {year}</p>
            <p className="font-mono text-3xl text-stone-900">{clp(annualTotal)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-stone-400">Líquido a pago anual</p>
            <p className="font-mono text-3xl text-emerald-700">{clp(annualLiquido)}</p>
          </div>
        </div>
        <button onClick={() => onYearChange(year + 1)} className="border border-stone-300 px-3 py-1 text-sm text-stone-600 hover:bg-stone-50">{year + 1} →</button>
      </div>

      <div className="bg-white border border-stone-200 p-5">
        <h4 className="font-serif text-base text-stone-900 mb-4">Producción y líquido a pago por mes</h4>
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" />
              <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#78716C" }} />
              <YAxis tick={{ fontSize: 11, fill: "#78716C" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={45} />
              <Tooltip formatter={(v) => clp(v)} labelStyle={{ color: "#1C1917" }} contentStyle={{ border: "1px solid #E7E5E4", fontSize: 13 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Producción" fill="#D97706" />
              <Bar dataKey="Líquido a pago" fill="#059669" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white border border-stone-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
              <th className="py-2 px-4">Mes</th>
              <th className="py-2 px-4 text-right">Producción</th>
              <th className="py-2 px-4 text-right">Líquido a pago</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ym} className="border-b border-stone-100">
                <td className="py-2 px-4 text-stone-700">{r.label}</td>
                <td className="py-2 px-4 text-right font-mono text-stone-900">{clp(r.totals.total)}</td>
                <td className="py-2 px-4 text-right font-mono text-emerald-700">{clp(r.liquido)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-stone-200 font-medium">
              <td className="py-2 px-4 text-stone-900">Total anual</td>
              <td className="py-2 px-4 text-right font-mono text-stone-900">{clp(annualTotal)}</td>
              <td className="py-2 px-4 text-right font-mono text-emerald-700">{clp(annualLiquido)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ProductionSummary totals={cat} title={`Desglose anual ${year}`} />
    </div>
  );
}

/* =========================================================
   PANEL EJECUTIVO
========================================================= */
/* =========================================================
   PANEL INSPECTOR
========================================================= */
function downloadPdfBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const recordIdFromKey = (key) => String(key).split("::").pop();
const horaCorta = () => new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
const fechaHoraCorta = (iso) =>
  iso ? new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

function RecordActions({ children }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">{children}</div>;
}
function ActionLink({ onClick, danger = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-sm py-1.5 hover:underline ${danger ? "text-rose-600" : "text-amber-700"}`}
    >
      {children}
    </button>
  );
}

function InspectorDashboard({ inspector, onExit }) {
  const [tab, setTab] = useState("inspeccion");

  // Borradores: se restauran una sola vez, antes del primer render, para que
  // el autoguardado no pise el borrador con un formulario vacío.
  const initRef = useRef(null);
  if (!initRef.current) {
    const restore = (kind, empty) => {
      const d = loadDraft(inspector.id, kind);
      if (!d || !isMeaningful(d.data, empty)) return { record: empty, editingId: null, savedAt: null };
      const { __editingId, ...rec } = d.data;
      return { record: { ...empty, ...rec }, editingId: __editingId || null, savedAt: d.savedAt };
    };
    initRef.current = { ins: restore("inspeccion", emptyInspeccion()), tas: restore("tasacion", emptyTasacion()) };
  }
  // Punto de comparación para decidir si hay "trabajo sin guardar" (vacío, o el registro que se está editando).
  const baselineRef = useRef({ ins: emptyInspeccion(), tas: emptyTasacion() });

  const [record, setRecord] = useState(initRef.current.ins.record);
  const [editingId, setEditingId] = useState(initRef.current.ins.editingId);
  const [restoredAt, setRestoredAt] = useState(initRef.current.ins.savedAt);
  const [draftNote, setDraftNote] = useState("");
  const [historial, setHistorial] = useState([]);
  const [loadingHist, setLoadingHist] = useState(true);
  const [saveMsg, setSaveMsg] = useState("");
  const [viewing, setViewing] = useState(null); // { key, data }

  const [tasacion, setTasacion] = useState(initRef.current.tas.record);
  const [editingTasId, setEditingTasId] = useState(initRef.current.tas.editingId);
  const [restoredTasAt, setRestoredTasAt] = useState(initRef.current.tas.savedAt);
  const [draftNoteTas, setDraftNoteTas] = useState("");
  const [historialTasaciones, setHistorialTasaciones] = useState([]);
  const [loadingHistTasaciones, setLoadingHistTasaciones] = useState(true);
  const [saveMsgTasacion, setSaveMsgTasacion] = useState("");
  const [viewingTasacion, setViewingTasacion] = useState(null);

  const refreshHistorial = async () => {
    setLoadingHist(true);
    setHistorial(await loadInspeccionesFor(inspector.id));
    setLoadingHist(false);
  };
  const refreshHistorialTasaciones = async () => {
    setLoadingHistTasaciones(true);
    setHistorialTasaciones(await loadTasacionesFor(inspector.id));
    setLoadingHistTasaciones(false);
  };
  useEffect(() => { refreshHistorial(); refreshHistorialTasaciones(); }, [inspector.id]);

  // Autoguardado del borrador (con una pequeña espera para no escribir en cada tecla).
  useEffect(() => {
    const t = setTimeout(() => {
      if (isMeaningful(record, baselineRef.current.ins)) {
        const r = saveDraft(inspector.id, "inspeccion", { ...record, __editingId: editingId });
        setDraftNote(!r.ok ? "No se pudo guardar el borrador en este dispositivo." : `Borrador guardado en este dispositivo · ${horaCorta()}${r.sinArchivo ? " (sin el PDF del CAV: pesa demasiado)" : ""}`);
      } else { clearDraft(inspector.id, "inspeccion"); setDraftNote(""); }
    }, 700);
    return () => clearTimeout(t);
  }, [record, editingId]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (isMeaningful(tasacion, baselineRef.current.tas)) {
        const r = saveDraft(inspector.id, "tasacion", { ...tasacion, __editingId: editingTasId });
        setDraftNoteTas(!r.ok ? "No se pudo guardar el borrador en este dispositivo." : `Borrador guardado en este dispositivo · ${horaCorta()}`);
      } else { clearDraft(inspector.id, "tasacion"); setDraftNoteTas(""); }
    }, 700);
    return () => clearTimeout(t);
  }, [tasacion, editingTasId]);

  const updateField = (field, value) => setRecord((prev) => ({ ...prev, [field]: value }));
  const updateChecklist = (itemId, patch) => {
    setRecord((prev) => ({
      ...prev,
      checklist: { ...prev.checklist, [itemId]: { ...(prev.checklist[itemId] || { estado: "", observacion: "" }), ...patch } },
    }));
  };
  const updateTasacionField = (field, value) => setTasacion((prev) => ({ ...prev, [field]: value }));
  const updateTasacionChecklist = (itemId, patch) => {
    setTasacion((prev) => ({
      ...prev,
      checklist: { ...prev.checklist, [itemId]: { ...(prev.checklist[itemId] || { nombre: "", estado: "", valor: 0 }), ...patch } },
    }));
  };

  const resetInspeccion = () => {
    baselineRef.current.ins = emptyInspeccion();
    setRecord(emptyInspeccion()); setEditingId(null); setRestoredAt(null); setDraftNote("");
    clearDraft(inspector.id, "inspeccion");
  };
  /* ---------- Fotos de la tasación ---------- */
  // Cada foto es un registro aparte (foto::<inspector>::<id>); la tasación solo guarda sus ids.
  const [photoBusy, setPhotoBusy] = useState({});
  const [photoErrors, setPhotoErrors] = useState({});
  // Ids de foto ya guardados con la tasación indicada. null = todavía no se sabe (el historial no ha cargado).
  const savedPhotoIds = (recordId) => {
    if (!recordId) return [];
    const h = historialTasaciones.find((x) => recordIdFromKey(x.id) === recordId);
    return h ? collectPhotoIds(h.data.checklist) : null;
  };
  // Fotos subidas en este formulario que aún no pertenecen a una tasación guardada.
  const unsavedPhotoIds = () => {
    const saved = savedPhotoIds(editingTasId);
    return saved === null ? [] : diffIds(collectPhotoIds(tasacion.checklist), saved);
  };
  const deletePhotos = (ids) => ids.forEach((id) => { photoCache.delete(id); window.storage.delete(photoKey(inspector.id, id), true); });

  const resetTasacion = ({ borrarFotos = true } = {}) => {
    if (borrarFotos) deletePhotos(unsavedPhotoIds());
    baselineRef.current.tas = emptyTasacion();
    setTasacion(emptyTasacion()); setEditingTasId(null); setRestoredTasAt(null); setDraftNoteTas("");
    clearDraft(inspector.id, "tasacion");
  };
  // ¿Hay algo sin guardar que se perdería al cargar otro registro en el formulario?
  const hayInspeccionSinGuardar = () => isMeaningful(record, baselineRef.current.ins);
  const hayTasacionSinGuardar = () => isMeaningful(tasacion, baselineRef.current.tas);

  const flash = (setter, msg, ms = 4000) => { setter(msg); setTimeout(() => setter(""), ms); };

  /* ---------- Inspección: guardar / editar / eliminar / PDF ---------- */
  const handleSave = async () => {
    const id = editingId || `${Date.now()}`;
    const now = new Date().toISOString();
    const toSave = { ...record, inspectorId: inspector.id, inspectorNombre: inspector.nombre, guardadoEl: editingId ? (record.guardadoEl || now) : now };
    if (editingId) toSave.editadoEl = now;
    const ok = await saveInspeccion(inspector.id, id, toSave);
    if (ok) {
      flash(setSaveMsg, editingId ? "Cambios guardados ✓" : "Inspección guardada ✓", 2500);
      resetInspeccion();
      refreshHistorial();
    } else {
      flash(setSaveMsg, "No se pudo guardar. Tus datos siguen en el borrador de este dispositivo; intenta de nuevo.");
    }
  };
  const startEditInspeccion = (h) => {
    if (hayInspeccionSinGuardar() && !window.confirm("Tienes una inspección sin guardar. ¿Reemplazarla por la que vas a editar?")) return;
    const rec = { ...emptyInspeccion(), ...h.data };
    baselineRef.current.ins = rec;
    setRecord(rec); setEditingId(recordIdFromKey(h.id)); setRestoredAt(null); setViewing(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const handleDeleteInspeccion = async (h) => {
    if (!window.confirm("¿Eliminar esta inspección? No se puede deshacer.")) return;
    const res = await deleteInspeccion(h.id);
    if (!res) { flash(setSaveMsg, "No se pudo eliminar. Intenta de nuevo."); return; }
    if (editingId && editingId === recordIdFromKey(h.id)) resetInspeccion();
    setViewing(null);
    flash(setSaveMsg, "Inspección eliminada ✓", 2500);
    refreshHistorial();
  };
  const handlePdfInspeccion = (data) => {
    try {
      const bytes = buildInspeccionPdf(data, { sections: CHECKLIST_SECTIONS, inspectorNombre: data.inspectorNombre || inspector.nombre });
      downloadPdfBytes(bytes, pdfFileName("Inspeccion", data));
    } catch (e) {
      console.error("No se pudo generar el PDF:", e);
      flash(setSaveMsg, "No se pudo generar el PDF.");
    }
  };

  /* ---------- Tasación: guardar / editar / eliminar / PDF ---------- */
  const handleSaveTasacion = async () => {
    const id = editingTasId || `${Date.now()}`;
    const now = new Date().toISOString();
    const toSave = { ...tasacion, inspectorId: inspector.id, inspectorNombre: inspector.nombre, guardadoEl: editingTasId ? (tasacion.guardadoEl || now) : now };
    if (editingTasId) toSave.editadoEl = now;
    const savedIds = savedPhotoIds(editingTasId);
    const ok = await saveTasacion(inspector.id, id, toSave);
    if (ok) {
      flash(setSaveMsgTasacion, editingTasId ? "Cambios guardados ✓" : "Tasación guardada ✓", 2500);
      // Fotos que tenía la tasación y ya no están: recién ahora se borran de la base.
      if (savedIds) deletePhotos(diffIds(savedIds, collectPhotoIds(tasacion.checklist)));
      resetTasacion({ borrarFotos: false });
      refreshHistorialTasaciones();
    } else {
      flash(setSaveMsgTasacion, "No se pudo guardar. Tus datos siguen en el borrador de este dispositivo; intenta de nuevo.");
    }
  };
  const startEditTasacion = (h) => {
    if (hayTasacionSinGuardar() && !window.confirm("Tienes una tasación sin guardar. ¿Reemplazarla por la que vas a editar?")) return;
    deletePhotos(unsavedPhotoIds());
    const rec = { ...emptyTasacion(), ...h.data };
    baselineRef.current.tas = rec;
    setTasacion(rec); setEditingTasId(recordIdFromKey(h.id)); setRestoredTasAt(null); setViewingTasacion(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const handleDeleteTasacion = async (h) => {
    if (!window.confirm("¿Eliminar esta tasación? No se puede deshacer.")) return;
    const res = await deleteTasacion(h.id);
    if (!res) { flash(setSaveMsgTasacion, "No se pudo eliminar. Intenta de nuevo."); return; }
    deletePhotos(collectPhotoIds(h.data.checklist)); // sus fotos se van con ella
    if (editingTasId && editingTasId === recordIdFromKey(h.id)) resetTasacion();
    setViewingTasacion(null);
    flash(setSaveMsgTasacion, "Tasación eliminada ✓", 2500);
    refreshHistorialTasaciones();
  };
  const handlePdfTasacion = (data) => {
    try {
      const bytes = buildTasacionPdf(data, { sections: TASACION_SECTIONS, getItems: getTasacionSectionItems, fmt: clp, inspectorNombre: data.inspectorNombre || inspector.nombre });
      downloadPdfBytes(bytes, pdfFileName("Tasacion", { ...data, inscripcion: data.patente }));
    } catch (e) {
      console.error("No se pudo generar el PDF:", e);
      flash(setSaveMsgTasacion, "No se pudo generar el PDF.");
    }
  };

  /* ---------- Conexión inspección → tasación ---------- */
  const tasacionDesdeInspeccion = (h) => ({
    propietario: h.data.propietarioNombre || "",
    vehiculo: [h.data.marca, h.data.modelo].filter(Boolean).join(" "),
    patente: h.data.inscripcion || "",
    anio: h.data.anio || "",
    inspeccionId: h.id,
  });
  const precargarTasacion = (h, { cambiarTab = true } = {}) => {
    if (hayTasacionSinGuardar() && !window.confirm("Tienes una tasación sin guardar. ¿Reemplazarla por una nueva basada en esta inspección?")) return;
    deletePhotos(unsavedPhotoIds());
    baselineRef.current.tas = emptyTasacion();
    setTasacion({ ...emptyTasacion(), ...tasacionDesdeInspeccion(h) });
    setEditingTasId(null); setRestoredTasAt(null); setViewingTasacion(null);
    if (cambiarTab) { setTab("tasaciones"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  };
  const inspeccionPorKey = (key) => historial.find((h) => h.id === key);
  const etiquetaInspeccion = (key) => {
    const h = key && inspeccionPorKey(key);
    return h ? `inspección del ${h.data.fecha} (${[h.data.marca, h.data.modelo].filter(Boolean).join(" ") || "sin marca"} · ${h.data.inscripcion || "sin patente"})` : "";
  };
  // Interfaz de fotos para los botones (+) del formulario de tasación.
  const setPhotoError = (itemId, msg) => setPhotoErrors((e) => ({ ...e, [itemId]: msg }));
  const photoApi = {
    inspectorId: inspector.id,
    busy: photoBusy,
    errors: photoErrors,
    add: async (itemId, file) => {
      setPhotoError(itemId, "");
      if (collectPhotoIds(tasacion.checklist).length >= MAX_PHOTOS_PER_TASACION) {
        setPhotoError(itemId, `Máximo ${MAX_PHOTOS_PER_TASACION} fotos por tasación.`);
        return;
      }
      setPhotoBusy((b) => ({ ...b, [itemId]: true }));
      try {
        const dataUrl = await compressImage(file);
        const photoId = makePhotoId();
        const stored = await window.storage.set(photoKey(inspector.id, photoId), dataUrl, true);
        if (!stored) throw new Error("subida_fallida");
        photoCache.set(photoId, dataUrl);
        setTasacion((prev) => {
          const cur = prev.checklist[itemId] || { nombre: "", estado: "", valor: 0 };
          return { ...prev, checklist: { ...prev.checklist, [itemId]: { ...cur, fotos: [...(cur.fotos || []), photoId] } } };
        });
      } catch (e) {
        setPhotoError(
          itemId,
          e.message === "no_es_imagen" ? "El archivo no es una imagen."
            : e.message === "imagen_muy_grande" ? "La foto es demasiado grande."
            : "No se pudo subir la foto. Revisa tu conexión e inténtalo de nuevo."
        );
      } finally {
        setPhotoBusy((b) => ({ ...b, [itemId]: false }));
      }
    },
    // Quita la foto de la tasación. Si ya estaba guardada, se borra de la base recién al guardar los cambios.
    remove: (itemId, photoId) => {
      setTasacion((prev) => {
        const cur = prev.checklist[itemId] || {};
        return { ...prev, checklist: { ...prev.checklist, [itemId]: { ...cur, fotos: (cur.fotos || []).filter((f) => f !== photoId) } } };
      });
      const saved = savedPhotoIds(editingTasId);
      if (saved !== null && !saved.includes(photoId)) deletePhotos([photoId]);
    },
  };
  const totalesTasacion = computeTasacionTotals(tasacion.checklist, TASACION_SECTIONS, getTasacionSectionItems);
  const tasadas = new Set(historialTasaciones.map((t) => t.data.inspeccionId).filter(Boolean));

  const tabBtn = (id, label) => (
    <button
      onClick={() => setTab(id)}
      className={`px-4 py-3 text-sm whitespace-nowrap ${tab === id ? "text-amber-400 border-b-2 border-amber-400" : "text-stone-400"}`}
    >
      {label}
    </button>
  );

  const barClass = "fixed bottom-0 inset-x-0 z-20 bg-white border-t border-stone-200 px-4 py-3 md:static md:z-auto md:bg-transparent md:border-0 md:p-0";

  return (
    <div className="min-h-screen bg-stone-100 pb-32 md:pb-16">
      <div className="bg-stone-900 text-stone-100">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-5 md:py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">Panel del inspector</p>
            <h1 className="font-serif text-2xl md:text-3xl">{inspector.nombre}</h1>
            <p className="text-xs text-stone-400 mt-1 capitalize">
              {new Date().toLocaleDateString("es-CL", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </p>
          </div>
          <button onClick={onExit} className="self-start md:self-auto border border-stone-700 px-3 py-2 text-sm text-stone-300 hover:bg-stone-800">Salir</button>
        </div>
        <div className="max-w-5xl mx-auto px-4 md:px-6 flex gap-2 border-t border-stone-800 overflow-x-auto">
          {tabBtn("inspeccion", "Inspección")}
          {tabBtn("tasaciones", "Tasaciones")}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 md:px-6 mt-6 md:mt-8 flex flex-col gap-6">
        {tab === "inspeccion" && (
          viewing ? (
            <>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <button onClick={() => setViewing(null)} className="text-sm text-stone-500 hover:underline py-1.5">← Volver al checklist</button>
                <ActionLink onClick={() => handlePdfInspeccion(viewing.data)}>Descargar PDF</ActionLink>
                <ActionLink onClick={() => startEditInspeccion(viewing)}>Editar</ActionLink>
                <ActionLink onClick={() => precargarTasacion(viewing)}>Crear tasación</ActionLink>
                <ActionLink danger onClick={() => handleDeleteInspeccion(viewing)}>Eliminar</ActionLink>
              </div>
              {saveMsg && <p className="text-xs text-stone-500">{saveMsg}</p>}
              <InspeccionForm key={"ver-" + viewing.id} record={viewing.data} onFieldChange={() => {}} onChecklistChange={() => {}} readOnly />
            </>
          ) : (
            <>
              {editingId && (
                <div className="bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-stone-700 flex flex-wrap items-center justify-between gap-2">
                  <span>Editando una inspección ya guardada{record.fecha ? ` (${record.fecha})` : ""}.</span>
                  <button onClick={() => { if (!hayInspeccionSinGuardar() || window.confirm("¿Cancelar la edición y descartar los cambios?")) resetInspeccion(); }} className="text-amber-800 hover:underline py-1">Cancelar edición</button>
                </div>
              )}
              {restoredAt && !editingId && (
                <div className="bg-sky-50 border border-sky-200 px-4 py-3 text-sm text-stone-700 flex flex-wrap items-center justify-between gap-2">
                  <span>Se recuperó el borrador guardado el {fechaHoraCorta(restoredAt)}</span>
                  <button onClick={() => { if (window.confirm("¿Descartar el borrador y empezar de cero?")) resetInspeccion(); }} className="text-sky-800 hover:underline py-1">Descartar borrador</button>
                </div>
              )}

              <InspeccionForm key={editingId || "nuevo"} record={record} onFieldChange={updateField} onChecklistChange={updateChecklist} />

              <div className={barClass}>
                <div className="flex flex-col md:flex-row md:items-center md:justify-end gap-2 md:gap-3">
                  <span className="text-xs text-stone-500 md:mr-auto">{saveMsg || draftNote}</span>
                  <div className="flex gap-2">
                    <button onClick={() => handlePdfInspeccion({ ...record, inspectorNombre: inspector.nombre })} className="flex-1 md:flex-none border border-stone-300 bg-white text-stone-700 px-4 py-3 md:py-2 text-sm hover:bg-stone-50">PDF</button>
                    <button onClick={handleSave} className="flex-[2] md:flex-none bg-stone-900 text-white px-4 py-3 md:py-2 text-sm font-medium hover:bg-stone-800">
                      {editingId ? "Guardar cambios" : "Guardar inspección"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-stone-200 p-4 md:p-5">
                <h3 className="font-serif text-lg text-stone-900 mb-4">Historial de inspecciones</h3>
                {loadingHist ? (
                  <p className="text-sm text-stone-500">Cargando…</p>
                ) : historial.length === 0 ? (
                  <p className="text-sm text-stone-500">Aún no hay inspecciones guardadas.</p>
                ) : (
                  <ul className="flex flex-col">
                    {historial.map((h) => (
                      <li key={h.id} className="border-b border-stone-100 py-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                          <span className="text-stone-900">{[h.data.marca, h.data.modelo].filter(Boolean).join(" ") || "—"}</span>
                          <span className="font-mono text-sm text-stone-600">{h.data.inscripcion || "—"}</span>
                        </div>
                        <div className="text-xs text-stone-500">
                          {h.data.fecha}
                          {h.data.editadoEl ? " · editada" : ""}
                          {tasadas.has(h.id) ? " · con tasación" : ""}
                        </div>
                        <RecordActions>
                          <ActionLink onClick={() => setViewing(h)}>Ver</ActionLink>
                          <ActionLink onClick={() => startEditInspeccion(h)}>Editar</ActionLink>
                          <ActionLink onClick={() => handlePdfInspeccion(h.data)}>PDF</ActionLink>
                          <ActionLink onClick={() => precargarTasacion(h)}>Crear tasación</ActionLink>
                          <ActionLink danger onClick={() => handleDeleteInspeccion(h)}>Eliminar</ActionLink>
                        </RecordActions>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )
        )}

        {tab === "tasaciones" && (
          viewingTasacion ? (
            <>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <button onClick={() => setViewingTasacion(null)} className="text-sm text-stone-500 hover:underline py-1.5">← Volver a Tasaciones</button>
                <ActionLink onClick={() => handlePdfTasacion(viewingTasacion.data)}>Descargar PDF</ActionLink>
                <ActionLink onClick={() => startEditTasacion(viewingTasacion)}>Editar</ActionLink>
                <ActionLink danger onClick={() => handleDeleteTasacion(viewingTasacion)}>Eliminar</ActionLink>
              </div>
              {saveMsgTasacion && <p className="text-xs text-stone-500">{saveMsgTasacion}</p>}
              <TasacionForm key={"ver-" + viewingTasacion.id} record={viewingTasacion.data} onFieldChange={() => {}} onChecklistChange={() => {}} readOnly inspeccionLabel={etiquetaInspeccion(viewingTasacion.data.inspeccionId)} />
            </>
          ) : (
            <>
              {editingTasId && (
                <div className="bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-stone-700 flex flex-wrap items-center justify-between gap-2">
                  <span>Editando una tasación ya guardada{tasacion.fecha ? ` (${tasacion.fecha})` : ""}.</span>
                  <button onClick={() => { if (!hayTasacionSinGuardar() || window.confirm("¿Cancelar la edición y descartar los cambios?")) resetTasacion(); }} className="text-amber-800 hover:underline py-1">Cancelar edición</button>
                </div>
              )}
              {restoredTasAt && !editingTasId && (
                <div className="bg-sky-50 border border-sky-200 px-4 py-3 text-sm text-stone-700 flex flex-wrap items-center justify-between gap-2">
                  <span>Se recuperó el borrador guardado el {fechaHoraCorta(restoredTasAt)}</span>
                  <button onClick={() => { if (window.confirm("¿Descartar el borrador y empezar de cero?")) resetTasacion(); }} className="text-sky-800 hover:underline py-1">Descartar borrador</button>
                </div>
              )}

              {!editingTasId && historial.length > 0 && (
                <div className="bg-white border border-stone-200 p-4">
                  <label className="text-xs text-stone-500 block mb-1">Precargar desde una inspección</label>
                  <select
                    value=""
                    onChange={(e) => { const h = inspeccionPorKey(e.target.value); if (h) precargarTasacion(h, { cambiarTab: false }); }}
                    className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">Seleccionar inspección…</option>
                    {historial.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.data.fecha} · {[h.data.marca, h.data.modelo].filter(Boolean).join(" ") || "sin marca"} · {h.data.inscripcion || "sin patente"}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <TasacionForm key={editingTasId || "nueva"} record={tasacion} onFieldChange={updateTasacionField} onChecklistChange={updateTasacionChecklist} inspeccionLabel={etiquetaInspeccion(tasacion.inspeccionId)} photos={photoApi} />

              <div className={barClass}>
                <div className="flex flex-col md:flex-row md:items-center md:justify-end gap-2 md:gap-3">
                  <span className="text-xs text-stone-500 md:mr-auto">
                    <strong className="text-stone-800">Total valorizaciones {clp(totalesTasacion.total)}</strong>
                    {(saveMsgTasacion || draftNoteTas) && <> · {saveMsgTasacion || draftNoteTas}</>}
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => handlePdfTasacion({ ...tasacion, inspectorNombre: inspector.nombre })} className="flex-1 md:flex-none border border-stone-300 bg-white text-stone-700 px-4 py-3 md:py-2 text-sm hover:bg-stone-50">PDF</button>
                    <button onClick={handleSaveTasacion} className="flex-[2] md:flex-none bg-stone-900 text-white px-4 py-3 md:py-2 text-sm font-medium hover:bg-stone-800">
                      {editingTasId ? "Guardar cambios" : "Guardar tasación"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-stone-200 p-4 md:p-5">
                <h3 className="font-serif text-lg text-stone-900 mb-4">Historial de tasaciones</h3>
                {loadingHistTasaciones ? (
                  <p className="text-sm text-stone-500">Cargando…</p>
                ) : historialTasaciones.length === 0 ? (
                  <p className="text-sm text-stone-500">Aún no hay tasaciones guardadas.</p>
                ) : (
                  <ul className="flex flex-col">
                    {historialTasaciones.map((h) => (
                      <li key={h.id} className="border-b border-stone-100 py-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                          <span className="text-stone-900">{h.data.vehiculo || "—"}</span>
                        </div>
                        <div className="text-xs text-stone-500">
                          {h.data.fecha} · <span className="font-mono">{h.data.patente || "—"}</span>
                          {h.data.editadoEl ? " · editada" : ""}
                          {h.data.inspeccionId ? " · desde inspección" : ""}
                        </div>
                        <ValorFinalResumen record={h.data} />
                        <RecordActions>
                          <ActionLink onClick={() => setViewingTasacion(h)}>Ver</ActionLink>
                          <ActionLink onClick={() => startEditTasacion(h)}>Editar</ActionLink>
                          <ActionLink onClick={() => handlePdfTasacion(h.data)}>PDF</ActionLink>
                          <ActionLink danger onClick={() => handleDeleteTasacion(h)}>Eliminar</ActionLink>
                        </RecordActions>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}

function VendorDashboard({ vendor, onExit }) {
  const [tab, setTab] = useState("mes");
  const [ym, setYm] = useState(currentYM());
  const [record, setRecord] = useState(emptyRecord());
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [year, setYear] = useState(currentYear());
  const [showReport, setShowReport] = useState(false);
  const [afpList, setAfpList] = useState([]);
  const [ufValor, setUfValor] = useState(DEFAULT_UF_VALOR);
  const tierSet = resolveTiers(vendor);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const rec = await loadRecord(vendor.id, ym);
      if (!cancelled) { setRecord(rec); setLoading(false); setDirty(false); setSaveMsg(""); }
    })();
    return () => { cancelled = true; };
  }, [vendor.id, ym]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadAfpList();
      const uf = await loadUfValor();
      if (!cancelled) { setAfpList(list); setUfValor(uf); }
    })();
    return () => { cancelled = true; };
  }, [vendor]);

  const update = (field, value) => { setRecord((prev) => ({ ...prev, [field]: value })); setDirty(true); setSaveMsg(""); };
  const updateCreditoRow = (i, field, value) => {
    setRecord((prev) => { const rows = [...prev.creditosRows]; rows[i] = { ...rows[i], [field]: value }; return { ...prev, creditosRows: rows }; });
    setDirty(true); setSaveMsg("");
  };
  const updateConsigRow = (i, field, value) => {
    setRecord((prev) => { const rows = [...prev.consigRows]; rows[i] = { ...rows[i], [field]: value }; return { ...prev, consigRows: rows }; });
    setDirty(true); setSaveMsg("");
  };

  const handleSave = async () => {
    setSaveMsg("Guardando…");
    const ok = await saveRecord(vendor.id, ym, record);
    setDirty(false);
    setSaveMsg(ok ? "Guardado ✓" : "No se pudo guardar, intenta de nuevo.");
  };

  const totals = useMemo(() => computeTotals(record, tierSet), [record, tierSet]);

  return (
    <div className="min-h-screen bg-stone-100 pb-16">
      <div className="bg-stone-900 text-stone-100">
        <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">Panel del ejecutivo</p>
            <h1 className="font-serif text-2xl md:text-3xl">{vendor.nombre}</h1>
            <p className="text-xs text-stone-400 mt-1">RUT {vendor.rut}</p>
            {hasCustomTiers(vendor) && (
              <span className="inline-block mt-2 text-xs bg-amber-500 text-stone-900 px-2 py-0.5 font-medium">Criterios personalizados</span>
            )}
          </div>
          <button onClick={onExit} className="self-start md:self-auto border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800">Salir</button>
        </div>
        <div className="max-w-5xl mx-auto px-6 flex gap-2 border-t border-stone-800">
          <button onClick={() => setTab("mes")} className={`px-4 py-3 text-sm ${tab === "mes" ? "text-amber-400 border-b-2 border-amber-400" : "text-stone-400"}`}>Producción del mes</button>
          <button onClick={() => setTab("anual")} className={`px-4 py-3 text-sm ${tab === "anual" ? "text-amber-400 border-b-2 border-amber-400" : "text-stone-400"}`}>Mi dashboard anual</button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 mt-8 flex flex-col gap-6">
        {tab === "mes" && (
          <>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-white border border-stone-200 p-4">
              <div className="flex items-center gap-3">
                <label className="text-sm text-stone-600">Mes</label>
                <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} className="border border-stone-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div className="flex items-center gap-3">
                {saveMsg && <span className="text-xs text-stone-500">{saveMsg}</span>}
                <button onClick={handleSave} disabled={!dirty} className={`px-4 py-2 text-sm font-medium ${dirty ? "bg-amber-500 text-stone-900 hover:bg-amber-400" : "bg-stone-200 text-stone-400 cursor-not-allowed"}`}>Guardar mes</button>
              </div>
            </div>

            {loading ? (
              <p className="text-sm text-stone-500">Cargando…</p>
            ) : (
              <>
                {(isModuleEnabled(vendor, "compras") || isModuleEnabled(vendor, "ventas") || isModuleEnabled(vendor, "seguros")) && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {isModuleEnabled(vendor, "compras") && (
                      <TierModule accent="amber" title="Compras de vehículos" unit="Compras" count={record.comprasN} onCount={(v) => update("comprasN", v)} tiers={tierSet.compras} />
                    )}
                    {isModuleEnabled(vendor, "ventas") && (
                      <TierModule accent="teal" title="Ventas" unit="Ventas" count={record.ventasN} onCount={(v) => update("ventasN", v)} tiers={tierSet.ventas} />
                    )}
                    {isModuleEnabled(vendor, "seguros") && (
                      <TierModule accent="indigo" title="Seguros" unit="Seguros" count={record.segurosN} onCount={(v) => update("segurosN", v)} tiers={tierSet.seguros} />
                    )}
                  </div>
                )}
                {isModuleEnabled(vendor, "creditos") && (
                  <CreditosModule count={record.creditosN} onCount={(v) => update("creditosN", v)} rows={record.creditosRows} onRowChange={updateCreditoRow} tiers={tierSet.creditos} />
                )}
                {isModuleEnabled(vendor, "consignaciones") && (
                  <ConsignacionesModule count={record.consigN} onCount={(v) => update("consigN", v)} rows={record.consigRows} onRowChange={updateConsigRow} tiers={tierSet.consignaciones} />
                )}
                {isModuleEnabled(vendor, "inspecciones") && (
                  <TierModule accent="cyan" title="Inspecciones" unit="Inspecciones" count={record.inspeccionesN} onCount={(v) => update("inspeccionesN", v)} tiers={tierSet.inspecciones} />
                )}
                <ProductionSummary totals={totals} title={`Resumen de ${ym}`} />
                <LiquidacionModule
                  sueldoBase={record.sueldoBase}
                  diasTrabajados={record.diasTrabajados}
                  semanaCorrida={record.semanaCorrida}
                  bonosImponibles={record.bonosImponibles}
                  gratificacionActiva={record.gratificacionActiva}
                  anticipos={record.anticipos}
                  descuentosLiquidacion={record.descuentosLiquidacion}
                  impuestos={record.impuestos}
                  afpId={record.afpId}
                  afpList={afpList}
                  tipoSalud={record.tipoSalud}
                  isapreUF={record.isapreUF}
                  ufValor={ufValor}
                  onChange={update}
                  totalProduccion={totals.total}
                  onGenerate={() => setShowReport(true)}
                />
              </>
            )}
          </>
        )}

        {tab === "anual" && <AnnualView vendor={vendor} year={year} onYearChange={setYear} afpList={afpList} ufValor={ufValor} />}
      </div>

      {showReport && (
        <ReportModal vendor={vendor} ym={ym} totals={totals} record={record} afpList={afpList} ufValor={ufValor} onClose={() => setShowReport(false)} />
      )}
    </div>
  );
}

/* =========================================================
   PANEL ADMINISTRADOR
========================================================= */
/* =========================================================
   AUTENTICACIÓN DEL ADMINISTRADOR
========================================================= */
function AdminAuthGate({ onSuccess, onExit }) {
  const [config, setConfig] = useState(undefined); // undefined=cargando, false=sin clave adicional, true=con clave adicional
  const [mode, setMode] = useState("login"); // login | setup | recover | reset | show-code
  const [error, setError] = useState("");

  // setup / reset
  const [email, setEmail] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [masterEmail, setMasterEmail] = useState("");
  const [masterPw, setMasterPw] = useState("");
  const [newRecoveryCode, setNewRecoveryCode] = useState("");
  const [savedCodeConfirmed, setSavedCodeConfirmed] = useState(false);

  // login
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPw, setLoginPw] = useState("");

  // recover
  const [recoveryInput, setRecoveryInput] = useState("");

  useEffect(() => {
    (async () => {
      setConfig(await window.auth.adminStatus());
      setMode("login");
    })();
  }, []);

  const handleSetup = async () => {
    setError("");
    if (!email.trim() || !email.includes("@")) { setError("Ingresa un correo válido (se guarda como referencia, no se envían correos)."); return; }
    if (!isValidAdminPassword(pw1)) { setError("La clave debe tener al menos 8 caracteres, con letras y números."); return; }
    if (pw1 !== pw2) { setError("Las claves no coinciden."); return; }
    try {
      const code = await window.auth.adminSetup({ masterEmail: masterEmail.trim(), masterPassword: masterPw, email: email.trim(), password: pw1 });
      setNewRecoveryCode(code);
      setMasterPw("");
      setMode("show-code");
    } catch (e) {
      setError(authErrorMessage(e, "La clave maestra es incorrecta o no se pudo guardar la configuración."));
    }
  };

  const handleLogin = async () => {
    setError("");
    try {
      await window.auth.adminLogin(loginEmail.trim(), loginPw);
      setLoginPw("");
      onSuccess();
    } catch (e) {
      setError(authErrorMessage(e, "Correo o clave incorrectos."));
    }
  };

  const handleRecoverCheck = async () => {
    setError("");
    try {
      await window.auth.adminRecoverCheck(recoveryInput.trim());
      setMode("reset");
    } catch (e) {
      setError(authErrorMessage(e, "Código de recuperación incorrecto."));
    }
  };

  const handleReset = async () => {
    setError("");
    if (!isValidAdminPassword(pw1)) { setError("La clave debe tener al menos 8 caracteres, con letras y números."); return; }
    if (pw1 !== pw2) { setError("Las claves no coinciden."); return; }
    try {
      const code = await window.auth.adminReset(recoveryInput.trim(), pw1);
      setNewRecoveryCode(code);
      setMode("show-code");
    } catch (e) {
      setError(authErrorMessage(e, "No se pudo guardar la nueva clave, intenta de nuevo."));
    }
  };

  if (config === undefined) {
    return <div className="min-h-screen bg-stone-100 flex items-center justify-center text-stone-500 text-sm">Cargando…</div>;
  }

  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center px-6">
      <div className="max-w-md w-full bg-white border border-stone-200 p-6 flex flex-col gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">Acceso administrador</p>
          <h2 className="font-serif text-xl text-stone-900">
            {mode === "login" && "Ingresa tu clave"}
            {mode === "setup" && "Crea tu clave de acceso"}
            {mode === "recover" && "Recuperar acceso"}
            {mode === "reset" && "Define una nueva clave"}
            {mode === "show-code" && "Guarda tu código de recuperación"}
          </h2>
        </div>

        {mode === "setup" && (
          <>
            <p className="text-xs text-stone-500">
              Crea una clave adicional para este panel (útil si otra persona también necesita acceso, sin compartir la clave maestra).
              Define una clave alfanumérica (mínimo 8 caracteres, con letras y números) y un correo asociado.
              Nota: este entorno no puede enviar correos reales — en su lugar, se generará un código de recuperación que deberás guardar tú mismo.
            </p>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Correo maestro</label>
              <input type="email" value={masterEmail} onChange={(e) => setMasterEmail(e.target.value)}
                className="w-full border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Clave maestra (para autorizar este cambio)</label>
              <input type="password" value={masterPw} onChange={(e) => setMasterPw(e.target.value)}
                className="w-full border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Correo de referencia</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com"
                className="w-full border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Clave de acceso</label>
              <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)}
                className="w-full border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Confirmar clave</label>
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSetup(); }}
                className="w-full border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button type="button" onClick={handleSetup} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800">Crear clave</button>
            <button type="button" onClick={() => { setError(""); setMode("login"); }} className="text-xs text-stone-500 hover:underline self-start">Volver</button>
          </>
        )}

        {mode === "login" && (
          <>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Correo</label>
              <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="tu@correo.com"
                className="w-full border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" autoFocus />
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Clave de acceso</label>
              <input type="password" value={loginPw} onChange={(e) => setLoginPw(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
                className="w-full border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button type="button" onClick={handleLogin} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800">Entrar</button>
            <div className="flex items-center justify-between">
              {config && (
                <button type="button" onClick={() => { setError(""); setMode("recover"); }} className="text-xs text-stone-500 hover:underline">¿Olvidaste tu clave?</button>
              )}
              <button type="button" onClick={() => { setError(""); setEmail(""); setPw1(""); setPw2(""); setMode("setup"); }} className="text-xs text-stone-500 hover:underline">
                {config ? "Cambiar clave adicional" : "Crear una clave adicional"}
              </button>
            </div>
          </>
        )}

        {mode === "recover" && (
          <>
            <p className="text-xs text-stone-500">Ingresa el código de recuperación que guardaste al crear tu clave.</p>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Código de recuperación</label>
              <input type="text" value={recoveryInput} onChange={(e) => setRecoveryInput(e.target.value)} placeholder="XXXX-XXXX-XXXX"
                onKeyDown={(e) => { if (e.key === "Enter") handleRecoverCheck(); }}
                className="w-full border border-stone-300 px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button type="button" onClick={handleRecoverCheck} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800">Verificar código</button>
            <button type="button" onClick={() => { setError(""); setMode("login"); }} className="text-xs text-stone-500 hover:underline self-start">Volver</button>
          </>
        )}

        {mode === "reset" && (
          <>
            <p className="text-xs text-stone-500">Código verificado. Define tu nueva clave de acceso.</p>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Nueva clave</label>
              <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)}
                className="w-full border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">Confirmar nueva clave</label>
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleReset(); }}
                className="w-full border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button type="button" onClick={handleReset} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800">Guardar nueva clave</button>
          </>
        )}

        {mode === "show-code" && (
          <>
            <p className="text-sm text-stone-700">
              Guarda este código de recuperación en un lugar seguro. Es la única forma de recuperar el acceso si olvidas tu clave, y solo se muestra una vez.
            </p>
            <div className="bg-amber-50 border border-amber-300 px-4 py-3 text-center">
              <span className="font-mono text-lg tracking-wider text-stone-900">{newRecoveryCode}</span>
            </div>
            <label className="flex items-center gap-2 text-xs text-stone-600">
              <input type="checkbox" checked={savedCodeConfirmed} onChange={(e) => setSavedCodeConfirmed(e.target.checked)} />
              Ya guardé este código en un lugar seguro.
            </label>
            <button
              type="button"
              disabled={!savedCodeConfirmed}
              onClick={() => { setError(""); setPw1(""); setPw2(""); setMode("login"); setConfig(true); }}
              className={`px-4 py-2 text-sm font-medium ${savedCodeConfirmed ? "bg-stone-900 text-white hover:bg-stone-800" : "bg-stone-200 text-stone-400 cursor-not-allowed"}`}
            >
              Continuar e iniciar sesión
            </button>
          </>
        )}

        <button type="button" onClick={onExit} className="text-xs text-stone-400 hover:underline self-start mt-2">← Volver al inicio</button>
      </div>
    </div>
  );
}

/* =========================================================
   TASACIÓN DE COMPRA (panel del administrador)
   Estima cuánto pagar por un vehículo a partir de los avisos de Chileautos.
   Nada se guarda: el cálculo vive solo en pantalla.
========================================================= */
const titleCase = (s) => String(s || "").toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase());

function TasacionCompra() {
  const [patente, setPatente] = useState("");
  const [km, setKm] = useState("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anio, setAnio] = useState("");
  const [version, setVersion] = useState("");
  const [margenAnio, setMargenAnio] = useState(1);
  const [transmision, setTransmision] = useState("");
  const [combustible, setCombustible] = useState("");
  const [margenBruto, setMargenBruto] = useState(MARGEN_BRUTO_DEFECTO);
  const [cav, setCav] = useState({ name: "", data: "" });
  const [cavMsg, setCavMsg] = useState("");
  const [leyendo, setLeyendo] = useState(false);
  const [pegado, setPegado] = useState("");
  const [copiado, setCopiado] = useState(false);
  const bmRef = useRef(null);
  const bmPatenteRef = useRef(null);
  const [pegadoPatente, setPegadoPatente] = useState("");
  const [msgPatente, setMsgPatente] = useState(null);
  const [copiadoPatente, setCopiadoPatente] = useState(false);

  // React no deja poner un enlace "javascript:" desde JSX, así que se asigna directo al elemento.
  useEffect(() => {
    if (bmRef.current) bmRef.current.setAttribute("href", buildBookmarkletHref());
    if (bmPatenteRef.current) bmPatenteRef.current.setAttribute("href", buildPatenteBookmarkletHref());
  }, []);

  const kmNum = parseKm(km);
  const patenteOk = isPatenteValida(patente);
  const filtros = calcularFiltros({ anio, km: kmNum, margenAnio });
  const urlBusqueda = patenteOk ? buildChileautosUrl({ marca, modelo, anio, km: kmNum, margenAnio, transmision, combustible }) : null;
  const transLabel = (TRANSMISIONES.find((t) => t.value === transmision) || {}).label;
  const combLabel = (COMBUSTIBLES.find((c) => c.value === combustible) || {}).label;

  const faltantes = [];
  if (!patenteOk) faltantes.push(patente ? "patente válida (ej. TTHY51)" : "patente");
  if (!kmNum) faltantes.push("kilometraje");
  if (!marca.trim()) faltantes.push("marca");
  if (!modelo.trim()) faltantes.push("modelo");
  if (!parseKm(anio)) faltantes.push("año");

  const handleCavLoaded = async (name, data) => {
    setCav({ name, data });
    setCavMsg("");
    setLeyendo(true);
    try {
      const fields = parseCavFields(await extractPdfText(data));
      const mv = splitModeloVersion(fields.modelo);
      const llenados = [];
      if (fields.marca) { setMarca(titleCase(fields.marca)); llenados.push("marca"); }
      if (mv.modelo) { setModelo(titleCase(mv.modelo)); llenados.push("modelo"); }
      if (fields.anio) { setAnio(fields.anio); llenados.push("año"); }
      if (mv.version) { setVersion(fields.modelo.slice(mv.modelo.length).trim()); llenados.push("versión"); }
      setCavMsg(llenados.length
        ? `Se completaron: ${llenados.join(", ")}. Revísalos: si el modelo tiene más de una palabra (ej. "Land Cruiser"), corrígelo.`
        : "No se detectaron datos en este PDF. Completa marca, modelo y año a mano.");
    } catch (e) {
      console.warn("No se pudo leer el CAV:", e);
      setCavMsg("No se pudo leer el PDF. Completa los datos a mano.");
    } finally {
      setLeyendo(false);
    }
  };

  // Cálculo derivado del texto pegado: se actualiza solo al pegar o al cambiar filtros.
  const calculo = useMemo(() => {
    if (!pegado.trim()) return null;
    const p = parseAvisosPegados(pegado);
    if (!p.ok) return { error: p.error };
    if (p.data.sinResultados) return { sinResultados: true };
    if (!p.data.listings.length) return { error: "La página de Chileautos no tenía avisos. Revisa que el marcador se usó en la lista de resultados." };
    const r = estimarCompra(p.data.listings, { ...filtros, transmision, combustible }, { margenBruto });
    let otraBusqueda = false;
    try {
      const u = decodeURIComponent(p.data.url || "").toLowerCase();
      const trans = TRANSMISIONES.find((t) => t.value === transmision);
      const comb = COMBUSTIBLES.find((c) => c.value === combustible);
      otraBusqueda = !(u.includes(`marca.${marca.trim().toLowerCase()}`) && u.includes(`modelo.${modelo.trim().toLowerCase()}`)
        && u.includes(`range(${filtros.anioMin}..${filtros.anioMax})`)
        && (!trans || u.includes(`transmisión.${trans.variantes[0].toLowerCase()}`))
        && (!comb || u.includes(`combustible.${comb.chileautos.toLowerCase()}`)));
    } catch (e) { otraBusqueda = false; }
    return { ...r, otraBusqueda };
  }, [pegado, marca, modelo, anio, km, margenAnio, transmision, combustible, margenBruto]);

  const copiarMarcador = async () => {
    try { await navigator.clipboard.writeText(buildBookmarkletHref()); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch (e) { /* sin permiso: queda el botón arrastrable */ }
  };
  const copiarMarcadorPatente = async () => {
    try { await navigator.clipboard.writeText(buildPatenteBookmarkletHref()); setCopiadoPatente(true); setTimeout(() => setCopiadoPatente(false), 2500); } catch (e) { /* sin permiso: queda el botón arrastrable */ }
  };
  // Al pegar lo que copió el marcador de patentechile.com se completan marca, modelo y año. La patente
  // se ingresa a mano: solo se rellena si estaba vacía, y si no coincide con la copiada se avisa.
  const aplicarDatosPatente = (texto) => {
    setPegadoPatente(texto);
    if (!texto.trim()) { setMsgPatente(null); return; }
    const p = parseDatosPatente(texto);
    if (!p.ok) { setMsgPatente({ mal: true, texto: p.error, etiquetas: p.etiquetas || [] }); return; }
    const d = p.data;
    setMarca(titleCase(d.marca)); setModelo(titleCase(d.modelo)); setAnio(String(d.anio));
    const avisos = [];
    if (d.patente && !patente) setPatente(d.patente);
    if (d.patente && patente && patente !== d.patente) avisos.push(`La patente de la ficha (${d.patente}) no coincide con la que ingresaste (${patente}). Revisa que sea el vehículo correcto.`);
    if (d.modelo.trim().split(/\s+/).length > 1) avisos.push("El modelo trae varias palabras. Para Chileautos deja solo el nombre del modelo (ej. \"Yaris\", sin la versión), salvo modelos como \"Land Cruiser\".");
    setMsgPatente({ mal: false, texto: `Se completaron marca, modelo y año${d.patente && !patente ? " y la patente" : ""}.`, avisos });
  };
  const limpiar = () => { setPegadoPatente(""); setMsgPatente(null); setPatente(""); setKm(""); setMarca(""); setModelo(""); setAnio(""); setVersion(""); setTransmision(""); setCombustible(""); setMargenBruto(MARGEN_BRUTO_DEFECTO); setCav({ name: "", data: "" }); setCavMsg(""); setPegado(""); };

  const Tarjeta = ({ titulo, sub, valor, destacado = false }) => (
    <div className={`p-4 border ${destacado ? "bg-stone-900 text-stone-100 border-stone-900" : "bg-white border-stone-200"}`}>
      <p className={`text-xs uppercase tracking-wide ${destacado ? "text-stone-400" : "text-stone-500"}`}>{titulo}</p>
      <p className="font-mono text-2xl md:text-3xl mt-1">{clp(valor)}</p>
      <p className={`text-xs mt-1 ${destacado ? "text-stone-400" : "text-stone-500"}`}>{sub}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-stone-200 p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="font-serif text-lg text-stone-900">Tasación de compra</h3>
            <p className="text-xs text-stone-500 mt-0.5">Estima cuánto pagar por un vehículo con los avisos de Chileautos. Nada de esto se guarda.</p>
          </div>
          <button type="button" onClick={limpiar} className="text-xs text-stone-500 hover:underline shrink-0 py-1">Limpiar</button>
        </div>

        <p className="text-xs uppercase tracking-widest text-stone-400 mb-2">1 · Datos del vehículo</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-stone-500 block mb-1">Patente *</label>
            <input type="text" value={patente} onChange={(e) => setPatente(normalizePatente(e.target.value))} placeholder="Ej. TTHY51" maxLength={6}
              className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-amber-500" />
            {patente.length === 6 && !patenteOk && <p className="text-xs text-rose-600 mt-1">Formato no válido (4 letras y 2 números, o 2 letras y 4 números).</p>}
          </div>
          <div>
            <label className="text-xs text-stone-500 block mb-1">Kilometraje *</label>
            <input type="text" inputMode="numeric" value={kmNum ? kmNum.toLocaleString("es-CL") : ""} onChange={(e) => setKm(e.target.value)} placeholder="Ej. 60.000"
              className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          <div>
            <label className="text-xs text-stone-500 block mb-1">Búsqueda por año</label>
            <select value={margenAnio} onChange={(e) => setMargenAnio(Number(e.target.value))}
              className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
              <option value={1}>Año del vehículo ±1</option>
              <option value={0}>Solo el año exacto</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="text-xs text-stone-500 block mb-1">CAV (opcional): completa marca, modelo, año y versión</label>
          <PdfDropzone fileName={cav.name} fileData={cav.data} onFileLoaded={handleCavLoaded} onRemove={() => { setCav({ name: "", data: "" }); setCavMsg(""); }} />
          {leyendo && <p className="text-xs text-stone-500 mt-2">Leyendo el CAV…</p>}
          {!leyendo && cavMsg && <p className="text-xs text-stone-500 mt-2">{cavMsg}</p>}
        </div>

        <div className="mt-4 border-t border-stone-200 pt-4">
          <p className="text-sm text-stone-700 font-medium mb-1">O con patentechile.com (alternativa al CAV)</p>
          <p className="text-xs text-stone-500 mb-2">
            Entra al sitio, busca la patente a mano y, con la ficha del vehículo abierta, pulsa el favorito. Copia <strong>solo</strong> patente, marca, modelo y año:
            nunca nombre, RUT ni dirección del dueño. El sitio puede pedir una verificación de seguridad: la completas tú.
          </p>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <a href="https://www.patentechile.com/" target="_blank" rel="noopener noreferrer"
              className="inline-block bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800">Abrir patentechile.com ↗</a>
            <a ref={bmPatenteRef} onClick={(e) => e.preventDefault()} draggable="true"
              className="inline-block border-2 border-dashed border-amber-500 bg-amber-50 text-amber-900 px-3 py-2 text-sm font-medium cursor-grab">⭐ Copiar datos de patente</a>
            <button type="button" onClick={copiarMarcadorPatente} className="text-xs text-stone-600 hover:underline py-2">
              {copiadoPatente ? "Código copiado ✓" : "No puedo arrastrarlo: copiar el código del marcador"}
            </button>
          </div>
          <textarea value={pegadoPatente} onChange={(e) => aplicarDatosPatente(e.target.value)} rows={2} placeholder="Pega aquí lo que copió el marcador de patente (Ctrl+V)"
            className="w-full border border-stone-300 bg-white px-2 py-1.5 text-xs font-mono text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500" />
          {msgPatente && (
            <div className="mt-2 flex flex-col gap-1">
              <p className={`text-xs ${msgPatente.mal ? "text-rose-600" : "text-emerald-700"}`}>{msgPatente.texto}</p>
              {(msgPatente.avisos || []).map((a) => <p key={a} className="text-xs text-amber-800">⚠ {a}</p>)}
              {msgPatente.mal && msgPatente.etiquetas && msgPatente.etiquetas.length > 0 && (
                <p className="text-xs text-stone-500">Campos que vio la página (sin sus valores): {msgPatente.etiquetas.join(" · ")}. Si quieres que lo ajuste, envíame esta lista.</p>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
          <TextField label="Marca *" value={marca} onChange={setMarca} placeholder="Ej. Toyota" />
          <TextField label="Modelo *" value={modelo} onChange={setModelo} placeholder="Ej. Yaris" />
          <TextField label="Año *" value={anio} onChange={(v) => setAnio(v.replace(/\D/g, "").slice(0, 4))} placeholder="Ej. 2020" />
          <TextField label="Versión" value={version} onChange={setVersion} placeholder="Ej. 1.5 GLI" />
          <div>
            <label className="text-xs text-stone-500 block mb-1">Transmisión</label>
            <select value={transmision} onChange={(e) => setTransmision(e.target.value)}
              className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500">
              <option value="">Seleccionar</option>
              {TRANSMISIONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-stone-500 block mb-1">Combustible</label>
            <select value={combustible} onChange={(e) => setCombustible(e.target.value)}
              className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500">
              <option value="">Seleccionar</option>
              {COMBUSTIBLES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white border border-stone-200 p-4 md:p-5">
        <p className="text-xs uppercase tracking-widest text-stone-400 mb-2">2 · Buscar en Chileautos</p>
        {urlBusqueda ? (
          <>
            <a href={urlBusqueda} target="_blank" rel="noopener noreferrer"
              className="inline-block bg-stone-900 text-white px-4 py-2.5 text-sm font-medium hover:bg-stone-800">Abrir la búsqueda en Chileautos ↗</a>
            <p className="text-xs text-stone-500 mt-2">
              Filtros aplicados: {marca} {modelo} · año {filtros.anioMin === filtros.anioMax ? filtros.anioMin : `${filtros.anioMin}–${filtros.anioMax}`} ·
              {" "}{filtros.kmMin.toLocaleString("es-CL")}–{filtros.kmMax.toLocaleString("es-CL")} km
              {transLabel ? ` · transmisión ${transLabel.toLowerCase()}` : ""}{combLabel ? ` · combustible ${combLabel.toLowerCase()}` : ""} · orden: precio más bajo.
            </p>
            <p className="text-xs text-stone-500 mt-1">Si Chileautos muestra "Vehículos parecidos a lo que buscas", el modelo no existe con ese nombre: corrígelo arriba.</p>
          </>
        ) : (
          <p className="text-sm text-stone-500">Completa {faltantes.join(", ")} para armar la búsqueda.</p>
        )}

        <div className="mt-4 border-t border-stone-200 pt-4">
          <p className="text-sm text-stone-700 font-medium mb-1">Marcador para copiar los avisos</p>
          <p className="text-xs text-stone-500 mb-2">Chileautos no permite leer sus avisos desde un servidor, pero tu navegador sí puede. Se instala una sola vez:</p>
          <ol className="text-xs text-stone-600 list-decimal pl-5 flex flex-col gap-1 mb-3">
            <li>Muestra la barra de favoritos (Ctrl+Shift+B) y <strong>arrastra este botón</strong> a ella.</li>
            <li>En la página de Chileautos que abriste, pulsa ese favorito: copia los avisos y muestra "N avisos copiados".</li>
            <li>Vuelve aquí y pega abajo.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <a ref={bmRef} onClick={(e) => e.preventDefault()} draggable="true"
              className="inline-block border-2 border-dashed border-amber-500 bg-amber-50 text-amber-900 px-3 py-2 text-sm font-medium cursor-grab">⭐ Copiar avisos Chileautos</a>
            <button type="button" onClick={copiarMarcador} className="text-xs text-stone-600 hover:underline py-2">
              {copiado ? "Código copiado ✓" : "No puedo arrastrarlo: copiar el código del marcador"}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-stone-200 p-4 md:p-5">
        <p className="text-xs uppercase tracking-widest text-stone-400 mb-2">3 · Margen bruto y avisos copiados</p>
        <div className="max-w-xs mb-4">
          <label className="text-xs text-stone-500 block mb-1">Margen bruto (se descuenta del precio promedio para el precio de compra)</label>
          <select value={margenBruto} onChange={(e) => setMargenBruto(Number(e.target.value))}
            className="w-full border border-stone-300 bg-white px-2 py-1.5 text-sm font-mono text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500">
            {MARGENES_BRUTOS.map((m) => <option key={m} value={m}>{clp(m)}</option>)}
          </select>
        </div>
        <label className="text-xs text-stone-500 block mb-1">Avisos copiados con el marcador</label>
        <textarea value={pegado} onChange={(e) => setPegado(e.target.value)} rows={3} placeholder="Pega aquí lo que copió el marcador (Ctrl+V)"
          className="w-full border border-stone-300 bg-white px-2 py-1.5 text-xs font-mono text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500" />
        {calculo && calculo.error && <p className="text-xs text-rose-600 mt-2">{calculo.error}</p>}
        {calculo && calculo.sinResultados && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 mt-2">
            Chileautos no tiene avisos exactos para este filtro (mostró "vehículos parecidos"). Revisa el modelo, o prueba con "Año ±1" y otro kilometraje.
          </p>
        )}
      </div>

      {calculo && calculo.ok && (
        <div className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-widest text-stone-400">4 · Resultado</p>
          {calculo.otraBusqueda && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2">
              Estos avisos parecen venir de otra búsqueda (otro modelo, año o kilometraje). Abre la búsqueda de arriba y vuelve a copiar.
            </p>
          )}
          {calculo.advertencias.map((w) => <p key={w} className="text-xs text-amber-800">⚠ {w}</p>)}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Tarjeta titulo="Precio promedio" sub={`Promedio de los ${calculo.primeros.length} avisos más baratos`} valor={calculo.promedioPrimeros} />
            <Tarjeta titulo="Precio sugerido de publicación" sub={`Precio promedio + ${clp(calculo.incremento)}`} valor={calculo.publicacion} />
            <Tarjeta titulo="Precio sugerido de compra" sub={`Precio promedio − margen bruto ${clp(calculo.margenBruto)}`} valor={calculo.compra} destacado />
          </div>
          <p className="text-xs text-stone-500">Estimación referencial a partir de precios de publicación, no de ventas concretadas.</p>

          <details className="bg-white border border-stone-200 p-4 text-sm">
            <summary className="cursor-pointer text-stone-700">Ver el detalle del cálculo ({calculo.validos.length} usados, {calculo.descartados.length} descartados)</summary>
            <div className="overflow-x-auto mt-3">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-stone-400 border-b border-stone-200">
                    <th className="py-1.5 pr-2">Aviso</th><th className="py-1.5 pr-2">Año</th><th className="py-1.5 pr-2 text-right">Km</th><th className="py-1.5 pr-2 text-right">Precio</th><th className="py-1.5 pr-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {calculo.validos.map((v, i) => (
                    <tr key={v.id} className={`border-b border-stone-100 ${i < calculo.primeros.length ? "bg-amber-50" : ""}`}>
                      <td className="py-1.5 pr-2"><a href={`https://www.chileautos.cl${v.href}`} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">{v.titulo || v.id}{v.version ? ` · ${v.version}` : ""}</a></td>
                      <td className="py-1.5 pr-2">{v.anio || "—"}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{v.km ? v.km.toLocaleString("es-CL") : "—"}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{clp(v.precio)}</td>
                      <td className="py-1.5 pr-2 text-stone-600">{i < calculo.primeros.length ? "Entra al promedio" : "Válido, fuera del promedio"}</td>
                    </tr>
                  ))}
                  {calculo.descartados.map((d, i) => (
                    <tr key={`${d.id}-${i}`} className="border-b border-stone-100 text-stone-400">
                      <td className="py-1.5 pr-2">{d.titulo || d.id}</td>
                      <td className="py-1.5 pr-2">{d.anio || "—"}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{d.km ? d.km.toLocaleString("es-CL") : "—"}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{d.precio ? clp(d.precio) : "—"}</td>
                      <td className="py-1.5 pr-2 text-rose-600">Descartado: {d.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
      {calculo && calculo.ok === false && <p className="text-sm text-rose-600">{calculo.error}</p>}
    </div>
  );
}

function AdminDashboard({ vendors, setVendors, inspectors, setInspectors, onExit }) {
  const [tab, setTab] = useState("resumen");
  const [selectedYM, setSelectedYM] = useState(currentYM());
  const [monthlyTotals, setMonthlyTotals] = useState({});
  const [loadingTotals, setLoadingTotals] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedRecord, setExpandedRecord] = useState(null);
  const [expandedShowDetail, setExpandedShowDetail] = useState(false);
  const [expandedShowAnnual, setExpandedShowAnnual] = useState(false);
  const [expandedYear, setExpandedYear] = useState(currentYear());

  // formulario alta de vendedor
  const [formNombre, setFormNombre] = useState("");
  const [formNacimiento, setFormNacimiento] = useState("");
  const [formRut, setFormRut] = useState("");
  const [formError, setFormError] = useState("");
  const [lastCreated, setLastCreated] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [moduleConfig, setModuleConfig] = useState(emptyModuleConfig());
  const [expandedModuleKey, setExpandedModuleKey] = useState(null);

  const toggleModuleEnabled = (key) => {
    setModuleConfig((prev) => ({ ...prev, [key]: { ...prev[key], enabled: !prev[key].enabled } }));
  };
  const addTramoRow = (key) => {
    setModuleConfig((prev) => ({ ...prev, [key]: { ...prev[key], tramos: [...prev[key].tramos, { desde: "", hasta: "", valor: "" }] } }));
  };
  const updateTramoRow = (key, index, field, value) => {
    setModuleConfig((prev) => {
      const tramos = prev[key].tramos.map((t, i) => (i === index ? { ...t, [field]: value } : t));
      return { ...prev, [key]: { ...prev[key], tramos } };
    });
  };
  const removeTramoRow = (key, index) => {
    setModuleConfig((prev) => ({ ...prev, [key]: { ...prev[key], tramos: prev[key].tramos.filter((_, i) => i !== index) } }));
  };

  // formulario alta de inspector
  const [formInspNombre, setFormInspNombre] = useState("");
  const [formInspError, setFormInspError] = useState("");
  const [lastCreatedInsp, setLastCreatedInsp] = useState(null);
  const [confirmDeleteInspId, setConfirmDeleteInspId] = useState(null);
  const [copiedInspId, setCopiedInspId] = useState(null);
  const [allInspecciones, setAllInspecciones] = useState([]);
  const [loadingInspecciones, setLoadingInspecciones] = useState(true);
  const [viewingInspeccion, setViewingInspeccion] = useState(null);
  const [allTasaciones, setAllTasaciones] = useState([]);
  const [loadingTasaciones, setLoadingTasaciones] = useState(true);
  const [viewingTasacion, setViewingTasacion] = useState(null);

  // Datos: lista de AFP y comisiones
  const [afpList, setAfpList] = useState([]);
  const [loadingAfp, setLoadingAfp] = useState(true);
  const [afpSaveMsg, setAfpSaveMsg] = useState("");
  const [afpDirty, setAfpDirty] = useState(false);
  const [ufValor, setUfValor] = useState(DEFAULT_UF_VALOR);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingAfp(true);
      const list = await loadAfpList();
      const uf = await loadUfValor();
      if (!cancelled) { setAfpList(list); setUfValor(uf); setLoadingAfp(false); setAfpDirty(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const updateAfpComision = (id, value) => {
    setAfpList((prev) => prev.map((a) => (a.id === id ? { ...a, comision: value } : a)));
    setAfpDirty(true);
    setAfpSaveMsg("");
  };

  const updateUfValor = (value) => {
    setUfValor(value);
    setAfpDirty(true);
    setAfpSaveMsg("");
  };

  const handleSaveAfp = async () => {
    const ok1 = await saveAfpList(afpList);
    const ok2 = await saveUfValor(ufValor);
    setAfpSaveMsg(ok1 && ok2 ? "Guardado ✓" : "No se pudo guardar, intenta de nuevo.");
    setAfpDirty(false);
  };

  useEffect(() => {
    if (tab !== "inspectores") return;
    let cancelled = false;
    (async () => {
      setLoadingInspecciones(true);
      const list = await loadAllInspecciones();
      if (!cancelled) { setAllInspecciones(list); setLoadingInspecciones(false); }
    })();
    (async () => {
      setLoadingTasaciones(true);
      const list = await loadAllTasaciones();
      if (!cancelled) { setAllTasaciones(list); setLoadingTasaciones(false); }
    })();
    return () => { cancelled = true; };
  }, [tab, inspectors]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingTotals(true);
      const results = {};
      for (const v of vendors) { results[v.id] = computeTotals(await loadRecord(v.id, selectedYM), resolveTiers(v)); }
      if (!cancelled) { setMonthlyTotals(results); setLoadingTotals(false); }
    })();
    return () => { cancelled = true; };
  }, [vendors, selectedYM]);

  useEffect(() => {
    if (!expandedId) return;
    let cancelled = false;
    (async () => {
      const rec = await loadRecord(expandedId, selectedYM);
      if (!cancelled) setExpandedRecord(rec);
    })();
    return () => { cancelled = true; };
  }, [expandedId, selectedYM]);

  const toggleExpand = (id) => {
    if (expandedId === id) { setExpandedId(null); setExpandedShowDetail(false); setExpandedShowAnnual(false); }
    else { setExpandedId(id); setExpandedShowDetail(false); setExpandedShowAnnual(false); }
  };

  const totalEmpresa = Object.values(monthlyTotals).reduce((a, t) => a + t.total, 0);
  const ranking = [...vendors].sort((a, b) => (monthlyTotals[b.id]?.total || 0) - (monthlyTotals[a.id]?.total || 0));
  const chartData = ranking.map((v) => ({ nombre: v.nombre.split(" ")[0], Producción: Math.round(monthlyTotals[v.id]?.total || 0) }));

  const handleCreate = async () => {
    setFormError("");
    if (!formNombre.trim() || !formNacimiento || !formRut.trim()) { setFormError("Completa nombre completo, fecha de nacimiento y RUT."); return; }
    const id = genId();
    const modules = MODULE_DEFS.filter((m) => moduleConfig[m.key].enabled).map((m) => m.key);
    const tramos = {};
    MODULE_DEFS.forEach((m) => {
      if (moduleConfig[m.key].enabled && moduleConfig[m.key].tramos.length > 0) {
        const normalizados = normalizeTramos(moduleConfig[m.key].tramos, m.tipo);
        if (normalizados.length > 0) tramos[m.key] = normalizados;
      }
    });
    const nuevo = { id, nombre: formNombre.trim(), nacimiento: formNacimiento, rut: formRut.trim(), modules, tramos, creadoEl: new Date().toISOString() };
    const next = [...vendors, nuevo];
    setVendors(next);
    await saveVendors(next);
    setLastCreated(nuevo);
    setFormNombre(""); setFormNacimiento(""); setFormRut("");
    setModuleConfig(emptyModuleConfig());
    setExpandedModuleKey(null);
  };

  const handleDelete = async (id) => {
    const next = await deleteVendorEverywhere(id, vendors);
    setVendors(next);
    setConfirmDeleteId(null);
    if (expandedId === id) setExpandedId(null);
    if (lastCreated?.id === id) setLastCreated(null);
  };

  const copyLink = async (id) => {
    const link = getProfileLink(id);
    try { await navigator.clipboard.writeText(link); setCopiedId(id); setTimeout(() => setCopiedId(null), 1500); }
    catch (e) { setCopiedId(null); }
  };

  const handleCreateInspector = async () => {
    setFormInspError("");
    if (!formInspNombre.trim()) { setFormInspError("Ingresa el nombre completo del inspector."); return; }
    const id = genId();
    const nuevo = { id, nombre: formInspNombre.trim(), creadoEl: new Date().toISOString() };
    const next = [...inspectors, nuevo];
    setInspectors(next);
    await saveInspectors(next);
    setLastCreatedInsp(nuevo);
    setFormInspNombre("");
  };

  const handleDeleteInspector = async (id) => {
    const next = await deleteInspectorEverywhere(id, inspectors);
    setInspectors(next);
    setConfirmDeleteInspId(null);
    if (lastCreatedInsp?.id === id) setLastCreatedInsp(null);
  };

  const copyInspectorLink = async (id) => {
    const link = getInspectorLink(id);
    try { await navigator.clipboard.writeText(link); setCopiedInspId(id); setTimeout(() => setCopiedInspId(null), 1500); }
    catch (e) { setCopiedInspId(null); }
  };

  return (
    <div className="min-h-screen bg-stone-100 pb-16">
      <div className="bg-stone-900 text-stone-100">
        <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">Panel administrador</p>
            <h1 className="font-serif text-2xl md:text-3xl">Producción del equipo</h1>
          </div>
          <button onClick={onExit} className="self-start md:self-auto border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800">Salir</button>
        </div>
        <div className="max-w-5xl mx-auto px-6 flex gap-2 border-t border-stone-800 overflow-x-auto whitespace-nowrap">
          <button onClick={() => setTab("resumen")} className={`px-4 py-3 text-sm ${tab === "resumen" ? "text-amber-400 border-b-2 border-amber-400" : "text-stone-400"}`}>Resumen mensual</button>
          <button onClick={() => setTab("vendedores")} className={`px-4 py-3 text-sm ${tab === "vendedores" ? "text-amber-400 border-b-2 border-amber-400" : "text-stone-400"}`}>Ejecutivos</button>
          <button onClick={() => setTab("inspectores")} className={`px-4 py-3 text-sm ${tab === "inspectores" ? "text-amber-400 border-b-2 border-amber-400" : "text-stone-400"}`}>Inspectores</button>
          <button onClick={() => setTab("compra")} className={`px-4 py-3 text-sm ${tab === "compra" ? "text-amber-400 border-b-2 border-amber-400" : "text-stone-400"}`}>Tasación de compra</button>
          <button onClick={() => setTab("datos")} className={`px-4 py-3 text-sm ${tab === "datos" ? "text-amber-400 border-b-2 border-amber-400" : "text-stone-400"}`}>Datos</button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 mt-8 flex flex-col gap-6">
        {tab === "resumen" && (
          <>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white border border-stone-200 p-5">
              <div className="flex items-center gap-3">
                <label className="text-sm text-stone-600">Mes</label>
                <input type="month" value={selectedYM} onChange={(e) => setSelectedYM(e.target.value)} className="border border-stone-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div className="text-left md:text-right">
                <p className="text-xs uppercase tracking-widest text-stone-400">Producción total del equipo</p>
                <p className="font-mono text-3xl text-amber-600">{clp(totalEmpresa)}</p>
              </div>
            </div>

            {vendors.length === 0 ? (
              <div className="bg-white border border-stone-200 p-8 text-center text-stone-500 text-sm">
                Aún no hay ejecutivos creados. Ve a la pestaña "Ejecutivos" para agregar el primero.
              </div>
            ) : loadingTotals ? (
              <p className="text-sm text-stone-500">Cargando producción del equipo…</p>
            ) : (
              <>
                <div className="bg-white border border-stone-200 p-5">
                  <h3 className="font-serif text-lg text-stone-900 mb-4">Ranking del mes</h3>
                  <div style={{ width: "100%", height: Math.max(180, chartData.length * 46) }}>
                    <ResponsiveContainer>
                      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11, fill: "#78716C" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                        <YAxis type="category" dataKey="nombre" width={90} tick={{ fontSize: 12, fill: "#1C1917" }} />
                        <Tooltip formatter={(v) => clp(v)} contentStyle={{ border: "1px solid #E7E5E4", fontSize: 13 }} />
                        <Bar dataKey="Producción" fill="#D97706" barSize={22} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white border border-stone-200">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
                        <th className="py-3 px-4">Ejecutivo</th>
                        <th className="py-3 px-4">RUT</th>
                        <th className="py-3 px-4 text-right">Producción del mes</th>
                        <th className="py-3 px-4 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.map((v) => (
                        <React.Fragment key={v.id}>
                          <tr onClick={() => toggleExpand(v.id)} className="border-b border-stone-100 cursor-pointer hover:bg-stone-50">
                            <td className="py-3 px-4 text-stone-900">
                              {v.nombre}
                              {hasCustomTiers(v) && <span className="ml-2 text-xs bg-amber-500 text-stone-900 px-1.5 py-0.5 align-middle">personalizado</span>}
                            </td>
                            <td className="py-3 px-4 text-stone-500 font-mono">{v.rut}</td>
                            <td className="py-3 px-4 text-right font-mono text-stone-900">{clp(monthlyTotals[v.id]?.total || 0)}</td>
                            <td className="py-3 px-4 text-stone-400">{expandedId === v.id ? "▲" : "▼"}</td>
                          </tr>
                          {expandedId === v.id && (
                            <tr>
                              <td colSpan={4} className="bg-stone-50 px-4 py-5">
                                <div className="flex flex-col gap-4">
                                  <ProductionSummary totals={monthlyTotals[v.id] || computeTotals(emptyRecord(), resolveTiers(v))} title={`Producción de ${v.nombre} — ${selectedYM}`} />
                                  <div className="flex gap-3">
                                    <button onClick={() => setExpandedShowDetail((s) => !s)} className="border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-white">
                                      {expandedShowDetail ? "Ocultar detalle mensual" : "Ver detalle mensual completo"}
                                    </button>
                                    <button onClick={() => setExpandedShowAnnual((s) => !s)} className="border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-white">
                                      {expandedShowAnnual ? "Ocultar dashboard anual" : "Ver dashboard anual"}
                                    </button>
                                  </div>

                                  {expandedShowDetail && expandedRecord && (
                                    <div className="flex flex-col gap-6 pt-2">
                                      {(isModuleEnabled(v, "compras") || isModuleEnabled(v, "ventas") || isModuleEnabled(v, "seguros")) && (
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                          {isModuleEnabled(v, "compras") && (
                                            <TierModule accent="amber" title="Compras de vehículos" unit="Compras" count={expandedRecord.comprasN} onCount={() => {}} tiers={resolveTiers(v).compras} readOnly />
                                          )}
                                          {isModuleEnabled(v, "ventas") && (
                                            <TierModule accent="teal" title="Ventas" unit="Ventas" count={expandedRecord.ventasN} onCount={() => {}} tiers={resolveTiers(v).ventas} readOnly />
                                          )}
                                          {isModuleEnabled(v, "seguros") && (
                                            <TierModule accent="indigo" title="Seguros" unit="Seguros" count={expandedRecord.segurosN} onCount={() => {}} tiers={resolveTiers(v).seguros} readOnly />
                                          )}
                                        </div>
                                      )}
                                      {isModuleEnabled(v, "creditos") && (
                                        <CreditosModule count={expandedRecord.creditosN} onCount={() => {}} rows={expandedRecord.creditosRows} onRowChange={() => {}} readOnly tiers={resolveTiers(v).creditos} />
                                      )}
                                      {isModuleEnabled(v, "consignaciones") && (
                                        <ConsignacionesModule count={expandedRecord.consigN} onCount={() => {}} rows={expandedRecord.consigRows} onRowChange={() => {}} readOnly tiers={resolveTiers(v).consignaciones} />
                                      )}
                                      {isModuleEnabled(v, "inspecciones") && (
                                        <TierModule accent="cyan" title="Inspecciones" unit="Inspecciones" count={expandedRecord.inspeccionesN} onCount={() => {}} tiers={resolveTiers(v).inspecciones} readOnly />
                                      )}
                                      <LiquidacionModule
                                          sueldoBase={expandedRecord.sueldoBase}
                                          diasTrabajados={expandedRecord.diasTrabajados}
                                          semanaCorrida={expandedRecord.semanaCorrida}
                                          bonosImponibles={expandedRecord.bonosImponibles}
                                          gratificacionActiva={expandedRecord.gratificacionActiva}
                                          anticipos={expandedRecord.anticipos}
                                          descuentosLiquidacion={expandedRecord.descuentosLiquidacion}
                                          impuestos={expandedRecord.impuestos}
                                          afpId={expandedRecord.afpId}
                                          afpList={afpList}
                                          tipoSalud={expandedRecord.tipoSalud}
                                          isapreUF={expandedRecord.isapreUF}
                                          ufValor={ufValor}
                                          onChange={() => {}}
                                          totalProduccion={monthlyTotals[v.id]?.total || 0}
                                          readOnly
                                        />
                                    </div>
                                  )}

                                  {expandedShowAnnual && (
                                    <div className="pt-2">
                                      <AnnualView vendor={v} year={expandedYear} onYearChange={setExpandedYear} afpList={afpList} ufValor={ufValor} />
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {tab === "vendedores" && (
          <>
            <div className="bg-white border border-stone-200 p-5">
              <h3 className="font-serif text-lg text-stone-900 mb-4">Crear perfil de ejecutivo</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="text-xs text-stone-500 block mb-1">Nombre completo</label>
                  <input value={formNombre} onChange={(e) => setFormNombre(e.target.value)} placeholder="Ej. María Fernández Soto"
                    className="w-full border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div>
                  <label className="text-xs text-stone-500 block mb-1">Fecha de nacimiento</label>
                  <input type="date" value={formNacimiento} onChange={(e) => setFormNacimiento(e.target.value)}
                    className="w-full border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div>
                  <label className="text-xs text-stone-500 block mb-1">RUT</label>
                  <input value={formRut} onChange={(e) => setFormRut(e.target.value)} placeholder="12.345.678-9"
                    className="w-full border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }} />
                </div>
              </div>

              <div className="border-t border-stone-200 pt-4 mb-4">
                <h4 className="text-sm font-medium text-stone-700 mb-1">Módulos y criterios de producción</h4>
                <p className="text-xs text-stone-500 mb-3">
                  Activa los módulos que tendrá este ejecutivo. Si no personalizas los tramos de un módulo activo, se usarán los tramos estándar de la plataforma.
                  El módulo <span className="font-medium">Pre Liquidación</span> se agrega automáticamente a todos los perfiles, sin excepción.
                </p>
                <div className="flex flex-col gap-2">
                  {MODULE_DEFS.map((m) => {
                    const cfg = moduleConfig[m.key];
                    return (
                      <div key={m.key} className="border border-stone-200">
                        <div className="flex items-center justify-between px-3 py-2 bg-stone-50">
                          <label className="flex items-center gap-2 text-sm text-stone-800">
                            <input type="checkbox" checked={cfg.enabled} onChange={() => toggleModuleEnabled(m.key)} />
                            {m.label}
                          </label>
                          {cfg.enabled && (
                            <button
                              type="button"
                              onClick={() => setExpandedModuleKey((k) => (k === m.key ? null : m.key))}
                              className="text-xs text-amber-700 hover:underline"
                            >
                              {expandedModuleKey === m.key ? "Ocultar tramos" : cfg.tramos.length > 0 ? `Editando ${cfg.tramos.length} tramo(s)` : "Personalizar tramos"}
                            </button>
                          )}
                        </div>

                        {cfg.enabled && expandedModuleKey === m.key && (
                          <div className="p-3 flex flex-col gap-2">
                            {cfg.tramos.length === 0 && (
                              <p className="text-xs text-stone-400">Sin tramos personalizados: se usarán los tramos estándar de {m.label}.</p>
                            )}
                            {cfg.tramos.map((t, i) => (
                              <div key={i} className="grid grid-cols-4 gap-2 items-center">
                                <input
                                  type="number" min="1" placeholder="Desde" value={t.desde}
                                  onChange={(e) => updateTramoRow(m.key, i, "desde", e.target.value)}
                                  className="border border-stone-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
                                />
                                <input
                                  type="number" min="1" placeholder="Hasta (vacío = sin límite)" value={t.hasta}
                                  onChange={(e) => updateTramoRow(m.key, i, "hasta", e.target.value)}
                                  className="border border-stone-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
                                />
                                <input
                                  type="number" min="0" placeholder={m.unidad} value={t.valor}
                                  onChange={(e) => updateTramoRow(m.key, i, "valor", e.target.value)}
                                  className="border border-stone-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
                                />
                                <button type="button" onClick={() => removeTramoRow(m.key, i)} className="text-xs text-rose-600 hover:underline">Quitar</button>
                              </div>
                            ))}
                            <button type="button" onClick={() => addTramoRow(m.key)} className="self-start text-xs text-emerald-700 hover:underline">+ Agregar tramo</button>
                            <p className="text-xs text-stone-400">Unidad: {m.unidad}. Ej: Desde 1, Hasta 5, Valor {m.tipo === "porcentaje" ? "15 (=15%)" : "100000"}.</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="border border-stone-200 px-3 py-2 bg-stone-100 flex items-center gap-2 text-sm text-stone-600">
                    <input type="checkbox" checked disabled />
                    Pre Liquidación <span className="text-xs text-stone-400">(automático para todos los perfiles)</span>
                  </div>
                </div>
              </div>

              {formError && <p className="text-xs text-rose-600 mb-3">{formError}</p>}
              <button type="button" onClick={handleCreate} className="bg-amber-500 text-stone-900 px-4 py-2 text-sm font-medium hover:bg-amber-400">Crear perfil</button>
            </div>

            {lastCreated && (
              <div className="bg-amber-50 border border-amber-300 p-5">
                <p className="text-sm text-stone-700 mb-2">
                  Perfil creado para <span className="font-semibold">{lastCreated.nombre}</span>. Entrega este enlace al ejecutivo:
                </p>
                <div className="flex flex-col md:flex-row gap-2">
                  <code className="flex-1 bg-white border border-stone-300 px-3 py-2 text-xs break-all">{getProfileLink(lastCreated.id)}</code>
                  <button onClick={() => copyLink(lastCreated.id)} className="border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700 hover:bg-stone-50">
                    {copiedId === lastCreated.id ? "Copiado ✓" : "Copiar enlace"}
                  </button>
                </div>
                <p className="text-xs text-stone-500 mt-2">Código de acceso: <span className="font-mono">{lastCreated.id}</span> (por si el enlace no se abre directo, el ejecutivo puede ingresarlo manualmente).</p>
              </div>
            )}

            <div className="bg-white border border-stone-200">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
                    <th className="py-3 px-4">Nombre</th>
                    <th className="py-3 px-4">RUT</th>
                    <th className="py-3 px-4">Nacimiento</th>
                    <th className="py-3 px-4">Enlace de perfil</th>
                    <th className="py-3 px-4 w-40"></th>
                  </tr>
                </thead>
                <tbody>
                  {vendors.length === 0 && (
                    <tr><td colSpan={5} className="py-6 px-4 text-center text-stone-500">Todavía no hay ejecutivos registrados.</td></tr>
                  )}
                  {vendors.map((v) => (
                    <tr key={v.id} className="border-b border-stone-100">
                      <td className="py-3 px-4 text-stone-900">
                        {v.nombre}
                        {hasCustomTiers(v) && <span className="ml-2 text-xs bg-amber-500 text-stone-900 px-1.5 py-0.5 align-middle">personalizado</span>}
                      </td>
                      <td className="py-3 px-4 text-stone-500 font-mono">{v.rut}</td>
                      <td className="py-3 px-4 text-stone-500">{v.nacimiento ? new Date(v.nacimiento + "T00:00:00").toLocaleDateString("es-CL") : "—"}</td>
                      <td className="py-3 px-4">
                        <button onClick={() => copyLink(v.id)} className="text-xs text-amber-700 hover:underline font-mono">
                          {copiedId === v.id ? "Copiado ✓" : `${v.id} · copiar enlace`}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {confirmDeleteId === v.id ? (
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => handleDelete(v.id)} className="text-xs bg-rose-600 text-white px-2 py-1 hover:bg-rose-700">Confirmar</button>
                            <button onClick={() => setConfirmDeleteId(null)} className="text-xs border border-stone-300 px-2 py-1 hover:bg-stone-50">Cancelar</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDeleteId(v.id)} className="text-xs text-rose-600 hover:underline">Eliminar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "inspectores" && (
          <>
            {viewingInspeccion ? (
              <>
                <button onClick={() => setViewingInspeccion(null)} className="self-start text-sm text-stone-500 hover:underline">← Volver a Inspectores</button>
                <InspeccionForm record={viewingInspeccion} onFieldChange={() => {}} onChecklistChange={() => {}} readOnly />
              </>
            ) : viewingTasacion ? (
              <>
                <button onClick={() => setViewingTasacion(null)} className="self-start text-sm text-stone-500 hover:underline">← Volver a Inspectores</button>
                <TasacionForm
                  record={viewingTasacion}
                  onFieldChange={() => {}}
                  onChecklistChange={() => {}}
                  readOnly
                  photos={viewingTasacion.inspectorId ? { viewOnly: true, inspectorId: viewingTasacion.inspectorId } : null}
                />
              </>
            ) : (
              <>
                <div className="bg-white border border-stone-200 p-5">
                  <h3 className="font-serif text-lg text-stone-900 mb-4">Crear perfil de inspector</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div>
                      <label className="text-xs text-stone-500 block mb-1">Nombre completo</label>
                      <input value={formInspNombre} onChange={(e) => setFormInspNombre(e.target.value)} placeholder="Ej. Pedro Salinas Vera"
                        className="w-full border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                        onKeyDown={(e) => { if (e.key === "Enter") handleCreateInspector(); }} />
                    </div>
                  </div>
                  {formInspError && <p className="text-xs text-rose-600 mb-3">{formInspError}</p>}
                  <button type="button" onClick={handleCreateInspector} className="bg-sky-600 text-white px-4 py-2 text-sm font-medium hover:bg-sky-500">Crear perfil</button>
                </div>

                {lastCreatedInsp && (
                  <div className="bg-sky-50 border border-sky-300 p-5">
                    <p className="text-sm text-stone-700 mb-2">
                      Perfil creado para <span className="font-semibold">{lastCreatedInsp.nombre}</span>. Entrega este enlace al inspector:
                    </p>
                    <div className="flex flex-col md:flex-row gap-2">
                      <code className="flex-1 bg-white border border-stone-300 px-3 py-2 text-xs break-all">{getInspectorLink(lastCreatedInsp.id)}</code>
                      <button onClick={() => copyInspectorLink(lastCreatedInsp.id)} className="border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700 hover:bg-stone-50">
                        {copiedInspId === lastCreatedInsp.id ? "Copiado ✓" : "Copiar enlace"}
                      </button>
                    </div>
                    <p className="text-xs text-stone-500 mt-2">Código de acceso: <span className="font-mono">{lastCreatedInsp.id}</span> (por si el enlace no se abre directo, el inspector puede ingresarlo manualmente).</p>
                  </div>
                )}

                <div className="bg-white border border-stone-200">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
                        <th className="py-3 px-4">Nombre</th>
                        <th className="py-3 px-4">Enlace de perfil</th>
                        <th className="py-3 px-4 w-40"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {inspectors.length === 0 && (
                        <tr><td colSpan={3} className="py-6 px-4 text-center text-stone-500">Todavía no hay inspectores registrados.</td></tr>
                      )}
                      {inspectors.map((i) => (
                        <tr key={i.id} className="border-b border-stone-100">
                          <td className="py-3 px-4 text-stone-900">{i.nombre}</td>
                          <td className="py-3 px-4">
                            <button onClick={() => copyInspectorLink(i.id)} className="text-xs text-sky-700 hover:underline font-mono">
                              {copiedInspId === i.id ? "Copiado ✓" : `${i.id} · copiar enlace`}
                            </button>
                          </td>
                          <td className="py-3 px-4 text-right">
                            {confirmDeleteInspId === i.id ? (
                              <div className="flex gap-2 justify-end">
                                <button onClick={() => handleDeleteInspector(i.id)} className="text-xs bg-rose-600 text-white px-2 py-1 hover:bg-rose-700">Confirmar</button>
                                <button onClick={() => setConfirmDeleteInspId(null)} className="text-xs border border-stone-300 px-2 py-1 hover:bg-stone-50">Cancelar</button>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmDeleteInspId(i.id)} className="text-xs text-rose-600 hover:underline">Eliminar</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="bg-white border border-stone-200 p-5">
                  <h3 className="font-serif text-lg text-stone-900 mb-4">Inspecciones registradas</h3>
                  {loadingInspecciones ? (
                    <p className="text-sm text-stone-500">Cargando…</p>
                  ) : allInspecciones.length === 0 ? (
                    <p className="text-sm text-stone-500">Aún no se han registrado inspecciones.</p>
                  ) : (
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
                          <th className="py-2 pr-2">Fecha</th>
                          <th className="py-2 pr-2">Inspector</th>
                          <th className="py-2 pr-2">Marca / Modelo</th>
                          <th className="py-2 pr-2">Inscripción</th>
                          <th className="py-2 pr-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {allInspecciones.map((r) => (
                          <tr key={r.id} className="border-b border-stone-100">
                            <td className="py-2 pr-2 text-stone-600">{r.data.fecha}</td>
                            <td className="py-2 pr-2 text-stone-900">{r.data.inspectorNombre || "—"}</td>
                            <td className="py-2 pr-2 text-stone-700">{[r.data.marca, r.data.modelo].filter(Boolean).join(" ") || "—"}</td>
                            <td className="py-2 pr-2 text-stone-600 font-mono">{r.data.inscripcion || "—"}</td>
                            <td className="py-2 pr-2 text-right"><button onClick={() => setViewingInspeccion(r.data)} className="text-xs text-amber-700 hover:underline">Ver</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="bg-white border border-stone-200 p-5">
                  <h3 className="font-serif text-lg text-stone-900 mb-4">Tasaciones registradas</h3>
                  {loadingTasaciones ? (
                    <p className="text-sm text-stone-500">Cargando…</p>
                  ) : allTasaciones.length === 0 ? (
                    <p className="text-sm text-stone-500">Aún no se han registrado tasaciones.</p>
                  ) : (
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
                          <th className="py-2 pr-2">Fecha</th>
                          <th className="py-2 pr-2">Inspector</th>
                          <th className="py-2 pr-2">Vehículo</th>
                          <th className="py-2 pr-2">Patente</th>
                          <th className="py-2 pr-2 text-right">Valor comercial</th>
                          <th className="py-2 pr-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {allTasaciones.map((r) => (
                          <tr key={r.id} className="border-b border-stone-100">
                            <td className="py-2 pr-2 text-stone-600">{r.data.fecha}</td>
                            <td className="py-2 pr-2 text-stone-900">{r.data.inspectorNombre || "—"}</td>
                            <td className="py-2 pr-2 text-stone-700">{r.data.vehiculo || "—"}</td>
                            <td className="py-2 pr-2 text-stone-600 font-mono">{r.data.patente || "—"}</td>
                            <td className="py-2 pr-2 text-right font-mono text-stone-900">{clp(r.data.valorComercial)}</td>
                            <td className="py-2 pr-2 text-right"><button onClick={() => setViewingTasacion(r.data)} className="text-xs text-amber-700 hover:underline">Ver</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {tab === "compra" && <TasacionCompra />}

        {tab === "datos" && (
          <div className="bg-white border border-stone-200 p-5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
              <div>
                <h3 className="font-serif text-lg text-stone-900">AFP y comisiones</h3>
                <p className="text-xs text-stone-500 mt-0.5">Porcentaje de comisión vigente por AFP. Editable por el administrador.</p>
              </div>
              <div className="flex items-center gap-3">
                {afpSaveMsg && <span className="text-xs text-stone-500">{afpSaveMsg}</span>}
                <button
                  onClick={handleSaveAfp}
                  disabled={!afpDirty}
                  className={`px-4 py-2 text-sm font-medium ${afpDirty ? "bg-amber-500 text-stone-900 hover:bg-amber-400" : "bg-stone-200 text-stone-400 cursor-not-allowed"}`}
                >
                  Guardar cambios
                </button>
              </div>
            </div>

            {loadingAfp ? (
              <p className="text-sm text-stone-500">Cargando…</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
                    <th className="py-2 pr-2">AFP</th>
                    <th className="py-2 pr-2 text-right w-40">Comisión (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {afpList.map((afp) => (
                    <tr key={afp.id} className="border-b border-stone-100">
                      <td className="py-2 pr-2 text-stone-900">{afp.nombre}</td>
                      <td className="py-2 pr-2">
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={afp.comision}
                            onChange={(e) => updateAfpComision(afp.id, e.target.value === "" ? "" : parseFloat(e.target.value))}
                            className="w-24 border border-stone-300 bg-white px-2 py-1.5 text-right font-mono text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                          <span className="text-stone-500">%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="border-t border-stone-200 mt-6 pt-5">
              <h4 className="font-serif text-base text-stone-900 mb-1">Valor UF</h4>
              <p className="text-xs text-stone-500 mb-3">Usado para convertir el monto de Isapre (en UF) a pesos en la Pre Liquidación.</p>
              <div className="flex items-center gap-2 max-w-xs">
                <span className="text-stone-500">$</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={ufValor}
                  onChange={(e) => updateUfValor(e.target.value === "" ? 0 : parseFloat(e.target.value))}
                  className="w-full border border-stone-300 bg-white px-2 py-1.5 text-right font-mono text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   LANDING / RUTEO
========================================================= */
function Landing({ onEnterAdmin, onEnterVendor, onEnterInspector }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [inspCode, setInspCode] = useState("");
  const [inspError, setInspError] = useState("");

  const handleVendorEnter = async () => {
    try {
      const profile = await window.auth.profileLogin("vendor", code);
      setError("");
      onEnterVendor(profile);
    } catch (e) {
      setError(authErrorMessage(e, "Código no válido. Revisa el enlace entregado por tu administrador."));
    }
  };

  const handleInspectorEnter = async () => {
    try {
      const profile = await window.auth.profileLogin("inspector", inspCode);
      setInspError("");
      onEnterInspector(profile);
    } catch (e) {
      setInspError(authErrorMessage(e, "Código no válido. Revisa el enlace entregado por tu administrador."));
    }
  };

  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center px-6">
      <div className="max-w-3xl w-full">
        <div className="text-center mb-10">
          <p className="text-xs uppercase tracking-widest text-stone-400 mb-2">Plataforma de gestión automotriz</p>
          <h1 className="font-serif text-3xl md:text-4xl text-stone-900">Drive Futuro</h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white border border-stone-200 p-6 flex flex-col gap-4">
            <div>
              <h2 className="font-serif text-xl text-stone-900">Administrador</h2>
              <p className="text-sm text-stone-500 mt-1">Visualiza la producción de todo el equipo, crea o elimina perfiles de ejecutivos e inspectores.</p>
            </div>
            <button onClick={onEnterAdmin} className="mt-auto bg-stone-900 text-white px-4 py-2 text-sm hover:bg-stone-800">Entrar como administrador</button>
          </div>
          <div className="bg-white border border-stone-200 p-6 flex flex-col gap-4">
            <div>
              <h2 className="font-serif text-xl text-stone-900">Ejecutivo</h2>
              <p className="text-sm text-stone-500 mt-1">Ingresa con el enlace o código que te entregó tu administrador.</p>
            </div>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código de acceso"
              className="border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500" />
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button onClick={handleVendorEnter} className="bg-amber-500 text-stone-900 px-4 py-2 text-sm font-medium hover:bg-amber-400">Entrar a mi dashboard</button>
          </div>
          <div className="bg-white border border-stone-200 p-6 flex flex-col gap-4">
            <div>
              <h2 className="font-serif text-xl text-stone-900">Inspector</h2>
              <p className="text-sm text-stone-500 mt-1">Ingresa con el enlace o código que te entregó tu administrador.</p>
            </div>
            <input value={inspCode} onChange={(e) => setInspCode(e.target.value)} placeholder="Código de acceso"
              className="border border-stone-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500" />
            {inspError && <p className="text-xs text-rose-600">{inspError}</p>}
            <button onClick={handleInspectorEnter} className="bg-sky-600 text-white px-4 py-2 text-sm font-medium hover:bg-sky-500">Entrar a mi checklist</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => {
    const onExpired = () => setSessionExpired(true);
    window.addEventListener("df-session-expired", onExpired);
    return () => window.removeEventListener("df-session-expired", onExpired);
  }, []);
  return (
    <>
      {sessionExpired && (
        <div className="fixed top-0 inset-x-0 z-50 bg-amber-100 border-b border-amber-300 px-4 py-3 text-sm text-stone-800 flex flex-wrap items-center justify-between gap-2">
          <span>Tu sesión venció. Recarga la página para volver a ingresar (los borradores del inspector quedan guardados en este dispositivo).</span>
          <button onClick={() => window.location.reload()} className="bg-stone-900 text-white px-3 py-1.5">Recargar</button>
        </div>
      )}
      <AppRoutes />
    </>
  );
}

function AppRoutes() {
  const [vendors, setVendors] = useState([]);
  const [inspectors, setInspectors] = useState([]);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState("landing");
  const [activeVendor, setActiveVendor] = useState(null);
  const [activeInspector, setActiveInspector] = useState(null);

  // Enlaces de perfil (?vendor=CODIGO / ?inspector=CODIGO): el servidor valida el código.
  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const vendorCode = params.get("vendor");
        const inspectorCode = params.get("inspector");
        if (vendorCode) {
          const profile = await window.auth.profileLogin("vendor", vendorCode);
          setActiveVendor(profile); setScreen("vendor");
        } else if (inspectorCode) {
          const profile = await window.auth.profileLogin("inspector", inspectorCode);
          setActiveInspector(profile); setScreen("inspector");
        }
      } catch (e) {}
      setReady(true);
    })();
  }, []);

  const exitToLanding = () => {
    try { window.auth.logout(); } catch (e) {}
    setScreen("landing");
    setActiveVendor(null);
    setActiveInspector(null);
    setVendors([]);
    setInspectors([]);
    try { window.history.replaceState({}, "", window.location.pathname); } catch (e) {}
  };

  // Tras iniciar sesión como admin, recién ahí se cargan los listados completos.
  const onAdminLogin = async () => {
    setVendors(await loadVendors());
    setInspectors(await loadInspectors());
    setScreen("admin");
  };

  if (!ready) {
    return <div className="min-h-screen bg-stone-100 flex items-center justify-center text-stone-500 text-sm">Cargando plataforma…</div>;
  }

  if (screen === "adminAuth") {
    return <AdminAuthGate onSuccess={onAdminLogin} onExit={exitToLanding} />;
  }

  if (screen === "admin") {
    return <AdminDashboard vendors={vendors} setVendors={setVendors} inspectors={inspectors} setInspectors={setInspectors} onExit={exitToLanding} />;
  }

  if (screen === "vendor" && activeVendor) {
    return <VendorDashboard vendor={activeVendor} onExit={exitToLanding} />;
  }

  if (screen === "inspector" && activeInspector) {
    return <InspectorDashboard inspector={activeInspector} onExit={exitToLanding} />;
  }

  return (
    <Landing
      onEnterAdmin={() => setScreen("adminAuth")}
      onEnterVendor={(profile) => { setActiveVendor(profile); setScreen("vendor"); }}
      onEnterInspector={(profile) => { setActiveInspector(profile); setScreen("inspector"); }}
    />
  );
}
