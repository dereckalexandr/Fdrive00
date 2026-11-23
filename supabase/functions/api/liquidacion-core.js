// Liquidación de sueldo: arma el contenido del documento a partir de una fila de la nómina guardada (pura, sin base ni red).
// La pantalla la convierte en PDF (pdf-report.js) para imprimirla y que el trabajador la firme.
import { AFPS } from "./calculadora-sueldo-core.js";
import { formatearRut } from "./crm-core.js";

const UNIDADES = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince",
  "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiún", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis",
  "veintisiete", "veintiocho", "veintinueve"];
const DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

/** 0..999 en palabras («un» apocopado: se usa antes de «mil», «millones» y «pesos»). */
function hastaMil(n) {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const c = Math.floor(n / 100); const r = n % 100;
  const partes = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) {
    if (r < 30) partes.push(UNIDADES[r]);
    else { const d = Math.floor(r / 10); const u = r % 10; partes.push(u ? `${DECENAS[d]} y ${UNIDADES[u]}` : DECENAS[d]); }
  }
  return partes.join(" ");
}

/** Monto entero en palabras, como en los documentos: 1.234.567 → «un millón doscientos treinta y cuatro mil quinientos sesenta y siete pesos». */
export function montoEnPalabras(monto) {
  let n = Math.round(Math.abs(Number(monto) || 0));
  if (n === 0) return "cero pesos";
  if (n === 1) return "un peso";
  const millones = Math.floor(n / 1e6); n %= 1e6;
  const miles = Math.floor(n / 1000); const resto = n % 1000;
  const partes = [];
  if (millones) partes.push(millones === 1 ? "un millón" : `${montoSinPesos(millones)} millones`);
  if (miles) partes.push(miles === 1 ? "mil" : `${hastaMil(miles)} mil`);
  if (resto) partes.push(hastaMil(resto));
  const texto = partes.join(" ");
  // «un millón de pesos», «dos millones de pesos» (cuando termina justo en millones).
  return `${texto}${!miles && !resto ? " de" : ""} pesos`;
}
function montoSinPesos(n) {
  const miles = Math.floor(n / 1000); const resto = n % 1000;
  return [miles ? (miles === 1 ? "mil" : `${hastaMil(miles)} mil`) : "", hastaMil(resto)].filter(Boolean).join(" ");
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const nombreMesLargo = (mes) => { const [a, m] = String(mes).split("-"); return `${MESES[Number(m) - 1]} de ${a}`; };
const pct = (x) => `${String(Math.round(Number(x) * 100) / 100).replace(".", ",")}%`;

/**
 * Contenido de la liquidación. fila: una fila de fin_nominas.filas ({ nombre, rut, ficha, variables, resultado, empleador, costoEmpresa }).
 * empresa: datos de la empresa (razon_social, rut, domicilio, comuna). trabajador: ficha guardada (cargo, fecha de ingreso).
 */
export function armarLiquidacion({ mes, fila, empresa = {}, trabajador = {}, parametros = {} }) {
  const r = fila.resultado; const f = fila.ficha || {}; const v = fila.variables || {};
  const afp = AFPS.find((a) => a.id === f.afp);
  const diasTrab = Math.max(0, 30 - Math.round(Number(v.diasAusente) || 0));
  const linea = (concepto, monto, detalle = "") => ({ concepto, detalle, monto: Math.round(monto) });
  const imponibles = [
    linea("Sueldo base", r.haberes.sueldoBase, diasTrab < 30 ? `${diasTrab} días trabajados` : ""),
    linea("Horas extra", r.haberes.horasExtra, v.horasExtra ? `${v.horasExtra} h` : ""),
    linea("Comisiones", r.haberes.comisiones),
    linea("Semana corrida", r.haberes.semanaCorrida),
    linea("Bonos", r.haberes.bonos),
    linea("Gratificación legal", r.haberes.gratificacion, "art. 50"),
  ].filter((x) => x.monto > 0);
  const noImponibles = [
    linea("Colación", r.haberes.colacion), linea("Movilización", r.haberes.movilizacion), linea("Asignación familiar", r.haberes.asignacionFamiliar),
  ].filter((x) => x.monto > 0);
  const descuentos = [
    linea(`AFP ${afp ? afp.nombre : ""}`.trim(), r.descuentos.afp, afp && afp.comision !== null ? pct(10 + afp.comision) : ""),
    linea(f.salud === "isapre" ? "Isapre" : "Fonasa", r.descuentos.salud, f.salud === "isapre" ? `plan ${String(f.planSaludUf).replace(".", ",")} UF` : "7%"),
    linea("Seguro de cesantía", r.descuentos.cesantia, r.descuentos.cesantia ? "0,6%" : ""),
    linea("Impuesto único", r.descuentos.impuesto),
    linea("Anticipos y otros descuentos", r.descuentos.otros),
  ].filter((x) => x.monto > 0);
  const empleador = [
    linea("Aporte reforma de pensiones (incluye SIS)", fila.empleador.aporte, parametros.aporteEmpleador != null ? pct(parametros.aporteEmpleador) : ""),
    linea("Seguro de cesantía del empleador", fila.empleador.cesantia),
    linea("Mutual de seguridad (accidentes)", fila.empleador.mutual, parametros.mutual != null ? pct(parametros.mutual) : ""),
  ].filter((x) => x.monto > 0);
  return {
    titulo: "Liquidación de sueldo",
    periodo: nombreMesLargo(mes),
    empresa: { razonSocial: empresa.razon_social || "", rut: empresa.rut ? formatearRut(empresa.rut) : "", domicilio: [empresa.domicilio, empresa.comuna].filter(Boolean).join(", ") },
    trabajador: {
      nombre: fila.nombre, rut: fila.rut ? formatearRut(fila.rut) : "", cargo: trabajador.cargo || "", fechaIngreso: (trabajador.ficha && trabajador.ficha.fechaIngreso) || "",
      contrato: f.contrato === "plazo_fijo" ? "Plazo fijo" : "Indefinido", afp: afp ? afp.nombre : "", salud: f.salud === "isapre" ? "Isapre" : "Fonasa", diasTrabajados: diasTrab,
    },
    imponibles, noImponibles, descuentos, empleador,
    totalImponible: r.imponible, totalNoImponible: r.noImponibles, totalHaberes: r.totalHaberes, totalDescuentos: r.totalDescuentos,
    baseTributable: r.baseTributable, liquido: r.liquido, liquidoPalabras: montoEnPalabras(r.liquido), costoEmpresa: fila.costoEmpresa,
    uf: parametros.uf, utm: parametros.utm,
  };
}
