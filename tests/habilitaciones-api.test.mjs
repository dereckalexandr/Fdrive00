// Habilitaciones del Ejecutivo: Ventas por defecto al crear; Compras y Consignaciones las activa el Jefe Local (o el Administrador).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";
import { permisosEfectivos } from "../supabase/functions/api/crm-core.js";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1; let L2;

async function crear(clave, nombre, rut, roles, localId, extra) {
  const datos = { nombre, rut, roles, localId, ...(extra ? { extra } : {}) };
  const r = await crm(admin, "usuarios.create", { datos, clave: CLAVE });
  assert.equal(r.status, 200, JSON.stringify(r));
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token, me: l.me, creado: r.usuario };
}
const fila = (id) => db.tablas.usuarios.find((u) => u.id === id);
const efectivos = (id) => permisosEfectivos(fila(id).roles, {}, fila(id).permisos_extra);
const estado = async (token, id) => (await ve(token, "equipo.habilitaciones")).ejecutivos.find((e) => e.id === id);

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  L2 = (await crm(admin, "locales.create", { nombre: "Sucursal Sur" })).local.id;
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("jefeSur", "Jorge Sur", "8.765.432-K", ["jefe_local"], L2);
  await crear("eje", "Eva Ejecutiva", "6.000.000-K", ["ejecutivo"], L1); // sin indicar nada: debe nacer con Ventas
  await crear("ejeSinVentas", "Beto Sin Ventas", "7.654.321-6", ["ejecutivo"], L1, { otorgar: [], quitar: ["ventas.operar"] });
  await crear("ejeSur", "Sara Sur", "9.876.543-3", ["ejecutivo"], L2);
  await crear("tasador", "Tito Tasador", "5.555.555-9", ["tasador"], L1);
});

test("Todo Ejecutivo nuevo nace con Ventas; Compras y Consignaciones, desactivadas", () => {
  const p = efectivos(U.eje.id);
  assert.ok(p.includes("ventas.operar"), "Ventas por defecto");
  assert.ok(!p.includes("compras.operar"));
  assert.ok(!p.includes("consignaciones.operar"));
  assert.ok(U.eje.me.permisos.includes("ventas.operar"), "y ya lo ve al ingresar");
  assert.ok(efectivos(U.ejeSur.id).includes("ventas.operar"), "también en otro local");
});

test("Si quien lo crea decide a propósito sin Ventas, se respeta; otros roles no reciben Ventas", () => {
  assert.ok(!efectivos(U.ejeSinVentas.id).includes("ventas.operar"));
  for (const id of [U.jefe.id, U.tasador.id]) assert.ok(!efectivos(id).includes("ventas.operar"), "solo los ejecutivos");
});

test("Al sumarle el rol Ejecutivo a una persona que ya existe, también parte con Ventas; si ya era ejecutivo, no se le cambia nada", async () => {
  const tas = fila(U.tasador.id);
  const r = await crm(admin, "usuarios.update", { id: tas.id, datos: { nombre: tas.nombre, roles: ["tasador", "ejecutivo"], localId: L1, extra: { otorgar: [], quitar: [] } } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.ok(efectivos(tas.id).includes("ventas.operar"));
  // Un ejecutivo al que se le quitó Ventas a propósito y se guarda de nuevo sin cambios: no se le devuelve.
  const b = fila(U.ejeSinVentas.id);
  await crm(admin, "usuarios.update", { id: b.id, datos: { nombre: b.nombre, roles: ["ejecutivo"], localId: L1, extra: { otorgar: [], quitar: [] } } });
  assert.ok(!efectivos(b.id).includes("ventas.operar"), "una edición común no le agrega Ventas");
});

test("El Jefe Local ve a los ejecutivos de su local con sus habilitaciones; otro local, no", async () => {
  const r = await ve(U.jefe.token, "equipo.habilitaciones");
  assert.equal(r.status, 200);
  const nombres = r.ejecutivos.map((e) => e.nombre);
  assert.ok(nombres.includes("Eva Ejecutiva") && nombres.includes("Beto Sin Ventas"));
  assert.ok(!nombres.includes("Sara Sur"), "otro local no");
  const eva = r.ejecutivos.find((e) => e.nombre === "Eva Ejecutiva");
  assert.deepEqual([eva.ventas, eva.compras, eva.consignaciones, eva.activo], [true, false, false, true]);
  assert.equal((await ve(U.jefeSur.token, "equipo.habilitaciones")).ejecutivos.map((e) => e.nombre).join(), "Sara Sur");
});

test("El Jefe Local activa y desactiva Compras y Consignaciones; el cambio se aplica a la persona", async () => {
  let r = await ve(U.jefe.token, "equipo.habilitar", { usuarioId: U.eje.id, permiso: "compras.operar", activo: true });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual([r.ejecutivo.compras, r.ejecutivo.consignaciones, r.ejecutivo.ventas], [true, false, true]);
  assert.ok(efectivos(U.eje.id).includes("compras.operar"));
  r = await ve(U.jefe.token, "equipo.habilitar", { usuarioId: U.eje.id, permiso: "consignaciones.operar", activo: true });
  assert.deepEqual([r.ejecutivo.compras, r.ejecutivo.consignaciones], [true, true]);
  // La persona lo ve al volver a ingresar (o en segundos), y puede trabajar leads de compra.
  nuevaIp();
  const l = await api({ action: "userLogin", rut: "6.000.000-K", password: CLAVE });
  assert.ok(l.me.permisos.includes("compras.operar") && l.me.permisos.includes("consignaciones.operar"));
  r = await ve(U.jefe.token, "equipo.habilitar", { usuarioId: U.eje.id, permiso: "compras.operar", activo: false });
  assert.deepEqual([r.ejecutivo.compras, r.ejecutivo.consignaciones, r.ejecutivo.ventas], [false, true, true], "solo cambia lo pedido");
  await ve(U.jefe.token, "equipo.habilitar", { usuarioId: U.eje.id, permiso: "consignaciones.operar", activo: false });
  const e = await estado(U.jefe.token, U.eje.id);
  assert.deepEqual([e.ventas, e.compras, e.consignaciones], [true, false, false]);
  // Queda en la bitácora.
  const bit = db.tablas.bitacora.filter((b) => b.accion === "usuario.habilitar");
  assert.equal(bit.length, 4);
  assert.equal(bit[0].actor_nombre, "Julia Jefa");
  assert.equal(bit[0].detalle.permiso, "compras.operar");
  assert.equal(bit[0].detalle.despues.compras, true);
});

test("El Jefe Local NO puede tocar Ventas, ni a personas de otro local, ni a quien no es ejecutivo", async () => {
  const habilitar = (token, usuarioId, permiso, activo = true) => ve(token, "equipo.habilitar", { usuarioId, permiso, activo });
  assert.equal((await habilitar(U.jefe.token, U.ejeSinVentas.id, "ventas.operar")).error, "permiso_invalido", "Ventas la maneja el Administrador");
  assert.ok(!efectivos(U.ejeSinVentas.id).includes("ventas.operar"));
  assert.equal((await habilitar(U.jefe.token, U.eje.id, "leads.asignar")).error, "permiso_invalido", "nada fuera de Compras y Consignaciones");
  assert.equal((await habilitar(U.jefe.token, U.ejeSur.id, "compras.operar")).status, 404, "otro local");
  assert.equal((await habilitar(U.jefeSur.token, U.eje.id, "compras.operar")).status, 404);
  const sinEjecutivo = db.tablas.usuarios.find((u) => u.nombre === "Julia Jefa");
  assert.equal((await habilitar(U.jefe.token, sinEjecutivo.id, "compras.operar")).error, "no_es_ejecutivo");
  assert.equal((await ve(U.jefe.token, "equipo.habilitar", { usuarioId: U.eje.id, permiso: "compras.operar", activo: "si" })).error, "valor_invalido");
  assert.equal((await habilitar(U.jefe.token, "no-existe", "compras.operar")).status, 404);
  assert.ok(!efectivos(U.ejeSur.id).includes("compras.operar"));
});

test("Quien no es supervisor (ejecutivo, tasador) no puede ver ni cambiar habilitaciones", async () => {
  for (const u of [U.eje, U.tasador, U.ejeSinVentas]) {
    assert.equal((await ve(u.token, "equipo.habilitaciones")).status, 403);
    assert.equal((await ve(u.token, "equipo.habilitar", { usuarioId: U.eje.id, permiso: "compras.operar", activo: true })).status, 403);
  }
  assert.equal((await ve(null, "equipo.habilitaciones")).status, 401);
  assert.ok(!efectivos(U.eje.id).includes("compras.operar"));
});

test("La cuenta maestra también puede, en cualquier local", async () => {
  const r = await ve(admin, "equipo.habilitar", { usuarioId: U.ejeSur.id, permiso: "consignaciones.operar", activo: true, localId: L2 });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.ok(efectivos(U.ejeSur.id).includes("consignaciones.operar"));
  assert.ok((await ve(admin, "equipo.habilitaciones", { localId: L2 })).ejecutivos.some((e) => e.nombre === "Sara Sur" && e.consignaciones));
});

test("Quitar una habilitación que el rol ya daba por defecto la quita de verdad", async () => {
  // Si el Administrador le da Compras al rol Ejecutivo entero, desactivarla a una persona debe quitársela expresamente.
  const base = permisosEfectivos(["ejecutivo"], {}, { otorgar: [], quitar: [] });
  assert.equal((await crm(admin, "permisos.setRol", { rol: "ejecutivo", permisos: [...base, "compras.operar"] })).status, 200);
  try {
    const u = fila(U.eje.id);
    const r = await ve(U.jefe.token, "equipo.habilitar", { usuarioId: u.id, permiso: "compras.operar", activo: false });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.ejecutivo.compras, false);
    assert.ok(fila(u.id).permisos_extra.quitar.includes("compras.operar"));
    assert.equal((await estado(U.jefe.token, u.id)).compras, false);
  } finally { await crm(admin, "permisos.reiniciarRol", { rol: "ejecutivo" }); }
});
