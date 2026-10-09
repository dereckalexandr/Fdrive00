/**
 * TASACIÓN DE COMPRA: lógica pura (se prueba en Node)
 * ----------------------------------------------------------------
 * - Arma la dirección de búsqueda de Chileautos con los filtros del vehículo.
 * - Interpreta los avisos que copia el marcador del navegador.
 * - Estima los precios:
 *     precio promedio                = promedio de los 5 primeros avisos (los más baratos, tras la limpieza)
 *     precio sugerido de publicación = precio promedio + INCREMENTO_PUBLICACION
 *     precio sugerido de compra      = precio promedio − margen bruto (lo elige el administrador de MARGENES_BRUTOS)
 * ----------------------------------------------------------------
 */
export const DESCUENTO_COMPRA = 2_000_000; // margen bruto por defecto
export const MARGEN_BRUTO_DEFECTO = DESCUENTO_COMPRA;
// Opciones de la lista "Margen bruto" del módulo.
export const MARGENES_BRUTOS = [1_500_000, 2_000_000, 2_500_000, 3_000_000, 3_500_000, 4_000_000, 5_000_000, 6_000_000, 7_000_000, 8_000_000, 9_000_000, 10_000_000];
export const MARGEN_KM = 0.2; // ±20 %
export const INCREMENTO_PUBLICACION = 500_000;
export const N_PRIMEROS = 5;

/* ---------- transmisión y combustible ---------- */
// `variantes`: nombres con que Chileautos guarda el valor. "Mecánica" (como la llama el módulo) es "Manual" en Chileautos.
export const TRANSMISIONES = [
  { value: "manual", label: "Mecánica", variantes: ["Manual"], prefijo: "manual" },
  { value: "automatica", label: "Automática", variantes: ["Automática", "Automático"], prefijo: "automatic" },
];
// Los acentos importan: Chileautos devuelve 0 avisos con "Hibrido" o "Electrico" sin tilde.
export const COMBUSTIBLES = [
  { value: "bencina", label: "Bencina", chileautos: "Bencina", prefijo: "bencina" },
  { value: "diesel", label: "Diesel", chileautos: "Diesel", prefijo: "diesel" },
  { value: "hibrido", label: "Híbrido", chileautos: "Híbrido", prefijo: "hibrido" },
  { value: "electrico", label: "Eléctrico", chileautos: "Eléctrico", prefijo: "electrico" },
];
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
// Un aviso sin el dato (vacío) no se descarta; uno con un valor distinto, sí.
const coincide = (valorAviso, prefijo) => !valorAviso || sinTildes(valorAviso).startsWith(prefijo);

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
 * EXCEPCIONES a la regla "solo la primera palabra del modelo": modelos cuyo nombre en Chileautos tiene VARIAS
 * palabras (ej. "Land Cruiser", "Corolla Cross"). Si el modelo empieza con alguna de estas frases (sin distinguir
 * mayúsculas ni tildes), se busca con la frase completa en vez de con la primera palabra.
 *
 * Cada excepción puede ser:
 *   - un texto: una frase de varias palabras ("Corolla Cross");
 *   - { prefijo, desde, hasta }: una serie con número, escrita pegada ("CX-" 3..90 → CX-3 … CX-90, "A" 1..7 → A1 … A7)
 *     o en dos palabras si el prefijo termina en espacio ("Tiggo " 2..8 → Tiggo 2 … Tiggo 8);
 *   - { numeros: [desde, hasta] }: modelos que son solo un número (208, 3008…);
 *   - { letras: n }: modelos de n letras (ASX, RAV…).
 * Las series con prefijo se NORMALIZAN al formato de la lista: "CX5", "cx 5" y "CX-5" se buscan como "CX-5";
 * "X 1" como "X1"; "A 3" como "A3"; "Tiggo7" y "Tiggo-7" como "Tiggo 7".
 * Las de UNA sola palabra (X1, 208, A3, ZS…) ya se conservan por la regla de la primera palabra; se listan igual
 * para dejar documentado qué modelos se consideran válidos.
 */
export const EXCEPCIONES_MODELO = [
  "Corolla Cross",
  "Land Cruiser",
  "Santa Fe",
  "Grand Vitara",
  "Yaris Sport",
  "Yaris Cross",
  { prefijo: "CX-", desde: 3, hasta: 90 },
  { prefijo: "X", desde: 1, hasta: 7 },
  { numeros: [1, 9999] },
  { letras: 3 },
  { prefijo: "A", desde: 1, hasta: 7 },
  { prefijo: "Q", desde: 1, hasta: 8 },
  { prefijo: "Tiggo ", desde: 2, hasta: 8 },
];

const sinTildesMinus = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Nombre del modelo tal como se busca en Chileautos.
 * Los datos de patentechile traen el modelo con el motor y la versión ("YARIS 1.5 GLI MT"), pero Chileautos solo
 * conoce el modelo ("Yaris"). Además el punto es un separador de su sintaxis: con "1.5" en el modelo ignora TODOS los
 * filtros. Por eso se usa solo la primera palabra (lo anterior al primer espacio), salvo las EXCEPCIONES_MODELO.
 */
export function modeloParaChileautos(modelo, excepciones = EXCEPCIONES_MODELO) {
  return resolverModelo(modelo, excepciones).busqueda;
}

/**
 * Lo mismo que modeloParaChileautos, pero además indica qué parte del texto se omitió
 * (el motor, la versión u otras palabras) para poder avisárselo al usuario.
 */
export function detalleModeloChileautos(modelo, excepciones = EXCEPCIONES_MODELO) {
  const r = resolverModelo(modelo, excepciones);
  return { busqueda: r.busqueda, omitido: r.palabras.slice(r.consumo).join(" ") };
}

function resolverModelo(modelo, excepciones) {
  const palabras = String(modelo || "").trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return { busqueda: "", consumo: 0, palabras };
  const norm = palabras.map(sinTildesMinus);
  const lista = Array.isArray(excepciones) ? excepciones : [];
  const enRango = (n, desde, hasta) => Number.isInteger(n) && n >= desde && n <= hasta;

  // Cada coincidencia indica cuántas palabras del modelo consume y cómo se escribe en la búsqueda. Gana la que consume más.
  const candidatas = [];
  for (const e of lista) {
    if (typeof e === "string") {
      const f = e.trim().split(/\s+/).filter(Boolean);
      if (f.length > 1 && f.length <= palabras.length && f.every((w, i) => sinTildesMinus(w) === norm[i])) {
        candidatas.push({ consumo: f.length, salida: f.join(" ") }); // se usa la escritura de la lista (Chileautos distingue tildes)
      }
    } else if (e && typeof e.prefijo === "string") {
      // Serie con número: la base es el prefijo sin guion ni espacio final ("CX", "X", "A", "Q", "Tiggo").
      const base = sinTildesMinus(e.prefijo).replace(/[\s-]+$/, "");
      const escrita = (n) => e.prefijo + n; // formato de la lista: "CX-5", "X1", "Tiggo 7"
      // a) una sola palabra, con o sin guion: "CX5", "CX-5", "Tiggo7", "Tiggo-7"
      const pegado = norm[0].match(new RegExp("^" + base + "-?(\\d+)$"));
      if (pegado && enRango(parseInt(pegado[1], 10), e.desde, e.hasta)) candidatas.push({ consumo: 1, salida: escrita(parseInt(pegado[1], 10)) });
      // b) dos palabras: "CX 5", "X 1", "Tiggo 7"
      if (palabras.length > 1 && norm[0] === base && /^\d+$/.test(norm[1]) && enRango(parseInt(norm[1], 10), e.desde, e.hasta)) {
        candidatas.push({ consumo: 2, salida: escrita(parseInt(norm[1], 10)) });
      }
    }
  }
  if (candidatas.length) {
    const mejor = candidatas.sort((a, b) => b.consumo - a.consumo)[0];
    return { busqueda: mejor.salida, consumo: mejor.consumo, palabras };
  }

  // Sin excepción: solo la primera palabra (los modelos de una palabra, como "Yaris", "208" o "ASX", quedan igual).
  return { busqueda: palabras[0], consumo: 1, palabras };
}

/**
 * ¿La primera palabra del modelo es un modelo válido de una sola palabra según las excepciones de serie, número o letras?
 * Solo sirve para documentar y probar la lista; el resultado de modeloParaChileautos no cambia por esto.
 */
export function esModeloConocidoDeUnaPalabra(palabra, excepciones = EXCEPCIONES_MODELO) {
  const p = sinTildesMinus(palabra);
  return (excepciones || []).some((e) => {
    if (!e || typeof e === "string") return false;
    if (Array.isArray(e.numeros)) return /^\d+$/.test(p) && parseInt(p, 10) >= e.numeros[0] && parseInt(p, 10) <= e.numeros[1];
    if (Number.isInteger(e.letras)) return new RegExp("^[a-z]{" + e.letras + "}$").test(p);
    if (typeof e.prefijo === "string" && !/\s$/.test(e.prefijo)) {
      const base = sinTildesMinus(e.prefijo);
      if (!p.startsWith(base)) return false;
      const resto = p.slice(base.length);
      return /^\d+$/.test(resto) && parseInt(resto, 10) >= e.desde && parseInt(resto, 10) <= e.hasta;
    }
    return false;
  });
}

/**
 * Dirección de búsqueda en Chileautos, ordenada por precio más bajo.
 * Devuelve null si falta algún dato obligatorio.
 */
export function buildChileautosUrl({ marca, modelo, anio, km, margenAnio = 1, pctKm = MARGEN_KM, transmision = "", combustible = "", excepciones = EXCEPCIONES_MODELO }) {
  const ma = String(marca || "").trim();
  const mo = modeloParaChileautos(modelo, excepciones);
  if (!ma || !mo || !toPositiveInt(anio) || !toPositiveInt(km)) return null;
  const f = calcularFiltros({ anio, km, margenAnio, pctKm });
  const enc = (s) => encodeURIComponent(s).replace(/\./g, "%2E");
  const tr = TRANSMISIONES.find((t) => t.value === transmision);
  const co = COMBUSTIBLES.find((c) => c.value === combustible);
  const claveT = enc("Transmisión");
  // La transmisión automática figura en Chileautos como "Automática" y, en pocos avisos, "Automático": se piden ambas.
  const grupoTransmision = tr && tr.variantes.length > 1 ? `(Or.${tr.variantes.map((v) => `${claveT}.${enc(v)}`).join("._.")}.)_.` : "";
  let extras = "";
  if (tr && tr.variantes.length === 1) extras += `._.${claveT}.${enc(tr.variantes[0])}`;
  if (co) extras += `._.Combustible.${enc(co.chileautos)}`;
  const q = `(And.(C.Marca.${enc(ma)}._.Modelo.${enc(mo)}.)_.${grupoTransmision}Ano.range(${f.anioMin}..${f.anioMax})._.Kilometraje.range(${f.kmMin}..${f.kmMax})${extras}.)`;
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

/* ---------- datos copiados de la ficha de patentechile.com ---------- */
/**
 * Valida el texto que copia el marcador de patente. Solo se aceptan patente, marca, modelo y año
 * (aunque el JSON trajera algo más, no se usa). Devuelve { ok:true, data } o { ok:false, error, etiquetas }.
 */
export function parseDatosPatente(texto) {
  const t = String(texto || "").trim();
  if (!t) return { ok: false, error: "Pega aquí el texto que copió el marcador." };
  let data;
  try { data = JSON.parse(t); } catch (e) {
    return { ok: false, error: "El texto no es el que copia el marcador. Pulsa el favorito en la ficha del vehículo y pega de nuevo." };
  }
  if (!data || data.fuente !== "patentechile") {
    return { ok: false, error: "El texto no corresponde a una ficha de patentechile.com copiada con el marcador." };
  }
  const marca = String(data.marca || "").trim();
  const modelo = String(data.modelo || "").trim();
  const anio = parseInt(data.anio, 10) || 0;
  if (!marca || !modelo || !anio) {
    return {
      ok: false,
      error: "No pude leer marca, modelo y año de esa página. Busca la patente en el sitio, abre la ficha del vehículo y vuelve a pulsar el favorito.",
      etiquetas: Array.isArray(data.etiquetas) ? data.etiquetas.map(String).slice(0, 40) : [],
    };
  }
  return { ok: true, data: { patente: normalizePatente(data.patente), marca, modelo, anio } };
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
 * @param filtros   { anioMin, anioMax, kmMin, kmMax, transmision?, combustible? } (los mismos que se pidieron a Chileautos)
 */
export function estimarCompra(listings, filtros = {}, { margenBruto, descuento = DESCUENTO_COMPRA } = {}) {
  const margen = Number.isFinite(Number(margenBruto)) && margenBruto !== undefined && margenBruto !== "" ? Number(margenBruto) : descuento;
  const descartados = [];
  const candidatos = [];
  const ids = new Set();
  const filtrosTrans = TRANSMISIONES.find((t) => t.value === filtros.transmision);
  const filtrosComb = COMBUSTIBLES.find((c) => c.value === filtros.combustible);

  for (const l of Array.isArray(listings) ? listings : []) {
    const precio = Number(l && l.precio) || 0;
    const motivo =
      !l ? "Aviso inválido"
      : ids.has(l.id) ? "Aviso repetido"
      : l.destacado ? "Aviso destacado (patrocinado)"
      : precio <= 0 ? "Sin precio"
      : l.anio && filtros.anioMin && (l.anio < filtros.anioMin || l.anio > filtros.anioMax) ? "Año fuera del filtro"
      : l.km && filtros.kmMax && (l.km < filtros.kmMin || l.km > filtros.kmMax) ? "Kilometraje fuera del filtro"
      : filtrosTrans && !coincide(l.transmision, filtrosTrans.prefijo) ? "Transmisión fuera del filtro"
      : filtrosComb && !coincide(l.combustible, filtrosComb.prefijo) ? "Combustible fuera del filtro"
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
  const publicacion = promedioPrimeros + INCREMENTO_PUBLICACION;
  const compraBruta = promedioPrimeros - margen;
  if (compraBruta < 0) advertencias.push("El precio promedio es menor que el margen bruto elegido: el precio de compra queda en $0.");
  return {
    ok: true,
    validos,
    primeros,
    descartados,
    advertencias,
    promedioPrimeros,
    publicacion,
    incremento: INCREMENTO_PUBLICACION,
    compra: Math.max(0, compraBruta),
    margenBruto: margen,
    descuento: margen,
  };
}
