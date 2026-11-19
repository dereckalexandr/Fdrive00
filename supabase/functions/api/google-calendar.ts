// Visitas en el Google Calendar de la empresa (Google Calendar API): el CRM crea el evento con el cliente como invitado y
// GOOGLE envía la invitación. Es una invitación nativa: Gmail, Outlook, Hotmail y Apple la reconocen como cita, y al
// reprogramar o cancelar el evento se actualiza o se quita solo en el calendario del cliente.
//
// Secretos (los carga el usuario): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN (permiso calendar.events
// de la cuenta de Google de la empresa). Opcional: GOOGLE_CALENDAR_ID (por defecto, el calendario principal).
// Sin estos secretos, el CRM sigue enviando la invitación por correo (Resend).
import { DURACION_VISITA_MIN } from "./calendario-core.js";

const env = (k: string) => (globalThis as any).Deno.env.get(k) ?? "";
export const googleConfigurado = () => !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET") && env("GOOGLE_REFRESH_TOKEN"));
const calendario = () => encodeURIComponent(env("GOOGLE_CALENDAR_ID") || "primary");
const BASE = "https://www.googleapis.com/calendar/v3";

let token: { valor: string; vence: number } | null = null;

/** Token de acceso a partir del token de actualización (se reutiliza mientras dure). */
async function accesoGoogle(forzar = false): Promise<string> {
  if (!forzar && token && token.vence > Date.now() + 60_000) return token.valor;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), refresh_token: env("GOOGLE_REFRESH_TOKEN"), grant_type: "refresh_token" }).toString(),
    signal: AbortSignal.timeout(10000),
  });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Google no entregó acceso (${r.status}): ${String(d.error_description || d.error || "").slice(0, 160)}`);
  token = { valor: String(d.access_token), vence: Date.now() + (Number(d.expires_in) || 3000) * 1000 };
  return token.valor;
}

/** Llamada a la API de Calendar; si el token expiró, lo renueva una vez. */
async function llamar(metodo: string, ruta: string, cuerpo?: unknown): Promise<any> {
  for (let intento = 0; intento < 2; intento++) {
    const acceso = await accesoGoogle(intento > 0);
    const r = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: { authorization: `Bearer ${acceso}`, ...(cuerpo ? { "content-type": "application/json" } : {}) },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    if (r.status === 401 && intento === 0) continue;
    if (metodo === "DELETE" && (r.status === 204 || r.status === 200 || r.status === 410 || r.status === 404)) return {}; // ya no existe: da lo mismo
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Google Calendar respondió ${r.status}: ${String((d.error && d.error.message) || "").slice(0, 200)}`);
    return d;
  }
  throw new Error("Google Calendar rechazó el acceso");
}

export type Visita = {
  titulo: string; inicio: string; descripcion?: string; lugar?: string;
  cliente: { nombre: string; email: string }; ejecutivo?: { nombre: string; email?: string | null } | null; tareaId?: string;
};

function cuerpoEvento(v: Visita) {
  const ini = new Date(v.inicio);
  const fin = new Date(ini.getTime() + DURACION_VISITA_MIN * 60_000);
  const invitados = [{ email: v.cliente.email, displayName: v.cliente.nombre }];
  // El ejecutivo también queda invitado: la visita aparece en su propio calendario.
  if (v.ejecutivo && v.ejecutivo.email && v.ejecutivo.email.toLowerCase() !== v.cliente.email.toLowerCase()) invitados.push({ email: v.ejecutivo.email, displayName: v.ejecutivo.nombre });
  return {
    summary: v.titulo,
    ...(v.descripcion ? { description: v.descripcion } : {}),
    ...(v.lugar ? { location: v.lugar } : {}),
    start: { dateTime: ini.toISOString(), timeZone: "America/Santiago" },
    end: { dateTime: fin.toISOString(), timeZone: "America/Santiago" },
    attendees: invitados,
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 120 }] },
    guestsCanModify: false, guestsCanInviteOthers: false,
    ...(v.tareaId ? { extendedProperties: { private: { crmTareaId: v.tareaId } } } : {}),
  };
}

/** Crea la visita en el calendario de la empresa y Google invita al cliente. Devuelve el id del evento. */
export async function crearVisitaGoogle(v: Visita): Promise<string> {
  const d = await llamar("POST", `/calendars/${calendario()}/events?sendUpdates=all`, cuerpoEvento(v));
  if (!d.id) throw new Error("Google Calendar no devolvió el evento");
  return String(d.id);
}

/** Cambia la hora (y los datos) de la visita: Google avisa al cliente y su calendario se actualiza. */
export async function moverVisitaGoogle(eventoId: string, v: Visita): Promise<void> {
  await llamar("PATCH", `/calendars/${calendario()}/events/${encodeURIComponent(eventoId)}?sendUpdates=all`, cuerpoEvento(v));
}

/** Cancela la visita: Google avisa al cliente y la quita de su calendario. */
export async function cancelarVisitaGoogle(eventoId: string): Promise<void> {
  await llamar("DELETE", `/calendars/${calendario()}/events/${encodeURIComponent(eventoId)}?sendUpdates=all`);
}

/** Para las pruebas: olvida el token guardado. */
export function _reiniciarTokenGoogle() { token = null; }
