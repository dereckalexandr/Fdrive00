// Conexión de Marketing con Meta Ads y Google Ads (etapa «Medir»: solo lectura).
//
// El CRM lee de cada plataforma el gasto, alcance, impresiones, clics y resultados de las campañas que se vincularon con una
// campaña del módulo Marketing, y los guarda en ella (antes se anotaban a mano). No crea ni modifica nada en las plataformas.
//
// Secretos de Meta (los carga el usuario con `supabase secrets set`):
//   META_AD_ACCOUNT_ID  número de la cuenta publicitaria (con o sin «act_»)
//   META_ADS_TOKEN      token de un usuario del sistema con el permiso ads_read (si falta, se usa WA_TOKEN: debe tener ads_read también)
// Secretos de Google Ads:
//   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID (cuenta publicitaria, sin guiones), GOOGLE_ADS_REFRESH_TOKEN (permiso adwords),
//   GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET (los mismos del calendario). Opcionales: GOOGLE_ADS_LOGIN_CUSTOMER_ID (cuenta de
//   administrador, si la cuenta publicitaria está bajo una) y GOOGLE_ADS_VERSION (por defecto v24; Google retira versiones cada año).
import {
  parsearMetaInsights, parsearGoogleFilas, campaniaDeGoogle, campaniaDeMeta, ventanaMetricas, monedaValida, errorLegible,
} from "./ads-core.js";

const env = (k: string) => (globalThis as any).Deno.env.get(k) ?? "";
const hoyCL = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

/* ---------------- Meta ---------------- */
const cuentaMeta = () => env("META_AD_ACCOUNT_ID").replace(/^act_/i, "").replace(/\D/g, "");
const tokenMeta = () => env("META_ADS_TOKEN") || env("WA_TOKEN");
export const metaAdsConfigurado = () => !!(tokenMeta() && cuentaMeta());
const graphBase = () => `https://graph.facebook.com/${env("WA_GRAPH_VERSION") || "v24.0"}`;

async function graph(ruta: string, params: Record<string, string> = {}): Promise<any> {
  const u = new URL(ruta.startsWith("http") ? ruta : `${graphBase()}${ruta}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.toString(), { headers: { authorization: `Bearer ${tokenMeta()}` }, signal: AbortSignal.timeout(20000) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) { const e = d && d.error; throw new Error(`${(e && (e.error_user_msg || e.message)) || `Meta respondió ${r.status}`} (${(e && e.code) ?? r.status})`); }
  return d;
}

export async function cuentaDeMeta() {
  const d = await graph(`/act_${cuentaMeta()}`, { fields: "name,currency,account_status" });
  return { nombre: String(d.name || ""), moneda: String(d.currency || ""), activa: Number(d.account_status) === 1 };
}

export async function listarMeta() {
  const out: any[] = [];
  let d = await graph(`/act_${cuentaMeta()}/campaigns`, { fields: "id,name,status,effective_status,start_time,stop_time", limit: "100" });
  for (let p = 0; p < 5; p++) {
    for (const c of d.data ?? []) out.push(campaniaDeMeta(c));
    if (!(d.paging && d.paging.next)) break;
    d = await graph(d.paging.next);
  }
  return out;
}

export async function metricasMeta(id: string, desde: string, hasta: string) {
  const d = await graph(`/${encodeURIComponent(id)}/insights`, { fields: "spend,reach,impressions,clicks,actions", time_range: JSON.stringify({ since: desde, until: hasta }) });
  return parsearMetaInsights((d.data ?? [])[0]);
}

/* ---------------- Google Ads ---------------- */
const clienteGoogle = () => env("GOOGLE_ADS_CUSTOMER_ID").replace(/\D/g, "");
const versionGoogle = () => env("GOOGLE_ADS_VERSION") || "v24";
export const googleAdsConfigurado = () => !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET") && env("GOOGLE_ADS_REFRESH_TOKEN") && env("GOOGLE_ADS_DEVELOPER_TOKEN") && clienteGoogle());

let tokenGoogle: { valor: string; vence: number } | null = null;
async function accesoGoogleAds(forzar = false): Promise<string> {
  if (!forzar && tokenGoogle && tokenGoogle.vence > Date.now() + 60_000) return tokenGoogle.valor;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), refresh_token: env("GOOGLE_ADS_REFRESH_TOKEN"), grant_type: "refresh_token" }).toString(),
    signal: AbortSignal.timeout(10000),
  });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Google no entregó acceso (${r.status}): ${String(d.error_description || d.error || "").slice(0, 160)}`);
  tokenGoogle = { valor: String(d.access_token), vence: Date.now() + (Number(d.expires_in) || 3000) * 1000 };
  return tokenGoogle.valor;
}

/** Consulta GAQL: devuelve todas las filas (sigue las páginas). Si el token expiró, lo renueva una vez. */
async function gaql(consulta: string): Promise<any[]> {
  const filas: any[] = [];
  let pagina = "";
  for (let p = 0; p < 10; p++) {
    let d: any = null;
    for (let intento = 0; intento < 2; intento++) {
      const acceso = await accesoGoogleAds(intento > 0);
      const r = await fetch(`https://googleads.googleapis.com/${versionGoogle()}/customers/${clienteGoogle()}/googleAds:search`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${acceso}`, "developer-token": env("GOOGLE_ADS_DEVELOPER_TOKEN"), "content-type": "application/json",
          ...(env("GOOGLE_ADS_LOGIN_CUSTOMER_ID") ? { "login-customer-id": env("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replace(/\D/g, "") } : {}),
        },
        body: JSON.stringify({ query: consulta, ...(pagina ? { pageToken: pagina } : {}) }),
        signal: AbortSignal.timeout(25000),
      });
      if (r.status === 401 && intento === 0) continue;
      d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const e = d && d.error;
        const det = e && Array.isArray(e.details) && e.details[0] && Array.isArray(e.details[0].errors) ? e.details[0].errors[0] : null;
        throw new Error(`${(det && det.message) || (e && e.message) || `Google Ads respondió ${r.status}`} (${r.status})`);
      }
      break;
    }
    filas.push(...((d && d.results) ?? []));
    pagina = (d && d.nextPageToken) || "";
    if (!pagina) break;
  }
  return filas;
}

export async function cuentaDeGoogle() {
  const f = await gaql("SELECT customer.descriptive_name, customer.currency_code FROM customer");
  const c = (f[0] && f[0].customer) || {};
  return { nombre: String(c.descriptiveName || c.descriptive_name || ""), moneda: String(c.currencyCode || c.currency_code || "") };
}

export async function listarGoogle() {
  const f = await gaql("SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.id");
  return f.map(campaniaDeGoogle).filter((c) => c.id);
}

export async function metricasGoogle(id: string, desde: string, hasta: string) {
  const f = await gaql(`SELECT campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE campaign.id = ${Number(id)} AND segments.date BETWEEN '${desde}' AND '${hasta}'`);
  return parsearGoogleFilas(f).get(String(id)) || { gasto: 0, alcance: null, impresiones: 0, clics: 0, leads: 0, mensajes: 0 };
}

/* ---------------- Estado y lista ---------------- */
export const configurado = (plataforma: string) => (plataforma === "meta" ? metaAdsConfigurado() : plataforma === "google" ? googleAdsConfigurado() : false);

/** ¿Conecta de verdad? Pide el nombre y la moneda de la cuenta (una llamada barata). Nunca lanza. */
export async function estadoConexion(plataforma: string) {
  if (!configurado(plataforma)) return { plataforma, configurado: false, conectado: false };
  try {
    const c = plataforma === "meta" ? await cuentaDeMeta() : await cuentaDeGoogle();
    return { plataforma, configurado: true, conectado: true, cuenta: c.nombre, moneda: c.moneda, monedaValida: monedaValida(c.moneda), ...(plataforma === "meta" ? { activa: (c as any).activa } : {}) };
  } catch (e) { return { plataforma, configurado: true, conectado: false, error: errorLegible(plataforma, e) }; }
}

export const listarExternas = (plataforma: string) => (plataforma === "meta" ? listarMeta() : listarGoogle());

/* ---------------- Sincronización ---------------- */
/**
 * Lee las métricas de las campañas vinculadas y las guarda en cada una (gasto, alcance, impresiones, clics y el detalle de la plataforma).
 * Mide dentro de las fechas de la campaña del CRM. Una campaña con error conserva sus números anteriores y anota el error.
 * @param filtro { id?: una sola campaña; local?: solo las de ese local }
 */
export async function sincronizarCampanias(sb: any, filtro: { id?: string; local?: string | null } = {}) {
  const { data, error } = await sb.from("campanias").select("*");
  if (error) throw error;
  const vinculadas = (data ?? []).filter((c: any) => c.externo_id && c.plataforma && c.estado !== "cancelada"
    && (!filtro.id || c.id === filtro.id) && (!filtro.local || c.local_id === filtro.local));
  const hoy = hoyCL();
  const monedas: Record<string, { ok: boolean; moneda: string } | undefined> = {};
  const res = { revisadas: vinculadas.length, actualizadas: 0, omitidas: 0, errores: [] as { campania: string; error: string }[] };
  for (const c of vinculadas.slice(0, 40)) {
    const falla = async (msg: string) => {
      res.errores.push({ campania: c.nombre, error: msg });
      await sb.from("campanias").update({ sync_error: msg.slice(0, 300), actualizado_en: new Date().toISOString() }).eq("id", c.id);
    };
    try {
      if (!configurado(c.plataforma)) { await falla(`${c.plataforma === "meta" ? "Meta" : "Google Ads"} no está conectado en el servidor.`); continue; }
      const ventana = ventanaMetricas(c, hoy);
      if (!ventana) { res.omitidas++; continue; } // todavía no empieza
      if (!monedas[c.plataforma]) {
        const cu = c.plataforma === "meta" ? await cuentaDeMeta() : await cuentaDeGoogle();
        monedas[c.plataforma] = { ok: monedaValida(cu.moneda), moneda: cu.moneda };
      }
      const mo = monedas[c.plataforma]!;
      if (!mo.ok) { await falla(`La cuenta publicitaria está en ${mo.moneda || "otra moneda"}: el CRM solo lleva pesos chilenos (CLP) y no convierte.`); continue; }
      const m: any = c.plataforma === "meta" ? await metricasMeta(c.externo_id, ventana.desde, ventana.hasta) : await metricasGoogle(c.externo_id, ventana.desde, ventana.hasta);
      const ahora = new Date().toISOString();
      const patch: Record<string, unknown> = {
        gasto: m.gasto, impresiones: m.impresiones, clics: m.clics, ...(m.alcance !== null && m.alcance !== undefined ? { alcance: m.alcance } : {}),
        externo: { ...(c.externo || {}), leads: m.leads, mensajes: m.mensajes, moneda: mo.moneda, desde: ventana.desde, hasta: ventana.hasta }, sync_en: ahora, sync_error: null, actualizado_en: ahora,
      };
      const up = await sb.from("campanias").update(patch).eq("id", c.id);
      if (up.error) throw up.error;
      res.actualizadas++;
    } catch (e) { await falla(errorLegible(c.plataforma, e)); }
  }
  return res;
}
