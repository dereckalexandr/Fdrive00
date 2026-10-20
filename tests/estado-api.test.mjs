// Estado del sistema (solo la cuenta maestra) y chequeo de salud para monitores externos, contra la función real.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, obtener, db } from "./helpers/api-env.mjs";

let admin;
before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
});

test("Salud: responde por GET sin sesión y no entrega datos", async () => {
  const r = await obtener("?health=1");
  assert.equal(r.status, 200);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r).sort(), ["ms", "ok", "status"]);
});

test("Sin la marca de salud, un GET sigue siendo rechazado", async () => {
  assert.equal((await obtener("")).status, 405);
});

test("Estado del sistema: solo la cuenta maestra", async () => {
  const r = await crm(admin, "sistema.estado");
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(typeof r.dbMs, "number");
  assert.equal(r.respaldo, null, "sin respaldos todavía");
  assert.equal(r.avisos.activo, true);
  assert.equal(r.avisos.fallidos7d, 0);
  assert.ok("usuarios" in r.conteos);
  const loc = await crm(admin, "locales.create", { nombre: "Casa matriz" });
  const u = await crm(admin, "usuarios.create", { datos: { nombre: "Jefa", rut: "12.345.678-5", roles: ["jefe_local"], localId: loc.local.id }, clave: "Prueba12345" });
  assert.equal(u.status, 200);
  nuevaIp();
  const l = await api({ action: "userLogin", rut: "12.345.678-5", password: "Prueba12345" });
  assert.equal((await api({ action: "crm", token: l.token, op: "sistema.estado" })).status, 403);
});

test("Estado del sistema: muestra el último respaldo y los avisos fallidos de la semana", async () => {
  const ahora = new Date().toISOString();
  db.tablas.bitacora.push({ id: 9001, creado_en: ahora, actor_tipo: "sistema", actor_nombre: "Respaldo", accion: "respaldo.realizado", detalle: { filas: 246, tablas: 26 } });
  db.tablas.bitacora.push({ id: 9002, creado_en: ahora, actor_tipo: "sistema", accion: "aviso.fallido", detalle: { asunto: "Nuevo lead asignado", error: "Resend rechazó el envío (403)" } });
  db.tablas.bitacora.push({ id: 9003, creado_en: "2020-01-01T00:00:00.000Z", actor_tipo: "sistema", accion: "aviso.fallido", detalle: { error: "viejo" } });
  db.tablas.bitacora.push({ id: 9004, creado_en: ahora, actor_tipo: "sistema", accion: "aviso.omitido", detalle: {} });
  const r = await crm(admin, "sistema.estado");
  assert.equal(r.respaldo.detalle.filas, 246);
  assert.equal(r.avisos.fallidos7d, 1, "el fallo de 2020 no cuenta");
  assert.equal(r.avisos.omitidos7d, 1);
  assert.equal(r.avisos.ultimosFallos[0].asunto, "Nuevo lead asignado");
});
