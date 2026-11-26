// Archivos pesados en Storage, contra la función real y una base y un Storage falsos: subir, leer, borrar, fallas y migración.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db, manejar } from "./helpers/api-env.mjs";

const kv = (token, op, extra = {}) => api({ action: "kv", token, op, ...extra });
const foto = (...bytes) => `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
const FOTO = foto(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5);
const fila = (key) => db.tablas.kv_store.find((f) => f.key === key);
const objeto = (ruta) => db.objetos.get(`archivos/${ruta}`);
let admin;

before(async () => { await iniciarFuncion(); admin = await loginAdmin(); });
beforeEach(() => { db.fallos.subida = false; db.fallos.bajada = false; db.objetos.clear(); db.tablas.kv_store.length = 0; });

test("Subir una foto: el contenido va a Storage, la base guarda solo el marcador y se lee igual que antes", async () => {
  assert.equal((await kv(admin, "set", { key: "foto::u1::f1", value: FOTO })).ok, true);
  assert.equal(fila("foto::u1::f1").value, "@archivo:df/foto/u1/f1", "en la base queda solo el marcador");
  const o = objeto("df/foto/u1/f1");
  assert.equal(o.type, "image/jpeg");
  assert.deepEqual([...o.bytes], [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
  const g = await kv(admin, "get", { key: "foto::u1::f1" });
  assert.equal(g.value, FOTO, "el navegador recibe la misma dirección data: de siempre");
});

test("Volver a subir la misma clave reemplaza el contenido (no queda el anterior)", async () => {
  await kv(admin, "set", { key: "ifoto::fich::a", value: foto(1, 1, 1) });
  await kv(admin, "set", { key: "ifoto::fich::a", value: foto(9, 9) });
  assert.deepEqual([...objeto("df/ifoto/fich/a").bytes], [9, 9]);
  assert.equal(db.objetos.size, 1);
  assert.equal((await kv(admin, "get", { key: "ifoto::fich::a" })).value, foto(9, 9));
});

test("La configuración pequeña NO va a Storage: sigue en la base tal cual", async () => {
  await kv(admin, "set", { key: "inspeccion::u1::fi1", value: JSON.stringify({ patente: "ABCD12" }) });
  await kv(admin, "set", { key: "empresa::datos", value: "{\"razon\":\"X\"}" });
  assert.equal(fila("inspeccion::u1::fi1").value, "{\"patente\":\"ABCD12\"}");
  assert.equal(db.objetos.size, 0);
  assert.equal((await kv(admin, "get", { key: "empresa::datos" })).value, "{\"razon\":\"X\"}");
});

test("Lo que ya estaba guardado dentro de la base (como antes) se sigue leyendo sin migrar", async () => {
  db.tablas.kv_store.push({ key: "vfoto::v1::viejo", value: FOTO });
  assert.equal((await kv(admin, "get", { key: "vfoto::v1::viejo" })).value, FOTO);
});

test("Borrar elimina la fila y también el archivo de Storage", async () => {
  await kv(admin, "set", { key: "dval::val1::arch1", value: `data:application/pdf;base64,${Buffer.from("%PDF-1.4 hola").toString("base64")}` });
  assert.equal(db.objetos.size, 1);
  assert.equal((await kv(admin, "delete", { key: "dval::val1::arch1" })).ok, true);
  assert.equal(fila("dval::val1::arch1"), undefined);
  assert.equal(db.objetos.size, 0);
  assert.equal((await kv(admin, "get", { key: "dval::val1::arch1" })).value, null);
});

test("Listar por prefijo sigue funcionando con los marcadores", async () => {
  for (const id of ["a", "b", "c"]) await kv(admin, "set", { key: `ifoto::ficha9::${id}`, value: foto(1, 2) });
  await kv(admin, "set", { key: "ifoto::otra::z", value: foto(3) });
  const l = await kv(admin, "list", { prefix: "ifoto::ficha9::" });
  assert.deepEqual(l.keys.sort(), ["ifoto::ficha9::a", "ifoto::ficha9::b", "ifoto::ficha9::c"]);
});

test("Si Storage está caído al subir, el archivo queda en la base: nunca se pierde lo que la persona subió", async () => {
  db.fallos.subida = true;
  assert.equal((await kv(admin, "set", { key: "foto::u1::f2", value: FOTO })).ok, true);
  assert.equal(fila("foto::u1::f2").value, FOTO);
  assert.equal(db.objetos.size, 0);
  assert.equal((await kv(admin, "get", { key: "foto::u1::f2" })).value, FOTO);
});

test("Si Storage está caído al leer, no se cae el servidor: responde sin contenido", async () => {
  await kv(admin, "set", { key: "foto::u1::f3", value: FOTO });
  db.fallos.bajada = true;
  const g = await kv(admin, "get", { key: "foto::u1::f3" });
  assert.equal(g.status, 200);
  assert.equal(g.value, null);
  db.fallos.bajada = false;
  assert.equal((await kv(admin, "get", { key: "foto::u1::f3" })).value, FOTO, "al volver Storage, el archivo sigue ahí");
});

test("Un valor que no es una dirección data: en una clave de archivo se guarda tal cual (sin romper nada)", async () => {
  await kv(admin, "set", { key: "foto::u1::raro", value: "texto cualquiera" });
  assert.equal(fila("foto::u1::raro").value, "texto cualquiera");
  assert.equal(db.objetos.size, 0);
});

test("Migración: estado, lotes, verificación y archivos que no se pueden mover quedan intactos", async () => {
  const lista = [
    ["ifoto::f1::a", foto(1, 2, 3)], ["ifoto::f1::b", foto(4, 5, 6, 7)], ["foto::u::c", foto(8)], ["vfoto::v::d", foto(9, 9)],
    ["dval::x::e", `data:application/pdf;base64,${Buffer.from("PDF").toString("base64")}`], ["wamedia::c::m", "data:audio/ogg;base64,AAEC"],
  ];
  for (const [key, value] of lista) db.tablas.kv_store.push({ key, value, shared: false });
  db.tablas.kv_store.push({ key: "foto::u::roto", value: "data:image/jpeg;base64,@@@no-es-base64@@@" }); // no se puede mover
  db.tablas.kv_store.push({ key: "empresa::datos", value: "{\"a\":1}" }); // configuración: no se toca

  const e0 = await crm(admin, "archivos.estado");
  assert.deepEqual([e0.enLaBase, e0.enStorage], [7, 0], "el archivo roto también cuenta como pendiente");

  const l1 = await crm(admin, "archivos.migrar", { limite: 4 });
  assert.equal(l1.movidos, 4);
  assert.deepEqual(l1.fallos, []);
  const l2 = await crm(admin, "archivos.migrar", { limite: 4 });
  assert.equal(l2.movidos, 2);
  assert.equal(l2.fallos.length, 1, "el archivo roto se informa");
  assert.match(l2.fallos[0], /foto::u::roto/);

  const e1 = await crm(admin, "archivos.estado");
  assert.deepEqual([e1.enLaBase, e1.enStorage], [1, 6], "queda solo el roto, sin tocar");
  assert.equal(fila("foto::u::roto").value, "data:image/jpeg;base64,@@@no-es-base64@@@", "lo roto queda intacto");
  assert.equal(fila("empresa::datos").value, "{\"a\":1}");
  for (const [key, value] of lista) {
    assert.match(fila(key).value, /^@archivo:df\//, key);
    assert.equal((await kv(admin, "get", { key })).value, value, `${key} se lee igual después de migrar`);
  }
  // Repetir no mueve nada más y no duplica.
  assert.equal((await crm(admin, "archivos.migrar", { limite: 20 })).movidos, 0);
  assert.equal(db.objetos.size, 6);
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "archivos.migrar"));
});

test("Migración: si Storage falla o la copia no coincide, el archivo queda en la base", async () => {
  db.tablas.kv_store.push({ key: "foto::u::q", value: FOTO });
  db.fallos.subida = true;
  const r = await crm(admin, "archivos.migrar", { limite: 5 });
  assert.equal(r.movidos, 0);
  assert.equal(r.fallos.length, 1);
  assert.equal(fila("foto::u::q").value, FOTO);
});

test("Solo el Administrador puede ver el estado y migrar", async () => {
  await crm(admin, "locales.create", { nombre: "Casa matriz" });
  const L = (await crm(admin, "locales.list")).locales[0].id;
  const c = await crm(admin, "usuarios.create", { datos: { nombre: "Ana", rut: "11.111.111-1", roles: ["ejecutivo"], localId: L }, clave: "Prueba12345" });
  assert.equal(c.status, 200);
  nuevaIp();
  const u = (await api({ action: "userLogin", rut: "11.111.111-1", password: "Prueba12345" })).token;
  assert.equal((await crm(u, "archivos.estado")).status, 403);
  assert.equal((await crm(u, "archivos.migrar")).status, 403);
  assert.equal((await crm("token-falso", "archivos.estado")).status, 401);
});

test("La foto pública del catálogo se sirve desde Storage", async () => {
  const L = (await crm(admin, "locales.list")).locales[0].id;
  const vid = randomUUID();
  db.tablas.vehiculos.push({ id: vid, local_id: L, activo: true, estado: "disponible", precio_lista: 9000000, fotos: ["fotoA"], patente: "AAAA11", marca: "X", modelo: "Y", anio: 2020 });
  await kv(admin, "set", { key: `vfoto::${vid}::fotoA`, value: FOTO });
  assert.match(fila(`vfoto::${vid}::fotoA`).value, /^@archivo:/);
  const r = await manejar(new Request(`http://x/api?vfoto=${vid}&f=fotoA`, { method: "GET" }));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/jpeg");
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
});
