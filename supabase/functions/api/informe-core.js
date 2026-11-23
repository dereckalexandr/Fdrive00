// Informe mensual de Finanzas para el dueño: arma el contenido a partir de lo que ya calcula el módulo (resumen, rentabilidad,
// gastos, conciliaciones, gastos fijos y nómina). Puro: sin base ni red. La pantalla lo convierte en PDF.
import { categoriaFin, GRUPOS_FIN } from "./finanzas-core.js";
import { formatearRut } from "./crm-core.js";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const nombrePeriodo = (p) => { const [a, m] = String(p).split("-"); return m ? `${MESES[Number(m) - 1]} de ${a}` : `año ${a}`; };
/** Período anterior: el mes anterior (AAAA-MM) o el año anterior (AAAA). */
export function periodoAnterior(p) {
  const s = String(p);
  if (/^\d{4}$/.test(s)) return String(Number(s) - 1);
  let [a, m] = s.split("-").map(Number);
  m--; if (m === 0) { m = 12; a--; }
  return `${a}-${String(m).padStart(2, "0")}`;
}
/** Variación porcentual (null si no hay base para comparar). */
export const variacion = (actual, anterior) => (anterior ? Math.round(((actual - anterior) / Math.abs(anterior)) * 1000) / 10 : null);

/** Gastos del estado de resultados agrupados (operación, personal, marketing…), con el período anterior al lado. */
function gastosPorGrupo(actual, anterior) {
  const suma = (lista) => {
    const g = {};
    for (const x of lista || []) { const c = categoriaFin(x.id); const grupo = (c && c.grupo) || "otros"; g[grupo] = (g[grupo] || 0) + x.monto; }
    return g;
  };
  const a = suma(actual); const b = suma(anterior);
  return GRUPOS_FIN.filter((g) => a[g.id] || b[g.id]).map((g) => ({ id: g.id, nombre: g.nombre, monto: a[g.id] || 0, anterior: b[g.id] || 0, variacion: variacion(a[g.id] || 0, b[g.id] || 0) }));
}

/**
 * Contenido del informe.
 * @param d { periodo, hoy, empresa, resumen, resumenAnterior, rentabilidad, sinRespaldo, conciliaciones, fijosPendientes, nomina }
 *   nomina: { aplica, guardada, trabajadores } (solo para un mes)
 */
export function armarInforme(d) {
  const r = d.resumen.resultados;
  const ra = d.resumenAnterior ? d.resumenAnterior.resultados : null;
  const fin = d.resumen.periodo && d.resumen.periodo.hasta;
  const cifras = [
    { id: "resultado", nombre: "Resultado", monto: r.resultado, anterior: ra ? ra.resultado : null },
    { id: "ventas", nombre: `Ventas (${r.unidades} ${r.unidades === 1 ? "auto" : "autos"})`, monto: r.ingresosVentas, anterior: ra ? ra.ingresosVentas : null },
    { id: "margen", nombre: "Margen bruto de las ventas", monto: r.margenBruto, anterior: ra ? ra.margenBruto : null },
    { id: "gastos", nombre: "Gastos del negocio", monto: r.totalGastos, anterior: ra ? ra.totalGastos : null },
    { id: "caja", nombre: "Flujo de caja (entró − salió)", monto: d.resumen.caja.neto, anterior: d.resumenAnterior ? d.resumenAnterior.caja.neto : null },
  ].map((c) => ({ ...c, variacion: c.anterior === null ? null : variacion(c.monto, c.anterior) }));

  // Pendientes y alertas: lo que hay que resolver para cerrar bien el período.
  const alertas = [];
  const n = (k, uno, varios) => `${k} ${k === 1 ? uno : varios}`;
  const pesos = (n) => `$${Math.round(n).toLocaleString("es-CL")}`;
  if (r.resultado < 0) alertas.push({ nivel: "alta", texto: `El resultado del período es negativo (${pesos(r.resultado)}).` });
  for (const c of d.resumen.cuentas || []) if (c.saldo < 0) alertas.push({ nivel: "alta", texto: `${c.nombre} tiene saldo negativo (${pesos(c.saldo)}): falta registrar ingresos o revisar el saldo inicial.` });
  for (const c of (d.resumen.cuentas || []).filter((x) => x.tipo === "banco")) {
    const u = (d.conciliaciones || {})[c.clave];
    if (!u) alertas.push({ nivel: "media", texto: `${c.nombre}: nunca se ha conciliado con la cartola del banco.` });
    else if (u.faltan || u.diferencia) alertas.push({ nivel: "alta", texto: `${c.nombre}: la última conciliación (al ${u.hasta}) tiene ${u.faltan ? `${u.faltan} movimientos por registrar` : ""}${u.faltan && u.diferencia ? " y " : ""}${u.diferencia ? `una diferencia de ${pesos(u.diferencia)}` : ""}.` });
    else if (fin && u.hasta < fin) alertas.push({ nivel: "baja", texto: `${c.nombre}: conciliada hasta el ${u.hasta}; falta conciliar el resto del período.` });
  }
  if (d.sinRespaldo && d.sinRespaldo.cantidad) alertas.push({ nivel: "media", texto: `${n(d.sinRespaldo.cantidad, "movimiento", "movimientos")} sin factura, boleta ni comprobante (${pesos(d.sinRespaldo.monto)}).` });
  if (d.fijosPendientes) alertas.push({ nivel: "media", texto: `${n(d.fijosPendientes, "gasto fijo", "gastos fijos")} del mes aún sin registrar (arriendo, servicios…).` });
  if (d.nomina && d.nomina.aplica && !d.nomina.guardada) alertas.push({ nivel: "media", texto: `La nómina de ${nombrePeriodo(d.periodo)} no está guardada (${d.nomina.trabajadores} trabajadores).` });
  const nominaPend = (d.resumen.porPagar || []).filter((x) => x.tipo === "nomina");
  if (nominaPend.length) alertas.push({ nivel: "media", texto: `Pagos de nómina pendientes: ${nominaPend.map((x) => `${x.vehiculo} ${x.folio.replace("Nómina ", "")} (${pesos(x.falta)})`).join("; ")}.` });
  const sinCosto = ((d.rentabilidad && d.rentabilidad.ventas) || []).filter((v) => v.sinCosto);
  if (sinCosto.length) alertas.push({ nivel: "media", texto: `${n(sinCosto.length, "venta", "ventas")} sin costo registrado: su margen aparece inflado.` });
  const viejos = ((d.rentabilidad && d.rentabilidad.stock) || []).filter((v) => !v.consignado && v.dias > 90);
  if (viejos.length) alertas.push({ nivel: "baja", texto: `${n(viejos.length, "auto propio lleva", "autos propios llevan")} más de 90 días en stock (${pesos(viejos.reduce((s, v) => s + v.invertido, 0))} invertidos).` });
  const orden = { alta: 0, media: 1, baja: 2 };
  alertas.sort((a, b) => orden[a.nivel] - orden[b.nivel]);

  const stock = (d.rentabilidad && d.rentabilidad.stock) || [];
  return {
    titulo: `Informe financiero · ${nombrePeriodo(d.periodo)}`,
    periodo: d.periodo, nombrePeriodo: nombrePeriodo(d.periodo), anterior: d.resumenAnterior ? nombrePeriodo(periodoAnterior(d.periodo)) : null,
    generado: d.hoy, empresa: { ...(d.empresa || {}), rut: d.empresa && d.empresa.rut ? formatearRut(d.empresa.rut) : "" },
    cifras,
    resultados: {
      ...r,
      anterior: ra ? { ingresosVentas: ra.ingresosVentas, costoVentas: ra.costoVentas, margenBruto: ra.margenBruto, totalOtros: ra.totalOtros, totalGastos: ra.totalGastos, resultado: ra.resultado } : null,
      grupos: gastosPorGrupo(r.gastos, ra ? ra.gastos : []),
    },
    ventas: ((d.rentabilidad && d.rentabilidad.ventas) || []).map((v) => ({ folio: v.folio, fecha: v.fecha, vehiculo: v.vehiculo, precio: v.precio, costo: v.costo, margen: v.margen, margenPct: v.margenPct })),
    totalesVentas: d.rentabilidad ? d.rentabilidad.totales : null,
    caja: { ...d.resumen.caja, saldoTotal: d.resumen.saldoTotal, cuentas: (d.resumen.cuentas || []).map((c) => ({ nombre: c.nombre, saldo: c.saldo, tipo: c.tipo, conciliacion: (d.conciliaciones || {})[c.clave] || null })) },
    porCobrar: { total: d.resumen.totalPorCobrar, items: d.resumen.porCobrar },
    porPagar: { total: d.resumen.totalPorPagar, items: d.resumen.porPagar },
    inventario: {
      propios: stock.filter((v) => !v.consignado).length, consignados: stock.filter((v) => v.consignado).length,
      invertido: stock.filter((v) => !v.consignado).reduce((s, v) => s + v.invertido, 0),
      margenEsperado: stock.reduce((s, v) => s + (v.margenEsperado || 0), 0),
      masAntiguos: stock.filter((v) => !v.consignado).sort((a, b) => b.dias - a.dias).slice(0, 5).map((v) => ({ vehiculo: v.vehiculo, dias: v.dias, invertido: v.invertido })),
    },
    alertas,
  };
}
