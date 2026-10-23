// Eliminar personas del CRM (solo la cuenta maestra): solo desactivadas y sin historial que se perdería.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";

let admin; let L;
const RUTS = ["6.000.000-K", "7.654.321-6", "9.876.543-3", "8.765.432-K", "13.000.000-2", "14.000.000-0", "12.000.000-4", "5.555.555-9", "10.000.013-K", "12.345.678-5"];
let n = 0;
async function crear(nombre, roles, extra) {
  const rut = RUTS[n++];
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId: L, extra }, clave: "Prueba12345" });
  assert.equal(r.status, 200, JSON.stringify(r));
  return { id: r.usuario.id, rut, nombre };
}
const existe = (id) => db.tablas.usuarios.some((u) => u.id === id);

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
});

test("Eliminar: primero hay que desactivar y confirmar con el nombre; solo la cuenta maestra puede", async () => {
  const u = await crear("Beto Borrar", ["ejecutivo"]);
  assert.equal((await crm(admin, "usuarios.delete", { id: u.id, confirmar: "Beto Borrar" })).error, "desactivar_primero");
  assert.ok(existe(u.id));
  assert.equal((await crm(admin, "usuarios.setActivo", { id: u.id, activo: false })).status, 200);
  assert.equal((await crm(admin, "usuarios.delete", { id: u.id, confirmar: "otro nombre" })).error, "confirmacion_invalida");
  assert.equal((await crm(admin, "usuarios.delete", { id: u.id })).error, "confirmacion_invalida");
  assert.ok(existe(u.id));
  // Una persona del CRM no puede eliminar a nadie.
  const jefe = await crear("Julia Jefa", ["jefe_local"]);
  nuevaIp();
  const l = await api({ action: "userLogin", rut: jefe.rut, password: "Prueba12345" });
  assert.equal((await crm(l.token, "usuarios.delete", { id: u.id, confirmar: "Beto Borrar" })).status, 403);
  assert.equal((await crm(l.token, "usuarios.impacto", { id: u.id })).status, 403);
  assert.equal((await crm(null, "usuarios.delete", { id: u.id, confirmar: "Beto Borrar" })).status, 401);
  assert.ok(existe(u.id));
});

test("Eliminar a alguien sin historial: desaparece, no puede ingresar, su RUT queda libre y queda en la bitácora", async () => {
  const u = await crear("Carla Sinhistorial", ["tasador"]);
  nuevaIp();
  const l = await api({ action: "userLogin", rut: u.rut, password: "Prueba12345" });
  assert.equal(l.status, 200);
  await crm(admin, "usuarios.setActivo", { id: u.id, activo: false });
  const imp = await crm(admin, "usuarios.impacto", { id: u.id });
  assert.deepEqual([imp.bloqueos, imp.avisos, imp.activo], [[], [], false]);
  const r = await crm(admin, "usuarios.delete", { id: u.id, confirmar: "  carla sinhistorial " });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.ok(!existe(u.id));
  assert.ok(!(await crm(admin, "usuarios.list")).usuarios.some((x) => x.id === u.id));
  nuevaIp();
  assert.equal((await api({ action: "userLogin", rut: u.rut, password: "Prueba12345" })).status, 401);
  assert.equal((await api({ action: "kv", token: l.token, op: "get", key: "x" })).status, 401, "su sesión abierta deja de servir");
  const bit = db.tablas.bitacora.find((b) => b.accion === "usuario.eliminar");
  assert.ok(bit);
  assert.equal(bit.detalle.nombre, "Carla Sinhistorial");
  assert.equal(JSON.stringify(bit).includes("pbkdf2"), false, "la bitácora no guarda la clave");
  const otra = await crm(admin, "usuarios.create", { datos: { nombre: "Otra Persona", rut: u.rut, roles: ["tasador"], localId: L }, clave: "Prueba12345" });
  assert.equal(otra.status, 200, "el RUT se puede volver a usar");
  assert.equal((await crm(admin, "usuarios.delete", { id: u.id, confirmar: "Carla Sinhistorial" })).status, 404, "ya no existe");
});

test("Con ventas, compras, consignaciones o fichas NO se elimina (se perdería el historial y las comisiones)", async () => {
  for (const [tabla, que] of [["cierres", "ventas cerradas"], ["compras", "compras"], ["consignaciones", "consignaciones"]]) {
    const u = await crear(`Con ${que}`, ["ejecutivo"]);
    db.tablas[tabla].push({ id: randomUUID(), ejecutivo_id: u.id });
    await crm(admin, "usuarios.setActivo", { id: u.id, activo: false });
    const imp = await crm(admin, "usuarios.impacto", { id: u.id });
    assert.deepEqual(imp.bloqueos, [{ que, n: 1 }]);
    const r = await crm(admin, "usuarios.delete", { id: u.id, confirmar: u.nombre });
    assert.equal(r.status, 409);
    assert.equal(r.error, "tiene_historial");
    assert.ok(existe(u.id), `${que}: la persona sigue`);
  }
});

test("Un Inspector con fichas guardadas no se elimina; una persona con leads sí, y los leads se conservan (sin responsable)", async () => {
  const insp = await crear("Ivo Inspector", ["inspector"]);
  db.tablas.kv_store.push({ key: `inspeccion::${insp.id}::f1`, value: "{}" }, { key: `tasacion::${insp.id}::v1`, value: "{}" });
  await crm(admin, "usuarios.setActivo", { id: insp.id, activo: false });
  const imp = await crm(admin, "usuarios.impacto", { id: insp.id });
  assert.deepEqual(imp.bloqueos.map((b) => b.que).sort(), ["fichas de inspección del Inspector", "valorizaciones del Inspector"]);
  assert.equal((await crm(admin, "usuarios.delete", { id: insp.id, confirmar: "Ivo Inspector" })).status, 409);

  const eje = await crear("Eva Conleads", ["ejecutivo"]);
  const lead = { id: randomUUID(), asignado_a: eje.id };
  db.tablas.leads.push(lead);
  db.tablas.tareas.push({ id: randomUUID(), asignado_a: eje.id });
  await crm(admin, "usuarios.setActivo", { id: eje.id, activo: false });
  const i2 = await crm(admin, "usuarios.impacto", { id: eje.id });
  assert.deepEqual(i2.bloqueos, []);
  assert.deepEqual(i2.avisos, [{ que: "leads asignados", n: 1 }, { que: "tareas", n: 1 }]);
  const r = await crm(admin, "usuarios.delete", { id: eje.id, confirmar: "Eva Conleads" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.quedaronSinResponsable, i2.avisos);
  assert.ok(db.tablas.leads.some((x) => x.id === lead.id), "el lead se conserva");
});

test("Impacto de una persona que no existe", async () => {
  assert.equal((await crm(admin, "usuarios.impacto", { id: randomUUID() })).status, 404);
  assert.equal((await crm(admin, "usuarios.delete", { id: randomUUID(), confirmar: "x" })).status, 404);
});
