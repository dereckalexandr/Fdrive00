// Asistente de WhatsApp fuera de horario: reglas puras (horario, conversación paso a paso y mensajes interactivos de Meta).
// Nada aquí habla con Meta ni con la base: el servidor (wa-bot.ts) lo usa, y las pruebas lo ejercitan por separado.
//
// Cómo funciona: si un cliente escribe cuando el local está cerrado, el asistente le hace cuatro preguntas (qué necesita, su
// nombre, el detalle del auto y cuándo prefiere que lo contacten), y al terminar el servidor deja el lead con el tipo correcto,
// los datos anotados y el ejecutivo que corresponde. Las respuestas son botones y listas de WhatsApp: no interpreta texto libre
// salvo para entender «quiero vender mi auto» y similares.

import { validarIa, IA_DEFECTO } from "./wa-ia-core.js";

export const ZONA_HORARIA = "America/Santiago";
export const DIAS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"]; // posición = Date.getDay()
const NOMBRE_DIA = { dom: "el domingo", lun: "el lunes", mar: "el martes", mie: "el miércoles", jue: "el jueves", vie: "el viernes", sab: "el sábado" };
const NOMBRE_DIA_CORTO = { dom: "domingo", lun: "lunes", mar: "martes", mie: "miércoles", jue: "jueves", vie: "viernes", sab: "sábado" };

/** Horas tras las cuales el asistente vuelve a avisar a un mismo cliente, y tras las que se da por terminada una conversación abandonada. */
export const HORAS_SIN_REPETIR = 12;
/** Si un ejecutivo escribió al cliente hace menos de esto, el asistente no se mete. */
export const HORAS_HUMANO_ACTIVO = 6;

export const HORARIO_DEFECTO = {
  lun: { abierto: true, desde: "09:00", hasta: "19:00" },
  mar: { abierto: true, desde: "09:00", hasta: "19:00" },
  mie: { abierto: true, desde: "09:00", hasta: "19:00" },
  jue: { abierto: true, desde: "09:00", hasta: "19:00" },
  vie: { abierto: true, desde: "09:00", hasta: "19:00" },
  sab: { abierto: true, desde: "10:00", hasta: "14:00" },
  dom: { abierto: false, desde: "10:00", hasta: "14:00" },
};
export const CONFIG_BOT_DEFECTO = { activo: false, empresa: "", horario: HORARIO_DEFECTO, ia: IA_DEFECTO };

const hhmm = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutos = (s) => { const m = hhmm.exec(String(s || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

/** Configuración del asistente que envía el Administrador o el Jefe Local: { activo, empresa, horario, ia: { activa, maxUsdMes, maxPorConversacion } }. */
export function validarConfigBot(c) {
  if (!c || typeof c !== "object") return { ok: false, error: "bot_config_invalida" };
  const empresa = String(c.empresa ?? "").replace(/\s+/g, " ").trim();
  if (empresa.length > 60) return { ok: false, error: "bot_config_invalida" };
  const horario = {};
  for (const d of DIAS) {
    const x = (c.horario || {})[d] || HORARIO_DEFECTO[d];
    const abierto = !!x.abierto;
    const desde = String(x.desde || HORARIO_DEFECTO[d].desde);
    const hasta = String(x.hasta || HORARIO_DEFECTO[d].hasta);
    if (!Number.isFinite(minutos(desde)) || !Number.isFinite(minutos(hasta))) return { ok: false, error: "bot_horario_invalido" };
    if (abierto && minutos(desde) >= minutos(hasta)) return { ok: false, error: "bot_horario_invalido" };
    horario[d] = { abierto, desde, hasta };
  }
  const ia = validarIa(c.ia);
  if (!ia.ok) return ia;
  return { ok: true, value: { activo: !!c.activo, empresa, horario, ia: ia.value } };
}

/** Configuración guardada (JSON o texto) con los valores por defecto para lo que falte. */
export function configBot(valor) {
  let o = valor;
  if (typeof o === "string") { try { o = JSON.parse(o); } catch { o = null; } }
  const v = validarConfigBot(o || CONFIG_BOT_DEFECTO);
  return v.ok ? v.value : { activo: false, empresa: "", horario: HORARIO_DEFECTO, ia: IA_DEFECTO };
}

/** Día de la semana y minutos desde la medianoche, según la hora de Chile. */
export function horaChile(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA_HORARIA, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(fecha);
  const g = (t) => (partes.find((p) => p.type === t) || {}).value;
  const dia = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[g("weekday")];
  return { dia, minutos: Number(g("hour")) * 60 + Number(g("minute")) };
}

/** ¿Está atendiendo el local en este momento? */
export function estaAbierto(horario, fecha = new Date()) {
  const { dia, minutos: m } = horaChile(fecha);
  const x = (horario || HORARIO_DEFECTO)[DIAS[dia]];
  return !!x && !!x.abierto && m >= minutos(x.desde) && m < minutos(x.hasta);
}

/** Cuándo vuelve a atender: «hoy desde las 09:00», «mañana desde las 09:00», «el lunes desde las 09:00»; «pronto» si nunca abre. */
export function proximaApertura(horario, fecha = new Date()) {
  const h = horario || HORARIO_DEFECTO;
  const { dia, minutos: m } = horaChile(fecha);
  for (let off = 0; off <= 7; off++) {
    const d = DIAS[(dia + off) % 7];
    const x = h[d];
    if (!x || !x.abierto) continue;
    if (off === 0 && m >= minutos(x.desde)) continue; // hoy ya abrió (y ahora está cerrado: terminó la jornada)
    return `${off === 0 ? "hoy" : off === 1 ? "mañana" : NOMBRE_DIA[d]} desde las ${x.desde}`;
  }
  return "pronto";
}

/** «lunes a viernes de 09:00 a 19:00 y sábado de 10:00 a 14:00». */
export function textoHorario(horario) {
  const h = horario || HORARIO_DEFECTO;
  const orden = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
  const grupos = [];
  for (const d of orden) {
    const x = h[d];
    if (!x || !x.abierto) continue;
    const franja = `${x.desde} a ${x.hasta}`;
    const ult = grupos[grupos.length - 1];
    if (ult && ult.franja === franja && orden.indexOf(ult.fin) === orden.indexOf(d) - 1) ult.fin = d;
    else grupos.push({ ini: d, fin: d, franja });
  }
  if (!grupos.length) return "en nuestro horario habitual";
  const parte = (g) => `${g.ini === g.fin ? NOMBRE_DIA_CORTO[g.ini] : `${NOMBRE_DIA_CORTO[g.ini]} a ${NOMBRE_DIA_CORTO[g.fin]}`} de ${g.franja}`;
  return grupos.map(parte).join(" y ");
}

/* ---------- Qué necesita el cliente ---------- */
export const NECESIDADES = [
  { id: "comprar", titulo: "Comprar un auto", tipoLead: "venta" },
  { id: "vender", titulo: "Vender mi auto", tipoLead: "compra" },
  { id: "consignar", titulo: "Consignar mi auto", tipoLead: "consignacion" },
  { id: "financiar", titulo: "Financiamiento", tipoLead: "venta" },
  { id: "otra", titulo: "Otra consulta", tipoLead: "venta" },
];
export const tipoLeadDeNecesidad = (id) => (NECESIDADES.find((n) => n.id === id) || NECESIDADES[0]).tipoLead;
export const tituloNecesidad = (id) => (NECESIDADES.find((n) => n.id === id) || {}).titulo || "";
const PREFERENCIAS = { am: "En la mañana", pm: "En la tarde", igual: "Me da igual" };

const sinTildes = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Entiende frases como «quiero vender mi auto» o «busco una camioneta». Devuelve el id de la necesidad o null. */
export function interpretarNecesidad(texto) {
  const t = sinTildes(texto);
  if (!t) return null;
  if (/consign/.test(t)) return "consignar";
  if (/\b(vender|vendo|vendiendo|tasar|tasacion|compran|compras mi|cuanto pagan)\b/.test(t)) return "vender";
  if (/\b(financ|credito|cuota|cuotas|pie)\w*/.test(t)) return "financiar";
  if (/\b(comprar|compro|busco|buscando|cotiz\w*|precio|valor|disponible|disponibles|auto|autos|camioneta|suv|sedan|vehiculo)\b/.test(t)) return "comprar";
  return null;
}
function interpretarPreferencia(texto) {
  const t = sinTildes(texto);
  if (/\b(manana|am|temprano)\b/.test(t)) return "am";
  if (/\b(tarde|pm)\b/.test(t)) return "pm";
  return null;
}

/* ---------- Mensajes que arma el asistente ---------- */
const txt = (texto) => ({ tipo: "texto", texto });
const lista = (texto) => ({ tipo: "lista", texto, boton: "Elegir", filas: NECESIDADES.map((n) => ({ id: n.id, titulo: n.titulo })) });
const botones = (texto, bs) => ({ tipo: "botones", texto, botones: bs });

function primerNombre(n) { return String(n || "").trim().split(" ")[0]; }

/** Preguntas del paso «detalle» según lo que necesita. */
function preguntaDetalle(nec, nombre) {
  const g = primerNombre(nombre);
  return ({
    comprar: `Gracias, ${g}. ¿Qué auto buscas? Cuéntame la marca o el modelo y tu presupuesto aproximado.`,
    vender: `Gracias, ${g}. ¿Qué auto quieres vender? Escríbeme la marca, el modelo, el año y el kilometraje.`,
    consignar: `Gracias, ${g}. ¿Qué auto quieres consignar? Escríbeme la marca, el modelo, el año y el kilometraje.`,
    financiar: `Gracias, ${g}. ¿Qué auto te interesa y cuánto podrías dar de pie?`,
    otra: `Gracias, ${g}. Cuéntame tu consulta y se la paso al ejecutivo.`,
  })[nec] || `Gracias, ${g}. Cuéntame qué necesitas.`;
}

/** Primer mensaje del asistente para un cliente nuevo (o que vuelve de cero) fuera de horario. */
export function mensajeInicio(cfg, ahora = new Date()) {
  const empresa = cfg.empresa || "nuestro equipo";
  return lista(`Hola 👋 Soy el asistente virtual de ${empresa}. Ahora estamos fuera de horario (atendemos ${textoHorario(cfg.horario)}), pero te dejo registrado para que un ejecutivo te contacte ${proximaApertura(cfg.horario, ahora)}.\n\n¿Qué necesitas?`);
}

/** Aviso corto para un cliente que ya tiene ejecutivo: no se le vuelve a preguntar nada. */
export function mensajeFueraDeHorario(cfg, { nombre, ejecutivo } = {}, ahora = new Date()) {
  const quien = ejecutivo ? `${primerNombre(ejecutivo)} te responderá` : "Un ejecutivo te responderá";
  const saludo = nombre ? `Hola ${primerNombre(nombre)}, ` : "Hola, ";
  return txt(`${saludo}ahora estamos fuera de horario (atendemos ${textoHorario(cfg.horario)}). ${quien} ${proximaApertura(cfg.horario, ahora)}. ¡Gracias por escribirnos!`);
}

export function estadoInicial(ahora = new Date()) {
  return { paso: "necesidad", datos: {}, intentos: 0, inicio: ahora.toISOString() };
}

/**
 * Un paso de la conversación. `estado` = { paso, datos, intentos }; `entrada` = { id, texto, tipo } (id: botón o fila de lista que tocó).
 * Devuelve { estado, mensajes, terminado }. Si el cliente no responde lo esperado se le repite la pregunta una vez; a la segunda
 * se sigue con lo que escribió, para no dejarlo atrapado.
 */
export function avanzar(estado, entrada, cfg, ahora = new Date()) {
  const e = { paso: estado.paso, datos: { ...(estado.datos || {}) }, intentos: Number(estado.intentos) || 0, inicio: estado.inicio };
  const texto = String((entrada && entrada.texto) || "").replace(/\s+/g, " ").trim();
  const id = String((entrada && entrada.id) || "");
  const sinTexto = !texto;

  if (e.paso === "necesidad") {
    const nec = NECESIDADES.some((n) => n.id === id) ? id : interpretarNecesidad(texto);
    if (nec) { e.datos.necesidad = nec; e.paso = "nombre"; e.intentos = 0; return { estado: e, mensajes: [txt("Perfecto. ¿Cómo te llamas?")], terminado: false }; }
    if (e.intentos < 1) { e.intentos += 1; return { estado: e, mensajes: [lista("No te entendí 😅. Elige una opción de la lista:")], terminado: false }; }
    e.datos.necesidad = "otra"; if (texto) e.datos.detalle = texto.slice(0, 500);
    e.paso = "nombre"; e.intentos = 0;
    return { estado: e, mensajes: [txt("No hay problema, le paso tu mensaje a un ejecutivo. ¿Cómo te llamas?")], terminado: false };
  }

  if (e.paso === "nombre") {
    if (sinTexto) {
      if (e.intentos < 1) { e.intentos += 1; return { estado: e, mensajes: [txt("¿Cómo te llamas? Escríbeme tu nombre.")], terminado: false }; }
      e.datos.nombre = "";
    } else e.datos.nombre = texto.slice(0, 60);
    e.intentos = 0;
    if (e.datos.detalle) { e.paso = "contacto"; return { estado: e, mensajes: [botones("¿Cuándo prefieres que te contactemos?", Object.entries(PREFERENCIAS).map(([i, t]) => ({ id: i, titulo: t })))], terminado: false }; }
    e.paso = "detalle";
    return { estado: e, mensajes: [txt(preguntaDetalle(e.datos.necesidad, e.datos.nombre))], terminado: false };
  }

  if (e.paso === "detalle") {
    // Una foto, un audio o un documento también vale como detalle: el ejecutivo lo verá en la conversación.
    e.datos.detalle = (sinTexto ? "(envió un archivo; míralo en la conversación)" : texto).slice(0, 500);
    e.paso = "contacto"; e.intentos = 0;
    return { estado: e, mensajes: [botones("¿Cuándo prefieres que te contactemos?", Object.entries(PREFERENCIAS).map(([i, t]) => ({ id: i, titulo: t })))], terminado: false };
  }

  if (e.paso === "contacto") {
    const pref = PREFERENCIAS[id] ? id : interpretarPreferencia(texto);
    if (pref) e.datos.contacto = pref;
    else if (texto) e.datos.contactoTexto = texto.slice(0, 80);
    e.paso = "listo";
    const nombre = e.datos.nombre ? `, ${primerNombre(e.datos.nombre)}` : "";
    const cuando = e.datos.contacto === "am" ? " (en la mañana)" : e.datos.contacto === "pm" ? " (en la tarde)" : "";
    return {
      estado: e, terminado: true,
      mensajes: [txt(`Listo${nombre} ✅ Quedaste registrado. Un ejecutivo te contactará ${proximaApertura(cfg.horario, ahora)}${cuando}. Si quieres agregar algo más, escríbelo aquí y se lo paso.`)],
    };
  }
  return { estado: e, mensajes: [], terminado: e.paso === "listo" };
}

/** Texto para anotar en el lead con lo que contó el cliente al asistente. */
export function resumenBot(datos) {
  const d = datos || {};
  const pref = PREFERENCIAS[d.contacto] || d.contactoTexto || "";
  return [
    "Asistente de WhatsApp (fuera de horario):",
    d.necesidad ? `• Necesita: ${tituloNecesidad(d.necesidad)}` : "",
    d.nombre ? `• Nombre: ${d.nombre}` : "",
    d.detalle ? `• Detalle: ${d.detalle}` : "",
    pref ? `• Prefiere que lo contacten: ${pref}` : "",
  ].filter(Boolean).join("\n");
}

/* ---------- Formato de Meta para mensajes con botones y listas ---------- */
/** Cuerpo del mensaje a enviar a la Cloud API de Meta (sin el destinatario ni los datos fijos). */
export function cuerpoMeta(m) {
  if (m.tipo === "texto") return { type: "text", text: { body: String(m.texto).slice(0, 4096), preview_url: false } };
  if (m.tipo === "botones") {
    return {
      type: "interactive",
      interactive: {
        type: "button", body: { text: String(m.texto).slice(0, 1024) },
        action: { buttons: m.botones.slice(0, 3).map((b) => ({ type: "reply", reply: { id: String(b.id).slice(0, 256), title: String(b.titulo).slice(0, 20) } })) },
      },
    };
  }
  if (m.tipo === "lista") {
    return {
      type: "interactive",
      interactive: {
        type: "list", body: { text: String(m.texto).slice(0, 1024) },
        action: { button: String(m.boton || "Elegir").slice(0, 20), sections: [{ title: "Opciones", rows: m.filas.slice(0, 10).map((f) => ({ id: String(f.id).slice(0, 200), title: String(f.titulo).slice(0, 24) })) }] },
      },
    };
  }
  return { type: "text", text: { body: "", preview_url: false } };
}

/** Cómo se guarda en la conversación del CRM lo que dijo el asistente (para que el ejecutivo lo lea). */
export function textoParaConversacion(m) {
  if (m.tipo === "texto") return m.texto;
  if (m.tipo === "botones") return `${m.texto}\n${m.botones.map((b) => `▫️ ${b.titulo}`).join("\n")}`;
  if (m.tipo === "lista") return `${m.texto}\n${m.filas.map((f) => `▫️ ${f.titulo}`).join("\n")}`;
  return "";
}
