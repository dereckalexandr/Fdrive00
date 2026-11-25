// Dirección de búsqueda en Chileautos para la prospección, armada con los filtros de la pantalla.
// Usa solo los criterios que el estimador ya verificó contra chileautos.cl (marca, modelo, año, kilometraje, transmisión y combustible) y la
// misma forma de escribirlos. El precio y el tipo de vendedor (particular o automotora) no están verificados en la dirección: se filtran
// después, en la lista del CRM, con los avisos copiados.
import { marcaParaChileautos, modeloParaChileautos, TRANSMISIONES, COMBUSTIBLES } from "./compra-calc.js";

const entero = (v) => { const n = Number(String(v ?? "").replace(/[^\d]/g, "")); return Number.isInteger(n) && n > 0 ? n : null; };
const enc = (s) => encodeURIComponent(s).replace(/\./g, "%2E");

/**
 * filtros: { marca, modelo, anioDesde, anioHasta, kmMax, transmision, combustible }. Todos opcionales.
 * Devuelve { url, resumen } o null si no se pidió nada que acote la búsqueda.
 */
export function urlBusquedaProspeccion(filtros) {
  const f = filtros || {};
  const ma = f.marca ? marcaParaChileautos(f.marca) : "";
  const mo = ma && f.modelo ? modeloParaChileautos(f.modelo) : "";
  const desde = entero(f.anioDesde);
  const hasta = entero(f.anioHasta);
  const km = entero(f.kmMax);
  const tr = TRANSMISIONES.find((t) => t.value === f.transmision);
  const co = COMBUSTIBLES.find((c) => c.value === f.combustible);
  if (!ma && !desde && !hasta && !km && !tr && !co) return null;

  const claveT = enc("Transmisión");
  const grupoMarca = ma ? `(C.Marca.${enc(ma)}${mo ? `._.Modelo.${enc(mo)}` : ""}.)_.` : "";
  // La transmisión automática figura como «Automática» y, en pocos avisos, «Automático»: se piden ambas.
  const grupoTrans = tr && tr.variantes.length > 1 ? `(Or.${tr.variantes.map((v) => `${claveT}.${enc(v)}`).join("._.")}.)_.` : "";
  // El rango de años va siempre (por defecto, todos): es la estructura que el estimador verificó, también cuando solo se pide marca.
  const anios = `Ano.range(${desde || 1990}..${hasta || new Date().getFullYear() + 1})`;
  const kms = km ? `Kilometraje.range(0..${km})` : "";
  let extras = "";
  if (tr && tr.variantes.length === 1) extras += `${claveT}.${enc(tr.variantes[0])}`;
  if (co) extras += `${extras ? "._." : ""}Combustible.${enc(co.chileautos)}`;
  const criterios = [anios, kms, extras].filter(Boolean).join("._.");
  const cuerpo = `${grupoMarca}${grupoTrans}${criterios}`;
  const resumen = [ma && (mo ? `${ma} ${mo}` : ma), desde || hasta ? `año ${desde || "…"}–${hasta || "…"}` : "", km ? `hasta ${km.toLocaleString("es-CL")} km` : "", tr && tr.label, co && co.label].filter(Boolean).join(" · ");
  return { url: `https://www.chileautos.cl/vehiculos/?q=(And.${cuerpo}.)&sort=~Price`, resumen };
}
