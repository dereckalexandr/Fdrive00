/**
 * PAGOS DE UNA VENTA
 * ----------------------------------------------------------------
 * Cada pago se registra aparte, con su medio, monto, fecha, la cuenta de la empresa donde llegó (si fue por banco) y su respaldo.
 * Para aprobar la venta, los pagos vigentes deben sumar exactamente el precio de venta y los que lo exigen deben traer respaldo.
 * Código puro (lo usan el servidor, las pantallas y las pruebas).
 * ----------------------------------------------------------------
 */

/** requiereCuenta: dónde llegó la plata en la empresa. requiereRespaldo: comprobante obligatorio. requiereReferencia: N° de operación o de documento. */
export const MEDIOS_PAGO = [
  { id: "transferencia", nombre: "Transferencia bancaria", requiereCuenta: true, requiereRespaldo: true, requiereReferencia: true, referencia: "N° de operación" },
  { id: "deposito", nombre: "Depósito bancario", requiereCuenta: true, requiereRespaldo: true, requiereReferencia: true, referencia: "N° de depósito" },
  { id: "vale_vista", nombre: "Vale vista", requiereCuenta: true, requiereRespaldo: true, requiereReferencia: true, referencia: "N° de vale vista" },
  { id: "efectivo", nombre: "Efectivo", requiereCuenta: false, requiereRespaldo: true, requiereReferencia: false, referencia: "N° de recibo (opcional)" },
  { id: "cheque", nombre: "Cheque", requiereCuenta: false, requiereRespaldo: true, requiereReferencia: true, referencia: "N° de cheque" },
  { id: "tarjeta", nombre: "Tarjeta (débito o crédito)", requiereCuenta: false, requiereRespaldo: true, requiereReferencia: false, referencia: "N° de operación (opcional)" },
  { id: "credito", nombre: "Crédito de la financiera", requiereCuenta: false, requiereRespaldo: false, requiereReferencia: false, referencia: "N° de operación (opcional)" },
  { id: "parte_pago", nombre: "Vehículo en parte de pago", requiereCuenta: false, requiereRespaldo: false, requiereReferencia: false, referencia: "Patente del vehículo recibido" },
];

const IDS = MEDIOS_PAGO.map((m) => m.id);
export const medioDe = (id) => MEDIOS_PAGO.find((m) => m.id === id) || null;
export const medioNombre = (id) => (medioDe(id) || { nombre: String(id || "") }).nombre;
export const MAX_ARCHIVOS_PAGO = 4;

const texto = (x, max) => String(x === null || x === undefined ? "" : x).replace(/\s+/g, " ").trim().slice(0, max);
const entero = (x, min, max) => {
  if (x === "" || x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));

/**
 * Un pago que registra el ejecutivo. `hoy` (AAAA-MM-DD, hora de Chile) pone el tope de la fecha: no puede ser futura.
 * @param input { medio, monto, fechaPago, cuentaId, referencia, notas }
 */
export function validarPago(input, { hoy } = {}) {
  const i = input || {};
  const medio = medioDe(String(i.medio || ""));
  if (!medio) return { ok: false, error: "medio_pago_invalido" };
  const monto = entero(i.monto, 1, 2_000_000_000);
  if (monto === null || Number.isNaN(monto)) return { ok: false, error: "monto_invalido" };
  const fecha = String(i.fechaPago || "").slice(0, 10);
  if (!esFecha(fecha) || fecha < "2020-01-01") return { ok: false, error: "fecha_pago_invalida" };
  if (hoy && fecha > hoy) return { ok: false, error: "fecha_pago_futura" };
  const cuentaId = medio.requiereCuenta ? String(i.cuentaId || "") : "";
  if (medio.requiereCuenta && !cuentaId) return { ok: false, error: "cuenta_requerida" };
  const referencia = texto(i.referencia, 60);
  if (medio.requiereReferencia && referencia.length < 3) return { ok: false, error: "referencia_requerida" };
  return { ok: true, value: { medio: medio.id, monto, fecha_pago: fecha, cuenta_id: cuentaId || null, referencia: referencia || null, notas: texto(i.notas, 300) || null } };
}

/** Una cuenta bancaria de la empresa. */
export function validarCuentaEmpresa(input) {
  const i = input || {};
  const banco = texto(i.banco, 60);
  if (banco.length < 2) return { ok: false, error: "banco_requerido" };
  const numero = texto(i.numeroCuenta, 30).replace(/[^0-9A-Za-z-]/g, "");
  if (numero.length < 4) return { ok: false, error: "numero_cuenta_invalido" };
  return {
    ok: true,
    value: {
      banco, numero_cuenta: numero, tipo_cuenta: texto(i.tipoCuenta, 30) || null, titular: texto(i.titular, 80) || null, rut_titular: texto(i.rutTitular, 14) || null,
      alias: texto(i.alias, 40) || null, activa: i.activa === false ? false : true,
    },
  };
}

/** Nombre corto de una cuenta para mostrarla: «BCI · Cuenta corriente 1234…» o su alias. */
export function etiquetaCuenta(c) {
  if (!c) return "";
  const base = [c.banco, c.tipo_cuenta, c.numero_cuenta].filter(Boolean).join(" · ");
  return c.alias ? `${c.alias} (${base})` : base;
}

/**
 * Cuánto se ha registrado y qué falta.
 * @param pagos   filas de cierre_pagos (se ignoran las anuladas)
 * @param precio  precio de venta
 */
export function resumenPagos(pagos, precio) {
  const vigentes = (pagos || []).filter((p) => p.estado !== "anulado");
  const total = vigentes.reduce((s, p) => s + Number(p.monto || 0), 0);
  const sinRespaldo = vigentes.filter((p) => (medioDe(p.medio) || {}).requiereRespaldo && (p.archivos || []).length === 0);
  const falta = Number(precio) - total;
  return { vigentes, total, falta: Math.max(0, falta), sobra: Math.max(0, -falta), cuadra: falta === 0, sinRespaldo };
}

/** ¿Los pagos permiten aprobar la venta? Devuelve { ok } o { ok:false, error }. */
export function verificarPagos(pagos, precio) {
  const r = resumenPagos(pagos, precio);
  if (r.vigentes.length === 0) return { ok: false, error: "sin_pagos" };
  if (!r.cuadra) return { ok: false, error: "pagos_no_cuadran" };
  if (r.sinRespaldo.length > 0) return { ok: false, error: "pago_sin_respaldo" };
  return { ok: true };
}
