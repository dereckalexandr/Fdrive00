// WhatsApp Business en el CRM (Cloud API de Meta, un número de la empresa).
//
// - webhookWhatsapp: recibe los avisos de Meta (mensajes de los clientes y estados de lo enviado). Verifica la firma con WA_APP_SECRET.
//   Un número que no está en el CRM crea su cliente y un lead de venta (fuente «WhatsApp») que se reparte con las reglas de siempre.
//   Un cliente conocido queda en su lead abierto más reciente (o el último que tuvo): lo atiende el ejecutivo de ese lead.
// - whatsappOp: lo que hacen las personas del CRM (bandeja, conversación, enviar texto, archivos o plantillas aprobadas).
//
// Secretos (supabase secrets set ...): WA_TOKEN (token permanente de usuario del sistema), WA_PHONE_NUMBER_ID, WA_WABA_ID,
// WA_APP_SECRET (firma de los avisos), WA_VERIFY_TOKEN (verificación del webhook). Opcional: WA_GRAPH_VERSION.
import {
  telefonoWa, mismoTelefono, nombreDesdePerfil, estadoSiguiente, parsearWebhook, ventanaAbierta, venceVentana, validarTextoWa,
  resumenMensaje, plantillasUsables, armarPlantilla, validarArchivoWa, telefonoVisible, FUENTE_WHATSAPP, MAX_BYTES_MEDIA,
  validarPlantillaNueva, plantillasParaAdmin,
} from "./whatsapp-core.js";
import { permisosEfectivos } from "./crm-core.js";
import { elegirAsignado, ETAPAS_CERRADAS } from "./ventas-core.js";
import { permisoDeTipo, grupoDeReparto } from "./compras-core.js";
import { enviarAviso, enSegundoPlano, correoActivo } from "./correo.ts";

const env = (k: string) => (globalThis as any).Deno.env.get(k) ?? "";
export const waConfigurado = () => !!(env("WA_TOKEN") && env("WA_PHONE_NUMBER_ID"));
const graphBase = () => `https://graph.facebook.com/${env("WA_GRAPH_VERSION") || "v24.0"}`;
const enc = new TextEncoder();
const SISTEMA = { tipo: "sistema", nombre: "WhatsApp" };

/** Llamada a la Graph API de Meta. Nunca lanza: devuelve ok, estado y los datos (o el mensaje de error de Meta). */
async function graph(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  try {
    const r = await fetch(path.startsWith("http") ? path : `${graphBase()}${path}`, {
      ...init, headers: { authorization: `Bearer ${env("WA_TOKEN")}`, ...(init.headers || {}) }, signal: AbortSignal.timeout(15000),
    });
    const txt = await r.text();
    let data: any = null;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = null; }
    if (!r.ok) {
      const e = data && data.error;
      return { ok: false, status: r.status, data, error: e ? `${e.error_user_msg || e.message || "Error de WhatsApp"} (${e.code ?? r.status})`.slice(0, 300) : `WhatsApp respondió ${r.status}` };
    }
    return { ok: true, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: `No se pudo contactar a WhatsApp: ${String((e as any)?.message ?? e).slice(0, 200)}` };
  }
}

function aBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function deBase64(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const claveMedia = (convId: string, msgId: string) => `wamedia::${convId}::${msgId}`;

async function hmacHex(secreto: string, datos: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(datos)))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function igualSeguro(a: string, b: string) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

/** Descarga de Meta el archivo de un mensaje entrante y lo guarda en kv_store (los enlaces de Meta duran poco). */
async function guardarMediaEntrante(sb: any, msg: any) {
  const media = msg.media || {};
  if (!media.id || media.guardado) return;
  const info = await graph(`/${encodeURIComponent(media.id)}`);
  if (!info.ok || !info.data || !info.data.url) { console.error("whatsapp media:", info.error); return; }
  const tam = Number(info.data.file_size) || 0;
  if (tam > MAX_BYTES_MEDIA) { await sb.from("wa_mensajes").update({ media: { ...media, tam, muy_grande: true } }).eq("id", msg.id); return; }
  try {
    const r = await fetch(info.data.url, { headers: { authorization: `Bearer ${env("WA_TOKEN")}` }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { console.error("whatsapp media: descarga", r.status); return; }
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > MAX_BYTES_MEDIA) { await sb.from("wa_mensajes").update({ media: { ...media, tam: bytes.length, muy_grande: true } }).eq("id", msg.id); return; }
    const mime = media.mime || info.data.mime_type || "application/octet-stream";
    const up = await sb.from("kv_store").upsert({ key: claveMedia(msg.conversacion_id, msg.id), value: `data:${mime};base64,${aBase64(bytes)}`, shared: false, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (up.error) { console.error("whatsapp media: guardar", up.error.message); return; }
    await sb.from("wa_mensajes").update({ media: { ...media, mime, tam: bytes.length, guardado: true } }).eq("id", msg.id);
  } catch (e) { console.error("whatsapp media:", String((e as any)?.message ?? e)); }
}

/** Local donde entran los leads nuevos de WhatsApp: el elegido por el Administrador, o el único/primer local activo. */
async function localWhatsapp(sb: any): Promise<string | null> {
  const cfg = await sb.from("kv_store").select("value").eq("key", "whatsapp::config").maybeSingle();
  let elegido = "";
  try { elegido = cfg.data && cfg.data.value ? String(JSON.parse(cfg.data.value).local_id || "") : ""; } catch { elegido = ""; }
  const lq = await sb.from("locales").select("id, activo, creado_en");
  const activos = (lq.data ?? []).filter((l: any) => l.activo !== false).sort((a: any, b: any) => String(a.creado_en || "").localeCompare(String(b.creado_en || "")));
  if (elegido && activos.some((l: any) => l.id === elegido)) return elegido;
  return activos.length ? activos[0].id : null;
}

/** Busca el cliente de un número (los teléfonos del CRM están escritos de muchas formas: se comparan normalizados). */
async function clientePorTelefono(sb: any, telefono: string) {
  const ultimos = telefono.slice(-4);
  const q = await sb.from("clientes").select("*").ilike("telefono", `%${ultimos}%`);
  if (q.error) return null;
  const hallados = (q.data ?? []).filter((c: any) => mismoTelefono(c.telefono, telefono));
  hallados.sort((a: any, b: any) => String(b.creado_en || "").localeCompare(String(a.creado_en || "")));
  return hallados[0] ?? null;
}

type DepsWebhook = { sb: any; audit: (actor: any, accion: string, entidad?: string, entidadId?: string, detalle?: Record<string, unknown>) => Promise<void>; rolePermOverrides: () => Promise<Record<string, string[]>> };

/** Crea el cliente y el lead de venta de un número nuevo y lo reparte entre los ejecutivos habilitados del local. */
async function crearLeadWhatsapp(d: DepsWebhook, conv: any, nombre: string, primerTexto: string) {
  const { sb } = d;
  const local = await localWhatsapp(sb);
  if (!local) return null;
  const ci = await sb.from("clientes").insert({ nombre: nombreDesdePerfil(nombre, conv.telefono), telefono: `+${conv.telefono}`, local_id: local, notas: "Llegó por WhatsApp" }).select().single();
  if (ci.error) { console.error("whatsapp cliente:", ci.error.message); return null; }
  const cliente = ci.data;
  const overrides = await d.rolePermOverrides();
  const uq = await sb.from("usuarios").select("id, nombre, roles, permisos_extra, activo, local_id, email").eq("local_id", local);
  const usuarios = uq.data ?? [];
  const elegibles = usuarios.filter((u: any) => u.activo && (() => { const p = permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra); return p.includes("leads.propios") && p.includes(permisoDeTipo("venta")); })()).map((u: any) => ({ id: u.id, nombre: u.nombre }));
  const ultimas: Record<string, string> = {};
  const grupo = grupoDeReparto("venta");
  const lastQ = await sb.from("leads").select("asignado_a, creado_en, tipo").eq("local_id", local);
  for (const l of lastQ.data ?? []) if (l.asignado_a && grupoDeReparto(l.tipo || "venta") === grupo && (!ultimas[l.asignado_a] || l.creado_en > ultimas[l.asignado_a])) ultimas[l.asignado_a] = l.creado_en;
  const asignado = elegirAsignado(elegibles, ultimas);
  const ins = await sb.from("leads").insert({
    local_id: local, tipo: "venta", etapa: "nuevo", cliente_id: cliente.id, fuente: FUENTE_WHATSAPP, asignado_a: asignado ? asignado.id : null,
    notas: [`Escribió por WhatsApp desde ${telefonoVisible(conv.telefono)}.`, primerTexto ? `Primer mensaje: «${primerTexto}»` : ""].filter(Boolean).join("\n").slice(0, 1000),
  }).select().single();
  if (ins.error) { console.error("whatsapp lead:", ins.error.message); return { cliente, lead: null, local }; }
  const lead = ins.data;
  await sb.from("lead_eventos").insert({ lead_id: lead.id, usuario_id: "sistema", usuario_nombre: "WhatsApp", tipo: "creado", detalle: `Lead creado por un mensaje de WhatsApp${asignado ? ` y asignado a ${asignado.nombre}` : " (sin ejecutivos habilitados: queda sin asignar)"}.` });
  await d.audit(SISTEMA, "whatsapp.lead", "lead", lead.id, { asignado: asignado ? asignado.nombre : null });
  // Aviso por correo al ejecutivo (o a los Jefes Local si nadie quedó asignado).
  if (correoActivo()) {
    const para = asignado
      ? usuarios.filter((u: any) => u.id === asignado.id && u.email).map((u: any) => u.email)
      : usuarios.filter((u: any) => u.activo && u.email && permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra).includes("leads.asignar")).map((u: any) => u.email);
    if (para.length) await enSegundoPlano(enviarAviso({ para, asunto: "Nuevo lead por WhatsApp", titulo: "Nuevo lead por WhatsApp", lineas: [`${cliente.nombre} (${telefonoVisible(conv.telefono)}) escribió por WhatsApp${asignado ? ` y se te asignó` : ", y no quedó asignado a nadie"}.`, primerTexto ? `Mensaje: «${primerTexto.slice(0, 200)}»` : "", "Respóndele desde el CRM (WhatsApp)."].filter(Boolean) }));
  }
  return { cliente, lead, local };
}

/** Asocia la conversación a su cliente y lead: el abierto más reciente; si no tiene, el último que tuvo; si el número es nuevo, crea ambos. */
async function vincular(d: DepsWebhook, conv: any, nombre: string, texto: string) {
  const { sb } = d;
  if (conv.lead_id) {
    const l = await sb.from("leads").select("id, etapa, cliente_id, local_id").eq("id", conv.lead_id).maybeSingle();
    if (l.data && !ETAPAS_CERRADAS.includes(l.data.etapa)) return conv;
  }
  const cliente = conv.cliente_id ? (await sb.from("clientes").select("*").eq("id", conv.cliente_id).maybeSingle()).data : await clientePorTelefono(sb, conv.telefono);
  let cambio: Record<string, unknown> | null = null;
  if (cliente) {
    const lq = await sb.from("leads").select("id, etapa, local_id, creado_en").eq("cliente_id", cliente.id);
    const leads = (lq.data ?? []).sort((a: any, b: any) => String(b.creado_en).localeCompare(String(a.creado_en)));
    const elegido = leads.find((l: any) => !ETAPAS_CERRADAS.includes(l.etapa)) || leads[0] || null;
    cambio = { cliente_id: cliente.id, lead_id: elegido ? elegido.id : null, local_id: (elegido && elegido.local_id) || cliente.local_id || null };
  } else {
    const r = await crearLeadWhatsapp(d, conv, nombre, texto);
    if (r) cambio = { cliente_id: r.cliente.id, lead_id: r.lead ? r.lead.id : null, local_id: r.local };
  }
  if (!cambio) return conv;
  const up = await sb.from("wa_conversaciones").update(cambio).eq("id", conv.id).select().single();
  return up.data || { ...conv, ...cambio };
}

/** Aviso de Meta (GET: verificación del webhook; POST: mensajes y estados). Responde 200 rápido; si la base falla, 500 para que Meta reintente. */
export async function webhookWhatsapp(req: Request, d: DepsWebhook): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const esperado = env("WA_VERIFY_TOKEN");
    const recibido = url.searchParams.get("hub.verify_token") ?? "";
    if (url.searchParams.get("hub.mode") === "subscribe" && esperado.length >= 12 && igualSeguro(recibido, esperado)) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const secreto = env("WA_APP_SECRET");
  if (!secreto) return new Response("not configured", { status: 503 });
  const crudo = await req.text();
  if (crudo.length > 2_000_000) return new Response("too large", { status: 413 });
  const firma = (req.headers.get("x-hub-signature-256") ?? "").replace(/^sha256=/, "");
  if (!firma || !igualSeguro(firma, await hmacHex(secreto, crudo))) return new Response("unauthorized", { status: 401 });
  let payload: any;
  try { payload = JSON.parse(crudo); } catch { return new Response("bad json", { status: 400 }); }
  const { sb } = d;
  const miNumero = env("WA_PHONE_NUMBER_ID");
  const { mensajes, estados } = parsearWebhook(payload);
  try {
    for (const m of mensajes) {
      if (miNumero && m.phoneNumberId && m.phoneNumberId !== miNumero) continue;
      if (!m.telefono) continue;
      // Conversación del número (una por número).
      let conv = (await sb.from("wa_conversaciones").select("*").eq("telefono", m.telefono).maybeSingle()).data;
      if (!conv) {
        const ins = await sb.from("wa_conversaciones").insert({ telefono: m.telefono, nombre_perfil: m.nombre || null }).select().single();
        if (ins.error && ins.error.code !== "23505") throw ins.error;
        conv = ins.data || (await sb.from("wa_conversaciones").select("*").eq("telefono", m.telefono).maybeSingle()).data;
      }
      // El mismo aviso puede llegar dos veces: el wamid es único.
      const dup = await sb.from("wa_mensajes").select("id").eq("wamid", m.wamid).maybeSingle();
      if (dup.data) continue;
      conv = await vincular(d, conv, m.nombre, m.texto);
      const msg = await sb.from("wa_mensajes").insert({
        conversacion_id: conv.id, wamid: m.wamid, direccion: "entrante", tipo: m.tipo, texto: m.texto || null, media: m.media, estado: "recibido",
        lead_id: conv.lead_id || null, wa_ts: m.ts,
      }).select().single();
      if (msg.error) { if (msg.error.code === "23505") continue; throw msg.error; }
      const ahora = new Date().toISOString();
      await sb.from("wa_conversaciones").update({
        no_leidos: (Number(conv.no_leidos) || 0) + 1, ultimo_mensaje_en: m.ts, ultimo_entrante_en: m.ts, ultimo_texto: resumenMensaje(m), ultima_direccion: "entrante",
        ...(m.nombre ? { nombre_perfil: m.nombre } : {}), actualizado_en: ahora,
      }).eq("id", conv.id);
      if (conv.lead_id) await sb.from("leads").update({ ultima_actividad: ahora }).eq("id", conv.lead_id);
      if (m.media) await enSegundoPlano(guardarMediaEntrante(sb, msg.data));
    }
    for (const s of estados) {
      if (miNumero && s.phoneNumberId && s.phoneNumberId !== miNumero) continue;
      const q = await sb.from("wa_mensajes").select("id, estado").eq("wamid", s.wamid).maybeSingle();
      if (!q.data) continue;
      const estado = estadoSiguiente(q.data.estado, s.estado);
      if (estado !== q.data.estado || s.error) await sb.from("wa_mensajes").update({ estado, ...(s.error ? { error: s.error } : {}) }).eq("id", q.data.id);
    }
  } catch (e) {
    console.error("whatsapp webhook:", String((e as any)?.message ?? e));
    return new Response("error", { status: 500 });
  }
  return new Response("ok", { status: 200 });
}

/* ================= Operaciones del CRM ================= */

export type HerramientasWa = {
  sb: any; json: (d: unknown, s?: number) => Response; err: (e: string, s?: number) => Response; fallo: (e: any) => Response;
  audit: (actor: any, accion: string, entidad?: string, entidadId?: string, detalle?: Record<string, unknown>) => Promise<void>;
  actor: any; userId: string; userName: string; esAdmin: boolean; esSupervisor: boolean; localId: string | null;
  puedeVer: (lead: any) => boolean; puedeTocar: (lead: any) => boolean; enLotes: (t: string, c: string, ids: string[]) => Promise<any[]>;
  evento: (leadId: string, tipo: string, detalle: string) => Promise<void>; usaLeads: boolean;
};

let cachePlantillas: { at: number; lista: any[] } | null = null;
async function plantillas(forzar = false): Promise<{ ok: boolean; lista: any[]; error?: string }> {
  if (!forzar && cachePlantillas && Date.now() - cachePlantillas.at < 5 * 60_000) return { ok: true, lista: cachePlantillas.lista };
  if (!env("WA_WABA_ID")) return { ok: false, lista: [], error: "Falta WA_WABA_ID" };
  const r = await graph(`/${encodeURIComponent(env("WA_WABA_ID"))}/message_templates?fields=name,language,status,category,components&limit=200`);
  if (!r.ok) return { ok: false, lista: [], error: r.error };
  const lista = plantillasUsables((r.data && r.data.data) || []);
  cachePlantillas = { at: Date.now(), lista };
  return { ok: true, lista };
}

export async function whatsappOp(h: HerramientasWa, op: string, body: any): Promise<Response> {
  const { sb, json, err, fallo } = h;
  if (!h.usaLeads && !h.esAdmin) return err("forbidden", 403);

  /** Conversaciones que esta persona ve: el Administrador todas (del local elegido); el Jefe Local las del local; el ejecutivo las de sus leads. */
  async function visibles(): Promise<any[]> {
    if (h.esAdmin || h.esSupervisor) {
      let q = sb.from("wa_conversaciones").select("*");
      if (h.localId) q = q.eq("local_id", h.localId);
      const r = await q;
      if (r.error) throw r.error;
      return r.data ?? [];
    }
    const mis = await sb.from("leads").select("id").eq("asignado_a", h.userId);
    if (mis.error) throw mis.error;
    return await h.enLotes("wa_conversaciones", "lead_id", (mis.data ?? []).map((l: any) => l.id));
  }
  async function leadDe(conv: any) {
    if (!conv || !conv.lead_id) return null;
    return (await sb.from("leads").select("*").eq("id", conv.lead_id).maybeSingle()).data;
  }
  /** ¿Puede ver o escribir en esta conversación? */
  async function acceso(conv: any): Promise<{ ver: boolean; escribir: boolean; lead: any }> {
    if (!conv) return { ver: false, escribir: false, lead: null };
    const lead = await leadDe(conv);
    if (h.esAdmin) return { ver: true, escribir: true, lead };
    if (h.esSupervisor) { const mismo = !!conv.local_id && conv.local_id === h.localId; return { ver: mismo, escribir: mismo, lead }; }
    if (!lead || (h.localId && lead.local_id !== h.localId)) return { ver: false, escribir: false, lead };
    return { ver: h.puedeVer(lead), escribir: h.puedeTocar(lead), lead };
  }
  /** Conversación de un lead: la ligada al lead o la del teléfono de su cliente (se crea si aún no existe). */
  async function convDeLead(leadId: string, crear: boolean): Promise<{ conv: any; lead: any; telefono: string | null; error?: string }> {
    const lq = await sb.from("leads").select("*").eq("id", leadId).maybeSingle();
    const lead = lq.data;
    if (!lead || (h.localId && lead.local_id !== h.localId && !h.esAdmin) || !h.puedeVer(lead)) return { conv: null, lead: null, telefono: null, error: "no_existe" };
    const cliente = lead.cliente_id ? (await sb.from("clientes").select("*").eq("id", lead.cliente_id).maybeSingle()).data : null;
    const telefono = cliente ? telefonoWa(cliente.telefono) : null;
    let conv = ((await sb.from("wa_conversaciones").select("*").eq("lead_id", lead.id).limit(1)).data ?? [])[0] ?? null;
    if (!conv && telefono) conv = (await sb.from("wa_conversaciones").select("*").eq("telefono", telefono).maybeSingle()).data;
    if (!conv && crear && telefono) {
      const ins = await sb.from("wa_conversaciones").insert({ telefono, cliente_id: cliente.id, lead_id: lead.id, local_id: lead.local_id }).select().single();
      if (ins.error && ins.error.code !== "23505") throw ins.error;
      conv = ins.data || (await sb.from("wa_conversaciones").select("*").eq("telefono", telefono).maybeSingle()).data;
    }
    // Si el cliente escribe por un lead nuevo, la conversación pasa a ese lead (lo atiende su ejecutivo).
    if (conv && crear && conv.lead_id !== lead.id && !ETAPAS_CERRADAS.includes(lead.etapa)) {
      const up = await sb.from("wa_conversaciones").update({ lead_id: lead.id, cliente_id: lead.cliente_id, local_id: lead.local_id }).eq("id", conv.id).select().single();
      if (up.data) conv = up.data;
    }
    return { conv, lead, telefono };
  }
  /** Lo que la pantalla muestra de una conversación. */
  async function detalle(conv: any, lead: any, escribir: boolean) {
    const mq = await sb.from("wa_mensajes").select("*").eq("conversacion_id", conv.id).order("creado_en", { ascending: false }).limit(200);
    if (mq.error) throw mq.error;
    const mensajes = (mq.data ?? []).reverse();
    const cliente = conv.cliente_id ? (await sb.from("clientes").select("id, nombre, telefono").eq("id", conv.cliente_id).maybeSingle()).data : null;
    const asignado = lead && lead.asignado_a ? (await sb.from("usuarios").select("id, nombre").eq("id", lead.asignado_a).maybeSingle()).data : null;
    return {
      conversacion: { ...conv, telefono_visible: telefonoVisible(conv.telefono) }, mensajes, cliente,
      lead: lead ? { id: lead.id, etapa: lead.etapa, tipo: lead.tipo, asignado: asignado ? asignado.nombre : null } : null,
      ventanaAbierta: ventanaAbierta(conv.ultimo_entrante_en), venceVentana: venceVentana(conv.ultimo_entrante_en),
      puedeEscribir: escribir && waConfigurado(), configurado: waConfigurado(),
    };
  }

  if (op === "wa.estado") {
    const out: Record<string, unknown> = { configurado: waConfigurado(), plantillas: !!env("WA_WABA_ID"), puedeConfigurar: h.esAdmin };
    if (h.esAdmin) {
      const cfg = await sb.from("kv_store").select("value").eq("key", "whatsapp::config").maybeSingle();
      let c: any = {};
      try { c = cfg.data && cfg.data.value ? JSON.parse(cfg.data.value) : {}; } catch { c = {}; }
      out.localLeads = c.local_id || null;
      out.localEfectivo = await localWhatsapp(sb);
      out.secretos = { WA_TOKEN: !!env("WA_TOKEN"), WA_PHONE_NUMBER_ID: !!env("WA_PHONE_NUMBER_ID"), WA_WABA_ID: !!env("WA_WABA_ID"), WA_APP_SECRET: !!env("WA_APP_SECRET"), WA_VERIFY_TOKEN: env("WA_VERIFY_TOKEN").length >= 12 };
    }
    return json(out);
  }
  if (op === "wa.config_save") {
    if (!h.esAdmin) return err("forbidden", 403);
    const local = String(body.localId ?? "");
    if (local) { const l = await sb.from("locales").select("id").eq("id", local).maybeSingle(); if (!l.data) return err("local_invalido"); }
    const up = await sb.from("kv_store").upsert({ key: "whatsapp::config", value: JSON.stringify({ local_id: local || null }), shared: false, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (up.error) return fallo(up.error);
    await h.audit(h.actor, "whatsapp.config", "whatsapp", "config", { local_id: local || null });
    return json({ ok: true });
  }

  if (op === "wa.resumen") {
    const convs = await visibles();
    return json({ noLeidos: convs.reduce((s: number, c: any) => s + (Number(c.no_leidos) || 0), 0), conversaciones: convs.filter((c: any) => Number(c.no_leidos) > 0).length });
  }

  if (op === "wa.list") {
    const convs = (await visibles()).sort((a: any, b: any) => String(b.ultimo_mensaje_en || b.creado_en || "").localeCompare(String(a.ultimo_mensaje_en || a.creado_en || ""))).slice(0, 300);
    const [clientes, leads] = await Promise.all([h.enLotes("clientes", "id", convs.map((c: any) => c.cliente_id)), h.enLotes("leads", "id", convs.map((c: any) => c.lead_id))]);
    const usuarios = await h.enLotes("usuarios", "id", leads.map((l: any) => l.asignado_a));
    const cli = new Map(clientes.map((c: any) => [c.id, c]));
    const lea = new Map(leads.map((l: any) => [l.id, l]));
    const usu = new Map(usuarios.map((u: any) => [u.id, u]));
    return json({
      configurado: waConfigurado(),
      // El Administrador y el Jefe Local crean y borran las plantillas de WhatsApp desde la bandeja.
      puedePlantillas: (h.esAdmin || h.esSupervisor) && !!env("WA_WABA_ID"),
      conversaciones: convs.map((c: any) => {
        const l: any = lea.get(c.lead_id);
        const cl: any = cli.get(c.cliente_id);
        const u: any = l ? usu.get(l.asignado_a) : null;
        return {
          id: c.id, telefono: c.telefono, telefono_visible: telefonoVisible(c.telefono), nombre: (cl && cl.nombre) || c.nombre_perfil || telefonoVisible(c.telefono),
          no_leidos: Number(c.no_leidos) || 0, ultimo_mensaje_en: c.ultimo_mensaje_en, ultimo_texto: c.ultimo_texto, ultima_direccion: c.ultima_direccion,
          ventanaAbierta: ventanaAbierta(c.ultimo_entrante_en), lead_id: c.lead_id, etapa: l ? l.etapa : null, tipo: l ? l.tipo : null, asignado: u ? u.nombre : null,
        };
      }),
    });
  }

  if (op === "wa.conversacion") {
    let conv: any = null; let lead: any = null; let escribir = false;
    if (body.leadId) {
      const r = await convDeLead(String(body.leadId), false);
      if (r.error) return err(r.error, 404);
      lead = r.lead;
      escribir = h.puedeTocar(lead);
      if (!r.conv) return json({ conversacion: null, mensajes: [], telefono: r.telefono, telefono_visible: r.telefono ? telefonoVisible(r.telefono) : "", ventanaAbierta: false, puedeEscribir: escribir && !!r.telefono && waConfigurado(), configurado: waConfigurado(), sinTelefono: !r.telefono });
      conv = r.conv;
      const a = await acceso(conv);
      if (a.lead && a.lead.id !== lead.id) { /* la conversación sigue a otro lead del cliente: se muestra igual (es el mismo número) */ }
    } else {
      conv = (await sb.from("wa_conversaciones").select("*").eq("id", String(body.id ?? "")).maybeSingle()).data;
      const a = await acceso(conv);
      if (!a.ver) return err("no_existe", 404);
      lead = a.lead; escribir = a.escribir;
    }
    return json(await detalle(conv, lead, escribir));
  }

  if (op === "wa.leer") {
    const conv = (await sb.from("wa_conversaciones").select("*").eq("id", String(body.id ?? "")).maybeSingle()).data;
    const a = await acceso(conv);
    if (!a.ver) return err("no_existe", 404);
    if (Number(conv.no_leidos) > 0) {
      await sb.from("wa_conversaciones").update({ no_leidos: 0 }).eq("id", conv.id);
      // Marca de leído en el teléfono del cliente (los dos tics azules): solo si quien lee es quien atiende.
      if (a.escribir && waConfigurado()) {
        const ult = await sb.from("wa_mensajes").select("wamid, direccion, creado_en").eq("conversacion_id", conv.id).eq("direccion", "entrante").order("creado_en", { ascending: false }).limit(1);
        const w = (ult.data ?? [])[0];
        if (w && w.wamid) await graph(`/${encodeURIComponent(env("WA_PHONE_NUMBER_ID"))}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: w.wamid }) });
      }
    }
    return json({ ok: true });
  }

  if (op === "wa.plantillas") {
    const r = await plantillas(!!body.recargar);
    if (!r.ok) return json({ plantillas: [], error: r.error });
    return json({ plantillas: r.lista });
  }

  /* ---- Plantillas: el Administrador y el Jefe Local las crean y borran desde el CRM; Meta las revisa y aprueba. ---- */
  if (op === "wa.plantillas_admin" || op === "wa.plantilla_crear" || op === "wa.plantilla_borrar") {
    if (!h.esAdmin && !h.esSupervisor) return err("forbidden", 403);
    if (!waConfigurado() || !env("WA_WABA_ID")) return err("whatsapp_no_configurado", 503);
    const waba = encodeURIComponent(env("WA_WABA_ID"));
    if (op === "wa.plantillas_admin") {
      const r = await graph(`/${waba}/message_templates?fields=id,name,language,status,category,components,rejected_reason&limit=200`);
      if (!r.ok) return json({ error: "whatsapp_error", detalle: r.error }, 502);
      return json({ plantillas: plantillasParaAdmin((r.data && r.data.data) || []) });
    }
    if (op === "wa.plantilla_crear") {
      const v = validarPlantillaNueva(body.plantilla);
      if (!v.ok) return err(v.error!);
      const r = await graph(`/${waba}/message_templates`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v.value) });
      if (!r.ok) return json({ error: "whatsapp_error", detalle: r.error }, 502);
      cachePlantillas = null;
      await h.audit(h.actor, "whatsapp.plantilla_crear", "whatsapp", String((r.data && r.data.id) || v.value.name), { nombre: v.value.name, categoria: v.value.category });
      return json({ plantilla: { id: String((r.data && r.data.id) || ""), nombre: v.value.name, estado: String((r.data && r.data.status) || "PENDING"), categoria: String((r.data && r.data.category) || v.value.category) } });
    }
    // Borrar: por nombre (borra todas sus versiones de idioma). Meta no deja reutilizar el nombre por 30 días.
    const nombre = String(body.nombre ?? "").trim();
    if (!/^[a-z0-9_]{3,512}$/.test(nombre)) return err("plantilla_nombre");
    const r = await graph(`/${waba}/message_templates?name=${encodeURIComponent(nombre)}`, { method: "DELETE" });
    if (!r.ok) return json({ error: "whatsapp_error", detalle: r.error }, 502);
    cachePlantillas = null;
    await h.audit(h.actor, "whatsapp.plantilla_borrar", "whatsapp", nombre, { nombre });
    return json({ ok: true });
  }

  if (op === "wa.media") {
    const m = (await sb.from("wa_mensajes").select("*").eq("id", String(body.mensajeId ?? "")).maybeSingle()).data;
    if (!m) return err("no_existe", 404);
    const conv = (await sb.from("wa_conversaciones").select("*").eq("id", m.conversacion_id).maybeSingle()).data;
    const a = await acceso(conv);
    if (!a.ver) return err("no_existe", 404);
    if (m.media && m.media.muy_grande) return err("archivo_muy_grande");
    let g = await sb.from("kv_store").select("value").eq("key", claveMedia(conv.id, m.id)).maybeSingle();
    if (!(g.data && g.data.value) && m.direccion === "entrante" && m.media && m.media.id && waConfigurado()) {
      await guardarMediaEntrante(sb, { ...m, media: { ...m.media, guardado: false } });
      g = await sb.from("kv_store").select("value").eq("key", claveMedia(conv.id, m.id)).maybeSingle();
    }
    if (!(g.data && g.data.value)) return err("sin_archivo", 404);
    return json({ dataUrl: g.data.value, nombre: (m.media && m.media.nombre) || "", mime: (m.media && m.media.mime) || "" });
  }

  if (op === "wa.enviar") {
    if (!waConfigurado()) return err("whatsapp_no_configurado", 503);
    let conv: any = null; let lead: any = null; let escribir = false;
    if (body.leadId) {
      const r = await convDeLead(String(body.leadId), true);
      if (r.error) return err(r.error, 404);
      if (!r.telefono && !r.conv) return err("cliente_sin_telefono");
      conv = r.conv; lead = r.lead; escribir = h.puedeTocar(lead);
    } else {
      conv = (await sb.from("wa_conversaciones").select("*").eq("id", String(body.id ?? "")).maybeSingle()).data;
      const a = await acceso(conv);
      if (!a.ver) return err("no_existe", 404);
      lead = a.lead; escribir = a.escribir;
    }
    if (!escribir) return err("forbidden", 403);

    const destino = conv.telefono;
    const envio: any = { messaging_product: "whatsapp", recipient_type: "individual", to: destino };
    const fila: any = { conversacion_id: conv.id, direccion: "saliente", estado: "enviado", lead_id: lead ? lead.id : conv.lead_id || null, usuario_id: h.userId, usuario_nombre: h.userName };
    let archivoGuardar: string | null = null;

    if (body.plantilla) {
      const r = await plantillas();
      if (!r.ok) return json({ error: "plantillas_no_disponibles", detalle: r.error }, 502);
      const p = r.lista.find((x: any) => x.nombre === String(body.plantilla.nombre ?? "") && x.idioma === String(body.plantilla.idioma ?? ""));
      if (!p) return err("plantilla_invalida");
      const a = armarPlantilla(p, body.plantilla.valores);
      if (!a.ok) return err(a.error!);
      envio.type = "template";
      envio.template = { name: p.nombre, language: { code: p.idioma }, ...(a.componentes.length ? { components: a.componentes } : {}) };
      Object.assign(fila, { tipo: "template", texto: a.texto, plantilla: p.nombre });
    } else {
      // Fuera de las 24 horas desde el último mensaje del cliente, WhatsApp solo deja enviar plantillas aprobadas.
      if (!ventanaAbierta(conv.ultimo_entrante_en)) return err("fuera_de_ventana");
      if (body.archivo) {
        const v = validarArchivoWa(body.archivo);
        if (!v.ok) return err(v.error!);
        const caption = body.texto ? String(body.texto).trim().slice(0, 1024) : "";
        const form = new FormData();
        form.append("messaging_product", "whatsapp");
        form.append("type", v.value.mime);
        form.append("file", new Blob([deBase64(v.value.base64)], { type: v.value.mime }), v.value.nombre);
        const up = await graph(`/${encodeURIComponent(env("WA_PHONE_NUMBER_ID"))}/media`, { method: "POST", body: form });
        if (!up.ok || !up.data || !up.data.id) return json({ error: "whatsapp_error", detalle: up.error || "No se pudo subir el archivo" }, 502);
        envio.type = v.value.tipo;
        envio[v.value.tipo] = v.value.tipo === "document" ? { id: up.data.id, filename: v.value.nombre, ...(caption ? { caption } : {}) } : { id: up.data.id, ...(caption ? { caption } : {}) };
        Object.assign(fila, { tipo: v.value.tipo, texto: caption || null, media: { id: String(up.data.id), mime: v.value.mime, nombre: v.value.nombre, tam: v.value.bytes, guardado: true } });
        archivoGuardar = String(body.archivo.dataUrl);
      } else {
        const t = validarTextoWa(body.texto);
        if (!t.ok) return err(t.error!);
        envio.type = "text";
        envio.text = { body: t.value, preview_url: false };
        Object.assign(fila, { tipo: "text", texto: t.value });
      }
    }

    const r = await graph(`/${encodeURIComponent(env("WA_PHONE_NUMBER_ID"))}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envio) });
    if (!r.ok) {
      await h.audit(h.actor, "whatsapp.fallo", "whatsapp", conv.id, { error: r.error });
      return json({ error: "whatsapp_error", detalle: r.error }, 502);
    }
    fila.wamid = String((((r.data || {}).messages || [])[0] || {}).id || "") || null;
    const ins = await sb.from("wa_mensajes").insert(fila).select().single();
    if (ins.error) return fallo(ins.error);
    if (archivoGuardar) await sb.from("kv_store").upsert({ key: claveMedia(conv.id, ins.data.id), value: archivoGuardar, shared: false, updated_at: new Date().toISOString() }, { onConflict: "key" });
    const ahora = new Date().toISOString();
    await sb.from("wa_conversaciones").update({ ultimo_mensaje_en: ahora, ultimo_texto: resumenMensaje(fila), ultima_direccion: "saliente", no_leidos: 0, actualizado_en: ahora }).eq("id", conv.id);
    // Escribirle al cliente cuenta como contacto: el lead nuevo pasa a «Contactado».
    if (lead && !ETAPAS_CERRADAS.includes(lead.etapa)) {
      const patch: Record<string, unknown> = { ultimo_contacto: ahora, ultima_actividad: ahora, actualizado_en: ahora };
      if (lead.etapa === "nuevo") patch.etapa = "contactado";
      await sb.from("leads").update(patch).eq("id", lead.id);
      if (lead.etapa === "nuevo") { await h.evento(lead.id, "whatsapp", "Primer contacto por WhatsApp desde el CRM"); await h.evento(lead.id, "etapa", "Nuevo → Contactado (primer contacto)"); }
    }
    return json({ mensaje: ins.data });
  }

  return err("unknown_op");
}
