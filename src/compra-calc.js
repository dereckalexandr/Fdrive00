/**
 * TASACIÓN DE COMPRA: lógica pura (se prueba en Node)
 * ----------------------------------------------------------------
 * - Arma la dirección de búsqueda de Chileautos con los filtros del vehículo.
 * - Interpreta los avisos que copia el marcador del navegador.
 * - Estima los precios:
 *     promedio de los 4 primeros avisos (los más baratos, tras la limpieza)
 *     precio sugerido de publicación = promedio de TODOS los avisos válidos de la primera página
 *     precio sugerido de compra     = promedio de los 4 primeros − DESCUENTO_COMPRA
 * ----------------------------------------------------------------
 */
export const DESCUENTO_COMPRA = 2_000_000;
export const MARGEN_KM = 0.2; // ±20 %
export const N_PRIMEROS = 4;

/* ---------- datos del vehículo ---------- */
/** "ttHY.51-1" -> "TTHY51" (la inscripción del CAV trae además un dígito verificador). */
export function normalizePatente(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}
/** Patente chilena: 4 letras + 2 dígitos (actual) o 2 letras + 4 dígitos (antigua). */
export const isPatenteValida = (p) => /^([A-Z]{4}\d{2}|[A-Z]{2}\d{4})$/.test(String(p || ""));

/** El CAV entrega "FORTUNER OTTO 2.7 AUT": el modelo es la primera palabra y el resto la versión. */
export function splitModeloVersion(modeloCav) {
  const parts = String(modeloCav || "").trim().split(/\s+/).filter(Boolean);
  return { modelo: parts[0] || "", version: parts.slice(1).join(" ") };
}

const toPositiveInt = (v) => {
  const n = parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
export const parseKm = toPositiveInt;

/** Rangos de año y kilometraje que se le piden a Chileautos. */
export function calcularFiltros({ anio, km, margenAnio = 1, pctKm = MARGEN_KM }) {
  const a = toPositiveInt(anio);
  const k = toPositiveInt(km);
  return {
    anioMin: a - margenAnio,
    anioMax: a + margenAnio,
    kmMin: Math.max(0, Math.floor((k * (1 - pctKm)) / 1000) * 1000),
    kmMax: Math.ceil((k * (1 + pctKm)) / 1000) * 1000,
  };
}

/**
 * Dirección de búsqueda en Chileautos, ordenada por precio más bajo.
 * Devuelve null si falta algún dato obligatorio.
 */
export function buildChileautosUrl({ marca, modelo, anio, km, margenAnio = 1, pctKm = MARGEN_KM }) {
  const ma = String(marca || "").trim();
  const mo = String(modelo || "").trim();
  if (!ma || !mo || !toPositiveInt(anio) || !toPositiveInt(km)) return null;
  const f = calcularFiltros({ anio, km, margenAnio, pctKm });
  const enc = (s) => encodeURIComponent(s).replace(/\./g, "%2E");
  const q = `(And.(C.Marca.${enc(ma)}._.Modelo.${enc(mo)}.)_.Ano.range(${f.anioMin}..${f.anioMax})._.Kilometraje.range(${f.kmMin}..${f.kmMax}).)`;
  return `https://www.chileautos.cl/vehiculos/?q=${q}&sort=~Price`;
}

/* ---------- avisos copiados por el marcador ---------- */
/** Valida el texto pegado. Devuelve { ok:true, data } o { ok:false, error }. */
export function parseAvisosPegados(texto) {
  const t = String(texto || "").trim();
  if (!t) return { ok: false, error: "Pega aquí el texto que copió el marcador." };
  let data;
  try { data = JSON.parse(t); } catch (e) {
    return { ok: false, error: "El texto no es el que copia el marcador. Vuelve a Chileautos, pulsa el marcador y pega de nuevo." };
  }
  if (!data || data.fuente !== "chileautos" || !Array.isArray(data.listings)) {
    return { ok: false, error: "El texto no corresponde a una búsqueda de Chileautos copiada con el marcador." };
  }
  return { ok: true, data };
}

/* ---------- limpieza de avisos ---------- */
/** Precios "de mentira" que se ponen para aparecer primero al ordenar por precio (111.111, 123.456, 100.001…). */
export function esPrecioSimbolico(precio) {
  const s = String(Math.round(precio));
  if (s.length < 5) return false;
  if (/^(\d)\1+$/.test(s)) return true; // 111111, 5555555
  if (/^1?0+1$/.test(s) || /^1?0+10$/.test(s)) return true; // 100001, 1000001, 100010
  const asc = "0123456789012345";
  if (s.length >= 6 && asc.includes(s.slice(0, 6))) return true; // 123456…
  return false;
}

const mediana = (nums) => {
  const a = [...nums].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const promedio = (nums) => nums.reduce((s, n) => s + n, 0) / nums.length;

/**
 * @param listings  avisos del marcador: { id, titulo, anio, km, precio, destacado, href }
 * @param filtros   { anioMin, anioMax, kmMin, kmMax } (los mismos que se pidieron a Chileautos)
 */
export function estimarCompra(listings, filtros = {}, { descuento = DESCUENTO_COMPRA } = {}) {
  const descartados = [];
  const candidatos = [];
  const ids = new Set();

  for (const l of Array.isArray(listings) ? listings : []) {
    const precio = Number(l && l.precio) || 0;
    const motivo =
      !l ? "Aviso inválido"
      : ids.has(l.id) ? "Aviso repetido"
      : l.destacado ? "Aviso destacado (patrocinado)"
      : precio <= 0 ? "Sin precio"
      : l.anio && filtros.anioMin && (l.anio < filtros.anioMin || l.anio > filtros.anioMax) ? "Año fuera del filtro"
      : l.km && filtros.kmMax && (l.km < filtros.kmMin || l.km > filtros.kmMax) ? "Kilometraje fuera del filtro"
      : esPrecioSimbolico(precio) ? "Precio simbólico"
      : null;
    if (l && l.id) ids.add(l.id);
    if (motivo) descartados.push({ ...l, motivo }); else candidatos.push({ ...l, precio });
  }

  // Precios muy por debajo del resto (menos de la mitad de la mediana). Con menos de 3 avisos no hay mediana confiable.
  let validos = candidatos;
  if (candidatos.length >= 3) {
    const piso = mediana(candidatos.map((c) => c.precio)) * 0.5;
    validos = [];
    for (const c of candidatos) {
      if (c.precio < piso) descartados.push({ ...c, motivo: "Precio muy bajo respecto al resto" });
      else validos.push(c);
    }
  }

  validos = [...validos].sort((a, b) => a.precio - b.precio);
  const advertencias = [];
  if (validos.length === 0) {
    return { ok: false, error: "No quedaron avisos válidos para calcular.", validos, descartados, advertencias };
  }
  const primeros = validos.slice(0, N_PRIMEROS);
  if (primeros.length < N_PRIMEROS) {
    advertencias.push(`Solo hay ${primeros.length} aviso${primeros.length === 1 ? "" : "s"} válido${primeros.length === 1 ? "" : "s"}: el promedio de los ${N_PRIMEROS} primeros usa solo esos.`);
  }
  const promedioPrimeros = Math.round(promedio(primeros.map((p) => p.precio)));
  const publicacion = Math.round(promedio(validos.map((v) => v.precio)));
  const compraBruta = promedioPrimeros - descuento;
  if (compraBruta < 0) advertencias.push("El promedio de los primeros avisos es menor que el descuento: el precio de compra queda en $0.");
  return {
    ok: true,
    validos,
    primeros,
    descartados,
    advertencias,
    promedioPrimeros,
    publicacion,
    compra: Math.max(0, compraBruta),
    descuento,
  };
}
