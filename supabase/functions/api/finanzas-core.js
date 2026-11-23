// Gestión financiera de la empresa: reglas puras (sin base ni red), compartidas por el servidor, la pantalla y las pruebas.
// No reemplaza la contabilidad oficial (la lleva el contador): ordena ingresos y egresos, saldos, flujo de caja, resultados
// y rentabilidad por vehículo. Los montos son los registrados (brutos, con IVA si el documento lo incluye).

/**
 * Categorías. `resultado: false` = no es ingreso ni gasto del negocio (aporte de capital, préstamo, retiro del dueño):
 * mueve la caja pero no el estado de resultados. `vehiculo: true` = costo de un vehículo (se suma a su costo y pasa a
 * «costo de ventas» cuando se vende; mientras está en stock es inventario, no gasto).
 */
export const CATEGORIAS_FIN = [
  // Egresos
  { id: "arriendo", nombre: "Arriendo", tipo: "egreso", resultado: true },
  { id: "sueldos", nombre: "Sueldos y leyes sociales", tipo: "egreso", resultado: true },
  { id: "comisiones", nombre: "Comisiones a ejecutivos", tipo: "egreso", resultado: true },
  { id: "publicidad", nombre: "Publicidad y marketing", tipo: "egreso", resultado: true },
  { id: "servicios", nombre: "Servicios básicos e internet", tipo: "egreso", resultado: true },
  { id: "reparacion", nombre: "Reparación y preparación de vehículos", tipo: "egreso", resultado: true, vehiculo: true },
  { id: "traslado", nombre: "Traslado de vehículos", tipo: "egreso", resultado: true, vehiculo: true },
  { id: "tramites", nombre: "Trámites, transferencias y documentos", tipo: "egreso", resultado: true, vehiculo: true },
  { id: "mantencion_local", nombre: "Mantención del local", tipo: "egreso", resultado: true },
  { id: "honorarios", nombre: "Contador y asesorías", tipo: "egreso", resultado: true },
  { id: "bancos", nombre: "Gastos bancarios", tipo: "egreso", resultado: true },
  { id: "impuestos", nombre: "Impuestos, patentes y contribuciones", tipo: "egreso", resultado: true },
  { id: "combustible", nombre: "Combustible y movilización", tipo: "egreso", resultado: true },
  { id: "otros_gastos", nombre: "Otros gastos", tipo: "egreso", resultado: true },
  { id: "pago_consignante", nombre: "Pago al dueño de un auto consignado", tipo: "egreso", resultado: false, conVehiculo: true },
  { id: "devolucion_reserva", nombre: "Devolución de reserva", tipo: "egreso", resultado: false },
  { id: "retiro_dueno", nombre: "Retiro del dueño", tipo: "egreso", resultado: false },
  { id: "pago_prestamo", nombre: "Pago de préstamo", tipo: "egreso", resultado: false },
  // Ingresos
  { id: "comision_financiera", nombre: "Comisiones de financieras", tipo: "ingreso", resultado: true },
  { id: "otros_servicios", nombre: "Otros servicios", tipo: "ingreso", resultado: true },
  { id: "otros_ingresos", nombre: "Otros ingresos", tipo: "ingreso", resultado: true },
  { id: "aporte_capital", nombre: "Aporte de capital", tipo: "ingreso", resultado: false },
  { id: "prestamo", nombre: "Préstamo recibido", tipo: "ingreso", resultado: false },
  // Traspaso entre cuentas (por ejemplo, depositar el efectivo de la caja en el banco)
  { id: "traspaso", nombre: "Traspaso entre cuentas", tipo: "traspaso", resultado: false },
];
/** Categorías de los movimientos que vienen solos del CRM (no se registran a mano). */
export const CATEGORIAS_AUTO = {
  venta_vehiculo: { id: "venta_vehiculo", nombre: "Pago de venta de vehículo", tipo: "ingreso", resultado: false },
  reserva: { id: "reserva", nombre: "Pago de reserva", tipo: "ingreso", resultado: false },
  compra_vehiculo: { id: "compra_vehiculo", nombre: "Pago a dueño por compra de vehículo", tipo: "egreso", resultado: false },
};
export const categoriaFin = (id) => CATEGORIAS_FIN.find((c) => c.id === id) || CATEGORIAS_AUTO[id] || null;
export const DOCUMENTOS_FIN = [
  { id: "factura", nombre: "Factura" }, { id: "boleta", nombre: "Boleta" }, { id: "honorarios", nombre: "Boleta de honorarios" },
  { id: "comprobante", nombre: "Comprobante / recibo" }, { id: "sin_documento", nombre: "Sin documento" },
];
export const MEDIOS_FIN = [
  { id: "transferencia", nombre: "Transferencia" }, { id: "efectivo", nombre: "Efectivo" }, { id: "tarjeta", nombre: "Tarjeta" },
  { id: "cheque", nombre: "Cheque" }, { id: "deposito", nombre: "Depósito" }, { id: "pac", nombre: "Cargo automático (PAC)" },
];
/** Clave de la caja (efectivo) de un local, para los saldos. Las cuentas bancarias usan su id. */
export const claveCaja = (localId) => `caja:${localId || "general"}`;
/** Pagos del CRM que no entraron a una cuenta ni en efectivo (cheques, tarjetas, crédito de la financiera): quedan «por depositar». */
export const POR_DEPOSITAR = "por_depositar";
/** ¿La categoría admite asociar un vehículo? */
export const categoriaConVehiculo = (id) => { const c = categoriaFin(id); return !!(c && (c.vehiculo || c.conVehiculo)); };

const texto = (x, max) => String(x === null || x === undefined ? "" : x).replace(/\s+/g, " ").trim().slice(0, max);
const fechaValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && Number.isFinite(Date.parse(`${s}T12:00:00Z`));

/**
 * Movimiento manual. input: { tipo, categoria, monto, fecha, descripcion, contraparte, documentoTipo, documentoNumero,
 * medio, cuentaId (vacío = caja), cuentaDestinoId (traspasos), vehiculoId, notas }.
 */
export function validarMovimiento(input, { hoy } = {}) {
  const i = input || {};
  const tipo = String(i.tipo || "");
  if (!["ingreso", "egreso", "traspaso"].includes(tipo)) return { ok: false, error: "fin_tipo" };
  const cat = CATEGORIAS_FIN.find((c) => c.id === (tipo === "traspaso" ? "traspaso" : String(i.categoria || "")));
  if (!cat || cat.tipo !== tipo) return { ok: false, error: "fin_categoria" };
  const monto = Math.round(Number(i.monto));
  if (!Number.isFinite(monto) || monto <= 0 || monto > 10_000_000_000) return { ok: false, error: "fin_monto" };
  if (!fechaValida(i.fecha)) return { ok: false, error: "fin_fecha" };
  if (hoy && String(i.fecha) > hoy) return { ok: false, error: "fin_fecha_futura" };
  const cuenta = texto(i.cuentaId, 40) || null;
  const destino = texto(i.cuentaDestinoId, 40) || null;
  if (tipo === "traspaso" && (cuenta || "caja") === (destino || "caja")) return { ok: false, error: "fin_traspaso" };
  const descripcion = texto(i.descripcion, 200);
  if (descripcion.length < 3) return { ok: false, error: "fin_descripcion" };
  const documento = DOCUMENTOS_FIN.some((d) => d.id === i.documentoTipo) ? i.documentoTipo : "sin_documento";
  const medio = MEDIOS_FIN.some((m) => m.id === i.medio) ? i.medio : (cuenta ? "transferencia" : "efectivo");
  return {
    ok: true,
    value: {
      tipo, categoria: cat.id, monto, fecha: String(i.fecha), descripcion, contraparte: texto(i.contraparte, 120) || null,
      documento_tipo: documento, documento_numero: texto(i.documentoNumero, 40) || null, medio,
      cuenta_id: cuenta, cuenta_destino_id: tipo === "traspaso" ? destino : null,
      vehiculo_id: cat.vehiculo || cat.conVehiculo ? texto(i.vehiculoId, 40) || null : null, notas: texto(i.notas, 500) || null,
    },
  };
}

/** Clave de saldo de un movimiento normalizado: la cuenta bancaria, «por depositar» o la caja del local. */
export const claveDe = (cuentaId, localId) => cuentaId || claveCaja(localId);

/**
 * Saldos por cuenta. `saldos`: [{ clave, saldo_inicial, desde }]; `movs`: movimientos normalizados
 * { fecha, tipo, monto, cuenta_id, cuenta_destino_id, local_id }. Solo cuentan los movimientos desde la fecha del saldo inicial.
 */
export function calcularSaldos(saldos, movs) {
  const out = {};
  for (const s of saldos || []) out[s.clave] = { clave: s.clave, inicial: Number(s.saldo_inicial) || 0, desde: s.desde, ingresos: 0, egresos: 0, saldo: Number(s.saldo_inicial) || 0 };
  const sumar = (clave, fecha, delta) => {
    const s = out[clave] || (out[clave] = { clave, inicial: 0, desde: null, ingresos: 0, egresos: 0, saldo: 0 });
    if (s.desde && fecha < s.desde) return;
    if (delta >= 0) s.ingresos += delta; else s.egresos += -delta;
    s.saldo += delta;
  };
  for (const m of movs || []) {
    const monto = Number(m.monto) || 0;
    if (m.tipo === "ingreso") sumar(claveDe(m.cuenta_id, m.local_id), m.fecha, monto);
    else if (m.tipo === "egreso") sumar(claveDe(m.cuenta_id, m.local_id), m.fecha, -monto);
    else if (m.tipo === "traspaso") { sumar(claveDe(m.cuenta_id, m.local_id), m.fecha, -monto); sumar(claveDe(m.cuenta_destino_id, m.local_id), m.fecha, monto); }
  }
  return out;
}

/** Flujo de caja por mes (AAAA-MM): entradas, salidas y neto. Los traspasos no cuentan (solo mueven plata entre cuentas). */
export function flujoMensual(movs) {
  const meses = {};
  for (const m of movs || []) {
    if (m.tipo === "traspaso") continue;
    const mes = String(m.fecha).slice(0, 7);
    const f = meses[mes] || (meses[mes] = { mes, entradas: 0, salidas: 0, neto: 0 });
    const monto = Number(m.monto) || 0;
    if (m.tipo === "ingreso") f.entradas += monto; else f.salidas += monto;
    f.neto = f.entradas - f.salidas;
  }
  return Object.values(meses).sort((a, b) => a.mes.localeCompare(b.mes));
}

/**
 * Rentabilidad de un vehículo: lo que costó (compra + gastos asociados) contra lo que se vendió.
 * v: { costoCompra, gastos, precioVenta|null }.
 */
export function rentabilidadVehiculo({ costoCompra = 0, gastos = 0, precioVenta = null }) {
  const invertido = (Number(costoCompra) || 0) + (Number(gastos) || 0);
  if (precioVenta == null) return { invertido, margen: null, margenPct: null };
  const margen = Number(precioVenta) - invertido;
  return { invertido, margen, margenPct: Number(precioVenta) > 0 ? Math.round((margen / Number(precioVenta)) * 1000) / 10 : null };
}

/**
 * Estado de resultados (lo devengado en el período, no la caja):
 *   ventas: [{ precio, costo }] (vehículos vendidos y aprobados en el período, costo = compra + gastos del vehículo)
 *   manuales: movimientos manuales vigentes del período { tipo, categoria, monto, vehiculo_id }
 * Gastos asociados a un vehículo no se cuentan aquí (son costo del vehículo); sin vehículo, sí son gasto del período.
 */
export function estadoResultados({ ventas = [], manuales = [] }) {
  const ingresosVentas = ventas.reduce((s, v) => s + (Number(v.precio) || 0), 0);
  const costoVentas = ventas.reduce((s, v) => s + (Number(v.costo) || 0), 0);
  const otrosIngresos = {};
  const gastos = {};
  for (const m of manuales) {
    const cat = categoriaFin(m.categoria);
    if (!cat || !cat.resultado) continue;
    if (cat.vehiculo && m.vehiculo_id) continue;
    const destino = m.tipo === "ingreso" ? otrosIngresos : m.tipo === "egreso" ? gastos : null;
    if (destino) destino[cat.id] = (destino[cat.id] || 0) + (Number(m.monto) || 0);
  }
  const totalOtros = Object.values(otrosIngresos).reduce((s, x) => s + x, 0);
  const totalGastos = Object.values(gastos).reduce((s, x) => s + x, 0);
  const margenBruto = ingresosVentas - costoVentas;
  return {
    unidades: ventas.length, ingresosVentas, costoVentas, margenBruto,
    otrosIngresos: Object.entries(otrosIngresos).map(([id, monto]) => ({ id, nombre: categoriaFin(id).nombre, monto })).sort((a, b) => b.monto - a.monto),
    totalOtros,
    gastos: Object.entries(gastos).map(([id, monto]) => ({ id, nombre: categoriaFin(id).nombre, monto })).sort((a, b) => b.monto - a.monto),
    totalGastos,
    resultado: margenBruto + totalOtros - totalGastos,
  };
}

/** Período de un mes (AAAA-MM) o un año (AAAA): fechas desde/hasta inclusive. */
export function periodo(p) {
  const s = String(p || "");
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [a, m] = s.split("-").map(Number);
    const fin = new Date(Date.UTC(a, m, 0)).getUTCDate();
    return { desde: `${s}-01`, hasta: `${s}-${String(fin).padStart(2, "0")}` };
  }
  if (/^\d{4}$/.test(s)) return { desde: `${s}-01-01`, hasta: `${s}-12-31` };
  return null;
}

/** Texto CSV (separado por punto y coma, como lo abre Excel en Chile) de los movimientos, para el contador. */
export function movimientosCsv(movs, nombreCuenta = (id) => id || "Caja") {
  const esc = (v) => { const t = String(v ?? ""); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const filas = [["Fecha", "Tipo", "Categoría", "Descripción", "Contraparte", "Documento", "N° documento", "Medio", "Cuenta", "Cuenta destino", "Monto", "Origen", "Estado"]];
  for (const m of movs) {
    const cat = categoriaFin(m.categoria);
    filas.push([m.fecha, m.tipo, cat ? cat.nombre : m.categoria, m.descripcion, m.contraparte || "", (DOCUMENTOS_FIN.find((d) => d.id === m.documento_tipo) || {}).nombre || "",
      m.documento_numero || "", (MEDIOS_FIN.find((x) => x.id === m.medio) || {}).nombre || m.medio || "", nombreCuenta(m.cuenta_id),
      m.tipo === "traspaso" ? nombreCuenta(m.cuenta_destino_id) : "", m.tipo === "egreso" ? -Number(m.monto) : Number(m.monto), m.origen === "manual" ? "Manual" : `CRM (${m.folio || m.origen})`, m.estado === "anulado" ? "Anulado" : "Vigente"]);
  }
  return filas.map((f) => f.map(esc).join(";")).join("\r\n");
}
