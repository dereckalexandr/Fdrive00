// De los datos que devuelve el servidor para una patente (API de Boostr) a los campos de los formularios de vehículo.
import { detalleModeloChileautos } from "./compra-calc.js";

const titulo = (s) => String(s || "").trim().toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
// Un modelo con números (RAV4, CX-5, i10) se deja en mayúsculas; el resto, con inicial mayúscula.
const modeloLegible = (s) => String(s || "").trim().split(/\s+/).map((w) => (/\d/.test(w) ? w.toUpperCase() : titulo(w))).join(" ");

/**
 * El proveedor entrega el modelo con la versión pegada ("NEW WRX S AWD CVT 2.0T"). Se separa igual que para buscar en Chileautos:
 * el modelo es el nombre comercial y lo demás pasa a la versión (tal como viene, en mayúsculas: AWD, CVT, 2.0T, GLI…).
 * @returns { marca, modelo, version, anio, color?, transmision?, combustible? }  (solo lo que el proveedor sabe)
 */
export function camposDesdePatente(v) {
  const completo = String(v.modeloCompleto || "").replace(/\s+/g, " ").trim();
  const { busqueda } = detalleModeloChileautos(completo);
  let resto = completo.replace(/^(?:all[\s-]+new|new)\s+/i, "");
  if (busqueda && resto.toLowerCase().startsWith(busqueda.toLowerCase())) resto = resto.slice(busqueda.length).trim();
  else resto = "";
  const out = { marca: v.marca || "", modelo: modeloLegible(busqueda || completo), version: String(v.version || resto).trim(), anio: v.anio ? String(v.anio) : "" };
  if (v.color) out.color = titulo(v.color);
  if (v.transmision) out.transmision = v.transmision;
  if (v.combustible) out.combustible = v.combustible;
  return out;
}

/** Aplica los datos al formulario: con `pisar` reemplaza lo que ya había (la persona pidió buscar); si no, solo completa los campos vacíos. */
export function aplicarCampos(actual, campos, { pisar = false } = {}) {
  const sig = { ...actual };
  const llenados = [];
  for (const [k, val] of Object.entries(campos)) {
    if (!val) continue;
    const vacio = sig[k] === undefined || sig[k] === null || String(sig[k]).trim() === "";
    if (vacio || pisar) { if (String(sig[k] ?? "") !== String(val)) llenados.push(k); sig[k] = val; }
  }
  return { valores: sig, llenados };
}

export const NOMBRE_CAMPO = { marca: "marca", modelo: "modelo", version: "versión", anio: "año", color: "color", transmision: "transmisión", combustible: "combustible" };
