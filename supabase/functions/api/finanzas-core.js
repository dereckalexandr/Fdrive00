// Gestión financiera de la empresa: reglas puras (sin base ni red), compartidas por el servidor, la pantalla y las pruebas.
// No reemplaza la contabilidad oficial (la lleva el contador): ordena ingresos y egresos, saldos, flujo de caja, resultados
// y rentabilidad por vehículo. Los montos son los registrados (brutos, con IVA si el documento lo incluye).

/**
 * Categorías. `resultado: false` = no es ingreso ni gasto del negocio (aporte de capital, préstamo, retiro del dueño):
 * mueve la caja pero no el estado de resultados. `vehiculo: true` = costo de un vehículo (se suma a su costo y pasa a
 * «costo de ventas» cuando se vende; mientras está en stock es inventario, no gasto). `grupo` ordena los gastos en pantalla y en el informe.
 */
export const GRUPOS_FIN = [
  { id: "operacion", nombre: "Gastos de operación" },
  { id: "personal", nombre: "Personal" },
  { id: "comercial", nombre: "Marketing y ventas" },
  { id: "vehiculos", nombre: "Vehículos" },
  { id: "impuestos", nombre: "Impuestos y patentes" },
  { id: "financieros", nombre: "Gastos financieros" },
  { id: "otros", nombre: "Otros" },
  { id: "no_resultado", nombre: "No son gasto (mueven caja)" },
  { id: "ingresos", nombre: "Ingresos" },
];
export const CATEGORIAS_FIN = [
  // Egresos: operación de la oficina y el local
  { id: "arriendo", nombre: "Arriendo de oficina y local", tipo: "egreso", resultado: true, grupo: "operacion" },
  { id: "gastos_comunes", nombre: "Gastos comunes, aseo y seguridad", tipo: "egreso", resultado: true, grupo: "operacion" },
  { id: "servicios", nombre: "Luz, agua, internet y teléfono", tipo: "egreso", resultado: true, grupo: "operacion" },
  { id: "insumos", nombre: "Insumos y artículos de oficina", tipo: "egreso", resultado: true, grupo: "operacion" },
  { id: "software", nombre: "Software, sistemas y suscripciones", tipo: "egreso", resultado: true, grupo: "operacion" },
  { id: "mantencion_local", nombre: "Mantención y reparaciones del local", tipo: "egreso", resultado: true, grupo: "operacion" },
  { id: "seguros", nombre: "Seguros", tipo: "egreso", resultado: true, grupo: "operacion" },
  { id: "honorarios", nombre: "Contador, abogado y asesorías", tipo: "egreso", resultado: true, grupo: "operacion" },
  { id: "combustible", nombre: "Combustible, peajes y movilización", tipo: "egreso", resultado: true, grupo: "operacion" },
  // Personal
  { id: "sueldos", nombre: "Sueldos y leyes sociales", tipo: "egreso", resultado: true, grupo: "personal" },
  { id: "comisiones", nombre: "Comisiones (fuera de la nómina)", tipo: "egreso", resultado: true, grupo: "personal" },
  // Marketing y ventas
  { id: "publicidad", nombre: "Publicidad y marketing digital", tipo: "egreso", resultado: true, grupo: "comercial" },
  { id: "portales", nombre: "Portales de avisos (Chileautos, Yapo…)", tipo: "egreso", resultado: true, grupo: "comercial" },
  // Vehículos (con vehículo asociado, se suman a su costo)
  { id: "reparacion", nombre: "Reparación y preparación de vehículos", tipo: "egreso", resultado: true, vehiculo: true, grupo: "vehiculos" },
  { id: "traslado", nombre: "Traslado de vehículos", tipo: "egreso", resultado: true, vehiculo: true, grupo: "vehiculos" },
  { id: "tramites", nombre: "Trámites, transferencias y documentos", tipo: "egreso", resultado: true, vehiculo: true, grupo: "vehiculos" },
  // Impuestos
  { id: "impuestos", nombre: "Impuestos (renta, multas, otros)", tipo: "egreso", resultado: true, grupo: "impuestos" },
  { id: "patentes", nombre: "Patente municipal y contribuciones", tipo: "egreso", resultado: true, grupo: "impuestos" },
  // Financieros
  { id: "bancos", nombre: "Comisiones y mantención bancaria", tipo: "egreso", resultado: true, grupo: "financieros" },
  { id: "intereses", nombre: "Intereses de créditos", tipo: "egreso", resultado: true, grupo: "financieros" },
  { id: "otros_gastos", nombre: "Otros gastos", tipo: "egreso", resultado: true, grupo: "otros" },
  // No son gasto del negocio
  { id: "pago_consignante", nombre: "Pago al dueño de un auto consignado", tipo: "egreso", resultado: false, conVehiculo: true, grupo: "no_resultado" },
  { id: "devolucion_reserva", nombre: "Devolución de reserva", tipo: "egreso", resultado: false, grupo: "no_resultado" },
  { id: "retiro_dueno", nombre: "Retiro del dueño", tipo: "egreso", resultado: false, grupo: "no_resultado" },
  { id: "pago_prestamo", nombre: "Pago de capital de un préstamo", tipo: "egreso", resultado: false, grupo: "no_resultado" },
  // Ingresos
  { id: "comision_financiera", nombre: "Comisiones de financieras", tipo: "ingreso", resultado: true, grupo: "ingresos" },
  { id: "otros_servicios", nombre: "Otros servicios", tipo: "ingreso", resultado: true, grupo: "ingresos" },
  { id: "otros_ingresos", nombre: "Otros ingresos", tipo: "ingreso", resultado: true, grupo: "ingresos" },
  { id: "aporte_capital", nombre: "Aporte de capital", tipo: "ingreso", resultado: false, grupo: "no_resultado" },
  { id: "prestamo", nombre: "Préstamo recibido", tipo: "ingreso", resultado: false, grupo: "no_resultado" },
  // Traspaso entre cuentas (por ejemplo, depositar el efectivo de la caja en el banco)
  { id: "traspaso", nombre: "Traspaso entre cuentas", tipo: "traspaso", resultado: false, grupo: "no_resultado" },
];
/** Categorías de un tipo, agrupadas para mostrarlas en un selector. */
export const categoriasAgrupadas = (tipo) => GRUPOS_FIN
  .map((g) => ({ ...g, categorias: CATEGORIAS_FIN.filter((c) => c.tipo === tipo && c.grupo === g.id) }))
  .filter((g) => g.categorias.length > 0);

/* ---------- Respaldos ---------- */
export const MAX_ARCHIVOS_FIN = 5;
/** Espacio de los archivos de un movimiento en el almacén: dval::fin-<uuid>::<archivo>. */
export const NS_FIN = /^fin-[0-9a-f-]{36}$/;
/** ¿El movimiento debería tener respaldo y no lo tiene? (los manuales; los del CRM traen el suyo en la venta o compra). */
export const faltaRespaldo = (m) => m.origen === "manual" && m.estado !== "anulado" && m.tipo !== "traspaso" && !((m.archivos || []).length > 0);

/**
 * Gastos del negocio por categoría y mes (lo que entra al estado de resultados), para el informe de gastos de operación.
 * movs: movimientos manuales vigentes { tipo, categoria, monto, fecha, mes_resultado, vehiculo_id }. meses: ["2026-06", …].
 * Los gastos de un vehículo asociado no van (son costo del auto).
 */
export function gastosPorMes(movs, meses) {
  const filas = {};
  const totales = Object.fromEntries(meses.map((m) => [m, 0]));
  for (const m of movs || []) {
    if (m.tipo !== "egreso" || m.estado === "anulado") continue;
    const cat = categoriaFin(m.categoria);
    if (!cat || !cat.resultado || (cat.vehiculo && m.vehiculo_id)) continue;
    const mes = m.mes_resultado || String(m.fecha).slice(0, 7);
    if (!(mes in totales)) continue;
    const f = filas[cat.id] || (filas[cat.id] = { id: cat.id, nombre: cat.nombre, grupo: cat.grupo, meses: Object.fromEntries(meses.map((x) => [x, 0])), total: 0 });
    f.meses[mes] += Number(m.monto) || 0;
    f.total += Number(m.monto) || 0;
    totales[mes] += Number(m.monto) || 0;
  }
  const grupos = GRUPOS_FIN.map((g) => {
    const cats = CATEGORIAS_FIN.filter((c) => c.grupo === g.id).map((c) => filas[c.id]).filter(Boolean);
    const meses_ = Object.fromEntries(meses.map((x) => [x, cats.reduce((s, c) => s + c.meses[x], 0)]));
    return { id: g.id, nombre: g.nombre, categorias: cats, meses: meses_, total: cats.reduce((s, c) => s + c.total, 0) };
  }).filter((g) => g.categorias.length > 0);
  const total = Object.values(totales).reduce((s, x) => s + x, 0);
  return { meses, grupos, totales, total, promedio: meses.length ? Math.round(total / meses.length) : 0 };
}

/**
 * Gastos fijos que faltan registrar en un mes: la última versión de cada serie de gastos marcados como fijos (por ejemplo, el arriendo)
 * que todavía no tiene un movimiento en ese mes. movs: manuales vigentes con { id, serie_id, recurrente, fecha, mes_resultado }.
 */
export function gastosFijosPendientes(movs, mes) {
  const series = {};
  for (const m of movs || []) {
    if (m.estado === "anulado") continue;
    const serie = m.serie_id || m.id;
    const mesM = m.mes_resultado || String(m.fecha).slice(0, 7);
    const s = series[serie] || (series[serie] = { ultimo: null, meses: new Set() });
    s.meses.add(mesM);
    if (m.recurrente && mesM < mes && (!s.ultimo || m.fecha > s.ultimo.fecha)) s.ultimo = m;
  }
  return Object.entries(series).filter(([, s]) => s.ultimo && !s.meses.has(mes)).map(([serie, s]) => ({ ...s.ultimo, serie_id: serie }))
    .sort((a, b) => a.categoria.localeCompare(b.categoria) || b.monto - a.monto);
}
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
  const recurrente = tipo === "egreso" && !!i.recurrente;
  return {
    ok: true,
    value: {
      recurrente, serie_id: recurrente && /^[0-9a-f-]{36}$/.test(String(i.serieId || "")) ? String(i.serieId) : null,
      tipo, categoria: cat.id, monto, fecha: String(i.fecha), descripcion, contraparte: texto(i.contraparte, 120) || null,
      documento_tipo: documento, documento_numero: texto(i.documentoNumero, 40) || null, medio,
      cuenta_id: cuenta, cuenta_destino_id: tipo === "traspaso" ? destino : null,
      vehiculo_id: cat.vehiculo || cat.conVehiculo ? texto(i.vehiculoId, 40) || null : null, notas: texto(i.notas, 500) || null,
      // Mes al que corresponde el gasto (por ejemplo, la publicidad de octubre pagada en noviembre). Solo se guarda si viene: así editar no lo borra.
      ...(/^\d{4}-(0[1-9]|1[0-2])$/.test(String(i.mesResultado || "")) ? { mes_resultado: String(i.mesResultado) } : {}),
    },
  };
}

/* ---------- Presupuesto mensual por categoría ---------- */
/** Categorías que admiten presupuesto: los gastos del negocio (no aportes, retiros ni pagos de préstamos). */
export const categoriasPresupuesto = () => CATEGORIAS_FIN.filter((c) => c.tipo === "egreso" && c.resultado);

/** Presupuesto guardado: { categoria: monto mensual }. Descarta categorías que no existen y montos inválidos o en cero. */
export function validarPresupuesto(input) {
  const out = {};
  const validas = new Set(categoriasPresupuesto().map((c) => c.id));
  for (const [id, v] of Object.entries((input && input.categorias) || {})) {
    if (!validas.has(id)) return { ok: false, error: "fin_categoria" };
    const n = Math.round(Number(String(v).replace(/\D/g, "")));
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000) return { ok: false, error: "fin_monto" };
    if (n > 0) out[id] = n;
  }
  return { ok: true, value: { categorias: out } };
}

/**
 * Lo gastado en el mes contra el presupuesto de cada categoría (resultado de gastosPorMes y el presupuesto guardado).
 * Incluye las categorías con presupuesto (aunque no tengan gasto) y las que gastaron sin presupuesto.
 */
export function compararPresupuesto(gastos, presupuesto, mes) {
  const pres = (presupuesto && presupuesto.categorias) || {};
  const gastoDe = {};
  for (const g of (gastos && gastos.grupos) || []) for (const c of g.categorias) gastoDe[c.id] = c.meses[mes] || 0;
  const ids = new Set([...Object.keys(pres), ...Object.keys(gastoDe).filter((id) => gastoDe[id] > 0)]);
  const filas = [...ids].map((id) => {
    const c = categoriaFin(id) || { id, nombre: id, grupo: "otros" };
    const p = pres[id] || 0; const g = gastoDe[id] || 0;
    return { id, nombre: c.nombre, grupo: c.grupo, presupuesto: p, gasto: g, pct: p > 0 ? Math.round((g / p) * 100) : null, excede: p > 0 ? g > p : false, sinPresupuesto: p === 0 && g > 0 };
  }).sort((a, b) => (GRUPOS_FIN.findIndex((x) => x.id === a.grupo) - GRUPOS_FIN.findIndex((x) => x.id === b.grupo)) || b.gasto - a.gasto);
  const totalPresupuesto = filas.reduce((s, f) => s + f.presupuesto, 0);
  const totalGasto = filas.filter((f) => f.presupuesto > 0).reduce((s, f) => s + f.gasto, 0);
  return { mes, filas, totalPresupuesto, totalGasto, excedidas: filas.filter((f) => f.excede) };
}

/* ---------- Publicidad de Meta y Google en Finanzas ---------- */
/** ¿El egreso de publicidad corresponde a esa plataforma? (por el proveedor o la descripción). */
export const esDePlataforma = (m, plataforma) => (plataforma === "meta" ? /meta|facebook|instagram/i : /google/i).test(`${m.contraparte || ""} ${m.descripcion || ""}`);

/**
 * Lo que gastó cada plataforma por mes contra lo registrado en Finanzas como publicidad de esa plataforma.
 * gastos: { meta: { "AAAA-MM": monto }, google: {...} }; movs: egresos manuales vigentes.
 */
export function publicidadPorRegistrar(gastos, movs, meses) {
  const filas = [];
  for (const plataforma of Object.keys(gastos || {})) {
    for (const mes of meses) {
      const gasto = Math.round(Number((gastos[plataforma] || {})[mes]) || 0);
      const registrado = (movs || []).filter((m) => m.estado !== "anulado" && m.tipo === "egreso" && m.categoria === "publicidad" && esDePlataforma(m, plataforma) && (m.mes_resultado || String(m.fecha).slice(0, 7)) === mes)
        .reduce((s, m) => s + Number(m.monto), 0);
      if (gasto || registrado) filas.push({ plataforma, mes, gasto, registrado, diferencia: gasto - registrado });
    }
  }
  return filas;
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
  const filas = [["Fecha", "Tipo", "Categoría", "Descripción", "Contraparte", "Documento", "N° documento", "Medio", "Cuenta", "Cuenta destino", "Monto", "Origen", "Estado", "Respaldos"]];
  for (const m of movs) {
    const cat = categoriaFin(m.categoria);
    filas.push([m.fecha, m.tipo, cat ? cat.nombre : m.categoria, m.descripcion, m.contraparte || "", (DOCUMENTOS_FIN.find((d) => d.id === m.documento_tipo) || {}).nombre || "",
      m.documento_numero || "", (MEDIOS_FIN.find((x) => x.id === m.medio) || {}).nombre || m.medio || "", nombreCuenta(m.cuenta_id),
      m.tipo === "traspaso" ? nombreCuenta(m.cuenta_destino_id) : "", m.tipo === "egreso" ? -Number(m.monto) : Number(m.monto), m.origen === "manual" ? "Manual" : `CRM (${m.folio || m.origen})`, m.estado === "anulado" ? "Anulado" : "Vigente",
      m.origen === "manual" ? ((m.archivos || []).length ? String((m.archivos || []).length) : (m.tipo === "traspaso" ? "" : "FALTA")) : "En el CRM"]);
  }
  return filas.map((f) => f.map(esc).join(";")).join("\r\n");
}
