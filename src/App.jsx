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
    { label: "Compras de vehículos", value: clp(totals.compras) },
    { label: "Ventas", value: clp(totals.ventas) },
    { label: "Seguros", value: clp(totals.seguros) },
    { label: "Créditos", value: clp(totals.creditos) },
    { label: "Consignaciones", value: clp(totals.consignaciones) },
    { label: "Inspecciones", value: clp(totals.inspecciones || 0) },
  ];
  const totalHaberes = totals.total + toNum(record.sueldoBase) + toNum(record.semanaCorrida) + toNum(record.bonosImponibles) + calcGratificacion(record.sueldoBase);
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
    { label: "Gratificación", value: clp(calcGratificacion(record.sueldoBase)) },
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
  const sumaMargen = record.consigRows.reduce(
    (a, r) => a + (toNum(r.precioVenta) - toNum(r.precioPiso) - toNum(r.descuentos)), 0
  );
  const consignaciones = sumaMargen * (getTier(record.consigN, tierSet.consignaciones)?.rate || 0);
  const inspecciones = (record.inspeccionesN || 0) * (getTier(record.inspeccionesN, tierSet.inspecciones)?.rate || 0);
  return {
    compras, ventas, seguros, creditos, consignaciones, inspecciones,
    sumaComisiones, sumaMargen,
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

/* --- Autenticación del administrador (clave + código de recuperación) --- */
async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function genRecoveryCode(length = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin caracteres ambiguos (0/O, 1/I)
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out.match(/.{1,4}/g).join("-");
}
function isValidAdminPassword(pw) {
  return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{8,}$/.test(pw || "");
}
async function loadAdminAuth() {
  try {
    const res = await window.storage.get("admin_auth", true);
    return res ? JSON.parse(res.value) : null;
  } catch (e) { return null; }
}
async function saveAdminAuth(data) {
  try { await window.storage.set("admin_auth", JSON.stringify(data), true); return true; }
  catch (e) { return false; }
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
  return (Math.random().toString(36).slice(2, 7) + Math.random().toString(36).slice(2, 5)).toUpperCase();
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
    propietario: "",
    fecha: new Date().toISOString().slice(0, 10),
    vehiculo: "",
    patente: "",
    vin: "",
    color: "",
    kilometraje: "",
    mantencionesMarca: "",
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
        <p className="text-sm text-stone-600">Arrastra aquí tu archivo PDF, o haz clic para seleccionarlo</p>
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

function InspeccionForm({ record, onFieldChange, onChecklistChange, readOnly = false }) {
  const fechaDisplay = record.fecha
    ? new Date(`${record.fecha}T00:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" })
    : "—";

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white border border-stone-200 border-l-4 border-sky-600 p-5">
        <h3 className="font-serif text-lg text-stone-900 mb-4">CAV</h3>
        <PdfDropzone
          fileName={record.cavFileName}
          fileData={record.cavFileData}
          onFileLoaded={(name, data) => { onFieldChange("cavFileName", name); onFieldChange("cavFileData", data); }}
          onRemove={() => { onFieldChange("cavFileName", ""); onFieldChange("cavFileData", ""); }}
          readOnly={readOnly}
        />
      </div>

      <div className="bg-white border border-stone-200 border-l-4 border-sky-600 p-5">
        <h3 className="font-serif text-lg text-stone-900 mb-4">Datos</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TextField label="Propietario" value={record.propietario} onChange={(v) => onFieldChange("propietario", v)} readOnly={readOnly} />
          <div>
            <label className="text-xs text-stone-500 block mb-1">Fecha del día</label>
            <div className="w-full px-2 py-1.5 text-sm text-stone-700 bg-stone-50 border border-stone-200">{fechaDisplay}</div>
          </div>
          <TextField label="Vehículo" value={record.vehiculo} onChange={(v) => onFieldChange("vehiculo", v)} readOnly={readOnly} />
          <TextField label="Patente" value={record.patente} onChange={(v) => onFieldChange("patente", v)} readOnly={readOnly} />
          <TextField label="Número de VIN" value={record.vin} onChange={(v) => onFieldChange("vin", v)} readOnly={readOnly} />
          <TextField label="Color" value={record.color} onChange={(v) => onFieldChange("color", v)} readOnly={readOnly} />
          <TextField label="Kilometraje" value={record.kilometraje} onChange={(v) => onFieldChange("kilometraje", v)} readOnly={readOnly} />
          <TextField label="Mantenciones en marca" value={record.mantencionesMarca} onChange={(v) => onFieldChange("mantencionesMarca", v)} readOnly={readOnly} />
        </div>
      </div>

      {CHECKLIST_SECTIONS.map((section) => (
        <div key={section.id} className="bg-white border border-stone-200 border-l-4 border-sky-600 p-5">
          <h3 className="font-serif text-lg text-stone-900 mb-4">{section.title}</h3>
          <div className="flex flex-col gap-4">
            {section.items.map((item) => {
              const itemState = record.checklist?.[item.id] || { estado: "", observacion: "" };
              return (
                <div key={item.id} className="grid grid-cols-1 md:grid-cols-3 gap-3 border-b border-stone-100 pb-4">
                  <div className="text-sm text-stone-700 flex items-center">{item.label}</div>
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
        </div>
      ))}
    </div>
  );
}

function TasacionForm({ record, onFieldChange, onChecklistChange, readOnly = false }) {
  const fechaDisplay = record.fecha
    ? new Date(`${record.fecha}T00:00:00`).toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" })
    : "—";
  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white border border-stone-200 border-l-4 border-violet-600 p-5">
        <h3 className="font-serif text-lg text-stone-900 mb-4">Tasación</h3>
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
      </div>

      <TasacionChecklist checklist={record.checklist || {}} onItemChange={onChecklistChange} readOnly={readOnly} />
    </div>
  );
}

function TasacionChecklist({ checklist, onItemChange, readOnly = false }) {
  return (
    <>
      {TASACION_SECTIONS.map((section) => {
        const items = getTasacionSectionItems(section);

        if (section.type === "dynamic") {
          return (
            <div key={section.id} className="bg-white border border-stone-200 border-l-4 border-violet-600 p-5">
              <h3 className="font-serif text-lg text-stone-900 mb-4">{section.title}</h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
                      <th className="py-2 pr-2">Nombre de pieza</th>
                      <th className="py-2 pr-2">Estado</th>
                      <th className="py-2 pr-2">Valorización</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const state = checklist[item.id] || { nombre: "", estado: "", valor: 0 };
                      const estadoOptions = section.estadoOptions || ESTADOS_CHECKLIST;
                      return (
                        <tr key={item.id} className="border-b border-stone-100">
                          <td className="py-1.5 pr-2 w-1/3">
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
                          </td>
                          <td className="py-1.5 pr-2 w-1/3">
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
                          </td>
                          <td className="py-1.5 pr-2 w-1/3">
                            <NumberField value={toNum(state.valor)} onChange={(v) => onItemChange(item.id, { valor: v })} readOnly={readOnly} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }

        return (
          <div key={section.id} className="bg-white border border-stone-200 border-l-4 border-violet-600 p-5">
            <h3 className="font-serif text-lg text-stone-900 mb-4">{section.title}</h3>
            <div className="flex flex-col gap-4">
              {items.map((item) => {
                const state = checklist[item.id] || { nombre: "", estado: "", valor: 0 };
                const estadoOptions = item.estadoOptions || section.estadoOptions || ESTADOS_CHECKLIST;
                return (
                  <div key={item.id} className="flex flex-col gap-3 border-b border-stone-100 pb-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="text-sm text-stone-700 flex items-center">{item.label}</div>
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
                  </div>
                );
              })}
            </div>
          </div>
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
  const tier = getTier(count, tiers);
  const rate = tier ? tier.rate : 0;
  const margenes = rows.map((r) => toNum(r.precioVenta) - toNum(r.precioPiso) - toNum(r.descuentos));
  const sumaMargen = margenes.reduce((a, b) => a + b, 0);
  const total = sumaMargen * rate;
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
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-stone-500 mb-4">
        {tiers.map((t) => (
          <span key={t.label} className={tier && tier.label === t.label ? "text-violet-700 font-semibold" : ""}>
            {t.label}: {(t.rate * 100).toFixed(0)}% sobre el margen
          </span>
        ))}
      </div>

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
                <th className="py-2 pr-2 text-right">Margen</th>
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
                  <td className="py-1.5 pr-2 text-right font-mono text-stone-700">{clp(margenes[i])}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="py-2 pr-2 text-right text-sm text-stone-600">Suma de márgenes</td>
                <td className="py-2 pr-2 text-right font-mono text-sm text-stone-900">{clp(sumaMargen)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="border-t border-stone-200 pt-3 mt-4 flex items-baseline justify-between">
        <span className="text-sm text-stone-600">Producción ({sumaMargen ? (rate * 100).toFixed(0) : 0}% sobre {clp(sumaMargen)})</span>
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
  sueldoBase, diasTrabajados, semanaCorrida, bonosImponibles, anticipos, descuentosLiquidacion, impuestos, afpId, afpList = [],
  tipoSalud, isapreUF, ufValor = DEFAULT_UF_VALOR,
  onChange, totalProduccion, readOnly = false, onGenerate,
}) {
  const gratificacion = calcGratificacion(sueldoBase);
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
                <label className="text-xs text-stone-500 block mb-1">Gratificación</label>
                <div className="w-full px-2 py-1.5 text-right font-mono text-sm text-stone-700 bg-white border border-stone-200">{clp(gratificacion)}</div>
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

  const totalHaberes = totals.total + toNum(record.sueldoBase) + toNum(record.semanaCorrida) + toNum(record.bonosImponibles) + calcGratificacion(record.sueldoBase);
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
    { label: "Compras de vehículos", value: totals.compras },
    { label: "Ventas", value: totals.ventas },
    { label: "Seguros", value: totals.seguros },
    { label: "Créditos", value: totals.creditos },
    { label: "Consignaciones", value: totals.consignaciones },
    { label: "Inspecciones", value: totals.inspecciones || 0 },
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
                <td className="py-1.5 text-stone-600 pl-2">Gratificación</td>
                <td className="py-1.5 text-right font-mono text-stone-900">{clp(calcGratificacion(record.sueldoBase))}</td>
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
        const totalHaberesMes = totals.total + toNum(rec.sueldoBase) + toNum(rec.semanaCorrida) + toNum(rec.bonosImponibles) + calcGratificacion(rec.sueldoBase);
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
function InspectorDashboard({ inspector, onExit }) {
  const [tab, setTab] = useState("inspeccion");

  const [record, setRecord] = useState(emptyInspeccion());
  const [historial, setHistorial] = useState([]);
  const [loadingHist, setLoadingHist] = useState(true);
  const [saveMsg, setSaveMsg] = useState("");
  const [viewing, setViewing] = useState(null);

  const [tasacion, setTasacion] = useState(emptyTasacion());
  const [historialTasaciones, setHistorialTasaciones] = useState([]);
  const [loadingHistTasaciones, setLoadingHistTasaciones] = useState(true);
  const [saveMsgTasacion, setSaveMsgTasacion] = useState("");
  const [viewingTasacion, setViewingTasacion] = useState(null);

  const refreshHistorial = async () => {
    setLoadingHist(true);
    const list = await loadInspeccionesFor(inspector.id);
    setHistorial(list);
    setLoadingHist(false);
  };
  const refreshHistorialTasaciones = async () => {
    setLoadingHistTasaciones(true);
    const list = await loadTasacionesFor(inspector.id);
    setHistorialTasaciones(list);
    setLoadingHistTasaciones(false);
  };
  useEffect(() => { refreshHistorial(); refreshHistorialTasaciones(); }, [inspector.id]);

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

  const handleSave = async () => {
    const id = `${Date.now()}`;
    const toSave = { ...record, inspectorId: inspector.id, inspectorNombre: inspector.nombre, guardadoEl: new Date().toISOString() };
    const ok = await saveInspeccion(inspector.id, id, toSave);
    setSaveMsg(ok ? "Inspección guardada ✓" : "No se pudo guardar, intenta de nuevo.");
    if (ok) { setRecord(emptyInspeccion()); refreshHistorial(); }
    setTimeout(() => setSaveMsg(""), 2500);
  };

  const handleSaveTasacion = async () => {
    const id = `${Date.now()}`;
    const toSave = { ...tasacion, inspectorId: inspector.id, inspectorNombre: inspector.nombre, guardadoEl: new Date().toISOString() };
    const ok = await saveTasacion(inspector.id, id, toSave);
    setSaveMsgTasacion(ok ? "Tasación guardada ✓" : "No se pudo guardar, intenta de nuevo.");
    if (ok) { setTasacion(emptyTasacion()); refreshHistorialTasaciones(); }
    setTimeout(() => setSaveMsgTasacion(""), 2500);
  };

  return (
    <div className="min-h-screen bg-stone-100 pb-16">
      <div className="bg-stone-900 text-stone-100">
        <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">Panel del inspector</p>
            <h1 className="font-serif text-2xl md:text-3xl">{inspector.nombre}</h1>
            <p className="text-xs text-stone-400 mt-1 capitalize">
              {new Date().toLocaleDateString("es-CL", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </p>
          </div>
          <button onClick={onExit} className="self-start md:self-auto border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800">Salir</button>
        </div>
        <div className="max-w-5xl mx-auto px-6 flex gap-2 border-t border-stone-800">
          <button onClick={() => setTab("inspeccion")} className={`px-4 py-3 text-sm ${tab === "inspeccion" ? "text-amber-400 border-b-2 border-amber-400" : "text-stone-400"}`}>Inspección</button>
          <button onClick={() => setTab("tasaciones")} className={`px-4 py-3 text-sm ${tab === "tasaciones" ? "text-amber-400 border-b-2 border-amber-400" : "text-stone-400"}`}>Tasaciones</button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 mt-8 flex flex-col gap-6">
        {tab === "inspeccion" && (
          viewing ? (
            <>
              <button onClick={() => setViewing(null)} className="self-start text-sm text-stone-500 hover:underline">← Volver al checklist</button>
              <InspeccionForm record={viewing} onFieldChange={() => {}} onChecklistChange={() => {}} readOnly />
            </>
          ) : (
            <>
              <InspeccionForm record={record} onFieldChange={updateField} onChecklistChange={updateChecklist} />

              <div className="flex items-center justify-end gap-3">
                {saveMsg && <span className="text-xs text-stone-500">{saveMsg}</span>}
                <button onClick={handleSave} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800">Guardar inspección</button>
              </div>

              <div className="bg-white border border-stone-200 p-5">
                <h3 className="font-serif text-lg text-stone-900 mb-4">Historial de inspecciones</h3>
                {loadingHist ? (
                  <p className="text-sm text-stone-500">Cargando…</p>
                ) : historial.length === 0 ? (
                  <p className="text-sm text-stone-500">Aún no hay inspecciones guardadas.</p>
                ) : (
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
                        <th className="py-2 pr-2">Fecha</th>
                        <th className="py-2 pr-2">Vehículo</th>
                        <th className="py-2 pr-2">Patente</th>
                        <th className="py-2 pr-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {historial.map((h) => (
                        <tr key={h.id} className="border-b border-stone-100">
                          <td className="py-2 pr-2 text-stone-600">{h.data.fecha}</td>
                          <td className="py-2 pr-2 text-stone-900">{h.data.vehiculo || "—"}</td>
                          <td className="py-2 pr-2 text-stone-600 font-mono">{h.data.patente || "—"}</td>
                          <td className="py-2 pr-2 text-right"><button onClick={() => setViewing(h.data)} className="text-xs text-amber-700 hover:underline">Ver</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )
        )}

        {tab === "tasaciones" && (
          viewingTasacion ? (
            <>
              <button onClick={() => setViewingTasacion(null)} className="self-start text-sm text-stone-500 hover:underline">← Volver a Tasaciones</button>
              <TasacionForm record={viewingTasacion} onFieldChange={() => {}} onChecklistChange={() => {}} readOnly />
            </>
          ) : (
            <>
              <TasacionForm record={tasacion} onFieldChange={updateTasacionField} onChecklistChange={updateTasacionChecklist} />

              <div className="flex items-center justify-end gap-3">
                {saveMsgTasacion && <span className="text-xs text-stone-500">{saveMsgTasacion}</span>}
                <button onClick={handleSaveTasacion} className="bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-800">Guardar tasación</button>
              </div>

              <div className="bg-white border border-stone-200 p-5">
                <h3 className="font-serif text-lg text-stone-900 mb-4">Historial de tasaciones</h3>
                {loadingHistTasaciones ? (
                  <p className="text-sm text-stone-500">Cargando…</p>
                ) : historialTasaciones.length === 0 ? (
                  <p className="text-sm text-stone-500">Aún no hay tasaciones guardadas.</p>
                ) : (
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-stone-400 border-b border-stone-200">
                        <th className="py-2 pr-2">Fecha</th>
                        <th className="py-2 pr-2">Vehículo</th>
                        <th className="py-2 pr-2">Patente</th>
                        <th className="py-2 pr-2 text-right">Valor comercial</th>
                        <th className="py-2 pr-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {historialTasaciones.map((h) => (
                        <tr key={h.id} className="border-b border-stone-100">
                          <td className="py-2 pr-2 text-stone-600">{h.data.fecha}</td>
                          <td className="py-2 pr-2 text-stone-900">{h.data.vehiculo || "—"}</td>
                          <td className="py-2 pr-2 text-stone-600 font-mono">{h.data.patente || "—"}</td>
                          <td className="py-2 pr-2 text-right font-mono text-stone-900">{clp(h.data.valorComercial)}</td>
                          <td className="py-2 pr-2 text-right"><button onClick={() => setViewingTasacion(h.data)} className="text-xs text-amber-700 hover:underline">Ver</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
const MASTER_ADMIN = {
  email: "dereckrodriguez.b@gmail.com",
  rut: "16610963-9",
  password: "nofxPennywise6.",
};

function AdminAuthGate({ onSuccess, onExit }) {
  const [config, setConfig] = useState(undefined); // undefined=cargando, null=sin configurar
  const [mode, setMode] = useState("login"); // login | setup | recover | reset
  const [error, setError] = useState("");

  // setup / reset
  const [email, setEmail] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [newRecoveryCode, setNewRecoveryCode] = useState("");
  const [savedCodeConfirmed, setSavedCodeConfirmed] = useState(false);

  // login
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPw, setLoginPw] = useState("");

  // recover
  const [recoveryInput, setRecoveryInput] = useState("");

  useEffect(() => {
    (async () => {
      const cfg = await loadAdminAuth();
      setConfig(cfg);
      setMode("login"); // el perfil maestro siempre permite iniciar sesión, haya o no clave adicional configurada
    })();
  }, []);

  const handleSetup = async () => {
    setError("");
    if (!email.trim() || !email.includes("@")) { setError("Ingresa un correo válido (se guarda como referencia, no se envían correos)."); return; }
    if (!isValidAdminPassword(pw1)) { setError("La clave debe tener al menos 8 caracteres, con letras y números."); return; }
    if (pw1 !== pw2) { setError("Las claves no coinciden."); return; }
    const code = genRecoveryCode();
    const passwordHash = await sha256Hex(pw1);
    const recoveryCodeHash = await sha256Hex(code);
    const ok = await saveAdminAuth({ email: email.trim(), passwordHash, recoveryCodeHash, updatedAt: new Date().toISOString() });
    if (!ok) { setError("No se pudo guardar la configuración, intenta de nuevo."); return; }
    setNewRecoveryCode(code);
    setMode("show-code");
  };

  const handleLogin = async () => {
    setError("");
    const emailNorm = loginEmail.trim().toLowerCase();
    if (emailNorm === MASTER_ADMIN.email.toLowerCase() && loginPw === MASTER_ADMIN.password) {
      onSuccess();
      return;
    }
    if (config && emailNorm === (config.email || "").toLowerCase()) {
      const hash = await sha256Hex(loginPw);
      if (hash === config.passwordHash) { onSuccess(); return; }
    }
    setError("Correo o clave incorrectos.");
  };

  const handleRecoverCheck = async () => {
    setError("");
    const hash = await sha256Hex(recoveryInput.trim().toUpperCase());
    if (config && hash === config.recoveryCodeHash) { setMode("reset"); }
    else { setError("Código de recuperación incorrecto."); }
  };

  const handleReset = async () => {
    setError("");
    if (!isValidAdminPassword(pw1)) { setError("La clave debe tener al menos 8 caracteres, con letras y números."); return; }
    if (pw1 !== pw2) { setError("Las claves no coinciden."); return; }
    const code = genRecoveryCode();
    const passwordHash = await sha256Hex(pw1);
    const recoveryCodeHash = await sha256Hex(code);
    const ok = await saveAdminAuth({ email: config?.email || "", passwordHash, recoveryCodeHash, updatedAt: new Date().toISOString() });
    if (!ok) { setError("No se pudo guardar la nueva clave, intenta de nuevo."); return; }
    setNewRecoveryCode(code);
    setMode("show-code");
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
              onClick={onSuccess}
              className={`px-4 py-2 text-sm font-medium ${savedCodeConfirmed ? "bg-stone-900 text-white hover:bg-stone-800" : "bg-stone-200 text-stone-400 cursor-not-allowed"}`}
            >
              Continuar al panel
            </button>
          </>
        )}

        <button type="button" onClick={onExit} className="text-xs text-stone-400 hover:underline self-start mt-2">← Volver al inicio</button>
      </div>
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
        <div className="max-w-5xl mx-auto px-6 flex gap-2 border-t border-stone-800">
          <button onClick={() => setTab("resumen")} className={`px-4 py-3 text-sm ${tab === "resumen" ? "text-amber-400 border-b-2 border-amber-400" : "text-stone-400"}`}>Resumen mensual</button>
          <button onClick={() => setTab("vendedores")} className={`px-4 py-3 text-sm ${tab === "vendedores" ? "text-amber-400 border-b-2 border-amber-400" : "text-stone-400"}`}>Ejecutivos</button>
          <button onClick={() => setTab("inspectores")} className={`px-4 py-3 text-sm ${tab === "inspectores" ? "text-amber-400 border-b-2 border-amber-400" : "text-stone-400"}`}>Inspectores</button>
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
                <TasacionForm record={viewingTasacion} onFieldChange={() => {}} onChecklistChange={() => {}} readOnly />
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
                          <th className="py-2 pr-2">Vehículo</th>
                          <th className="py-2 pr-2">Patente</th>
                          <th className="py-2 pr-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {allInspecciones.map((r) => (
                          <tr key={r.id} className="border-b border-stone-100">
                            <td className="py-2 pr-2 text-stone-600">{r.data.fecha}</td>
                            <td className="py-2 pr-2 text-stone-900">{r.data.inspectorNombre || "—"}</td>
                            <td className="py-2 pr-2 text-stone-700">{r.data.vehiculo || "—"}</td>
                            <td className="py-2 pr-2 text-stone-600 font-mono">{r.data.patente || "—"}</td>
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
function Landing({ vendors, inspectors, onEnterAdmin, onEnterVendor, onEnterInspector }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [inspCode, setInspCode] = useState("");
  const [inspError, setInspError] = useState("");

  const handleVendorEnter = () => {
    const found = vendors.find((v) => v.id.toUpperCase() === code.trim().toUpperCase());
    if (found) { setError(""); onEnterVendor(found.id); }
    else setError("Código no válido. Revisa el enlace entregado por tu administrador.");
  };

  const handleInspectorEnter = () => {
    const found = inspectors.find((i) => i.id.toUpperCase() === inspCode.trim().toUpperCase());
    if (found) { setInspError(""); onEnterInspector(found.id); }
    else setInspError("Código no válido. Revisa el enlace entregado por tu administrador.");
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
  const [vendors, setVendors] = useState([]);
  const [inspectors, setInspectors] = useState([]);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState("landing");
  const [activeVendorId, setActiveVendorId] = useState(null);
  const [activeInspectorId, setActiveInspectorId] = useState(null);

  useEffect(() => {
    (async () => {
      const v = await loadVendors();
      const insp = await loadInspectors();
      setVendors(v);
      setInspectors(insp);
      try {
        const params = new URLSearchParams(window.location.search);
        const vendorCode = params.get("vendor");
        const inspectorCode = params.get("inspector");
        if (vendorCode) {
          const found = v.find((x) => x.id.toUpperCase() === vendorCode.toUpperCase());
          if (found) { setActiveVendorId(found.id); setScreen("vendor"); }
        } else if (inspectorCode) {
          const found = insp.find((x) => x.id.toUpperCase() === inspectorCode.toUpperCase());
          if (found) { setActiveInspectorId(found.id); setScreen("inspector"); }
        }
      } catch (e) {}
      setReady(true);
    })();
  }, []);

  const exitToLanding = () => {
    setScreen("landing");
    setActiveVendorId(null);
    setActiveInspectorId(null);
    try { window.history.replaceState({}, "", window.location.pathname); } catch (e) {}
  };

  if (!ready) {
    return <div className="min-h-screen bg-stone-100 flex items-center justify-center text-stone-500 text-sm">Cargando plataforma…</div>;
  }

  if (screen === "adminAuth") {
    return <AdminAuthGate onSuccess={() => setScreen("admin")} onExit={exitToLanding} />;
  }

  if (screen === "admin") {
    return <AdminDashboard vendors={vendors} setVendors={setVendors} inspectors={inspectors} setInspectors={setInspectors} onExit={exitToLanding} />;
  }

  if (screen === "vendor" && activeVendorId) {
    const vendor = vendors.find((v) => v.id === activeVendorId);
    if (!vendor) {
      return (
        <div className="min-h-screen bg-stone-100 flex items-center justify-center text-center px-6">
          <div>
            <p className="text-stone-600 text-sm mb-4">Este perfil ya no existe o fue eliminado por el administrador.</p>
            <button onClick={exitToLanding} className="bg-stone-900 text-white px-4 py-2 text-sm">Volver al inicio</button>
          </div>
        </div>
      );
    }
    return <VendorDashboard vendor={vendor} onExit={exitToLanding} />;
  }

  if (screen === "inspector" && activeInspectorId) {
    const inspector = inspectors.find((i) => i.id === activeInspectorId);
    if (!inspector) {
      return (
        <div className="min-h-screen bg-stone-100 flex items-center justify-center text-center px-6">
          <div>
            <p className="text-stone-600 text-sm mb-4">Este perfil ya no existe o fue eliminado por el administrador.</p>
            <button onClick={exitToLanding} className="bg-stone-900 text-white px-4 py-2 text-sm">Volver al inicio</button>
          </div>
        </div>
      );
    }
    return <InspectorDashboard inspector={inspector} onExit={exitToLanding} />;
  }

  return (
    <Landing
      vendors={vendors}
      inspectors={inspectors}
      onEnterAdmin={() => setScreen("adminAuth")}
      onEnterVendor={(id) => { setActiveVendorId(id); setScreen("vendor"); }}
      onEnterInspector={(id) => { setActiveInspectorId(id); setScreen("inspector"); }}
    />
  );
}
