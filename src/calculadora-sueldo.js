/**
 * CALCULADORA DE SUELDO (Chile)
 * ----------------------------------------------------------------
 * Pasa de sueldo base a sueldo líquido, o del líquido que se quiere recibir al sueldo base e imponible que lo produce.
 * Es una simulación: no reemplaza la liquidación que emite el empleador. Funciones puras, sin red ni pantalla.
 * Los valores legales (UF, UTM, sueldo mínimo, topes, comisiones de las AFP, tramos del impuesto) van en PARAMETROS y se pueden
 * cambiar al llamar: la pantalla deja editar UF, UTM y sueldo mínimo, y trae los del día cuando puede.
 * ----------------------------------------------------------------
 */

/** Valores de referencia de noviembre de 2026 (UF del 1.º de noviembre; UTM del mes; topes fijados por la Superintendencia de Pensiones). */
export const PARAMETROS = {
  uf: 41252.94,
  utm: 72440,
  sueldoMinimo: 539000,
  topeAfpUf: 90,
  topeCesantiaUf: 135.2,
  jornadaSemanal: 42,
  cotizacionAfp: 10,
  cotizacionSalud: 7,
  cesantiaTrabajador: 0.6,
};

/** Comisión de cada AFP sobre la renta imponible (%), además del 10% que va a la cuenta de ahorro. */
export const AFPS = [
  { id: "capital", nombre: "Capital", comision: 1.44 },
  { id: "cuprum", nombre: "Cuprum", comision: 1.44 },
  { id: "habitat", nombre: "Habitat", comision: 1.27 },
  { id: "planvital", nombre: "PlanVital", comision: 1.16 },
  { id: "provida", nombre: "Provida", comision: 1.45 },
  { id: "modelo", nombre: "Modelo", comision: 0.58 },
  { id: "uno", nombre: "Uno", comision: 0.46 },
  { id: "ninguna", nombre: "No cotiza", comision: null },
];

/** Impuesto único de segunda categoría: [hasta (UTM), factor, cantidad a rebajar (UTM)]. Tabla mensual del SII. */
export const TRAMOS_IMPUESTO = [
  [13.5, 0, 0],
  [30, 0.04, 0.54],
  [50, 0.08, 1.74],
  [70, 0.135, 4.49],
  [90, 0.23, 11.14],
  [120, 0.304, 17.8],
  [310, 0.35, 23.32],
  [Infinity, 0.4, 38.82],
];

export const ENTRADA_VACIA = {
  sueldoBase: 0, contrato: "indefinido", gratificacion: false, horasExtra: 0, comisiones: 0, semanaCorrida: 0, bonos: 0,
  colacion: 0, movilizacion: 0, asignacionFamiliar: 0, diasLaborales: 30, diasAusente: 0,
  afp: "habitat", salud: "fonasa", planSaludUf: 0, otrosDescuentos: 0,
};

const num = (v, max = 1e12) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
const peso = (n) => Math.round(n);

/** Impuesto único del mes sobre la base tributable (en pesos), con la UTM del mes. */
export function impuestoUnico(baseTributable, utm) {
  const base = num(baseTributable);
  const u = num(utm);
  if (!base || !u) return 0;
  const enUtm = base / u;
  for (const [hasta, factor, rebaja] of TRAMOS_IMPUESTO) {
    if (enUtm <= hasta) return Math.max(0, peso(base * factor - rebaja * u));
  }
  return 0;
}

/**
 * Calcula la liquidación a partir del sueldo base.
 * @param {object} entrada  ver ENTRADA_VACIA
 * @param {object} [parametros]  ver PARAMETROS
 */
export function calcularLiquido(entrada, parametros = PARAMETROS) {
  const e = { ...ENTRADA_VACIA, ...(entrada || {}) };
  const p = { ...PARAMETROS, ...(parametros || {}) };
  const uf = num(p.uf);
  const sueldoBase = num(e.sueldoBase);
  const diasLab = Math.min(31, Math.max(1, Math.round(num(e.diasLaborales) || 30)));
  const ausente = Math.min(diasLab, Math.round(num(e.diasAusente)));
  const base = peso((sueldoBase * (diasLab - ausente)) / diasLab);

  // Hora extra: valor de la hora ordinaria (sueldo × 12 ÷ (52 semanas × horas de la jornada)) con 50% de recargo.
  const jornada = num(p.jornadaSemanal) || 42;
  const valorHoraExtra = peso(((sueldoBase * 12) / (52 * jornada)) * 1.5);
  const horasExtra = peso(valorHoraExtra * num(e.horasExtra, 1000));

  const comisiones = peso(num(e.comisiones));
  const semanaCorrida = peso(num(e.semanaCorrida));
  const bonos = peso(num(e.bonos));
  // Gratificación legal mensual (art. 50): 25% de lo devengado, con tope de 4,75 sueldos mínimos al año repartidos en 12 meses.
  const topeGratificacion = peso((4.75 * num(p.sueldoMinimo)) / 12);
  const gratificacion = e.gratificacion ? Math.min(peso(0.25 * (base + horasExtra + comisiones + semanaCorrida + bonos)), topeGratificacion) : 0;

  const imponible = base + horasExtra + comisiones + semanaCorrida + bonos + gratificacion;
  const baseAfpSalud = Math.min(imponible, num(p.topeAfpUf) * uf);
  const baseCesantia = Math.min(imponible, num(p.topeCesantiaUf) * uf);

  const afp = AFPS.find((a) => a.id === e.afp);
  const afpMonto = afp && afp.comision !== null ? peso(baseAfpSalud * ((num(p.cotizacionAfp) + afp.comision) / 100)) : 0;
  const saludLegal = peso(baseAfpSalud * (num(p.cotizacionSalud) / 100));
  // Isapre: se descuenta el plan pactado en UF, y nunca menos del 7% legal.
  const saludMonto = e.salud === "isapre" ? Math.max(saludLegal, peso(num(e.planSaludUf, 1000) * uf)) : saludLegal;
  // Seguro de cesantía: lo paga el trabajador solo con contrato indefinido.
  const cesantia = e.contrato === "indefinido" ? peso(baseCesantia * (num(p.cesantiaTrabajador) / 100)) : 0;

  // Base del impuesto: lo imponible menos las cotizaciones previsionales (de salud, solo hasta el 7% legal).
  const baseTributable = Math.max(0, imponible - afpMonto - saludLegal - cesantia);
  const impuesto = impuestoUnico(baseTributable, p.utm);

  const colacion = peso(num(e.colacion));
  const movilizacion = peso(num(e.movilizacion));
  const asignacionFamiliar = peso(num(e.asignacionFamiliar));
  const noImponibles = colacion + movilizacion + asignacionFamiliar;
  const otros = peso(num(e.otrosDescuentos));

  const totalHaberes = imponible + noImponibles;
  const totalDescuentos = afpMonto + saludMonto + cesantia + impuesto + otros;
  return {
    haberes: { sueldoBase: base, horasExtra, comisiones, semanaCorrida, bonos, gratificacion, colacion, movilizacion, asignacionFamiliar },
    imponible, noImponibles, totalHaberes,
    descuentos: { afp: afpMonto, salud: saludMonto, cesantia, impuesto, otros },
    totalDescuentos, baseTributable,
    topeAfpSalud: peso(num(p.topeAfpUf) * uf),
    superaTope: imponible > num(p.topeAfpUf) * uf,
    liquido: totalHaberes - totalDescuentos,
  };
}

/**
 * Al revés: el sueldo base más bajo con el que el líquido llega al que se quiere recibir (los demás datos quedan como están).
 * @returns {{ ok: true, sueldoBase: number, resultado: object } | { ok: false, error: "liquido_invalido" | "fuera_de_rango" }}
 */
export function calcularDesdeLiquido(liquidoDeseado, entrada, parametros = PARAMETROS) {
  const objetivo = Math.round(Number(liquidoDeseado));
  if (!Number.isFinite(objetivo) || objetivo <= 0) return { ok: false, error: "liquido_invalido" };
  const con = (b) => calcularLiquido({ ...entrada, sueldoBase: b }, parametros);
  let bajo = 0;
  let alto = 500_000_000;
  if (con(alto).liquido < objetivo) return { ok: false, error: "fuera_de_rango" };
  if (con(bajo).liquido >= objetivo) return { ok: true, sueldoBase: 0, resultado: con(0) };
  while (alto - bajo > 1) {
    const medio = Math.floor((bajo + alto) / 2);
    if (con(medio).liquido >= objetivo) alto = medio; else bajo = medio;
  }
  return { ok: true, sueldoBase: alto, resultado: con(alto) };
}
