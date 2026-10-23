import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db, correos, entorno } from "./helpers/api-env.mjs";
import { alertasPendientes, agruparPorDestinatario, lineasDeAlerta, cargaDelEquipo } from "../supabase/functions/api/alertas-leads-core.js";

const CFG = { horas_primer_contacto: 2, horas_sin_contacto: 4, dias_detenido: 7 };
const AHORA = new Date("2026-10-23T12:00:00Z");
const hace = (h) => new Date(AHORA.getTime() - h * 3600_000).toISOString();
const lead = (o) => ({ id: "l", etapa: "nuevo", tipo: "venta", local_id: "L1", asignado_a: "e1", ultimo_contacto: null, creado_en: hace(1), actualizado_en: hace(1), ...o });

test("Alertas: quién recibe cada plazo vencido, y solo una vez", () => {
  const jefes = new Map([["L1", ["j1"]]]);
  const leads = [lead({ id: "a", creado_en: hace(3) }), lead({ id: "b", creado_en: hace(5) }), lead({ id: "c", creado_en: hace(1) }),
    lead({ id: "d", etapa: "cotizado", ultimo_contacto: hace(300), creado_en: hace(400), actualizado_en: hace(300) }), lead({ id: "e", etapa: "ganado", creado_en: hace(90) }),
    lead({ id: "f", asignado_a: null, creado_en: hace(3) })];
  const r = alertasPendientes({ leads, jefesPorLocal: jefes, ahora: AHORA, cfg: CFG });
  const de = (id) => r.filter((x) => x.leadId === id).map((x) => `${x.tipo}:${x.para.join("+")}`);
  assert.deepEqual(de("a"), ["primer_contacto:e1"]);
  assert.deepEqual(de("b"), ["primer_contacto:e1", "sin_contacto:j1"]);
  assert.deepEqual(de("c"), []);
  assert.deepEqual(de("d"), ["detenido:e1"]);
  assert.deepEqual(de("e"), [], "cerrado");
  assert.deepEqual(de("f"), ["primer_contacto:j1"], "sin ejecutivo: al Jefe");
  const otra = alertasPendientes({ leads, jefesPorLocal: jefes, ahora: AHORA, cfg: CFG, enviadas: new Set(["a|primer_contacto", "b|primer_contacto"]) });
  assert.deepEqual(otra.filter((x) => x.leadId === "a" || x.leadId === "b").map((x) => `${x.leadId}:${x.tipo}`), ["b:sin_contacto"]);
  const g = agruparPorDestinatario(r);
  assert.equal(g.get("e1").primer_contacto.length, 2);
  assert.equal(g.get("j1").sin_contacto.length, 1);
  const texto = lineasDeAlerta(g.get("e1"), CFG, new Map([["a", "Ana"]])).join("\n");
  assert.match(texto, /2 leads nuevos sin primer contacto/);
  assert.match(texto, /• Ana/);
});

test("Carga del equipo", () => {
  const leads = [lead({ id: "a", creado_en: hace(3) }), lead({ id: "b", etapa: "contactado", ultimo_contacto: hace(1), tipo: "compra" }), lead({ id: "c", asignado_a: "e2" }), lead({ id: "d", asignado_a: null }), lead({ id: "x", etapa: "perdido" })];
  const tareas = [{ lead_id: "b", vence_en: hace(2) }, { lead_id: "c", vence_en: new Date(AHORA.getTime() + 3600_000).toISOString() }];
  const r = cargaDelEquipo({ ejecutivos: [{ id: "e1", nombre: "Eva" }, { id: "e2", nombre: "Marcos" }, { id: "e3", nombre: "Zoe" }], leads, tareasPendientes: tareas, ahora: AHORA, cfg: CFG });
  const e1 = r.filas.find((f) => f.id === "e1");
  assert.deepEqual([e1.abiertos, e1.porAtender, e1.atrasadosContacto, e1.sinProxima, e1.vencidas, e1.porTipo.compra], [2, 1, 1, 1, 1, 1]);
  assert.equal(r.filas.find((f) => f.id === "e2").sinProxima, 0);
  assert.equal(r.filas.find((f) => f.id === "e3").abiertos, 0);
  assert.equal(r.sinAsignar.abiertos, 1);
  assert.equal(r.filas[0].id, "e1", "el más atrasado va primero");
});

// ---- contra la función real ----
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1; let n = 0;
async function crear(clave, nombre, rut, roles, extra, email) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId: L1, extra, email }, clave: CLAVE });
  assert.equal(r.status, 200, JSON.stringify(r));
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token };
}
const ve = (t, op, extra = {}) => api({ action: "ventas", token: t, op, ...extra });
const cron = (secreto) => api({ action: "cronAlertas", secreto });

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], undefined, "julia@x.cl");
  await crear("e1", "Eva Ejecutiva", "6.000.000-K", ["ejecutivo"], undefined, "eva@x.cl");
  await crear("e2", "Marcos Sin Correo", "7.654.321-6", ["ejecutivo"]);
});

test("Tarea programada: exige el secreto, manda un correo por persona y no repite", async () => {
  entorno.CRON_SECRET = "secreto-cron-de-prueba-123";
  assert.equal((await cron("malo")).status, 401);
  assert.equal((await cron("")).status, 401);
  const r0 = await ve(U.e1.token, "leads.create", { cliente: { nombre: "Cliente Atrasado", telefono: "911111111" }, lead: { fuente: "Llamada" } });
  assert.equal(r0.status, 200, JSON.stringify(r0));
  const fila = db.tablas.leads.find((l) => l.id === r0.lead.id);
  fila.creado_en = new Date(Date.now() - 5 * 3600_000).toISOString();
  fila.asignado_a = U.e1.id;
  db.tablas.alertas_leads = db.tablas.alertas_leads || [];
  correos.length = 0;
  const r = await cron("secreto-cron-de-prueba-123");
  assert.equal(r.status, 200, JSON.stringify(r));
  const para = correos.map((c) => c.to.join()).sort();
  assert.deepEqual(para, ["eva@x.cl", "julia@x.cl"]);
  assert.match(correos.find((c) => c.to[0] === "eva@x.cl").html, /Cliente Atrasado/);
  assert.equal(db.tablas.alertas_leads.length, 2);
  correos.length = 0;
  assert.equal((await cron("secreto-cron-de-prueba-123")).status, 200);
  assert.equal(correos.length, 0, "no se repite");
});

test("Carga del equipo: solo la ve el Jefe Local", async () => {
  assert.equal((await ve(U.e1.token, "equipo.carga")).status, 403);
  const r = await ve(U.jefe.token, "equipo.carga");
  assert.equal(r.status, 200, JSON.stringify(r));
  const eva = r.filas.find((f) => f.nombre === "Eva Ejecutiva");
  assert.equal(eva.abiertos, 1);
  assert.equal(eva.atrasadosContacto, 1);
});
