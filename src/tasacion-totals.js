/**
 * SUBTOTALES Y TOTAL DE LA TASACIÓN
 * ----------------------------------------------------------------
 * Suma las valorizaciones (`valor`) de cada módulo del checklist y el total
 * general. La usan tanto la pantalla como el PDF, para que muestren siempre
 * las mismas cifras. Solo cuentan los ítems que existen en el checklist
 * actual; un valor no numérico o vacío cuenta como 0.
 * ----------------------------------------------------------------
 */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * @param checklist  record.checklist
 * @param sections   TASACION_SECTIONS
 * @param getItems   (section) => items
 * @returns { bySection: { [sectionId]: number }, total: number }
 */
export function computeTasacionTotals(checklist, sections, getItems) {
  const cl = checklist || {};
  const bySection = {};
  let total = 0;
  for (const section of sections) {
    let sub = 0;
    for (const item of getItems(section)) sub += num(cl[item.id] && cl[item.id].valor);
    bySection[section.id] = sub;
    total += sub;
  }
  return { bySection, total };
}

/**
 * Valor final de la tasación = valor comercial estimado − total de valorizaciones.
 * Puede ser negativo si las valorizaciones superan al valor comercial.
 */
export function computeValorFinal(valorComercial, totalValorizaciones) {
  const vc = num(valorComercial);
  const total = num(totalValorizaciones);
  return { valorComercial: vc, total, final: vc - total };
}
