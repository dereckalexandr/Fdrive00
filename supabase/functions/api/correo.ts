// Envío de avisos por correo con Resend. Si no está configurado (RESEND_API_KEY), no hace nada: los avisos son un extra,
// nunca deben frenar ni hacer fallar una operación del CRM.
import { destinatariosValidos, limpiarAsunto, plantillaCorreo } from "./avisos-core.js";
import { armarIcs, enlaceGoogleCalendar, textoFechaVisita, aBase64Utf8, DURACION_VISITA_MIN } from "./calendario-core.js";

export const correoActivo = () => !!Deno.env.get("RESEND_API_KEY");

type Adjunto = { filename: string; content: string; content_type?: string };
type Aviso = {
  para: string[]; asunto: string; titulo: string; lineas: string[]; ruta?: string; enlaceTexto?: string;
  /** Enlace completo (por ejemplo, a Google Calendar) en vez de una ruta de la plataforma. */
  enlaceExterno?: string; pie?: string; responderA?: string; adjuntos?: Adjunto[];
  /** Sin botón (los correos a clientes nunca llevan el enlace a la plataforma). */
  sinEnlace?: boolean;
};

/** Envía un aviso a cada destinatario por separado (nadie ve las direcciones de los demás). Devuelve cuántos salieron. */
export async function enviarAviso(a: Aviso, alFallar?: (motivo: string) => Promise<unknown>): Promise<number> {
  const fallo = async (m: string) => { console.error("aviso por correo:", m); try { if (alFallar) await alFallar(m.slice(0, 300)); } catch { /* el registro es un extra */ } };
  const clave = Deno.env.get("RESEND_API_KEY");
  if (!clave) return 0;
  const para = destinatariosValidos(a.para);
  if (para.length === 0) return 0;
  const desde = Deno.env.get("MAIL_FROM") || "Drive Futuro <onboarding@resend.dev>";
  const base = (Deno.env.get("APP_URL") || "").replace(/\/+$/, "");
  const enlace = a.sinEnlace ? "" : a.enlaceExterno ? a.enlaceExterno : base ? base + (a.ruta ?? "/plataforma") : "";
  const { html, texto } = plantillaCorreo({ titulo: a.titulo, lineas: a.lineas, enlace, ...(a.enlaceTexto ? { enlaceTexto: a.enlaceTexto } : {}), ...(a.pie ? { pie: a.pie } : {}) });
  const responder = a.responderA && destinatariosValidos([a.responderA])[0];
  let enviados = 0;
  for (const destino of para) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${clave}`, "content-type": "application/json" },
        body: JSON.stringify({ from: desde, to: [destino], subject: limpiarAsunto(a.asunto), html, text: texto, ...(responder ? { reply_to: responder } : {}), ...(a.adjuntos && a.adjuntos.length ? { attachments: a.adjuntos } : {}) }),
        signal: AbortSignal.timeout(6000),
      });
      if (r.ok) enviados++;
      else await fallo(`Resend rechazó el envío (${r.status}): ${(await r.text()).slice(0, 200)}`);
    } catch (e) {
      await fallo(`no se pudo contactar a Resend: ${String((e as any)?.message ?? e)}`);
    }
  }
  return enviados;
}

/**
 * Invitación de calendario de una visita a la sucursal: correo al cliente con el archivo .ics (Gmail lo ofrece agregar a
 * Google Calendar; también Outlook y Apple) y un botón «Agregar a Google Calendar». Devuelve cuántos correos salieron.
 * `modo`: «nueva» (primera invitación), «cambio» (nueva hora: mismo evento, su calendario se actualiza) o «cancelada»
 * (quita el evento de su calendario). `secuencia` sube con cada cambio para que el calendario reemplace la versión anterior.
 */
export async function enviarInvitacionVisita(v: {
  uid: string; para: string; nombreCliente: string; inicio: string; empresa: string; lugar?: string; ejecutivo?: string; correoEjecutivo?: string; detalle?: string;
  modo?: "nueva" | "cambio" | "cancelada"; secuencia?: number; inicioAnterior?: string;
}, alFallar?: (motivo: string) => Promise<unknown>): Promise<number> {
  const modo = v.modo || "nueva";
  const titulo = `Visita a ${v.empresa}`;
  const cuando = textoFechaVisita(v.inicio);
  const descripcion = [v.detalle, v.ejecutivo ? `Te atiende: ${v.ejecutivo}` : "", v.lugar ? `Dirección: ${v.lugar}` : ""].filter(Boolean).join("\n");
  const desde = Deno.env.get("MAIL_FROM") || "Drive Futuro <onboarding@resend.dev>";
  const cancelada = modo === "cancelada";
  const ics = armarIcs({
    uid: v.uid, inicio: v.inicio, duracionMin: DURACION_VISITA_MIN, titulo, descripcion, lugar: v.lugar, secuencia: v.secuencia || 0,
    metodo: cancelada ? "CANCEL" : "REQUEST", organizador: { nombre: v.empresa, email: desde }, invitado: { nombre: v.nombreCliente, email: v.para },
  });
  const adjunto = { filename: cancelada ? "cancelacion.ics" : "invitacion.ics", content: aBase64Utf8(ics), content_type: `text/calendar; charset=utf-8; method=${cancelada ? "CANCEL" : "REQUEST"}` };
  if (cancelada) {
    return await enviarAviso({
      para: [v.para], asunto: `Visita cancelada: ${v.empresa} (${cuando})`, titulo: "Tu visita fue cancelada",
      lineas: [
        `Hola ${v.nombreCliente}, cancelamos tu visita a ${v.empresa} del ${cuando}.`,
        "Si agregaste la visita a tu calendario, la invitación adjunta la quita.",
        "Si quieres agendar otro día, responde este correo y te ayudamos.",
      ],
      sinEnlace: true, pie: v.empresa, responderA: v.correoEjecutivo, adjuntos: [adjunto],
    }, alFallar);
  }
  const cambio = modo === "cambio";
  return await enviarAviso({
    para: [v.para],
    asunto: cambio ? `Cambio de horario de tu visita a ${v.empresa}: ${cuando}` : `Tu visita a ${v.empresa}: ${cuando}`,
    titulo: cambio ? `Tu visita cambió al ${cuando}` : `Te esperamos el ${cuando}`,
    lineas: [
      cambio
        ? `Hola ${v.nombreCliente}, cambiamos el horario de tu visita a ${v.empresa}${v.inicioAnterior ? ` (antes: ${textoFechaVisita(v.inicioAnterior)})` : ""}. La nueva hora es el ${cuando}.`
        : `Hola ${v.nombreCliente}, quedó agendada tu visita a ${v.empresa}.`,
      v.detalle || "",
      v.lugar ? `Dirección: ${v.lugar}.` : "",
      v.ejecutivo ? `Te atenderá ${v.ejecutivo}.` : "",
      cambio
        ? "Adjuntamos la invitación actualizada: al abrirla, tu calendario cambia la hora de la visita."
        : "Adjuntamos la invitación para tu calendario. Si necesitas cambiar el día o la hora, responde este correo.",
    ],
    enlaceExterno: enlaceGoogleCalendar({ inicio: v.inicio, duracionMin: DURACION_VISITA_MIN, titulo, descripcion, lugar: v.lugar }),
    enlaceTexto: "Agregar a Google Calendar", pie: v.empresa, responderA: v.correoEjecutivo, adjuntos: [adjunto],
  }, alFallar);
}

/** Lanza el envío sin hacer esperar la respuesta (en la nube, sigue en segundo plano; sin ese soporte, espera). */
export async function enSegundoPlano(p: Promise<unknown>) {
  const safe = p.catch((e) => console.error("aviso por correo falló:", String(e?.message ?? e)));
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") rt.waitUntil(safe);
  else await safe;
}
