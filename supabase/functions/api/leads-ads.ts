// Leads de anuncios: las personas que llenan un formulario de Meta (Facebook e Instagram) o de Google Ads entran solas al CRM como lead
// de venta, con su campaña (si está vinculada en Marketing), repartidos entre los ejecutivos del local y con aviso por correo.
//
// - Meta: el aviso llega por la misma dirección que los de WhatsApp (?whatsapp=1, objeto «page», campo «leadgen») y la misma firma
//   (WA_APP_SECRET). El aviso solo trae el número del formulario: el CRM lee sus datos de la Graph API (permiso leads_retrieval).
//   Token: META_LEADS_TOKEN (o META_ADS_TOKEN, o WA_TOKEN), de un usuario del sistema con acceso a la página y permiso leads_retrieval.
// - Google: llega a ?googleleads=1 con el aviso completo del formulario. Se valida con la clave que se escribe en el formulario de Google
//   (GOOGLE_ADS_LEAD_KEY, mínimo 12 caracteres).
// Si un lead no se puede guardar (token sin permiso, base caída…), queda registrado para reintentarlo desde Marketing: no se pierde.
import {
  parsearAvisoMeta, datosDeLeadMeta, datosDeLeadGoogle, tieneContacto, nombreCliente, notasDeLead, claveLeadExterno, claveFalloLead, FUENTE_META, FUENTE_GOOGLE,
} from "./leads-ads-core.js";
import { elegirEjecutivo, clientePorTelefono, localWhatsapp, type DepsWebhook } from "./whatsapp.ts";
import { permisosEfectivos } from "./crm-core.js";
import { ETAPAS_CERRADAS } from "./ventas-core.js";
import { enviarAviso, enSegundoPlano, correoActivo } from "./correo.ts";

const env = (k: string) => (globalThis as any).Deno.env.get(k) ?? "";
const SISTEMA = (plataforma: string) => ({ tipo: "sistema", nombre: plataforma === "meta" ? "Meta Ads" : "Google Ads" });
const nombrePlataforma = (p: string) => (p === "meta" ? "Meta (Facebook e Instagram)" : "Google Ads");
const tokenLeads = () => env("META_LEADS_TOKEN") || env("META_ADS_TOKEN") || env("WA_TOKEN");
export const leadsMetaConfigurado = () => !!(tokenLeads() && env("WA_APP_SECRET"));
export const leadsGoogleConfigurado = () => env("GOOGLE_ADS_LEAD_KEY").length >= 12;

function igualSeguro(a: string, b: string) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

/** Lee de Meta los datos de un formulario respondido. Lanza con un mensaje claro si no se puede. */
async function leerLeadMeta(leadgenId: string): Promise<any> {
  const u = `https://graph.facebook.com/${env("WA_GRAPH_VERSION") || "v24.0"}/${encodeURIComponent(leadgenId)}?fields=${encodeURIComponent("field_data,created_time,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,is_organic")}`;
  const r = await fetch(u, { headers: { authorization: `Bearer ${tokenLeads()}` }, signal: AbortSignal.timeout(15000) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) { const e = d && d.error; throw new Error(`${(e && (e.error_user_msg || e.message)) || `Meta respondió ${r.status}`} (${(e && e.code) ?? r.status})`.slice(0, 300)); }
  return { ...d, id: d.id || leadgenId };
}

/**
 * Crea (o reutiliza) el cliente y el lead de un formulario ya leído. Devuelve { lead, nuevo }. Lanza si falla algo (el que llama lo registra).
 * Si la persona ya tiene un lead abierto, no se crea otro: se anota que volvió a pedir información y se avisa al ejecutivo.
 */
async function guardarLead(d: DepsWebhook, x: any): Promise<{ lead: any; nuevo: boolean; duplicado?: boolean }> {
  const { sb } = d;
  const clave = claveLeadExterno(x.plataforma, x.id);
  // Marca de «ya procesado»: la clave es única, así que dos avisos simultáneos no crean dos leads.
  const marca = await sb.from("kv_store").insert({ key: clave, value: JSON.stringify({ en: new Date().toISOString() }), shared: false, updated_at: new Date().toISOString() });
  if (marca.error) { if (marca.error.code === "23505") return { lead: null, nuevo: false, duplicado: true }; throw marca.error; }
  try {
    const cq = await sb.from("campanias").select("id, nombre, local_id, plataforma, externo_id");
    const camp = x.campaniaExternaId ? (cq.data ?? []).find((c: any) => c.plataforma === x.plataforma && c.externo_id === x.campaniaExternaId) : null;
    const local = (camp && camp.local_id) || (await localWhatsapp(sb));
    if (!local) throw new Error("No hay un local activo donde recibir el lead.");
    const plataforma = nombrePlataforma(x.plataforma);

    let cliente = x.telefono ? await clientePorTelefono(sb, x.telefono.replace(/\D/g, "")) : null;
    if (!cliente && x.email) { const q = await sb.from("clientes").select("*").ilike("email", x.email); cliente = (q.data ?? [])[0] || null; }
    if (cliente) {
      const parche: Record<string, unknown> = {};
      if (!cliente.email && x.email) parche.email = x.email;
      if (!cliente.telefono && x.telefono) parche.telefono = x.telefono;
      if (Object.keys(parche).length) await sb.from("clientes").update(parche).eq("id", cliente.id);
    } else {
      const ci = await sb.from("clientes").insert({ nombre: nombreCliente(x), telefono: x.telefono, email: x.email, local_id: local, notas: `Llegó por un formulario de ${plataforma}` }).select().single();
      if (ci.error) throw ci.error;
      cliente = ci.data;
    }

    const { asignado, usuarios, overrides } = await elegirEjecutivo(d, local);
    const ahora = new Date().toISOString();
    const abiertos = ((await sb.from("leads").select("id, etapa, asignado_a, creado_en").eq("cliente_id", cliente.id)).data ?? []).filter((l: any) => !ETAPAS_CERRADAS.includes(l.etapa));
    let lead: any; let nuevo = true;
    if (abiertos.length) {
      lead = abiertos.sort((a: any, b: any) => String(b.creado_en).localeCompare(String(a.creado_en)))[0];
      nuevo = false;
      await sb.from("lead_eventos").insert({ lead_id: lead.id, usuario_id: "sistema", usuario_nombre: SISTEMA(x.plataforma).nombre, tipo: "nota", detalle: `Volvió a pedir información por un formulario de ${plataforma}.\n${notasDeLead(x, plataforma)}`.slice(0, 1200) });
      await sb.from("leads").update({ ultima_actividad: ahora }).eq("id", lead.id);
    } else {
      const ins = await sb.from("leads").insert({
        local_id: local, tipo: "venta", etapa: "nuevo", cliente_id: cliente.id, fuente: x.plataforma === "meta" ? FUENTE_META : FUENTE_GOOGLE,
        campania_id: camp ? camp.id : null, asignado_a: asignado ? asignado.id : null, notas: notasDeLead(x, plataforma),
      }).select().single();
      if (ins.error) throw ins.error;
      lead = ins.data;
      await sb.from("lead_eventos").insert({ lead_id: lead.id, usuario_id: "sistema", usuario_nombre: SISTEMA(x.plataforma).nombre, tipo: "creado", detalle: `Lead creado por un formulario de ${plataforma}${camp ? ` (campaña ${camp.nombre})` : ""}${asignado ? ` y asignado a ${asignado.nombre}` : " (sin ejecutivos habilitados: queda sin asignar)"}.` });
    }
    await d.audit(SISTEMA(x.plataforma), nuevo ? "ads.lead" : "ads.lead_repetido", "lead", lead.id, { plataforma: x.plataforma, campania: camp ? camp.nombre : x.campaniaNombre || null, asignado: asignado ? asignado.nombre : null });

    // Aviso por correo al ejecutivo del lead (o a los Jefes Local si nadie quedó asignado).
    if (correoActivo()) {
      const dueno = nuevo ? (asignado ? asignado.id : null) : lead.asignado_a;
      const para = dueno
        ? usuarios.filter((u: any) => u.id === dueno && u.email).map((u: any) => u.email)
        : usuarios.filter((u: any) => u.activo && u.email && permisosEfectivos(u.roles ?? [], overrides, u.permisos_extra).includes("leads.asignar")).map((u: any) => u.email);
      if (para.length) {
        const titulo = nuevo ? `Nuevo lead de ${nombrePlataforma(x.plataforma).split(" ")[0]}` : "Un cliente volvió a pedir información";
        await enSegundoPlano(enviarAviso({ para, asunto: titulo, titulo, lineas: [`${cliente.nombre}${x.telefono ? ` · ${x.telefono}` : ""}${x.email ? ` · ${x.email}` : ""}`, camp ? `Campaña: ${camp.nombre}` : x.campaniaNombre ? `Campaña: ${x.campaniaNombre}` : "", ...(x.extras || []).slice(0, 4).map((e: any) => `${e.pregunta}: ${e.respuesta}`), "Contáctalo cuanto antes desde el CRM: los leads de anuncios se enfrían rápido."].filter(Boolean) }));
      }
    }
    return { lead, nuevo };
  } catch (e) {
    await sb.from("kv_store").delete().eq("key", clave); // sin la marca, el reintento puede procesarlo
    throw e;
  }
}

/** Anota un lead que no se pudo guardar, con lo necesario para reintentarlo (el de Google guarda el aviso completo). */
async function registrarFallo(sb: any, plataforma: string, id: string, error: unknown, aviso?: unknown) {
  const previo = (await sb.from("kv_store").select("value").eq("key", claveFalloLead(plataforma, id)).maybeSingle()).data;
  let intentos = 1;
  try { intentos = previo && previo.value ? (JSON.parse(previo.value).intentos || 0) + 1 : 1; } catch { intentos = 1; }
  const reg = { plataforma, id, error: String((error as any)?.message ?? error).slice(0, 300), en: new Date().toISOString(), intentos, ...(aviso ? { aviso } : {}) };
  await sb.from("kv_store").upsert({ key: claveFalloLead(plataforma, id), value: JSON.stringify(reg), shared: false, updated_at: reg.en }, { onConflict: "key" });
}
const quitarFallo = (sb: any, plataforma: string, id: string) => sb.from("kv_store").delete().eq("key", claveFalloLead(plataforma, id));

/** Procesa un formulario de Meta: lo lee de Meta y lo guarda. Nunca lanza: si falla, lo deja registrado para reintentar. */
async function procesarMeta(d: DepsWebhook, leadgenId: string): Promise<{ ok: boolean; error?: string; nuevo?: boolean }> {
  try {
    const g = await leerLeadMeta(leadgenId);
    const x = datosDeLeadMeta(g);
    x.id = leadgenId;
    if (!tieneContacto(x)) { await quitarFallo(d.sb, "meta", leadgenId); return { ok: false, error: "El formulario no trae teléfono ni correo." }; }
    const r = await guardarLead(d, x);
    await quitarFallo(d.sb, "meta", leadgenId);
    return { ok: true, nuevo: r.nuevo };
  } catch (e) {
    await registrarFallo(d.sb, "meta", leadgenId, e);
    console.error("lead meta:", leadgenId, String((e as any)?.message ?? e));
    return { ok: false, error: String((e as any)?.message ?? e).slice(0, 300) };
  }
}

/** Avisos de la página de Facebook (por el webhook de WhatsApp, ya con la firma verificada). Siempre responde 200: Meta desactiva los avisos que fallan seguido. */
export async function avisoPaginaMeta(d: DepsWebhook, payload: any): Promise<Response> {
  for (const f of parsearAvisoMeta(payload)) await procesarMeta(d, f.leadgenId);
  return new Response("ok", { status: 200 });
}

/** Aviso de un formulario de Google Ads (POST ?googleleads=1). Se valida con la clave del formulario. */
export async function webhookLeadsGoogle(req: Request, d: DepsWebhook): Promise<Response> {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if (!leadsGoogleConfigurado()) return new Response("not configured", { status: 503 });
  const crudo = await req.text();
  if (crudo.length > 200_000) return new Response("too large", { status: 413 });
  let b: any;
  try { b = JSON.parse(crudo); } catch { return new Response("bad json", { status: 400 }); }
  if (!igualSeguro(String(b && b.google_key || ""), env("GOOGLE_ADS_LEAD_KEY"))) return new Response("unauthorized", { status: 401 });
  const x = datosDeLeadGoogle(b);
  if (!x.id) return new Response("bad lead", { status: 400 });
  if (x.prueba) return new Response(JSON.stringify({ ok: true, prueba: true }), { status: 200, headers: { "content-type": "application/json" } }); // «Enviar datos de prueba» de Google: no es un cliente
  try {
    if (!tieneContacto(x)) return new Response(JSON.stringify({ ok: true, sin_contacto: true }), { status: 200, headers: { "content-type": "application/json" } });
    const r = await guardarLead(d, x);
    await quitarFallo(d.sb, "google", x.id);
    return new Response(JSON.stringify({ ok: true, duplicado: !!r.duplicado }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    await registrarFallo(d.sb, "google", x.id, e, b);
    console.error("lead google:", x.id, String((e as any)?.message ?? e));
    return new Response(JSON.stringify({ ok: false }), { status: 200, headers: { "content-type": "application/json" } });
  }
}

/** Reintenta un lead que falló (desde Marketing). */
export async function reintentarLead(d: DepsWebhook, plataforma: string, id: string): Promise<{ ok: boolean; error?: string }> {
  if (plataforma === "meta") return await procesarMeta(d, id);
  const reg = (await d.sb.from("kv_store").select("value").eq("key", claveFalloLead("google", id)).maybeSingle()).data;
  let aviso: any = null;
  try { aviso = reg && reg.value ? JSON.parse(reg.value).aviso : null; } catch { aviso = null; }
  if (!aviso) return { ok: false, error: "No hay datos guardados de ese lead." };
  try { await guardarLead(d, datosDeLeadGoogle(aviso)); await quitarFallo(d.sb, "google", id); return { ok: true }; }
  catch (e) { await registrarFallo(d.sb, "google", id, e, aviso); return { ok: false, error: String((e as any)?.message ?? e).slice(0, 300) }; }
}

/** Lo que muestra Marketing: si cada plataforma está lista, las direcciones a configurar, los leads de los últimos 30 días y los que fallaron. */
export async function estadoLeadsAds(sb: any, local: string | null) {
  const base = String(env("SUPABASE_URL") || "").replace(/\/$/, "");
  const url = `${base}/functions/v1/api`;
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: leads } = await sb.from("leads").select("id, fuente, campania_id, creado_en, local_id");
  const recientes = (leads ?? []).filter((l: any) => (l.fuente === FUENTE_META || l.fuente === FUENTE_GOOGLE) && l.creado_en >= desde && (!local || l.local_id === local));
  const { data: fallos } = await sb.from("kv_store").select("key, value").like("key", "leadfallo::%");
  const lista: any[] = [];
  for (const f of fallos ?? []) { try { const r = JSON.parse(f.value); delete r.aviso; lista.push(r); } catch { /* registro dañado */ } }
  return {
    meta: { listo: leadsMetaConfigurado(), url: `${url}?whatsapp=1`, leads30: recientes.filter((l: any) => l.fuente === FUENTE_META).length },
    google: { listo: leadsGoogleConfigurado(), url: `${url}?googleleads=1`, leads30: recientes.filter((l: any) => l.fuente === FUENTE_GOOGLE).length },
    fallos: lista.sort((a, b) => String(b.en).localeCompare(String(a.en))).slice(0, 20),
  };
}
