// Consulta pública de inspecciones por patente (sin iniciar sesión): reglas y datos que salen al público.
// Decisión del negocio: se puede consultar cualquier inspección realizada y el informe público lleva los datos del propietario y el CAV.
// Para cerrar esos datos basta poner PUBLICO_CON_PROPIETARIO en false.
import { folioInspeccion } from "./inspecciones-core.js";

export const PUBLICO_CON_PROPIETARIO = true;
/** Búsquedas por patente por IP y hora, y lecturas de informe/fotos por IP y hora (por instancia de la función: es un freno, no una garantía). */
export const LIMITE_BUSQUEDA_IP_HORA = 20;
export const LIMITE_LECTURA_IP_HORA = 400;
/** Cuánto dura el acceso que se entrega al encontrar una inspección (informe y fotos). */
export const VIGENCIA_ACCESO_MS = 30 * 60 * 1000;

/** Lo que ve el visitante al encontrar la inspección: sin ids internos, sin datos de quien la pidió ni del lead. */
export function inspeccionPublica(fila, ficha, inspectorNombre) {
  const v = fila.vehiculo || {};
  return {
    folio: folioInspeccion(fila.numero),
    fecha: fila.completada_en,
    inspector: inspectorNombre || null,
    vehiculo: { patente: fila.patente || v.patente || null, marca: v.marca || null, modelo: v.modelo || null, anio: v.anio ?? null, km: v.km ?? null },
    resultado: fila.resultado || {},
    fotos: (Array.isArray(fila.fotos) ? fila.fotos : []).filter((f) => /^[A-Za-z0-9_-]{1,60}$/.test(String(f))).slice(0, 24),
    tieneCav: PUBLICO_CON_PROPIETARIO && !!(ficha && ficha.cavFileData),
  };
}

/** La ficha completa del Inspector para el informe en PDF. Sin el archivo del CAV (pesado: se pide aparte) y, si así se decide, sin propietario. */
export function fichaParaInforme(ficha) {
  const { cavFileData, cavFileName, fotosEquipo, ...resto } = ficha || {};
  if (PUBLICO_CON_PROPIETARIO) return resto;
  const { propietarioNombre, propietarioRun, ...sinDueno } = resto;
  return sinDueno;
}
