// Nómina de Finanzas: reglas puras (sin base ni red), compartidas por el servidor, la pantalla y las pruebas.
// El CRM propone la liquidación de cada trabajador con la calculadora de sueldo (AFP, salud, cesantía, impuesto único) y suma
// lo que paga el empleador. Es una propuesta: el Administrador la ajusta a lo que indique el contador. Al registrar los pagos
// (sueldos líquidos, Previred e impuesto único) se crean los egresos en Finanzas.
import { PARAMETROS, AFPS, ENTRADA_VACIA, calcularLiquido } from "./calculadora-sueldo-core.js";
import { validarRut, normalizarRut } from "./crm-core.js";

/**
 * Cotizaciones de cargo del empleador (% de la renta imponible). Valores desde agosto de 2026:
 * - aporteEmpleador: cotización de la reforma de pensiones (Ley 21.735), 3,5% de ago-2026 a jul-2027; incluye el SIS.
 * - cesantía: 2,4% con contrato indefinido; 3% a plazo fijo u obra.
 * - mutual: seguro de accidentes del trabajo (Ley 16.744), tasa básica 0,90% + adicional según la actividad (aquí 0,03%).
 * Se pueden cambiar en cada nómina. Revisar con el contador cuando cambien (la reforma sube el aporte cada agosto).
 */
export const TASAS_EMPLEADOR = { aporteEmpleador: 3.5, cesantiaIndefinido: 2.4, cesantiaPlazoFijo: 3, mutual: 0.93 };

/** Parámetros de una nómina: los de la calculadora (UF, UTM, sueldo mínimo, topes) y las tasas del empleador. */
export const parametrosNomina = (p) => ({ ...PARAMETROS, ...TASAS_EMPLEADOR, ...(p || {}) });

/** Datos fijos del trabajador (se usan cada mes). */
export const FICHA_VACIA = {
  sueldoBase: 0, contrato: "indefinido", gratificacion: true, colacion: 0, movilizacion: 0, asignacionFamiliar: 0,
  afp: "habitat", salud: "fonasa", planSaludUf: 0,
};
/** Lo que cambia cada mes. */
export const VARIABLES_VACIAS = { comisiones: 0, semanaCorrida: 0, bonos: 0, horasExtra: 0, diasAusente: 0, otrosDescuentos: 0 };

const texto = (x, max) => String(x === null || x === undefined ? "" : x).replace(/\s+/g, " ").trim().slice(0, max);
const monto = (x, max = 1e10) => { const n = Math.round(Number(x)); return Number.isFinite(n) && n >= 0 && n <= max ? n : NaN; };
const pct = (x) => { const n = Number(x); return Number.isFinite(n) && n >= 0 && n <= 30 ? n : NaN; };

/** Ficha de un trabajador. input: { nombre, rut, cargo, usuarioId, activo, ficha: {...} } */
export function validarTrabajador(input) {
  const i = input || {};
  const nombre = texto(i.nombre, 120);
  if (nombre.length < 3) return { ok: false, error: "nombre_invalido" };
  const rut = texto(i.rut, 20);
  if (rut && !validarRut(rut)) return { ok: false, error: "rut_invalido" };
  const f = { ...FICHA_VACIA, ...(i.ficha || {}) };
  const ficha = {
    sueldoBase: monto(f.sueldoBase), contrato: f.contrato === "plazo_fijo" ? "plazo_fijo" : "indefinido", gratificacion: f.gratificacion !== false,
    colacion: monto(f.colacion), movilizacion: monto(f.movilizacion), asignacionFamiliar: monto(f.asignacionFamiliar),
    afp: AFPS.some((a) => a.id === f.afp) ? f.afp : "habitat", salud: f.salud === "isapre" ? "isapre" : "fonasa",
    planSaludUf: f.salud === "isapre" ? Number(f.planSaludUf) || 0 : 0,
  };
  if (!(ficha.sueldoBase > 0)) return { ok: false, error: "nomina_sueldo" };
  for (const k of ["colacion", "movilizacion", "asignacionFamiliar"]) if (Number.isNaN(ficha[k])) return { ok: false, error: "nomina_monto" };
  if (!(ficha.planSaludUf >= 0 && ficha.planSaludUf <= 100)) return { ok: false, error: "nomina_monto" };
  return {
    ok: true,
    value: { nombre, rut: rut ? normalizarRut(rut) : null, cargo: texto(i.cargo, 80) || null, usuario_id: texto(i.usuarioId, 40) || null, activo: i.activo !== false, ficha },
  };
}

export function validarParametros(p) {
  const x = parametrosNomina(p);
  for (const k of ["uf", "utm", "sueldoMinimo"]) if (!(Number(x[k]) > 0)) return { ok: false, error: "nomina_parametros" };
  for (const k of ["aporteEmpleador", "cesantiaIndefinido", "cesantiaPlazoFijo", "mutual"]) if (Number.isNaN(pct(x[k]))) return { ok: false, error: "nomina_parametros" };
  return {
    ok: true,
    value: {
      uf: Number(x.uf), utm: Number(x.utm), sueldoMinimo: Number(x.sueldoMinimo), topeAfpUf: Number(x.topeAfpUf), topeCesantiaUf: Number(x.topeCesantiaUf),
      aporteEmpleador: Number(x.aporteEmpleador), cesantiaIndefinido: Number(x.cesantiaIndefinido), cesantiaPlazoFijo: Number(x.cesantiaPlazoFijo), mutual: Number(x.mutual),
    },
  };
}

/** Liquidación de un trabajador en un mes, más lo que paga el empleador encima. */
export function calcularFila(ficha, variables, parametros) {
  const p = parametrosNomina(parametros);
  const v = { ...VARIABLES_VACIAS, ...(variables || {}) };
  const f = { ...FICHA_VACIA, ...(ficha || {}) };
  const entrada = {
    ...ENTRADA_VACIA, sueldoBase: f.sueldoBase, contrato: f.contrato, gratificacion: !!f.gratificacion, colacion: f.colacion, movilizacion: f.movilizacion,
    asignacionFamiliar: f.asignacionFamiliar, afp: f.afp, salud: f.salud, planSaludUf: f.planSaludUf,
    comisiones: v.comisiones, semanaCorrida: v.semanaCorrida, bonos: v.bonos, horasExtra: v.horasExtra, diasAusente: v.diasAusente, otrosDescuentos: v.otrosDescuentos,
  };
  const r = calcularLiquido(entrada, p);
  const baseAfp = Math.min(r.imponible, Number(p.topeAfpUf) * Number(p.uf));
  const baseCes = Math.min(r.imponible, Number(p.topeCesantiaUf) * Number(p.uf));
  const aporte = Math.round(baseAfp * (Number(p.aporteEmpleador) / 100));
  const cesantia = Math.round(baseCes * (Number(f.contrato === "plazo_fijo" ? p.cesantiaPlazoFijo : p.cesantiaIndefinido) / 100));
  const mutual = Math.round(r.imponible * (Number(p.mutual) / 100));
  const empleador = { aporte, cesantia, mutual, total: aporte + cesantia + mutual };
  return { resultado: r, empleador, costoEmpresa: r.totalHaberes + empleador.total };
}

/** Totales de la nómina y lo que hay que pagar: sueldos líquidos, Previred (trabajador + empleador) e impuesto único (F29). */
export function totalesNomina(filas) {
  const t = { trabajadores: 0, haberes: 0, imponible: 0, liquido: 0, afp: 0, salud: 0, cesantia: 0, impuesto: 0, otros: 0, empleador: 0, costoEmpresa: 0 };
  for (const f of filas || []) {
    const r = f.resultado;
    t.trabajadores++;
    t.haberes += r.totalHaberes; t.imponible += r.imponible; t.liquido += r.liquido;
    t.afp += r.descuentos.afp; t.salud += r.descuentos.salud; t.cesantia += r.descuentos.cesantia; t.impuesto += r.descuentos.impuesto; t.otros += r.descuentos.otros;
    t.empleador += f.empleador.total; t.costoEmpresa += f.costoEmpresa;
  }
  return { ...t, previred: t.afp + t.salud + t.cesantia + t.empleador };
}

/**
 * Nómina del mes. input: { filas: [{ trabajadorId, nombre, rut, ficha, variables }], parametros }.
 * Recalcula todo (no confía en montos enviados) y devuelve filas con su liquidación y los totales.
 */
export function armarNomina(input) {
  const pv = validarParametros(input && input.parametros);
  if (!pv.ok) return pv;
  const filas = [];
  const vistos = new Set();
  for (const x of (input && input.filas) || []) {
    const id = texto(x.trabajadorId, 40);
    if (!id || vistos.has(id)) return { ok: false, error: "nomina_filas" };
    vistos.add(id);
    const vars = {};
    for (const k of Object.keys(VARIABLES_VACIAS)) {
      const n = k === "horasExtra" || k === "diasAusente" ? Number(x.variables && x.variables[k]) || 0 : monto((x.variables && x.variables[k]) || 0);
      if (Number.isNaN(n) || n < 0 || (k === "diasAusente" && n > 31) || (k === "horasExtra" && n > 200)) return { ok: false, error: "nomina_monto" };
      vars[k] = n;
    }
    const ficha = { ...FICHA_VACIA, ...(x.ficha || {}) };
    const c = calcularFila(ficha, vars, pv.value);
    filas.push({ trabajadorId: id, nombre: texto(x.nombre, 120), rut: x.rut || null, ficha, variables: vars, ...c });
  }
  if (filas.length === 0) return { ok: false, error: "nomina_vacia" };
  return { ok: true, value: { filas, parametros: pv.value, totales: totalesNomina(filas) } };
}

/** Conceptos de pago de una nómina y su monto. */
export const CONCEPTOS_NOMINA = [
  { id: "sueldos", nombre: "Sueldos líquidos" },
  { id: "previred", nombre: "Cotizaciones previsionales (Previred)" },
  { id: "impuesto", nombre: "Impuesto único de los trabajadores (F29)" },
];
export const montoConcepto = (totales, concepto) => (concepto === "sueldos" ? totales.liquido : concepto === "previred" ? totales.previred : concepto === "impuesto" ? totales.impuesto : 0);
