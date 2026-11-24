// Marketing ↔ Meta Ads y Google Ads (etapa «Medir», solo lectura): lectura de las respuestas de cada plataforma, vínculo con las campañas
// del CRM, lectura de gasto y resultados, errores claros y permisos. Contra la función real con Meta y Google simulados.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  parsearMetaInsights, parsearGoogleFilas, campaniaDeGoogle, campaniaDeMeta, ventanaMetricas, monedaValida, validarVinculo, validarImportacion,
  excedePresupuesto, errorLegible, canalDePlataforma,
} from "../supabase/functions/api/ads-core.js";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db, ads, entorno, manejar } from "./helpers/api-env.mjs";

test("Meta: métricas de una fila de insights (gasto, alcance, formularios y mensajes)", () => {
  const m = parsearMetaInsights({ spend: "125430", reach: "20100", impressions: "45000", clicks: "812", actions: [
    { action_type: "link_click", value: "700" }, { action_type: "lead", value: "9" }, { action_type: "onsite_conversion.lead_grouped", value: "9" },
    { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "14" }] });
  assert.deepEqual(m, { gasto: 125430, alcance: 20100, impresiones: 45000, clics: 812, leads: 9, mensajes: 14 });
  assert.equal(parsearMetaInsights({ spend: "10.4", actions: [{ action_type: "onsite_conversion.lead_grouped", value: "3" }] }).leads, 3);
  assert.deepEqual(parsearMetaInsights(undefined), { gasto: 0, alcance: 0, impresiones: 0, clics: 0, leads: 0, mensajes: 0 });
  assert.deepEqual(campaniaDeMeta({ id: "123", name: "Ofertas", status: "ACTIVE", effective_status: "PAUSED", start_time: "2026-11-01T03:00:00+0000" }), { plataforma: "meta", id: "123", nombre: "Ofertas", estado: "paused", desde: "2026-11-01", hasta: null });
});

test("Google: filas GAQL (camelCase o snake_case) se suman por campaña; el costo viene en micros", () => {
  const m = parsearGoogleFilas([
    { campaign: { id: "777" }, metrics: { costMicros: "50500000000", impressions: "1000", clicks: "40", conversions: 2.4 } },
    { campaign: { id: "777" }, metrics: { cost_micros: "20000000000", impressions: "500", clicks: "10", conversions: 1 } },
    { campaign: { id: "888" }, metrics: { costMicros: "1000000" } },
  ]);
  assert.deepEqual(m.get("777"), { gasto: 70500, alcance: null, impresiones: 1500, clics: 50, leads: 3, mensajes: 0 });
  assert.equal(m.get("888").gasto, 1);
  assert.deepEqual(campaniaDeGoogle({ campaign: { id: "777", name: "Búsqueda SUV", status: "ENABLED" } }), { plataforma: "google", id: "777", nombre: "Búsqueda SUV", estado: "enabled", desde: null, hasta: null });
});

test("Reglas: ventana de fechas, moneda, vínculo, importación, exceso de presupuesto y mensajes de error", () => {
  assert.deepEqual(ventanaMetricas({ desde: "2026-11-01", hasta: "2026-11-30" }, "2026-11-23"), { desde: "2026-11-01", hasta: "2026-11-23" });
  assert.deepEqual(ventanaMetricas({ desde: "2026-10-01", hasta: "2026-10-31" }, "2026-11-23"), { desde: "2026-10-01", hasta: "2026-10-31" });
  assert.equal(ventanaMetricas({ desde: "2026-12-01", hasta: "2026-12-31" }, "2026-11-23"), null);
  assert.equal(monedaValida("clp"), true);
  assert.equal(monedaValida("USD"), false);
  assert.equal(validarVinculo({ plataforma: "tiktok", externoId: "123" }).error, "plataforma_invalida");
  assert.equal(validarVinculo({ plataforma: "meta", externoId: "abc" }).error, "externo_invalido");
  assert.deepEqual(validarVinculo({ plataforma: "meta", externoId: " 1234567 " }).value, { plataforma: "meta", externo_id: "1234567" });
  const imp = validarImportacion({ plataforma: "google", externoId: "777", presupuesto: "500000" }, { nombre: "Búsqueda SUV", desde: "2026-10-01", hasta: null }, "2026-11-23");
  assert.deepEqual(imp.value, { plataforma: "google", externo_id: "777", nombre: "Búsqueda SUV", desde: "2026-10-01", hasta: "2026-10-31", presupuesto: 500000, canal: "google" });
  assert.equal(validarImportacion({ plataforma: "meta", externoId: "1234", presupuesto: -1 }, { nombre: "x" }, "2026-11-23").error, "presupuesto_invalido");
  assert.equal(canalDePlataforma("meta"), "facebook");
  assert.equal(excedePresupuesto({ presupuesto_aprobado: 100000, gasto: 120000, estado: "aprobada" }), true);
  assert.equal(excedePresupuesto({ presupuesto_aprobado: 100000, gasto: 90000, estado: "aprobada" }), false);
  assert.equal(excedePresupuesto({ presupuesto_aprobado: 0, gasto: 5000, estado: "aprobada" }), true); // gasta sin tener presupuesto aprobado
  assert.match(errorLegible("meta", new Error("Error validating access token: Session has expired (190)")), /token venció/);
  assert.match(errorLegible("google", new Error("El token de desarrollador no está aprobado (403)")), /acceso de prueba/);
  assert.match(errorLegible("google", new Error("CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION (403)")), /Explorer/);
});

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1;
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const mes = hoy.slice(0, 7);
const CAMP = { nombre: "Ofertas SUV", canal: "facebook", objetivo: "Consultas", desde: `${mes}-01`, hasta: `${mes}-28`, presupuesto: 300000 };

async function crear(clave, nombre, rut, roles, localId) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token };
}
async function aprobada(extra = {}) {
  const c = (await ve(U.mkt.token, "marketing.campanias.save", { datos: { ...CAMP, ...extra } })).campania;
  await ve(U.mkt.token, "marketing.campanias.enviar", { id: c.id });
  if (Number(extra.presupuesto ?? CAMP.presupuesto) > 0) await ve(U.jefe.token, "marketing.campanias.aprobar", { id: c.id });
  return c;
}

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("mkt", "Marta Marketing", "10.000.013-K", ["marketing"], L1);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1);
});

test("Sin conectar: el estado lo dice y no se puede listar ni vincular", async () => {
  const antes = { ...entorno };
  assert.equal((await ve(U.mkt.token, "marketing.ads.estado")).plataformas.every((p) => p.configurado === false), true);
  assert.equal((await ve(U.mkt.token, "marketing.ads.externas", { plataforma: "meta" })).error, "ads_no_configurado");
  const c = await aprobada();
  assert.equal((await ve(U.mkt.token, "marketing.ads.vincular", { id: c.id, plataforma: "meta", externoId: "111222333" })).error, "ads_no_configurado");
  Object.assign(entorno, { META_AD_ACCOUNT_ID: "act_998877", GOOGLE_ADS_CUSTOMER_ID: "123-456-7890", GOOGLE_ADS_REFRESH_TOKEN: "1//refresco", GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecreto", GOOGLE_ADS_LOGIN_CUSTOMER_ID: "555-666-7777" });
  assert.ok(antes);
});

let CAMPA; let CAMPG;
test("Estado y lista: conecta con la cuenta, lista las campañas con su vínculo y exige permiso", async () => {
  ads.meta.campanias = [
    { id: "111222333", name: "Ofertas SUV noviembre", status: "ACTIVE", effective_status: "ACTIVE", start_time: `${mes}-01T03:00:00+0000` },
    { id: "444555666", name: "Retargeting sitio", status: "PAUSED", effective_status: "PAUSED" },
  ];
  ads.google.campanias = [{ id: "777001", name: "Búsqueda SUV", status: "ENABLED" }];
  const e = await ve(U.mkt.token, "marketing.ads.estado");
  const meta = e.plataformas.find((p) => p.plataforma === "meta"); const goo = e.plataformas.find((p) => p.plataforma === "google");
  assert.deepEqual([meta.conectado, meta.cuenta, meta.monedaValida], [true, "Cuenta BuyCar", true]);
  assert.deepEqual([goo.conectado, goo.cuenta], [true, "BuyCar Google"]);
  assert.equal((await ve(U.e1.token, "marketing.ads.estado")).status, 403);
  const l = await ve(U.mkt.token, "marketing.ads.externas", { plataforma: "meta" });
  assert.equal(l.campanias.length, 2);
  assert.ok(l.campanias.every((c) => c.vinculada === null));
  assert.equal((await ve(U.mkt.token, "marketing.ads.externas", { plataforma: "tiktok" })).error, "plataforma_invalida");
  // El token viaja en el encabezado, nunca en la dirección.
  assert.ok(ads.meta.llamadas.every((x) => x.auth === "Bearer EAAprueba" && !JSON.stringify(x.query).includes("EAAprueba")));
  assert.equal(ads.meta.llamadas[0].ruta.includes("act_998877"), true);

  // Meta falla (token vencido): mensaje claro y 502.
  ads.meta.fallar = "Error validating access token: Session has expired";
  const f = await ve(U.mkt.token, "marketing.ads.externas", { plataforma: "meta" });
  assert.equal(f.status, 502);
  assert.match(f.detalle, /token venció/);
  CAMPA = await aprobada({ nombre: "Ofertas SUV (Meta)" });
  CAMPG = await aprobada({ nombre: "Búsqueda SUV (Google)", canal: "google" });
});

test("Vincular: lee el gasto y los resultados al instante; la campaña pasa a ser automática", async () => {
  ads.meta.insights["111222333"] = { spend: "180000", reach: "30500", impressions: "52000", clicks: "910", actions: [{ action_type: "lead", value: "11" }, { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "6" }] };
  assert.equal((await ve(U.e1.token, "marketing.ads.vincular", { id: CAMPA.id, plataforma: "meta", externoId: "111222333" })).status, 403);
  assert.equal((await ve(U.jefe.token, "marketing.ads.vincular", { id: CAMPA.id, plataforma: "meta", externoId: "111222333" })).status, 403, "el supervisor no cambia campañas");
  assert.equal((await ve(U.mkt.token, "marketing.ads.vincular", { id: CAMPA.id, plataforma: "meta", externoId: "999000111" })).error, "externo_no_existe");
  const r = await ve(U.mkt.token, "marketing.ads.vincular", { id: CAMPA.id, plataforma: "meta", externoId: "111222333" });
  assert.equal(r.status, 200, JSON.stringify(r));
  const c = r.campania;
  assert.deepEqual([c.plataforma, c.externo_id, c.gasto, c.alcance, c.impresiones, c.clics], ["meta", "111222333", 180000, 30500, 52000, 910]);
  assert.deepEqual([c.externo.leads, c.externo.mensajes, c.externo.moneda], [11, 6, "CLP"]);
  assert.ok(c.sync_en && !c.sync_error);
  assert.equal(c.excedePresupuesto, false);
  // Se midió dentro de las fechas de la campaña, sin pasar de hoy.
  const consulta = ads.meta.llamadas.filter((x) => x.ruta.endsWith("/insights")).pop();
  assert.deepEqual(JSON.parse(consulta.query.time_range), { since: `${mes}-01`, until: hoy });
  // Ya no se anotan resultados a mano, y la plataforma no se vincula dos veces.
  assert.equal((await ve(U.mkt.token, "marketing.campanias.resultados", { id: CAMPA.id, datos: { gasto: 1, alcance: 1, impresiones: 1, clics: 1 } })).error, "resultados_automaticos");
  assert.equal((await ve(U.mkt.token, "marketing.ads.vincular", { id: CAMPG.id, plataforma: "meta", externoId: "111222333" })).error, "externo_ya_vinculado");
  const l = await ve(U.mkt.token, "marketing.ads.externas", { plataforma: "meta" });
  assert.equal(l.campanias.find((x) => x.id === "111222333").vinculada.id, CAMPA.id);
});

test("Google: vincula, suma las filas, convierte micros a pesos y usa los encabezados de la API", async () => {
  ads.google.metricas["777001"] = { costMicros: 95_250_000_000, impressions: 8000, clicks: 300, conversions: 7 };
  const r = await ve(U.mkt.token, "marketing.ads.vincular", { id: CAMPG.id, plataforma: "google", externoId: "777001" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual([r.campania.gasto, r.campania.impresiones, r.campania.clics, r.campania.externo.leads], [95250, 8000, 300, 7]);
  assert.equal(r.campania.alcance, 0, "Google no informa alcance: no se pisa");
  const ll = ads.google.llamadas.pop();
  assert.match(ll.url, /\/customers\/1234567890\/googleAds:search$/);
  assert.equal(ll.headers["developer-token"], undefined, "Google ya no usa token de desarrollador");
  assert.equal(ll.headers["login-customer-id"], "5556667777");
  assert.match(ll.query, /campaign\.id = 777001/);
  assert.ok(ll.headers.authorization.startsWith("Bearer ya29."));
});

test("Actualizar: lee de nuevo; un error deja los números anteriores y avisa; una cuenta en dólares no se convierte", async () => {
  ads.meta.insights["111222333"] = { spend: "310000", reach: "40000", impressions: "70000", clics: "1200", clicks: "1200", actions: [] };
  let r = await ve(U.mkt.token, "marketing.ads.sync", { id: CAMPA.id });
  assert.equal(r.status, 200);
  assert.deepEqual([r.resumen.actualizadas, r.resumen.errores.length], [1, 0]);
  let c = db.tablas.campanias.find((x) => x.id === CAMPA.id);
  assert.equal(c.gasto, 310000);
  assert.equal(excedePresupuesto(c), true); // pasó los $300.000 aprobados
  assert.equal((await ve(U.mkt.token, "marketing.campanias.get", { id: CAMPA.id })).campania.excedePresupuesto, true);

  ads.meta.fallar = "Error validating access token: Session has expired";
  r = await ve(U.jefe.token, "marketing.ads.sync", { id: CAMPA.id });
  assert.equal(r.resumen.errores.length, 1);
  assert.match(r.resumen.errores[0].error, /token venció/);
  c = db.tablas.campanias.find((x) => x.id === CAMPA.id);
  assert.equal(c.gasto, 310000, "conserva lo último que se leyó");
  assert.match(c.sync_error, /token venció/);

  ads.meta.cuenta.currency = "USD";
  r = await ve(U.mkt.token, "marketing.ads.sync", { id: CAMPA.id });
  assert.match(r.resumen.errores[0].error, /USD.*pesos chilenos/);
  ads.meta.cuenta.currency = "CLP";
  r = await ve(U.mkt.token, "marketing.ads.sync", {});
  assert.equal(r.resumen.revisadas, 2);
  assert.equal(db.tablas.campanias.find((x) => x.id === CAMPA.id).sync_error, null);

  ads.google.fallar = 403;
  r = await ve(U.mkt.token, "marketing.ads.sync", { id: CAMPG.id });
  assert.match(r.resumen.errores[0].error, /acceso de prueba/);
});

test("Importar y desvincular: crea la campaña del CRM desde la de la plataforma (en borrador) y se puede soltar", async () => {
  ads.meta.insights["444555666"] = { spend: "42000", reach: "9000", impressions: "15000", clicks: "180", actions: [] };
  assert.equal((await ve(U.mkt.token, "marketing.ads.importar", { plataforma: "meta", externoId: "444555666", presupuesto: -5 })).error, "presupuesto_invalido");
  const r = await ve(U.mkt.token, "marketing.ads.importar", { plataforma: "meta", externoId: "444555666", presupuesto: 200000 });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual([r.campania.nombre, r.campania.canal, r.campania.estado, r.campania.presupuesto, r.campania.gasto], ["Retargeting sitio", "facebook", "borrador", 200000, 42000]);
  assert.equal((await ve(U.mkt.token, "marketing.ads.importar", { plataforma: "meta", externoId: "444555666", presupuesto: 1 })).error, "externo_ya_vinculado");
  const d = await ve(U.mkt.token, "marketing.ads.desvincular", { id: r.campania.id });
  assert.equal(d.status, 200);
  assert.deepEqual([d.campania.plataforma, d.campania.externo_id, d.campania.sync_en], [null, null, null]);
  assert.equal(d.campania.gasto, 42000, "queda lo último leído y vuelve a ser manual");
  assert.equal((await ve(U.mkt.token, "marketing.ads.desvincular", { id: r.campania.id })).error, "sin_vinculo");
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "campania.vincular") && db.tablas.bitacora.some((b) => b.accion === "campania.importar"));
});

test("Tarea programada: lee todas las vinculadas, solo con el secreto", async () => {
  entorno.CRON_SECRET = "secreto-cron-de-prueba-largo";
  const llamar = (secreto) => manejar(new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cronAds", secreto }) }));
  assert.equal((await llamar("otro-secreto-que-no-es-el-bueno")).status, 401);
  const ok = await llamar("secreto-cron-de-prueba-largo");
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.equal(j.ok, true);
  assert.equal(j.resumen.revisadas, 2);
});
