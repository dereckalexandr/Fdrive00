// Crear, activar y pausar campañas de Google Ads desde Marketing: validación de los textos, operaciones que se envían a Google,
// encadenamiento con la aprobación del Jefe Local y pausa automática. Contra la función real con Google Ads simulado.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { validarCampaniaGoogle, operacionesCrearGoogle, idCampaniaCreada, sugerenciasGoogle, puedeActivar, diasRestantes, GOOGLE_CHILE } from "../supabase/functions/api/ads-core.js";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db, ads, entorno, manejar } from "./helpers/api-env.mjs";

const HOY = "2026-11-10";
const C = { desde: "2026-11-01", hasta: "2026-11-30", presupuesto: 300000, estado: "aprobada" };
const DATOS = { presupuestoDiario: "10.000", url: "https://sitio.cl", titulos: "Autos Usados en Las Condes\nRevisados e Inspeccionados\nFinanciamiento a tu Medida", descripciones: "Autos revisados con historial al día.\nRecibimos tu auto en parte de pago.", palabras: "autos usados\nComprar auto usado!\nautos usados" };

test("Validación: presupuesto diario contra los días que quedan, URL, títulos, descripciones y palabras clave", () => {
  assert.equal(diasRestantes(C, HOY), 21);
  const v = validarCampaniaGoogle(DATOS, C, HOY);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.value.presupuestoDiario, 10000);
  assert.deepEqual(v.value.palabras, ["autos usados", "comprar auto usado"], "sin símbolos ni repetidas");
  assert.equal(validarCampaniaGoogle({ ...DATOS, presupuestoDiario: 20000 }, C, HOY).error, "google_diario_excede"); // 20.000 × 21 > 300.000
  assert.equal(validarCampaniaGoogle({ ...DATOS, presupuestoDiario: 500 }, C, HOY).error, "google_diario");
  assert.equal(validarCampaniaGoogle({ ...DATOS, url: "http://sitio.cl" }, C, HOY).error, "google_url");
  assert.equal(validarCampaniaGoogle({ ...DATOS, titulos: "Uno\nDos" }, C, HOY).error, "google_titulos");
  assert.equal(validarCampaniaGoogle({ ...DATOS, titulos: "Un título demasiado largo para Google Ads\nDos\nTres" }, C, HOY).error, "google_titulos");
  assert.equal(validarCampaniaGoogle({ ...DATOS, descripciones: "Solo una" }, C, HOY).error, "google_descripciones");
  assert.equal(validarCampaniaGoogle({ ...DATOS, palabras: "" }, C, HOY).error, "google_palabras");
  assert.equal(validarCampaniaGoogle(DATOS, { ...C, hasta: "2026-11-05" }, HOY).error, "campania_terminada");
  assert.deepEqual([puedeActivar(C, HOY).ok, puedeActivar({ ...C, estado: "pendiente" }, HOY).error, puedeActivar({ ...C, desde: "2026-11-20" }, HOY).error], [true, "campania_sin_aprobar", "campania_no_empieza"]);
  const s = sugerenciasGoogle({ comuna: "Las Condes", marcas: ["Hyundai", "Kia"], urlSitio: "https://sitio.cl" });
  assert.ok(s.titulos.length >= 3 && s.titulos.every((t) => t.length <= 30));
  assert.ok(s.descripciones.every((t) => t.length <= 90));
  assert.ok(s.palabras.includes("hyundai usado"));
  assert.equal(validarCampaniaGoogle({ presupuestoDiario: 10000, url: s.url, titulos: s.titulos, descripciones: s.descripciones, palabras: s.palabras }, C, HOY).ok, true, "las sugerencias son válidas tal cual");
});

test("Operaciones para Google: todo en un envío, en pausa, Chile y español, anuncio adaptable y palabras de frase", () => {
  const v = validarCampaniaGoogle(DATOS, C, HOY).value;
  const ops = operacionesCrearGoogle("1234567890", "CAM-0001 · Ofertas", v);
  assert.equal(ops[0].campaignBudgetOperation.create.amountMicros, "10000000000");
  const camp = ops[1].campaignOperation.create;
  assert.deepEqual([camp.status, camp.advertisingChannelType, camp.campaignBudget], ["PAUSED", "SEARCH", "customers/1234567890/campaignBudgets/-1"]);
  assert.equal(ops[2].campaignCriterionOperation.create.location.geoTargetConstant, GOOGLE_CHILE);
  const anuncio = ops[5].adGroupAdOperation.create.ad;
  assert.deepEqual([anuncio.finalUrls[0], anuncio.responsiveSearchAd.headlines.length, anuncio.responsiveSearchAd.descriptions.length], ["https://sitio.cl", 3, 2]);
  assert.deepEqual(ops.slice(6).map((o) => [o.adGroupCriterionOperation.create.keyword.text, o.adGroupCriterionOperation.create.keyword.matchType]), [["autos usados", "PHRASE"], ["comprar auto usado", "PHRASE"]]);
  assert.equal(idCampaniaCreada({ mutateOperationResponses: [{ campaignBudgetResult: { resourceName: "customers/1/campaignBudgets/5" } }, { campaignResult: { resourceName: "customers/1/campaigns/777" } }] }), "777");
});

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const U = {};
let admin; let L1;
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const fin = (() => { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 20); return d.toISOString().slice(0, 10); })();
async function crear(clave, nombre, rut, roles) {
  await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId: L1 }, clave: "Prueba12345" });
  nuevaIp();
  U[clave] = (await api({ action: "userLogin", rut, password: "Prueba12345" })).token;
}
before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"]);
  await crear("mkt", "Marta Marketing", "10.000.013-K", ["marketing"]);
  Object.assign(entorno, { GOOGLE_ADS_CUSTOMER_ID: "123-456-7890", GOOGLE_ADS_REFRESH_TOKEN: "r", GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s" });
  db.tablas.kv_store.push({ key: "empresa::datos", value: JSON.stringify({ razon_social: "Empresa SpA", rut: "76557869-8", comuna: "Las Condes" }) });
});

test("Flujo: sugerencias, crear en pausa y vinculada, activar solo aprobada, pausar, y pausa sola al finalizar", async () => {
  const c = (await ve(U.mkt, "marketing.campanias.save", { datos: { nombre: "Búsqueda SUV", canal: "google", objetivo: "Consultas", desde: hoy, hasta: fin, presupuesto: 420000 } })).campania;
  const s = await ve(U.mkt, "marketing.ads.google_sugerencias", { id: c.id });
  assert.equal(s.status, 200, JSON.stringify(s));
  assert.deepEqual([s.dias, s.maxDiario, s.conectado], [21, 20000, true]);
  assert.match(s.sugerencias.titulos[0], /Las Condes/);
  const datos = { presupuestoDiario: 15000, url: "https://fdrive02.vercel.app", titulos: s.sugerencias.titulos, descripciones: s.sugerencias.descripciones, palabras: s.sugerencias.palabras };
  assert.equal((await ve(U.jefe, "marketing.ads.google_crear", { id: c.id, datos })).status, 403, "el Jefe Local no crea campañas");
  const otra = (await ve(U.mkt, "marketing.campanias.save", { datos: { nombre: "Meta", canal: "facebook", objetivo: "x", desde: hoy, hasta: fin, presupuesto: 1000 } })).campania;
  assert.equal((await ve(U.mkt, "marketing.ads.google_crear", { id: otra.id, datos })).error, "canal_no_google");

  // Google rechaza: no queda nada a medias.
  ads.google.fallar = 400;
  const mal = await ve(U.mkt, "marketing.ads.google_crear", { id: c.id, datos });
  assert.equal(mal.status, 502);
  assert.match(mal.detalle, /políticas/);
  assert.equal(db.tablas.campanias.find((x) => x.id === c.id).externo_id, null);

  const r = await ve(U.mkt, "marketing.ads.google_crear", { id: c.id, datos });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual([r.campania.plataforma, r.campania.externo.estado, r.campania.externo.creada_desde_crm], ["google", "paused", true]);
  const ops = ads.google.mutaciones.pop();
  assert.equal(ops[1].campaignOperation.create.status, "PAUSED");
  assert.match(ops[1].campaignOperation.create.name, /^CAM-\d{4} · Búsqueda SUV$/);

  // Activar exige la aprobación del Jefe Local.
  assert.equal((await ve(U.mkt, "marketing.ads.activar", { id: c.id })).error, "campania_sin_aprobar");
  await ve(U.mkt, "marketing.campanias.enviar", { id: c.id });
  await ve(U.jefe, "marketing.campanias.aprobar", { id: c.id });
  assert.equal((await ve(U.jefe, "marketing.ads.activar", { id: c.id })).status, 403, "activar es de Marketing");
  const a = await ve(U.mkt, "marketing.ads.activar", { id: c.id });
  assert.equal(a.status, 200, JSON.stringify(a));
  assert.equal(a.campania.externo.estado, "enabled");
  const upd = ads.google.mutaciones.pop()[0].campaignOperation;
  assert.deepEqual([upd.update.status, upd.updateMask, upd.update.resourceName], ["ENABLED", "status", `customers/1234567890/campaigns/${r.campania.externo_id}`]);

  // El Jefe Local la puede pausar (freno de emergencia).
  const p = await ve(U.jefe, "marketing.ads.pausar", { id: c.id });
  assert.equal(p.campania.externo.estado, "paused");
  await ve(U.mkt, "marketing.ads.activar", { id: c.id });

  // Subir el presupuesto vuelve a pedir aprobación y la pausa en Google.
  const e = await ve(U.mkt, "marketing.campanias.save", { id: c.id, datos: { nombre: "Búsqueda SUV", canal: "google", objetivo: "Consultas", desde: hoy, hasta: fin, presupuesto: 600000 } });
  assert.deepEqual([e.campania.estado, e.campania.externo.estado, e.campania.externo.pausada_por], ["pendiente", "paused", "presupuesto por aprobar"]);
  await ve(U.jefe, "marketing.campanias.aprobar", { id: c.id });
  await ve(U.mkt, "marketing.ads.activar", { id: c.id });
  // Finalizar la campaña la pausa en Google.
  const f = await ve(U.mkt, "marketing.campanias.finalizar", { id: c.id });
  assert.deepEqual([f.campania.estado, f.campania.externo.estado], ["finalizada", "paused"]);
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "campania.google_crear") && db.tablas.bitacora.some((b) => b.accion === "campania.google_activar"));
});

test("Pausa automática al pasar la fecha de término; las de Meta no se tocan desde el CRM", async () => {
  const c = (await ve(U.mkt, "marketing.campanias.save", { datos: { nombre: "Corta", canal: "google", objetivo: "x", desde: hoy, hasta: fin, presupuesto: 0 } })).campania;
  await ve(U.mkt, "marketing.campanias.enviar", { id: c.id });
  const r = await ve(U.mkt, "marketing.ads.google_crear", { id: c.id, datos: { presupuestoDiario: 5000, url: "https://sitio.cl", titulos: "Uno\nDos\nTres", descripciones: "Primera descripción\nSegunda descripción", palabras: "autos usados" } });
  assert.equal(r.status, 200, JSON.stringify(r));
  await ve(U.mkt, "marketing.ads.activar", { id: c.id });
  // La campaña terminó ayer (se simula moviendo la fecha): la próxima lectura la pausa.
  const fila = db.tablas.campanias.find((x) => x.id === c.id);
  fila.hasta = "2020-01-31"; fila.desde = "2020-01-01";
  ads.google.metricas[fila.externo_id] = { costMicros: 0, impressions: 0, clicks: 0, conversions: 0 };
  await ve(U.mkt, "marketing.ads.sync", { id: c.id });
  assert.deepEqual([fila.externo.estado, fila.externo.pausada_por], ["paused", "fin de la campaña"]);
  // Meta: solo lectura.
  db.tablas.campanias.push({ ...fila, id: "00000000-0000-4000-8000-000000000001", numero: 999, plataforma: "meta", externo_id: "123456", estado: "aprobada", desde: hoy, hasta: fin });
  assert.equal((await ve(U.mkt, "marketing.ads.pausar", { id: "00000000-0000-4000-8000-000000000001" })).error, "meta_solo_lectura");
});
