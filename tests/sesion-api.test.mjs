// Retomar la sesión al recargar la página (acción userMe), contra la función real.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm } from "./helpers/api-env.mjs";

let admin; let u;
before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  const loc = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  const r = await crm(admin, "usuarios.create", { datos: { nombre: "Eva Uno", rut: "6.000.000-K", roles: ["ejecutivo"], localId: loc }, clave: "Prueba12345" });
  nuevaIp();
  const l = await api({ action: "userLogin", rut: "6.000.000-K", password: "Prueba12345" });
  u = { id: r.usuario.id, token: l.token, loc };
});

test("userMe devuelve los datos y permisos actuales de quien tiene sesión", async () => {
  const r = await api({ action: "userMe", token: u.token });
  assert.equal(r.status, 200);
  assert.equal(r.me.nombre, "Eva Uno");
  assert.ok(Array.isArray(r.me.permisos));
  assert.equal(r.me.clave_hash, undefined, "nunca la clave");
});

test("userMe: sin sesión, con sesión ajena o de otro tipo, se rechaza", async () => {
  assert.equal((await api({ action: "userMe" })).status, 401);
  assert.equal((await api({ action: "userMe", token: "x.y" })).status, 401);
  assert.equal((await api({ action: "userMe", token: admin })).status, 401, "la cuenta maestra no usa userMe");
});

test("userMe: una persona desactivada pierde la sesión al recargar", async () => {
  assert.equal((await crm(admin, "usuarios.setActivo", { id: u.id, activo: false })).status, 200);
  assert.equal((await api({ action: "userMe", token: u.token })).status, 401);
});
