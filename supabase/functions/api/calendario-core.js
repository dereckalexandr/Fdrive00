// Invitaciones de calendario para las visitas a la sucursal: archivo .ics (iCalendar, RFC 5545) que Gmail, Google Calendar,
// Outlook y Apple reconocen como invitación, y un enlace «Agregar a Google Calendar» de respaldo. Reglas puras (sin red).

export const DURACION_VISITA_MIN = 60;

const z2 = (n) => String(n).padStart(2, "0");
/** Fecha en formato iCalendar UTC: 20261120T140000Z. */
export function fechaIcs(iso) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${z2(d.getUTCMonth() + 1)}${z2(d.getUTCDate())}T${z2(d.getUTCHours())}${z2(d.getUTCMinutes())}${z2(d.getUTCSeconds())}Z`;
}
const masMinutos = (iso, min) => new Date(Date.parse(iso) + min * 60_000).toISOString();

/** Escapa un texto para iCalendar (barra invertida, punto y coma, coma y saltos de línea). */
export function escaparIcs(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Pliega una línea a 75 bytes como pide el estándar (las continuaciones empiezan con un espacio). */
export function plegarIcs(linea) {
  const enc = new TextEncoder();
  const partes = [];
  let actual = "";
  let bytes = 0;
  for (const ch of linea) {
    const b = enc.encode(ch).length;
    const max = partes.length === 0 ? 75 : 74; // las continuaciones llevan un espacio al inicio
    if (bytes + b > max) { partes.push(actual); actual = ""; bytes = 0; }
    actual += ch; bytes += b;
  }
  partes.push(actual);
  return partes.join("\r\n ");
}

const correoDe = (s) => { const m = /<([^>]+)>/.exec(String(s || "")); return (m ? m[1] : String(s || "")).trim(); };

/**
 * Invitación iCalendar de una visita.
 * @param v { uid, inicio (ISO), duracionMin?, titulo, descripcion?, lugar?, organizador: { nombre, email }, invitado: { nombre, email }, secuencia?, ahora? }
 */
export function armarIcs(v) {
  const inicio = new Date(v.inicio).toISOString();
  const fin = masMinutos(inicio, v.duracionMin || DURACION_VISITA_MIN);
  const org = v.organizador || {};
  const inv = v.invitado || {};
  const lineas = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Drive Futuro//CRM//ES",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${v.uid}`,
    `DTSTAMP:${fechaIcs(v.ahora || new Date().toISOString())}`,
    `DTSTART:${fechaIcs(inicio)}`,
    `DTEND:${fechaIcs(fin)}`,
    `SUMMARY:${escaparIcs(v.titulo)}`,
    ...(v.descripcion ? [`DESCRIPTION:${escaparIcs(v.descripcion)}`] : []),
    ...(v.lugar ? [`LOCATION:${escaparIcs(v.lugar)}`] : []),
    `ORGANIZER;CN=${escaparIcs(org.nombre || "")}:mailto:${correoDe(org.email)}`,
    `ATTENDEE;CN=${escaparIcs(inv.nombre || "")};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${correoDe(inv.email)}`,
    "STATUS:CONFIRMED",
    `SEQUENCE:${Number(v.secuencia) || 0}`,
    "TRANSP:OPAQUE",
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escaparIcs(v.titulo)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lineas.map(plegarIcs).join("\r\n") + "\r\n";
}

/** Enlace que abre Google Calendar con el evento listo para guardar. */
export function enlaceGoogleCalendar({ inicio, duracionMin, titulo, descripcion, lugar }) {
  const ini = new Date(inicio).toISOString();
  const p = new URLSearchParams({ action: "TEMPLATE", text: String(titulo || ""), dates: `${fechaIcs(ini)}/${fechaIcs(masMinutos(ini, duracionMin || DURACION_VISITA_MIN))}`, ctz: "America/Santiago" });
  if (descripcion) p.set("details", String(descripcion));
  if (lugar) p.set("location", String(lugar));
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/** «jueves 20 de noviembre a las 11:00», en la hora de Chile. */
export function textoFechaVisita(iso) {
  const d = new Date(iso);
  const dia = d.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Santiago" });
  const hora = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" });
  return `${dia.replace(",", "")} a las ${hora}`;
}

/** Base64 de un texto UTF-8 (para adjuntar el .ics al correo). */
export function aBase64Utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
