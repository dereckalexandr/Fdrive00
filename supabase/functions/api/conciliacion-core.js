// Conciliación bancaria de Finanzas: reglas puras (sin base ni red), compartidas por el servidor, la pantalla y las pruebas.
// 1) leerCartola: de la tabla de la cartola (filas de celdas, como venga del banco) a líneas { fecha, descripcion, documento, monto, saldo }.
//    Reconoce las columnas por su encabezado (Fecha, Descripción/Glosa, Cargo/Abono o Monto, Saldo…), así sirve para cualquier banco.
// 2) conciliar: empareja cada línea con un movimiento registrado en la misma cuenta (mismo monto y signo, fecha cercana).

const sinTildes = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Monto en formato chileno o de planilla: "1.234.567", "$ -1.234", "(1.234)", "1234567,00", 1234567. null si no es un monto. */
export function leerMonto(x) {
  if (typeof x === "number") return Number.isFinite(x) ? Math.round(x) : null;
  let s = String(x ?? "").trim();
  if (!s) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  s = s.replace(/\$|clp|\s/gi, "");
  if (s.endsWith("-")) { negativo = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { negativo = !negativo; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  // Decimales: coma final con 1-2 dígitos ("1.234,56") o punto final con 1-2 dígitos sin otras comas ("1234.56").
  let n;
  if (/,\d{1,2}$/.test(s)) n = Number(s.replace(/\./g, "").replace(",", "."));
  else if (/^\d+\.\d{1,2}$/.test(s)) n = Number(s);
  else n = Number(s.replace(/[.,]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(negativo ? -n : n);
}

/** Fecha de la cartola a AAAA-MM-DD: "05/11/2026", "5-11-26", "2026-11-05", "05/11" (con el año de referencia), número de serie de Excel. */
export function leerFecha(x, anioRef) {
  if (typeof x === "number" && x > 20000 && x < 80000) {
    const d = new Date(Math.round((x - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(x ?? "").trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return armar(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?(?:\s|$)/.exec(s);
  if (m) {
    let a = m[3] ? +m[3] : Number(anioRef) || new Date().getFullYear();
    if (a < 100) a += 2000;
    return armar(a, +m[2], +m[1]);
  }
  return null;
}
function armar(a, mes, d) {
  if (mes < 1 || mes > 12 || d < 1 || d > 31 || a < 2000 || a > 2100) return null;
  const f = `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return new Date(`${f}T12:00:00Z`).getUTCDate() === d ? f : null;
}

const COLUMNAS = {
  fecha: ["fecha", "fecha operacion", "fecha mov", "fecha movimiento", "fecha contable"],
  descripcion: ["descripcion", "glosa", "detalle", "concepto", "descripcion movimiento", "movimiento", "transaccion"],
  documento: ["n documento", "documento", "nro documento", "n doc", "numero documento", "n operacion", "operacion", "serial", "n de documento", "nro. documento", "doc"],
  cargo: ["cargo", "cargos", "debito", "debitos", "giro", "giros", "cheques y otros cargos", "egreso", "egresos", "monto cargo", "cargos ($)"],
  abono: ["abono", "abonos", "credito", "creditos", "deposito", "depositos", "depositos y otros abonos", "ingreso", "ingresos", "monto abono", "abonos ($)"],
  monto: ["monto", "importe", "monto ($)", "valor"],
  saldo: ["saldo", "saldo diario", "saldo contable", "saldo disponible", "saldo ($)"],
};
const limpiarEncabezado = (s) => sinTildes(s).replace(/[°º#:]/g, "").replace(/\s+/g, " ").trim();
function columnaDe(texto) {
  const t = limpiarEncabezado(texto);
  if (!t) return null;
  for (const [k, nombres] of Object.entries(COLUMNAS)) if (nombres.includes(t)) return k;
  // Coincidencias parciales («Fecha Contable», «Cargos (CLP)»…).
  if (/^fecha/.test(t)) return "fecha";
  if (/saldo/.test(t)) return "saldo";
  if (/cargo|debito|giro/.test(t)) return "cargo";
  if (/abono|credito|deposito/.test(t)) return "abono";
  if (/descrip|glosa|detalle|concepto/.test(t)) return "descripcion";
  if (/document|operacion|n doc/.test(t)) return "documento";
  if (/^monto|importe/.test(t)) return "monto";
  return null;
}

/**
 * De las filas de la cartola a líneas. matriz: array de filas (array de celdas). Busca la fila de encabezados en las primeras 40.
 * @returns {{ ok: true, lineas, columnas } | { ok: false, error: "cartola_sin_columnas" | "cartola_vacia" }}
 */
export function leerCartola(matriz, { anioRef } = {}) {
  const filas = (matriz || []).filter((f) => Array.isArray(f));
  let cab = -1; let mapa = null;
  for (let i = 0; i < Math.min(filas.length, 40); i++) {
    const m = {};
    filas[i].forEach((c, j) => { const k = columnaDe(c); if (k && m[k] === undefined) m[k] = j; });
    if (m.fecha !== undefined && (m.monto !== undefined || m.cargo !== undefined || m.abono !== undefined)) { cab = i; mapa = m; break; }
  }
  if (!mapa) return { ok: false, error: "cartola_sin_columnas" };
  const lineas = [];
  for (const f of filas.slice(cab + 1)) {
    const fecha = leerFecha(f[mapa.fecha], anioRef);
    if (!fecha) continue; // totales, saldos iniciales, filas en blanco
    let monto = null;
    if (mapa.cargo !== undefined || mapa.abono !== undefined) {
      const cargo = mapa.cargo !== undefined ? leerMonto(f[mapa.cargo]) : null;
      const abono = mapa.abono !== undefined ? leerMonto(f[mapa.abono]) : null;
      if (abono) monto = Math.abs(abono);
      else if (cargo) monto = -Math.abs(cargo);
    } else monto = leerMonto(f[mapa.monto]);
    if (!monto) continue;
    const descripcion = mapa.descripcion !== undefined ? String(f[mapa.descripcion] ?? "").replace(/\s+/g, " ").trim().slice(0, 200) : "";
    const documento = mapa.documento !== undefined ? String(f[mapa.documento] ?? "").trim().slice(0, 40) : "";
    const saldo = mapa.saldo !== undefined ? leerMonto(f[mapa.saldo]) : null;
    lineas.push({ n: lineas.length + 1, fecha, descripcion, documento, monto, saldo });
  }
  if (lineas.length === 0) return { ok: false, error: "cartola_vacia" };
  return { ok: true, lineas, columnas: Object.keys(mapa) };
}

/** Monto con signo de un movimiento visto desde una cuenta: entra (+) o sale (−). 0 si no la toca. */
export function montoEnCuenta(m, cuenta) {
  const n = Number(m.monto) || 0;
  if (m.tipo === "traspaso") return m.cuenta_destino_id === cuenta ? n : m.cuenta_id === cuenta ? -n : 0;
  if (m.cuenta_id !== cuenta) return 0;
  return m.tipo === "ingreso" ? n : m.tipo === "egreso" ? -n : 0;
}

const dias = (a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000;
export const TOLERANCIA_DIAS = 4;

/**
 * Empareja líneas de la cartola con movimientos de la cuenta: mismo monto con signo y fecha a ±TOLERANCIA_DIAS días.
 * Si hay varios candidatos, gana el de igual N° de documento y luego el de fecha más cercana. Cada movimiento se usa una vez.
 * @returns {{ lineas: [{...linea, movimientoId, estado: "cuadra"|"falta"}], sinCartola: movimientos de la cuenta en el período sin línea }}
 */
export function conciliar(lineas, movs, cuenta, { desde, hasta } = {}) {
  const cands = (movs || []).filter((m) => m.estado !== "anulado").map((m) => ({ m, monto: montoEnCuenta(m, cuenta) })).filter((x) => x.monto !== 0);
  const usados = new Set();
  // Primero las coincidencias más seguras (mismo documento, misma fecha), para que no se las lleve otra línea.
  const pares = [];
  for (const l of lineas) {
    for (const c of cands) {
      if (c.monto !== l.monto) continue;
      const d = dias(l.fecha, c.m.fecha);
      if (d > TOLERANCIA_DIAS) continue;
      const doc = l.documento && c.m.documento_numero && String(c.m.documento_numero).replace(/\D/g, "") === String(l.documento).replace(/\D/g, "") && /\d/.test(l.documento);
      pares.push({ l, c, puntaje: (doc ? 0 : 100) + d });
    }
  }
  pares.sort((a, b) => a.puntaje - b.puntaje);
  const deLinea = new Map();
  for (const p of pares) {
    if (deLinea.has(p.l.n) || usados.has(p.c.m.id)) continue;
    deLinea.set(p.l.n, p.c.m);
    usados.add(p.c.m.id);
  }
  const out = lineas.map((l) => {
    const m = deLinea.get(l.n);
    return { ...l, movimientoId: m ? m.id : null, movimiento: m ? { id: m.id, fecha: m.fecha, descripcion: m.descripcion, folio: m.folio, origen: m.origen } : null, estado: m ? "cuadra" : "falta" };
  });
  const sinCartola = cands.filter((c) => !usados.has(c.m.id) && (!desde || c.m.fecha >= desde) && (!hasta || c.m.fecha <= hasta))
    .map((c) => ({ id: c.m.id, fecha: c.m.fecha, descripcion: c.m.descripcion, folio: c.m.folio, origen: c.m.origen, monto: c.monto }));
  return { lineas: out, sinCartola };
}

/** Categoría sugerida para registrar una línea de la cartola que no está en el CRM (por palabras de la glosa). */
export function categoriaSugerida(linea) {
  const g = sinTildes(linea.descripcion);
  if (linea.monto > 0) {
    if (/aporte|capital/.test(g)) return "aporte_capital";
    if (/prestamo|credito comercial/.test(g)) return "prestamo";
    if (/forum|santander consumer|tanner|autofin|amicar|financier|global/.test(g)) return "comision_financiera";
    return "otros_ingresos";
  }
  if (/comision|mantencion|cargo por|impuesto timbre|itf|seguro desgravamen|interes|linea de credito/.test(g)) return /interes|linea de credito/.test(g) ? "intereses" : "bancos";
  if (/previred|afp|isapre|fonasa|remuneracion|sueldo|liquidacion/.test(g)) return "sueldos";
  if (/tesoreria|sii|f29|iva|impuesto/.test(g)) return "impuestos";
  if (/municipal|patente|contribuc/.test(g)) return "patentes";
  if (/arriendo/.test(g)) return "arriendo";
  if (/enel|aguas|metrogas|movistar|entel|claro|vtr|wom|gtd|internet/.test(g)) return "servicios";
  if (/facebook|meta|google|instagram|tiktok/.test(g)) return "publicidad";
  if (/chileautos|yapo|mercadolibre|mercado libre/.test(g)) return "portales";
  if (/copec|shell|petrobras|aramco|autopista|peaje|tag|uber|cabify/.test(g)) return "combustible";
  if (/seguro/.test(g)) return "seguros";
  if (/registro civil|notaria|notario|srcei/.test(g)) return "tramites";
  return "otros_gastos";
}
