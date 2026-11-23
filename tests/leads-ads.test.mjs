// Leads de anuncios: formularios de Meta (Lead Ads) y de Google Ads entran solos al CRM con su campaña, reparto y aviso;
// sin duplicados, sin perder los que fallan. Contra la función real con Meta y Google simulados.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { parsearAvisoMeta, datosDeLeadMeta, datosDeLeadGoogle, tieneContacto, nombreCliente, notasDeLead } from "../supabase/functions/api/leads-ads-core.js";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db, ads, entorno, manejar, correos } from "./helpers/api-env.mjs";

test("Aviso de Meta: solo los formularios (leadgen) con su número; ignora lo demás", () => {
  const r = parsearAvisoMeta({ object: "page", entry: [{ id: "PAG1", changes: [
    { field: "leadgen", value: { leadgen_id: "444455556666", form_id: "F1", ad_id: "AD1", page_id: "PAG1" } },
    { field: "feed", value: { item: "post" } }, { field: "leadgen", value: { leadgen_id: "abc" } }] }] });
  assert.deepEqual(r, [{ leadgenId: "444455556666", formId: "F1", anuncioId: "AD1", paginaId: "PAG1" }]);
  assert.deepEqual(parsearAvisoMeta({ object: "whatsapp_business_account", entry: [] }), []);
});

test("Datos del formulario de Meta: contacto normalizado, preguntas propias y datos del anuncio", () => {
  const d = datosDeLeadMeta({ id: "444455556666", campaign_id: "120200000001", campaign_name: "SUV usados", adset_name: "Santiago 25-45", ad_name: "Tucson 2022", field_data: [
    { name: "full_name", values: ["María José  Pérez"] }, { name: "phone_number", values: ["+56 9 8765 4321"] }, { name: "email", values: ["Maria@Correo.CL"] },
    { name: "¿qué_auto_te_interesa?", values: ["Hyundai Tucson"] }, { name: "city", values: ["Providencia"] }] });
  assert.deepEqual([d.nombre, d.telefono, d.email], ["María José Pérez", "+56987654321", "maria@correo.cl"]);
  assert.deepEqual(d.extras, [{ pregunta: "¿qué auto te interesa?", respuesta: "Hyundai Tucson" }, { pregunta: "city", respuesta: "Providencia" }]);
  assert.deepEqual([d.campaniaExternaId, d.anuncio], ["120200000001", "Tucson 2022"]);
  const n = notasDeLead(d, "Meta (Facebook e Instagram)");
  assert.match(n, /Campaña: SUV usados · conjunto: Santiago 25-45 · anuncio: Tucson 2022/);
  assert.match(n, /¿qué auto te interesa\?: Hyundai Tucson/);
  // Nombre y apellido por separado; teléfono de 8 dígitos; sin contacto válido.
  assert.equal(datosDeLeadMeta({ field_data: [{ name: "first_name", values: ["Ana"] }, { name: "last_name", values: ["Soto"] }, { name: "phone_number", values: ["87654321"] }] }).telefono, "+56987654321");
  const sin = datosDeLeadMeta({ field_data: [{ name: "full_name", values: ["Sin Datos"] }, { name: "email", values: ["no-es-correo"] }] });
  assert.equal(tieneContacto(sin), false);
  assert.equal(nombreCliente({ nombre: "", telefono: "+56987654321", email: null }), "Cliente 4321");
});

test("Datos del formulario de Google: columnas estándar, preguntas propias y prueba", () => {
  const d = datosDeLeadGoogle({ lead_id: "g-123", campaign_id: 7700110022, is_test: false, user_column_data: [
    { column_id: "FIRST_NAME", string_value: "Pedro" }, { column_id: "LAST_NAME", string_value: "Rojas" }, { column_id: "PHONE_NUMBER", string_value: "+56 9 1111 2222" },
    { column_id: "EMAIL", string_value: "pedro@correo.cl" }, { column_id: "CUSTOM_1", column_name: "¿Cuándo quieres comprar?", string_value: "Este mes" }] });
  assert.deepEqual([d.id, d.nombre, d.telefono, d.email, d.campaniaExternaId, d.prueba], ["g-123", "Pedro Rojas", "+56911112222", "pedro@correo.cl", "7700110022", false]);
  assert.deepEqual(d.extras, [{ pregunta: "¿Cuándo quieres comprar?", respuesta: "Este mes" }]);
  assert.equal(datosDeLeadGoogle({ lead_id: "x", is_test: true, user_column_data: [] }).prueba, true);
});

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1;
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const mes = hoy.slice(0, 7);
const lead = (extra = {}) => ({ id: "x", campaign_id: "120200000001", campaign_name: "SUV usados", field_data: [{ name: "full_name", values: ["Cliente Prueba"] }, { name: "phone_number", values: ["+56911110001"] }, { name: "email", values: ["prueba1@correo.cl"] }], ...extra });
const aviso = (...ids) => ({ object: "page", entry: [{ id: "PAG1", changes: ids.map((id) => ({ field: "leadgen", value: { leadgen_id: id, form_id: "F1", ad_id: "AD1", page_id: "PAG1" } })) }] });
async function webhookMeta(payload, { firma } = {}) {
  const cuerpo = JSON.stringify(payload);
  const sig = firma ?? "sha256=" + createHmac("sha256", "secreto-app-prueba").update(cuerpo).digest("hex");
  const res = await manejar(new Request("http://x/api?whatsapp=1", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: cuerpo }));
  return { status: res.status, texto: await res.text() };
}
async function webhookGoogle(body) {
  const res = await manejar(new Request("http://x/api?googleleads=1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra, email: `${clave}@prueba.cl` }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token };
}
let CAMP;
before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  const ventas = { otorgar: ["ventas.operar"], quitar: [] };
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("mkt", "Marta Marketing", "10.000.013-K", ["marketing"], L1);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1, ventas);
  await crear("e2", "Ema Dos", "7.654.321-6", ["ejecutivo"], L1, ventas);
  Object.assign(entorno, { META_AD_ACCOUNT_ID: "998877", GOOGLE_ADS_LEAD_KEY: "clave-del-formulario-google" });
  ads.meta.campanias = [{ id: "120200000001", name: "SUV usados", status: "ACTIVE", effective_status: "ACTIVE" }];
  ads.meta.insights["120200000001"] = { spend: "1000", reach: "10", impressions: "100", clicks: "5", actions: [] };
  CAMP = (await ve(U.mkt.token, "marketing.campanias.save", { datos: { nombre: "SUV usados noviembre", canal: "facebook", objetivo: "x", desde: `${mes}-01`, hasta: `${mes}-28`, presupuesto: 0 } })).campania;
  await ve(U.mkt.token, "marketing.campanias.enviar", { id: CAMP.id });
  assert.equal((await ve(U.mkt.token, "marketing.ads.vincular", { id: CAMP.id, plataforma: "meta", externoId: "120200000001" })).status, 200);
});

test("Meta: un formulario crea cliente y lead de venta con su campaña, repartido y con aviso al ejecutivo", async () => {
  ads.meta.leads["900000000001"] = lead();
  const antes = correos.length;
  assert.equal((await webhookMeta(aviso("900000000001"), { firma: "sha256=" + "0".repeat(64) })).status, 401);
  assert.equal(db.tablas.leads.length, 0);
  const r = await webhookMeta(aviso("900000000001"));
  assert.equal(r.status, 200);
  const cli = db.tablas.clientes.find((c) => c.email === "prueba1@correo.cl");
  assert.deepEqual([cli.nombre, cli.telefono, cli.local_id], ["Cliente Prueba", "+56911110001", L1]);
  const l = db.tablas.leads.find((x) => x.cliente_id === cli.id);
  assert.deepEqual([l.fuente, l.tipo, l.etapa, l.campania_id], ["Meta Ads", "venta", "nuevo", CAMP.id]);
  assert.ok([U.e1.id, U.e2.id].includes(l.asignado_a));
  assert.match(l.notas, /formulario de Meta/);
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === l.id && e.tipo === "creado" && /campaña SUV usados noviembre/.test(e.detalle)));
  const mail = correos.slice(antes).find((c) => /Nuevo lead/.test(c.subject));
  assert.ok(mail, "avisa por correo");
  assert.deepEqual(mail.to, [db.tablas.usuarios.find((u) => u.id === l.asignado_a).email]);
  // La lectura a Meta usa el token en el encabezado y pide los campos necesarios.
  const ll = ads.meta.llamadas.filter((x) => x.ruta.endsWith("/900000000001")).pop();
  assert.equal(ll.auth, "Bearer EAAprueba");
  assert.match(ll.query.fields, /field_data/);
  // Las métricas de la campaña cuentan este lead.
  const c = (await ve(U.mkt.token, "marketing.campanias.get", { id: CAMP.id })).campania;
  assert.equal(c.metricas.leads, 1);
});

test("Meta: el mismo aviso repetido no duplica; el siguiente ejecutivo recibe el siguiente lead; una persona con lead abierto no genera otro", async () => {
  assert.equal((await webhookMeta(aviso("900000000001"))).status, 200);
  assert.equal(db.tablas.leads.length, 1, "aviso repetido");
  ads.meta.leads["900000000002"] = lead({ field_data: [{ name: "full_name", values: ["Otra Persona"] }, { name: "phone_number", values: ["+56911110002"] }, { name: "email", values: ["otra@correo.cl"] }, { name: "¿qué_auto_te_interesa?", values: ["Kia Rio"] }] });
  await webhookMeta(aviso("900000000002"));
  const [a, b] = db.tablas.leads;
  assert.notEqual(a.asignado_a, b.asignado_a, "reparto por turnos");
  assert.match(b.notas, /Kia Rio/);
  // La misma persona (por teléfono escrito distinto) vuelve a llenar el formulario: se anota en su lead, no se crea otro.
  ads.meta.leads["900000000003"] = lead({ field_data: [{ name: "full_name", values: ["Cliente Prueba"] }, { name: "phone_number", values: ["911110001"] }] });
  await webhookMeta(aviso("900000000003"));
  assert.equal(db.tablas.leads.length, 2);
  const ev = db.tablas.lead_eventos.filter((e) => e.lead_id === a.id && e.tipo === "nota");
  assert.equal(ev.length, 1);
  assert.match(ev[0].detalle, /Volvió a pedir información/);
});

test("Meta: si no se puede leer (sin permiso) responde 200, queda registrado y se reintenta desde Marketing sin perder el lead", async () => {
  ads.meta.leads["900000000004"] = lead({ field_data: [{ name: "full_name", values: ["Se Reintenta"] }, { name: "phone_number", values: ["+56911110004"] }] });
  ads.meta.fallar = "(#200) Requires leads_retrieval permission";
  const r = await webhookMeta(aviso("900000000004"));
  assert.equal(r.status, 200, "Meta desactiva los avisos que fallan");
  assert.equal(db.tablas.leads.length, 2);
  let e = await ve(U.mkt.token, "marketing.leads.estado");
  assert.equal(e.fallos.length, 1);
  assert.match(e.fallos[0].error, /leads_retrieval/);
  assert.equal(e.fallos[0].aviso, undefined);
  assert.equal((await ve(U.e1.token, "marketing.leads.estado")).status, 403);
  const re = await ve(U.mkt.token, "marketing.leads.reintentar", { plataforma: "meta", id: "900000000004" });
  assert.equal(re.status, 200, JSON.stringify(re));
  assert.equal(db.tablas.leads.length, 3);
  e = await ve(U.mkt.token, "marketing.leads.estado");
  assert.equal(e.fallos.length, 0);
  assert.equal(e.meta.leads30, 3);
  assert.equal(e.meta.listo, true);
  assert.match(e.meta.url, /\?whatsapp=1$/);
});

test("Meta: un formulario sin teléfono ni correo no crea nada; los avisos de WhatsApp siguen funcionando", async () => {
  ads.meta.leads["900000000005"] = lead({ field_data: [{ name: "full_name", values: ["Sin Contacto"] }] });
  await webhookMeta(aviso("900000000005"));
  assert.equal(db.tablas.leads.length, 3);
  const wa = { object: "whatsapp_business_account", entry: [{ id: "WABA1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "PNID1" }, contacts: [{ profile: { name: "Cliente WA" }, wa_id: "56922220001" }], messages: [{ from: "56922220001", id: "wamid.IN1", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Hola" } }] } }] }] };
  assert.equal((await webhookMeta(wa)).status, 200);
  assert.ok(db.tablas.leads.some((l) => l.fuente === "WhatsApp"));
});

test("Google: exige la clave del formulario, ignora los datos de prueba, crea el lead con su campaña y no duplica", async () => {
  ads.google.campanias = [{ id: "7700110022", name: "Búsqueda SUV", status: "ENABLED" }];
  ads.google.metricas["7700110022"] = { costMicros: 5_000_000, impressions: 10, clicks: 1, conversions: 0 };
  const CG = (await ve(U.mkt.token, "marketing.campanias.save", { datos: { nombre: "Búsqueda SUV", canal: "google", objetivo: "x", desde: `${mes}-01`, hasta: `${mes}-28`, presupuesto: 0 } })).campania;
  await ve(U.mkt.token, "marketing.campanias.enviar", { id: CG.id });
  Object.assign(entorno, { GOOGLE_ADS_DEVELOPER_TOKEN: "t", GOOGLE_ADS_CUSTOMER_ID: "1234567890", GOOGLE_ADS_REFRESH_TOKEN: "r", GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s" });
  assert.equal((await ve(U.mkt.token, "marketing.ads.vincular", { id: CG.id, plataforma: "google", externoId: "7700110022" })).status, 200);
  const cuerpo = { lead_id: "g-1001", campaign_id: 7700110022, form_id: 55, google_key: "clave-del-formulario-google", is_test: false, user_column_data: [
    { column_id: "FULL_NAME", string_value: "Pedro Rojas" }, { column_id: "PHONE_NUMBER", string_value: "+56 9 3333 4444" }, { column_id: "EMAIL", string_value: "pedro@correo.cl" }, { column_id: "CUSTOM_1", column_name: "¿Cuándo quieres comprar?", string_value: "Este mes" }] };
  const antes = db.tablas.leads.length;
  assert.equal((await webhookGoogle({ ...cuerpo, google_key: "otra-clave-incorrecta" })).status, 401);
  assert.equal((await webhookGoogle({ ...cuerpo, is_test: true })).json.prueba, true);
  assert.equal(db.tablas.leads.length, antes);
  const r = await webhookGoogle(cuerpo);
  assert.equal(r.status, 200);
  const l = db.tablas.leads.find((x) => x.fuente === "Google Ads");
  assert.deepEqual([l.campania_id, l.tipo, l.etapa], [CG.id, "venta", "nuevo"]);
  assert.match(l.notas, /¿Cuándo quieres comprar\?: Este mes/);
  assert.equal(db.tablas.clientes.find((c) => c.id === l.cliente_id).telefono, "+56933334444");
  const rep = await webhookGoogle(cuerpo);
  assert.equal(rep.json.duplicado, true);
  assert.equal(db.tablas.leads.filter((x) => x.fuente === "Google Ads").length, 1);
  assert.equal(((await ve(U.mkt.token, "marketing.leads.estado")).google.listo), true);
  // Sin clave configurada el servidor no atiende.
  const clave = entorno.GOOGLE_ADS_LEAD_KEY; entorno.GOOGLE_ADS_LEAD_KEY = "";
  const res = await manejar(new Request("http://x/api?googleleads=1", { method: "POST", body: JSON.stringify(cuerpo) }));
  assert.equal(res.status, 503);
  entorno.GOOGLE_ADS_LEAD_KEY = clave;
});
