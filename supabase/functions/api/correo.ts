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
  const enlace = a.enlaceExterno ? a.enlaceExterno : base ? base + (a.ruta ?? "/plataforma") : "";
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
 */
export async function enviarInvitacionVisita(v: {
  uid: string; para: string; nombreCliente: string; inicio: string; empresa: string; lugar?: string; ejecutivo?: string; correoEjecutivo?: string; detalle?: string;
}, alFallar?: (motivo: string) => Promise<unknown>): Promise<number> {
  const titulo = `Visita a ${v.empresa}`;
  const cuando = textoFechaVisita(v.inicio);
  const descripcion = [v.detalle, v.ejecutivo ? `Te atiende: ${v.ejecutivo}` : "", v.lugar ? `Dirección: ${v.lugar}` : ""].filter(Boolean).join("\n");
  const desde = Deno.env.get("MAIL_FROM") || "Drive Futuro <onboarding@resend.dev>";
  const ics = armarIcs({
    uid: v.uid, inicio: v.inicio, duracionMin: DURACION_VISITA_MIN, titulo, descripcion, lugar: v.lugar,
    organizador: { nombre: v.empresa, email: desde }, invitado: { nombre: v.nombreCliente, email: v.para },
  });
  return await enviarAviso({
    para: [v.para], asunto: `Tu visita a ${v.empresa}: ${cuando}`, titulo: `Te esperamos el ${cuando}`,
    lineas: [
      `Hola ${v.nombreCliente}, quedó agendada tu visita a ${v.empresa}.`,
      v.detalle || "",
      v.lugar ? `Dirección: ${v.lugar}.` : "",
      v.ejecutivo ? `Te atenderá ${v.ejecutivo}.` : "",
      "Adjuntamos la invitación para tu calendario. Si necesitas cambiar el día o la hora, responde este correo.",
    ],
    enlaceExterno: enlaceGoogleCalendar({ inicio: v.inicio, duracionMin: DURACION_VISITA_MIN, titulo, descripcion, lugar: v.lugar }),
    enlaceTexto: "Agregar a Google Calendar", pie: v.empresa, responderA: v.correoEjecutivo,
    adjuntos: [{ filename: "invitacion.ics", content: aBase64Utf8(ics), content_type: "text/calendar; charset=utf-8; method=REQUEST" }],
  }, alFallar);
}

/** Lanza el envío sin hacer esperar la respuesta (en la nube, sigue en segundo plano; sin ese soporte, espera). */
export async function enSegundoPlano(p: Promise<unknown>) {
  const safe = p.catch((e) => console.error("aviso por correo falló:", String(e?.message ?? e)));
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") rt.waitUntil(safe);
  else await safe;
}
