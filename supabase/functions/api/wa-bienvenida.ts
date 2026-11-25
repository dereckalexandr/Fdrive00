// Mensaje de bienvenida por WhatsApp a los leads de formularios (lado servidor).
//
// Cuando entra un lead por el sitio web o por un formulario de Meta o Google Ads, se le envía una plantilla aprobada por Meta que confirma
// que recibimos su solicitud y cuándo lo contactará un ejecutivo. Si responde, se abre la conversación y sigue el asistente o el ejecutivo.
// Frenos (los formularios públicos se pueden usar para molestar a un tercero): apagado por defecto, un mensaje por teléfono cada 7 días,
// tope diario, y no se envía si la persona ya está conversando. Nunca lanza: si falla, el lead ya quedó guardado y asignado.
import {
  configBienvenida, valoresBienvenida, claveBienvenidaTelefono, claveBienvenidaDia, yaRecibioBienvenida, CLAVE_BIENVENIDA, CLAVE_BIENVENIDA_ESTADO,
  VARIABLES_BIENVENIDA, claveBajaTelefono, ETIQUETA_BAJA, TEXTO_CONFIRMA_BAJA,
} from "./wa-bienvenida-core.js";
import { telefonoWa, armarPlantilla, ventanaAbierta } from "./whatsapp-core.js";
import { configBot } from "./wa-bot-core.js";
import { graph, plantillas, waConfigurado } from "./whatsapp.ts";

const env = (k: string) => (globalThis as any).Deno.env.get(k) ?? "";
const ahoraIso = () => new Date().toISOString();

export type DepsBienvenida = {
  sb: any;
  audit: (actor: any, accion: string, entidad?: string, entidadId?: string, detalle?: Record<string, unknown>) => Promise<void>;
};
export type DatosBienvenida = {
  nombre?: string; telefono?: string; origen: "web" | "meta" | "google"; tipo?: string; vehiculo?: string; empresa?: string;
  leadId?: string; clienteId?: string; localId?: string;
};

export async function cargarConfigBienvenida(sb: any) {
  const g = await sb.from("kv_store").select("value").eq("key", CLAVE_BIENVENIDA).maybeSingle();
  return configBienvenida(g.data ? g.data.value : null);
}
async function leerKv(sb: any, key: string) {
  const g = await sb.from("kv_store").select("value").eq("key", key).maybeSingle();
  try { return g.data && g.data.value ? JSON.parse(g.data.value) : null; } catch { return null; }
}
const guardarKv = (sb: any, key: string, v: unknown) => sb.from("kv_store").upsert({ key, value: JSON.stringify(v), shared: false, updated_at: ahoraIso() }, { onConflict: "key" });

async function registrar(sb: any, ok: boolean, error = "") {
  try { await guardarKv(sb, CLAVE_BIENVENIDA_ESTADO, { ok, error: String(error).slice(0, 300), en: ahoraIso() }); } catch (e) { console.error("whatsapp bienvenida estado:", String((e as any)?.message ?? e)); }
}
export const ultimoResultadoBienvenida = (sb: any) => leerKv(sb, CLAVE_BIENVENIDA_ESTADO);
/** Cuántas bienvenidas se enviaron hoy (hora de Chile). */
export async function enviadasHoy(sb: any, fecha = new Date()) {
  const v = await leerKv(sb, claveBienvenidaDia(fecha));
  return v && Number.isFinite(Number(v.n)) ? Number(v.n) : 0;
}

/**
 * Envía la bienvenida a un lead nuevo. Devuelve qué pasó: «enviada», «apagada», «sin_whatsapp», «sin_telefono», «repetido»,
 * «ya_conversa», «tope», «plantilla» (no está aprobada) o «error». `prueba`: envía solo el mensaje, sin frenos ni registros del lead.
 */
export async function bienvenidaLead(d: DepsBienvenida, x: DatosBienvenida, opciones: { prueba?: boolean } = {}): Promise<string> {
  try {
    const { sb } = d;
    const prueba = !!opciones.prueba;
    const cfg = await cargarConfigBienvenida(sb);
    if (!prueba && !cfg.activa) return "apagada";
    if (!waConfigurado()) return "sin_whatsapp";
    const tel = telefonoWa(x.telefono);
    if (!tel) return "sin_telefono";
    if (!prueba && (await leerKv(sb, claveBajaTelefono(tel)))) return "baja"; // pidió no recibir mensajes: nunca más
    const ahora = new Date();

    let reserva = false;
    if (!prueba) {
      if (yaRecibioBienvenida(await leerKv(sb, claveBienvenidaTelefono(tel)), ahora)) return "repetido";
      const c0 = (await sb.from("wa_conversaciones").select("id, ultimo_entrante_en").eq("telefono", tel).maybeSingle()).data;
      if (c0 && ventanaAbierta(c0.ultimo_entrante_en, ahora)) return "ya_conversa"; // ya está hablando con nosotros: no hace falta una plantilla
      if ((await enviadasHoy(sb, ahora)) >= cfg.maxPorDia) { await registrar(sb, false, `Se alcanzó el tope de ${cfg.maxPorDia} bienvenidas por día.`); return "tope"; }
      // Se reserva el teléfono antes de enviar: dos formularios simultáneos no mandan dos mensajes.
      await guardarKv(sb, claveBienvenidaTelefono(tel), { en: ahora.toISOString() });
      reserva = true;
    }
    const liberar = async () => { if (reserva) await sb.from("kv_store").delete().eq("key", claveBienvenidaTelefono(tel)); };

    const lista = await plantillas();
    const p = lista.ok ? lista.lista.find((t: any) => t.nombre === cfg.plantilla.nombre && t.idioma === cfg.plantilla.idioma) : null;
    if (!p || p.variables.length !== VARIABLES_BIENVENIDA) {
      await liberar();
      await registrar(sb, false, p ? `La plantilla «${p.nombre}» debe tener ${VARIABLES_BIENVENIDA} variables.` : `La plantilla «${cfg.plantilla.nombre}» no está aprobada en Meta.`);
      return "plantilla";
    }
    const bot = configBot((await sb.from("kv_store").select("value").eq("key", "whatsapp::bot").maybeSingle()).data?.value ?? null);
    // Nombre de la empresa: el que se escribió para el asistente de WhatsApp y, si no hay, el del sitio (el mismo en todos los orígenes).
    const sitio = bot.empresa || x.empresa || String(((await sb.from("config_negocio").select("valor").eq("clave", "sitio_nombre").maybeSingle()).data || {}).valor || "");
    const a = armarPlantilla(p, valoresBienvenida({ nombre: x.nombre, tipo: x.tipo, origen: x.origen, vehiculo: x.vehiculo, empresa: sitio, horario: bot.horario, ahora }));
    if (!a.ok) { await liberar(); await registrar(sb, false, "No se pudieron armar los valores de la plantilla."); return "error"; }

    const envio = { messaging_product: "whatsapp", recipient_type: "individual", to: tel, type: "template", template: { name: p.nombre, language: { code: p.idioma }, ...(a.componentes.length ? { components: a.componentes } : {}) } };
    const r = await graph(`/${encodeURIComponent(env("WA_PHONE_NUMBER_ID"))}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envio) });
    if (!r.ok) { await liberar(); await registrar(sb, false, r.error || "WhatsApp no aceptó el mensaje."); return "error"; }
    await registrar(sb, true);
    if (prueba) return "enviada";

    // Conversación y mensaje en el CRM: el ejecutivo ve que ya se le escribió, y si el cliente responde la conversación sigue su lead.
    const wamid = String((((r.data || {}).messages || [])[0] || {}).id || "") || null;
    let conv = (await sb.from("wa_conversaciones").select("*").eq("telefono", tel).maybeSingle()).data;
    if (!conv) {
      const ins = await sb.from("wa_conversaciones").insert({ telefono: tel, nombre_perfil: x.nombre ? String(x.nombre).slice(0, 80) : null, cliente_id: x.clienteId || null, lead_id: x.leadId || null, local_id: x.localId || null }).select().single();
      if (ins.error && ins.error.code !== "23505") throw ins.error;
      conv = ins.data || (await sb.from("wa_conversaciones").select("*").eq("telefono", tel).maybeSingle()).data;
    } else if (!conv.lead_id && x.leadId) {
      await sb.from("wa_conversaciones").update({ lead_id: x.leadId, cliente_id: conv.cliente_id || x.clienteId || null, local_id: conv.local_id || x.localId || null }).eq("id", conv.id);
    }
    if (conv) {
      await sb.from("wa_mensajes").insert({ conversacion_id: conv.id, wamid, direccion: "saliente", tipo: "template", texto: a.texto, plantilla: p.nombre, estado: "enviado", lead_id: x.leadId || conv.lead_id || null, usuario_id: "bienvenida", usuario_nombre: "Bienvenida automática" });
      await sb.from("wa_conversaciones").update({ ultimo_mensaje_en: ahoraIso(), ultimo_texto: a.texto.slice(0, 200), ultima_direccion: "saliente", actualizado_en: ahoraIso() }).eq("id", conv.id);
    }
    if (x.leadId) await sb.from("lead_eventos").insert({ lead_id: x.leadId, usuario_id: "sistema", usuario_nombre: "Bienvenida automática", tipo: "nota", detalle: `Se envió por WhatsApp el mensaje de bienvenida (plantilla «${p.nombre}»).` });
    await guardarKv(sb, claveBienvenidaDia(ahora), { n: (await enviadasHoy(sb, ahora)) + 1 });
    await d.audit({ tipo: "sistema", nombre: "Bienvenida automática" }, "whatsapp.bienvenida", "lead", x.leadId, { origen: x.origen, plantilla: p.nombre });
    return "enviada";
  } catch (e) {
    console.error("whatsapp bienvenida:", String((e as any)?.message ?? e));
    return "error";
  }
}

/**
 * El cliente pidió dejar de recibir mensajes: se anota (nunca más se le envía la bienvenida), se etiqueta la conversación como «No contactar»,
 * se le confirma y el asistente deja de responderle. Nunca lanza.
 */
export async function registrarBaja(d: DepsBienvenida, conv: any, telefono: string) {
  try {
    const { sb } = d;
    const tel = telefonoWa(telefono) || String(telefono);
    await guardarKv(sb, claveBajaTelefono(tel), { en: ahoraIso() });
    const c = (await sb.from("wa_conversaciones").select("etiquetas").eq("id", conv.id).maybeSingle()).data;
    const et: string[] = Array.isArray(c && c.etiquetas) ? c.etiquetas : [];
    await sb.from("wa_conversaciones").update({
      etiquetas: et.includes(ETIQUETA_BAJA) || et.length >= 5 ? et : [...et, ETIQUETA_BAJA],
      bot_estado: { paso: "listo", datos: {}, intentos: 0, derivado: true, baja: true }, bot_actualizado: ahoraIso(),
    }).eq("id", conv.id);
    const r = await graph(`/${encodeURIComponent(env("WA_PHONE_NUMBER_ID"))}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: conv.telefono, type: "text", text: { body: TEXTO_CONFIRMA_BAJA, preview_url: false } }) });
    if (r.ok) {
      await sb.from("wa_mensajes").insert({ conversacion_id: conv.id, wamid: String((((r.data || {}).messages || [])[0] || {}).id || "") || null, direccion: "saliente", tipo: "text", texto: TEXTO_CONFIRMA_BAJA, estado: "enviado", lead_id: conv.lead_id || null, usuario_id: "bot", usuario_nombre: "Asistente" });
      await sb.from("wa_conversaciones").update({ ultimo_mensaje_en: ahoraIso(), ultimo_texto: TEXTO_CONFIRMA_BAJA.slice(0, 200), ultima_direccion: "saliente", actualizado_en: ahoraIso() }).eq("id", conv.id);
    }
    if (conv.lead_id) await sb.from("lead_eventos").insert({ lead_id: conv.lead_id, usuario_id: "sistema", usuario_nombre: "Asistente", tipo: "nota", detalle: "El cliente pidió no recibir más mensajes automáticos por WhatsApp: no se le enviarán más bienvenidas y el asistente dejó de responderle." });
    await d.audit({ tipo: "sistema", nombre: "Asistente" }, "whatsapp.baja", "conversacion", conv.id, {});
  } catch (e) {
    console.error("whatsapp baja:", String((e as any)?.message ?? e));
  }
}
