// Caché del navegador para que Pista nunca espere a la red cuando ya conoce la respuesta («stale-while-revalidate»).
//
// Dos capas, las dos SOLO en memoria (no se escribe nada en el disco del equipo y todo se borra al cerrar sesión o al recargar):
//  1. Caché de LECTURAS de la API (vida corta, FRESCO_API_MS): evita repetir la misma consulta, junta las que salen a la vez y es donde
//     caen las precargas (pasar el cursor por un lead o una pestaña ya deja su respuesta lista antes del clic).
//  2. Caché de PANTALLAS (useCarga): la última respuesta de cada pantalla. Al volver a abrirla se dibuja al instante con lo que había
//     y, por detrás, se pide lo nuevo y se reemplaza.
// Cualquier cambio (guardar, crear, aprobar…) borra TODO: es mejor perder velocidad un instante que mostrar un dato viejo de algo que
// la persona acaba de cambiar.

export const FRESCO_API_MS = 8_000;
export const MAX_EDAD_PANTALLA_MS = 10 * 60_000;
export const MAX_ENTRADAS = 300;

/** Lecturas que se pueden guardar: operaciones de consulta. Lo que cambia solo (WhatsApp, estado del sistema) nunca se guarda. */
// Lista CONSERVADORA (la misma que ya usan los reintentos de lectura, más `lista` y dos lecturas con nombre propio): tratar por error un
// cambio como si fuera una lectura lo dejaría sin ejecutar, así que jamás se usan terminaciones ambiguas como «estado».
const LECTURA = /(^|\.)(list|lista|get|cola|resumen|equipo|pendientes|mios|mias|catalogos)$/;
const LECTURA_NOMBRADA = /^(gestion\.embudo|marketing\.resultados)$/;
const SIEMPRE_FRESCO = /^(wa|whatsapp|sistema|archivos)\./;
export const esLecturaCacheable = (op) => typeof op === "string" && (LECTURA.test(op) || LECTURA_NOMBRADA.test(op)) && !SIEMPRE_FRESCO.test(op);
// Lecturas VIVAS: cambian solas y la pantalla las repite cada pocos segundos (WhatsApp, estado). Nunca se guardan, pero tampoco vacían la caché
// (si lo hicieran, cada sondeo borraría todo lo guardado). Cualquier otra operación que no sea lectura se trata como CAMBIO.
const LECTURA_VIVA = /^((wa|whatsapp).(list|resumen|conversacion|estado|plantillas|plantillas_admin|respuestas|media|bot_estado|bienvenida_estado)|sistema.estado|archivos.estado)$/;
export const esLecturaViva = (op) => typeof op === "string" && LECTURA_VIVA.test(op);

/** JSON con las llaves ordenadas: el mismo contenido da siempre la misma firma. */
export function estable(v) {
  if (v === undefined) return "u";
  if (typeof v === "function") return "f";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(estable).join(",")}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined && typeof v[k] !== "function").map((k) => `${JSON.stringify(k)}:${estable(v[k])}`).join(",")}}`;
}
export const firma = (accion, op, params) => `${accion}|${op}|${estable(params || {})}`;

/** Clave de una pantalla: su código (qué pide) y los valores de los que depende (qué filtros tiene puestos). */
export const claveDeCarga = (fn, deps) => `${Function.prototype.toString.call(fn)}|${(deps || []).map(estable).join("|")}`;

const copiar = (v) => (v === undefined || v === null || typeof v !== "object" ? v : structuredClone(v));

/** Caché pequeña con edad máxima y tope de entradas (sale lo más antiguo). Entrega y guarda COPIAS: nadie puede alterar lo guardado. */
export function crearCache({ maxEdadMs, max = MAX_ENTRADAS, ahora = () => Date.now() } = {}) {
  const m = new Map();
  return {
    get(clave) {
      const e = m.get(clave);
      if (!e) return null;
      const edad = ahora() - e.en;
      if (edad > maxEdadMs) { m.delete(clave); return null; }
      return { valor: copiar(e.valor), edad };
    },
    set(clave, valor) {
      let guardado;
      try { guardado = copiar(valor); } catch { return; } // algo que no se puede copiar (no viene del servidor): no se guarda
      m.delete(clave);
      m.set(clave, { valor: guardado, en: ahora() });
      while (m.size > max) m.delete(m.keys().next().value);
    },
    limpiar() { m.clear(); },
    get tamano() { return m.size; },
  };
}

export const cacheApi = crearCache({ maxEdadMs: FRESCO_API_MS });
export const cachePantallas = crearCache({ maxEdadMs: MAX_EDAD_PANTALLA_MS });
const enVuelo = new Map();

/** Borra todo lo guardado (al cambiar algo, al iniciar o cerrar sesión, o cuando vence la sesión). */
export function limpiarTodo() { cacheApi.limpiar(); cachePantallas.limpiar(); enVuelo.clear(); }

/**
 * Lee con caché: si hay una respuesta reciente la devuelve sin ir a la red; si la misma consulta ya está en camino, se une a ella.
 * `pedir` hace la consulta real. Los cambios (no lecturas) ejecutan `pedir` y borran todo, antes y después.
 */
export async function conCache(accion, op, params, pedir, { registrar } = {}) {
  if (esLecturaViva(op)) return await pedir();
  if (!esLecturaCacheable(op)) {
    limpiarTodo();
    try { return await pedir(); } finally { limpiarTodo(); }
  }
  const f = firma(accion, op, params);
  if (registrar) registrar({ accion, op, params });
  const hit = cacheApi.get(f);
  if (hit) return hit.valor;
  let p = enVuelo.get(f);
  if (!p) {
    p = pedir().then((r) => { cacheApi.set(f, r); return r; }).finally(() => enVuelo.delete(f));
    enVuelo.set(f, p);
  }
  const r = await p;
  try { return copiar(r); } catch { return r; }
}

/* ---------- aprender qué pide cada pestaña, para precargarla al pasar el cursor ---------- */
const aprendido = new Map(); // «pestañas:id» -> [{ accion, op, params }]
let grabando = null;

/** Al abrir una pestaña, anota qué lecturas hace en los próximos instantes. */
// `reloj.setTimeout` va envuelto en una flecha: en el navegador, llamar al setTimeout global como método de otro objeto lanza «Illegal invocation».
export function empezarAAprender(id, ms = 1500, reloj = { setTimeout: (f, t) => setTimeout(f, t) }) {
  const lista = [];
  grabando = { id, lista };
  reloj.setTimeout(() => { if (grabando && grabando.lista === lista) { if (lista.length) aprendido.set(id, lista); grabando = null; } }, ms);
}
export function anotarLectura(l) {
  if (!grabando || !esLecturaCacheable(l.op)) return;
  if (!grabando.lista.some((x) => x.accion === l.accion && x.op === l.op && estable(x.params) === estable(l.params))) grabando.lista.push({ ...l, params: copiar(l.params) });
}
export const lecturasAprendidas = (id) => aprendido.get(id) || [];
export function olvidarAprendido() { aprendido.clear(); grabando = null; }

/** Misma firma que usa `conCache`: sirve para saber si una lectura ya está lista. */
export const estaLista = (accion, op, params) => !!cacheApi.get(firma(accion, op, params));
