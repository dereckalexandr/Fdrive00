// Conexión de Marketing con Meta Ads y Google Ads: reglas puras (sin red ni base), compartidas por el servidor y las pruebas.
// Etapa «Medir»: el CRM lee de cada plataforma el gasto, alcance, impresiones, clics y resultados de las campañas vinculadas.

export const PLATAFORMAS = [
  { id: "meta", nombre: "Meta (Facebook e Instagram)", canal: "facebook" },
  { id: "google", nombre: "Google Ads", canal: "google" },
];
export const plataformaNombre = (id) => (PLATAFORMAS.find((p) => p.id === id) || {}).nombre || id;
export const canalDePlataforma = (id) => (PLATAFORMAS.find((p) => p.id === id) || {}).canal || "otro";

const entero = (x) => { const n = Math.round(Number(x)); return Number.isFinite(n) && n >= 0 ? n : 0; };
const dia = (iso) => String(iso || "").slice(0, 10);

/**
 * Una fila de /insights de Meta a métricas. `actions` trae los resultados: formularios («lead») y conversaciones iniciadas por mensaje
 * (clic a WhatsApp o Messenger). El gasto viene como texto en la moneda de la cuenta (CLP no tiene decimales).
 */
export function parsearMetaInsights(fila) {
  const f = fila || {};
  const acciones = Array.isArray(f.actions) ? f.actions : [];
  const valor = (tipo) => entero((acciones.find((a) => a.action_type === tipo) || {}).value);
  // «lead» ya incluye los formularios de Facebook; «lead_grouped» solo se usa si no viene el total.
  const leads = valor("lead") || valor("onsite_conversion.lead_grouped");
  const mensajes = valor("onsite_conversion.messaging_conversation_started_7d");
  return { gasto: entero(f.spend), alcance: entero(f.reach), impresiones: entero(f.impressions), clics: entero(f.clicks), leads, mensajes };
}

/**
 * Filas de la consulta de Google Ads (GAQL) a métricas por campaña. Se suman las filas de una misma campaña (si la consulta vino
 * segmentada por día). El costo viene en micros (1 peso = 1.000.000). Google no entrega alcance en todas las campañas: queda null.
 */
export function parsearGoogleFilas(filas) {
  const out = new Map();
  for (const r of filas || []) {
    const id = String((r.campaign && r.campaign.id) || "");
    if (!id) continue;
    const m = r.metrics || {};
    const a = out.get(id) || { gasto: 0, alcance: null, impresiones: 0, clics: 0, leads: 0, mensajes: 0, _micros: 0, _conv: 0 };
    a._micros += Number(m.costMicros ?? m.cost_micros ?? 0) || 0;
    a.impresiones += entero(m.impressions);
    a.clics += entero(m.clicks);
    a._conv += Number(m.conversions) || 0; // las conversiones de Google son decimales: se suman completas y se redondea al final
    out.set(id, a);
  }
  for (const a of out.values()) { a.gasto = Math.round(a._micros / 1_000_000); a.leads = Math.round(a._conv); delete a._micros; delete a._conv; }
  return out;
}

/** Campaña de Google (GAQL) a la forma común. Los estados de Google: ENABLED, PAUSED, REMOVED. */
export function campaniaDeGoogle(r) {
  const c = (r && r.campaign) || {};
  const fecha = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !String(s).startsWith("2037") ? String(s) : null); // 2037-12-30 = sin fin
  return { plataforma: "google", id: String(c.id || ""), nombre: String(c.name || "").slice(0, 120), estado: String(c.status || "").toLowerCase(), desde: fecha(c.startDate ?? c.start_date), hasta: fecha(c.endDate ?? c.end_date) };
}

/** Campaña de Meta a la forma común (status: ACTIVE, PAUSED, ARCHIVED…). */
export function campaniaDeMeta(c) {
  const x = c || {};
  return { plataforma: "meta", id: String(x.id || ""), nombre: String(x.name || "").slice(0, 120), estado: String(x.effective_status || x.status || "").toLowerCase(), desde: x.start_time ? dia(x.start_time) : null, hasta: x.stop_time ? dia(x.stop_time) : null };
}

/** Ventana de fechas en que se mide una campaña: las fechas de la campaña del CRM, sin pasar de hoy. null si aún no empieza. */
export function ventanaMetricas(campania, hoy) {
  const desde = dia(campania.desde);
  const hasta = dia(campania.hasta) < hoy ? dia(campania.hasta) : hoy;
  return desde && hasta && desde <= hasta ? { desde, hasta } : null;
}

const MONEDA = "CLP";
/** El CRM lleva todo en pesos: una cuenta publicitaria en otra moneda no se convierte, se avisa. */
export const monedaValida = (m) => String(m || "").toUpperCase() === MONEDA;

/** Datos del vínculo entre una campaña del CRM y una de la plataforma. */
export function validarVinculo(input) {
  const i = input || {};
  if (!PLATAFORMAS.some((p) => p.id === i.plataforma)) return { ok: false, error: "plataforma_invalida" };
  const externoId = String(i.externoId ?? "").trim();
  if (!/^\d{3,30}$/.test(externoId)) return { ok: false, error: "externo_invalido" };
  return { ok: true, value: { plataforma: i.plataforma, externo_id: externoId } };
}

/** Importar una campaña de la plataforma como campaña nueva del CRM: pide el presupuesto (la plataforma gasta por su cuenta). */
export function validarImportacion(input, externa, hoy) {
  const v = validarVinculo(input);
  if (!v.ok) return v;
  const presupuesto = Math.round(Number(input.presupuesto));
  if (!Number.isFinite(presupuesto) || presupuesto < 0 || presupuesto > 2_000_000_000) return { ok: false, error: "presupuesto_invalido" };
  const desde = externa.desde && externa.desde <= hoy ? externa.desde : hoy;
  let hasta = externa.hasta && externa.hasta >= desde ? externa.hasta : null;
  if (!hasta) { const d = new Date(`${desde}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 30); hasta = d.toISOString().slice(0, 10); }
  return { ok: true, value: { ...v.value, nombre: externa.nombre || "Campaña importada", desde, hasta, presupuesto, canal: canalDePlataforma(v.value.plataforma) } };
}

/** ¿El gasto de la plataforma superó lo que el Jefe Local aprobó? (la plataforma gasta aunque el CRM no lo apruebe). */
export const excedePresupuesto = (c) => Number(c.presupuesto_aprobado) > 0 ? Number(c.gasto) > Number(c.presupuesto_aprobado) : Number(c.gasto) > 0 && c.estado !== "borrador";

/** Antigüedad de la última lectura, en horas (null si nunca se leyó). */
export const horasDesdeSync = (c, ahora = Date.now()) => (c.sync_en ? Math.max(0, Math.round((ahora - Date.parse(c.sync_en)) / 3_600_000)) : null);

/** Mensaje claro para un error de la plataforma. */
export function errorLegible(plataforma, e) {
  const t = String((e && e.message) || e || "");
  // El del token de desarrollador va primero: su texto también contiene «token» y se confundiría con un token vencido.
  if (/developer.?token|desarrollador|DEVELOPER_TOKEN/i.test(t)) return "Google Ads: el token de desarrollador no está aprobado todavía (solo sirve con cuentas de prueba).";
  if (/token|OAuth|expired|invalid_grant|401|190/i.test(t)) return `${plataformaNombre(plataforma)} rechazó el acceso: el token venció o no tiene permiso. Genera uno nuevo.`;
  if (/permission|permiso|403|PERMISSION_DENIED|ads_read/i.test(t)) return `${plataformaNombre(plataforma)}: falta permiso para leer esta cuenta publicitaria.`;
  if (/rate|limit|429|quota/i.test(t)) return `${plataformaNombre(plataforma)}: demasiadas consultas, se reintenta en la próxima actualización.`;
  return `${plataformaNombre(plataforma)}: ${t.slice(0, 160)}`;
}

/* ======================= Crear campañas en Google Ads (búsqueda) ======================= */
// Campaña de búsqueda simple: presupuesto diario, «maximizar clics», Chile, español, un grupo de anuncios con un anuncio adaptable
// (títulos y descripciones) y palabras clave de concordancia de frase. Se crea EN PAUSA: se activa solo si el Jefe Local la aprobó.
export const GOOGLE_CHILE = "geoTargetConstants/2152";
export const GOOGLE_ESPANOL = "languageConstants/1003";
export const LIMITES_GOOGLE = { titulos: [3, 15, 30], descripciones: [2, 4, 90], palabras: [1, 30, 80], diarioMin: 1000, diarioMax: 10_000_000 };

const lineas = (x) => (Array.isArray(x) ? x : String(x || "").split(/\r?\n/)).map((s) => String(s).replace(/\s+/g, " ").trim()).filter(Boolean);
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000) + 1;

/** Días que quedan de la campaña (desde hoy o desde su inicio, hasta su término). */
export function diasRestantes(c, hoy) {
  const desde = String(c.desde) > hoy ? String(c.desde) : hoy;
  return String(c.hasta) >= desde ? diasEntre(desde, String(c.hasta)) : 0;
}

/** Textos sugeridos para la campaña: con las marcas del inventario y los datos de la empresa. El usuario los ajusta. */
export function sugerenciasGoogle({ comuna = "", marcas = [], urlSitio = "" } = {}) {
  const lugar = comuna ? ` en ${comuna}` : "";
  const corta = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, ""));
  const titulos = [
    corta(`Autos Usados${lugar}`, 30), "Revisados e Inspeccionados", "Financiamiento a tu Medida", "Recibimos tu Auto en Parte", "Agenda tu Visita Hoy",
    ...marcas.slice(0, 5).map((m) => corta(`${m} Usados${lugar}`, 30)),
  ].filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 15);
  const descripciones = [
    "Autos usados revisados, con historial y documentos al día. Cotiza tu cuota en minutos.",
    `Recibimos tu auto en parte de pago y te ayudamos con el crédito. Visítanos${lugar}.`.slice(0, 90),
  ];
  const palabras = ["autos usados", "comprar auto usado", `autos usados${lugar.toLowerCase()}`, "automotora", ...marcas.slice(0, 8).map((m) => `${m.toLowerCase()} usado`)]
    .filter((p, i, a) => p && a.indexOf(p) === i).slice(0, 15);
  return { titulos, descripciones, palabras, url: urlSitio };
}

/** Datos de la campaña a crear en Google. c: campaña del CRM (fechas y presupuesto). */
export function validarCampaniaGoogle(input, c, hoy) {
  const i = input || {};
  const diario = Math.round(Number(String(i.presupuestoDiario ?? "").replace(/\D/g, "")));
  if (!Number.isFinite(diario) || diario < LIMITES_GOOGLE.diarioMin || diario > LIMITES_GOOGLE.diarioMax) return { ok: false, error: "google_diario" };
  const dias = diasRestantes(c, hoy);
  if (dias <= 0) return { ok: false, error: "campania_terminada" };
  if (Number(c.presupuesto) > 0 && diario * dias > Number(c.presupuesto)) return { ok: false, error: "google_diario_excede" };
  const url = String(i.url || "").trim();
  if (!/^https:\/\/[^\s/$.?#][^\s]*$/i.test(url) || url.length > 500) return { ok: false, error: "google_url" };
  const [tMin, tMax, tLen] = LIMITES_GOOGLE.titulos;
  const titulos = [...new Set(lineas(i.titulos))];
  if (titulos.length < tMin || titulos.length > tMax || titulos.some((t) => t.length > tLen)) return { ok: false, error: "google_titulos" };
  const [dMin, dMax, dLen] = LIMITES_GOOGLE.descripciones;
  const descripciones = [...new Set(lineas(i.descripciones))];
  if (descripciones.length < dMin || descripciones.length > dMax || descripciones.some((t) => t.length > dLen)) return { ok: false, error: "google_descripciones" };
  const [pMin, pMax, pLen] = LIMITES_GOOGLE.palabras;
  // Google rechaza algunos símbolos en las palabras clave: se dejan letras, números y espacios.
  const palabras = [...new Set(lineas(i.palabras).map((p) => p.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim()).filter((p) => p.length >= 2))];
  if (palabras.length < pMin || palabras.length > pMax || palabras.some((p) => p.length > pLen)) return { ok: false, error: "google_palabras" };
  return { ok: true, value: { presupuestoDiario: diario, url, titulos, descripciones, palabras, dias } };
}

/**
 * Operaciones de la API de Google Ads para crear la campaña en un solo envío (googleAds:mutate). Los recursos nuevos se enlazan
 * entre sí con identificadores temporales negativos. La campaña queda EN PAUSA.
 */
export function operacionesCrearGoogle(cliente, nombre, v) {
  const r = (tipo, n) => `customers/${cliente}/${tipo}/${n}`;
  const presupuesto = r("campaignBudgets", -1); const campania = r("campaigns", -2); const grupo = r("adGroups", -3);
  return [
    { campaignBudgetOperation: { create: { resourceName: presupuesto, name: `${nombre} · presupuesto ${Date.now()}`, amountMicros: String(v.presupuestoDiario * 1_000_000), deliveryMethod: "STANDARD", explicitlyShared: false } } },
    { campaignOperation: { create: {
      resourceName: campania, name: nombre, status: "PAUSED", advertisingChannelType: "SEARCH", campaignBudget: presupuesto, targetSpend: {},
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false, targetPartnerSearchNetwork: false },
      containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    } } },
    { campaignCriterionOperation: { create: { campaign: campania, location: { geoTargetConstant: GOOGLE_CHILE } } } },
    { campaignCriterionOperation: { create: { campaign: campania, language: { languageConstant: GOOGLE_ESPANOL } } } },
    { adGroupOperation: { create: { resourceName: grupo, name: `${nombre} · grupo`, campaign: campania, status: "ENABLED", type: "SEARCH_STANDARD" } } },
    { adGroupAdOperation: { create: { adGroup: grupo, status: "ENABLED", ad: { finalUrls: [v.url], responsiveSearchAd: { headlines: v.titulos.map((text) => ({ text })), descriptions: v.descripciones.map((text) => ({ text })) } } } } },
    ...v.palabras.map((text) => ({ adGroupCriterionOperation: { create: { adGroup: grupo, status: "ENABLED", keyword: { text, matchType: "PHRASE" } } } })),
  ];
}

/** Id de la campaña creada, desde la respuesta de googleAds:mutate. */
export function idCampaniaCreada(respuesta) {
  for (const r of (respuesta && respuesta.mutateOperationResponses) || []) {
    const rn = r.campaignResult && r.campaignResult.resourceName;
    if (rn) return String(rn).split("/").pop();
  }
  return null;
}

/** ¿Se puede activar en Google? Solo con la campaña del CRM aprobada y dentro de sus fechas. */
export function puedeActivar(c, hoy) {
  if (c.estado !== "aprobada") return { ok: false, error: "campania_sin_aprobar" };
  if (String(c.desde) > hoy) return { ok: false, error: "campania_no_empieza" };
  if (String(c.hasta) < hoy) return { ok: false, error: "campania_terminada" };
  return { ok: true };
}
