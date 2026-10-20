// Envío de avisos por correo con Resend. Si no está configurado (RESEND_API_KEY), no hace nada: los avisos son un extra,
// nunca deben frenar ni hacer fallar una operación del CRM.
import { destinatariosValidos, limpiarAsunto, plantillaCorreo } from "./avisos-core.js";

export const correoActivo = () => !!Deno.env.get("RESEND_API_KEY");

type Aviso = { para: string[]; asunto: string; titulo: string; lineas: string[]; ruta?: string; enlaceTexto?: string };

/** Envía un aviso a cada destinatario por separado (nadie ve las direcciones de los demás). Devuelve cuántos salieron. */
export async function enviarAviso(a: Aviso, alFallar?: (motivo: string) => Promise<unknown>): Promise<number> {
  const fallo = async (m: string) => { console.error("aviso por correo:", m); try { if (alFallar) await alFallar(m.slice(0, 300)); } catch { /* el registro es un extra */ } };
  const clave = Deno.env.get("RESEND_API_KEY");
  if (!clave) return 0;
  const para = destinatariosValidos(a.para);
  if (para.length === 0) return 0;
  const desde = Deno.env.get("MAIL_FROM") || "Drive Futuro <onboarding@resend.dev>";
  const base = (Deno.env.get("APP_URL") || "").replace(/\/+$/, "");
  const { html, texto } = plantillaCorreo({ titulo: a.titulo, lineas: a.lineas, enlace: base ? base + (a.ruta ?? "/plataforma") : "", ...(a.enlaceTexto ? { enlaceTexto: a.enlaceTexto } : {}) });
  let enviados = 0;
  for (const destino of para) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${clave}`, "content-type": "application/json" },
        body: JSON.stringify({ from: desde, to: [destino], subject: limpiarAsunto(a.asunto), html, text: texto }),
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

/** Lanza el envío sin hacer esperar la respuesta (en la nube, sigue en segundo plano; sin ese soporte, espera). */
export async function enSegundoPlano(p: Promise<unknown>) {
  const safe = p.catch((e) => console.error("aviso por correo falló:", String(e?.message ?? e)));
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") rt.waitUntil(safe);
  else await safe;
}
