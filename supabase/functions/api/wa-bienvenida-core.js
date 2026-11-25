// Mensaje de bienvenida por WhatsApp a los leads que llegan por un formulario (sitio web, Meta Ads, Google Ads): reglas puras.
// Nada aquí habla con Meta ni con la base. El servidor (wa-bienvenida.ts) lo usa y las pruebas lo ejercitan por separado.
//
// WhatsApp no deja escribirle libremente a alguien que no escribió en las últimas 24 horas: el primer mensaje tiene que ser una
// plantilla aprobada por Meta. Si el cliente responde, se abre la conversación y sigue el asistente (menú o IA) o el ejecutivo.
import { estaAbierto, proximaApertura, HORARIO_DEFECTO } from "./wa-bot-core.js";

export const CLAVE_BIENVENIDA = "whatsapp::bienvenida";
export const CLAVE_BIENVENIDA_ESTADO = "whatsapp::bienvenida::estado";
/** Un mismo teléfono recibe la bienvenida una vez cada tantos días (un formulario repetido no repite el mensaje). */
export const DIAS_SIN_REPETIR = 7;
export const BIENVENIDA_DEFECTO = { activa: false, plantilla: { nombre: "", idioma: "es" }, maxPorDia: 40 };

/** Plantilla que el CRM propone crear en Meta (categoría «Servicio»: confirma una solicitud que el cliente acaba de hacer). */
export const PLANTILLA_SUGERIDA = {
  nombre: "bienvenida_formulario",
  categoria: "UTILITY",
  cuerpo: "Hola {{1}} 👋 Recibimos {{2}}. Un ejecutivo de {{3}} te contactará {{4}}. Si quieres, puedes escribirnos por aquí y te ayudamos.",
  pie: "Mensaje automático",
  ejemplos: ["Pedro", "tu consulta por el Toyota Yaris 2020", "BuyCar", "mañana desde las 10:00"],
};
export const VARIABLES_BIENVENIDA = 4;

/** Configuración guardada: { activa, plantilla: { nombre, idioma }, maxPorDia }. */
export function validarConfigBienvenida(c) {
  const x = c && typeof c === "object" ? c : {};
  const p = x.plantilla && typeof x.plantilla === "object" ? x.plantilla : {};
  const nombre = String(p.nombre ?? "").trim();
  const idioma = String(p.idioma ?? "es").trim() || "es";
  if (nombre && !/^[a-z0-9_]{3,512}$/.test(nombre)) return { ok: false, error: "bienvenida_config_invalida" };
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(idioma)) return { ok: false, error: "bienvenida_config_invalida" };
  const maxPorDia = x.maxPorDia === undefined ? BIENVENIDA_DEFECTO.maxPorDia : Number(x.maxPorDia);
  if (!Number.isInteger(maxPorDia) || maxPorDia < 1 || maxPorDia > 1000) return { ok: false, error: "bienvenida_config_invalida" };
  if (x.activa && !nombre) return { ok: false, error: "bienvenida_sin_plantilla" };
  return { ok: true, value: { activa: !!x.activa, plantilla: { nombre, idioma }, maxPorDia } };
}
export function configBienvenida(valor) {
  let o = valor;
  if (typeof o === "string") { try { o = JSON.parse(o); } catch { o = null; } }
  const v = validarConfigBienvenida(o || BIENVENIDA_DEFECTO);
  return v.ok ? v.value : { ...BIENVENIDA_DEFECTO };
}

const primerNombre = (n) => String(n ?? "").replace(/\s+/g, " ").trim().split(" ")[0].slice(0, 30);

/** Qué recibimos, dicho como continuación de «Recibimos …»: «tu consulta por el Toyota Yaris 2020», «tu solicitud para vender tu auto»… */
export function descripcionSolicitud({ tipo, origen, vehiculo } = {}) {
  const v = String(vehiculo ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const por = v ? ` por el ${v}` : "";
  if (tipo === "visita") return v ? `tu solicitud de visita para el ${v}` : "tu solicitud de visita";
  if (tipo === "financiamiento") return v ? `tu solicitud de financiamiento para el ${v}` : "tu solicitud de financiamiento";
  if (tipo === "vender") return "tu solicitud para vender tu auto";
  if (tipo === "consignar") return "tu solicitud para consignar tu auto";
  if (tipo === "renovar") return "tu solicitud para renovar tu auto";
  if (tipo === "consulta") return `tu consulta${por}`;
  // Formularios de anuncios (Meta y Google): no sabemos más que lo que pidió información.
  return origen === "meta" || origen === "google" ? "tu solicitud de información" : `tu consulta${por}`;
}

/** Cuándo lo van a contactar, como continuación de «te contactará …». */
export function cuandoContactar({ tipo, horario, ahora = new Date() } = {}) {
  if (tipo === "visita") return "para confirmar tu visita";
  if (estaAbierto(horario || HORARIO_DEFECTO, ahora)) return "a la brevedad";
  const prox = proximaApertura(horario || HORARIO_DEFECTO, ahora);
  return prox === "pronto" ? "a la brevedad" : prox;
}

/** Los cuatro valores de la plantilla sugerida, en orden: nombre, qué recibimos, empresa y cuándo. */
export function valoresBienvenida({ nombre, tipo, origen, vehiculo, empresa, horario, ahora = new Date() } = {}) {
  return [
    primerNombre(nombre) || "cliente",
    descripcionSolicitud({ tipo, origen, vehiculo }),
    String(empresa ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "nuestra automotora",
    cuandoContactar({ tipo, horario, ahora }),
  ];
}

export const claveBienvenidaTelefono = (tel) => `bienvenida::tel::${String(tel).replace(/\D/g, "")}`;
export const claveBienvenidaDia = (fecha = new Date()) => `whatsapp::bienvenida::dia::${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(fecha)}`;

/** ¿Ya se le envió la bienvenida a este teléfono hace menos de DIAS_SIN_REPETIR días? `previo` = { en } guardado. */
export function yaRecibioBienvenida(previo, ahora = new Date()) {
  const t = Date.parse((previo && previo.en) || "");
  return Number.isFinite(t) && ahora.getTime() - t < DIAS_SIN_REPETIR * 86_400_000;
}

/* ---------- Bajas: quien pide dejar de recibir mensajes ---------- */
export const claveBajaTelefono = (tel) => `bienvenida::baja::${String(tel).replace(/\D/g, "")}`;
export const ETIQUETA_BAJA = "No contactar";
export const TEXTO_CONFIRMA_BAJA = "Listo, no te escribiremos más mensajes automáticos. Si más adelante quieres retomar, puedes escribirnos cuando quieras.";
const sinTildes = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¡!¿?.,;:]+/g, " ").replace(/\s+/g, " ").trim();
/** ¿El cliente pide que dejemos de escribirle? («No quiero recibir más mensajes», «dejen de escribirme», «STOP», «dar de baja»…). */
export function esPeticionDeBaja(texto) {
  const t = sinTildes(texto);
  if (!t || t.length > 140) return false;
  if (/^(stop|baja|parar|cancelar|desuscribir|desuscribirme)$/.test(t)) return true;
  // «No quiero recibir llamadas pero sí mensajes» no es una baja de mensajes: «recibir» solo cuenta sola o con mensajes, más, WhatsApp, avisos…
  return /\bno quiero (seguir )?recibi\w*( mas)?( mensajes?| whatsapp| notificaciones| avisos| informacion| publicidad| correos?| nada)*( por (whatsapp|aqui|este medio))?$/.test(t)
    || /\bno quiero que me (escriban|escriba|contacten|manden|envien)\b/.test(t)
    || /\b(dejen|deja|dejar|dejes) de (escribir|enviar|mandar|molestar|contactar)\w*/.test(t)
    || /\b(darme|dar|me den|me des|denme) de baja\b|\bdesuscrib/.test(t)
    || /\bno me (escriban|escribas|contacten|contactes|manden|mandes|envien|envies|llamen|llames)( mas)?\b/.test(t);
}
