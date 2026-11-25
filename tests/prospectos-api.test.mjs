// Prospección en Chileautos, contra la función real y una base falsa: permisos, guardado sin repetir y sin datos personales, estados,
// aislamiento por local y conversión del prospecto en un lead de compra.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1; let L2;

const rut = (num) => {
  let s = 0; let m = 2;
  for (const d of String(num).split("").reverse()) { s += Number(d) * m; m = m === 7 ? 2 : m + 1; }
  const r = 11 - (s % 11);
  return `${String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${r === 11 ? "0" : r === 10 ? "K" : String(r)}`;
};
async function crear(clave, nombre, run, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut: run, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut: run, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}
const aviso = (n, extra = {}) => ({ id: `CL-AD-${2000000 + n}`, titulo: `2019 Toyota Yaris ${n}`, version: "1.5 SE", transmision: "Automática", combustible: "Bencina", anio: 2019, km: 60000 + n, precio: 8_000_000 + n * 1000, destacado: false, vendedorTipo: "particular", vendedorNombre: "", href: `/vehiculos/detalles/toyota-yaris-2019/CL-AD-${2000000 + n}/?rankingType=Spot`, ...extra });
const guardados = () => db.tablas.prospectos;

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  L2 = (await crm(admin, "locales.create", { nombre: "Sucursal Sur" })).local.id;
  await crear("jefe", "Julia Jefa", rut(12345678), ["jefe_local"], L1);
  await crear("c1", "Carla Compradora", rut(7654321), ["ejecutivo"], L1, { otorgar: ["compras.operar"], quitar: ["ventas.operar"] });
  await crear("v1", "Vera Vendedora", rut(6000000), ["ejecutivo"], L1, { otorgar: ["ventas.operar"], quitar: ["compras.operar", "consignaciones.operar"] });
  await crear("c2", "Camilo Sur", rut(9999999), ["ejecutivo"], L2, { otorgar: ["compras.operar"], quitar: ["ventas.operar"] });
});

test("Permisos: prospectan quienes compran o consignan, los supervisores y el Administrador; un vendedor no", async () => {
  assert.equal((await ve(U.v1.token, "prospectos.lista")).status, 403);
  assert.equal((await ve(U.v1.token, "prospectos.guardar", { avisos: [aviso(1)] })).status, 403);
  assert.equal((await ve(U.c1.token, "prospectos.lista")).status, 200);
  assert.equal((await ve(U.jefe.token, "prospectos.lista")).status, 200);
  assert.equal((await ve(admin, "prospectos.lista", { localId: L1 })).status, 200);
  assert.equal((await ve(admin, "prospectos.lista")).error, "sin_local", "el Administrador con dos locales debe elegir uno");
  const r = await ve(U.c1.token, "prospectos.lista");
  assert.deepEqual(r.prospectos, []);
  assert.deepEqual(r.estados.map((e) => e.id), ["nuevo", "contactado", "respondio", "descartado", "convertido"]);
  assert.equal((await ve(U.c1.token, "prospectos.otra_cosa")).error, "op_desconocida");
});

test("Guardar: entran solo los avisos válidos, sin datos personales, y los repetidos no se duplican", async () => {
  const antes = guardados().length;
  const sucio = { ...aviso(1), telefono: "+56 9 1111 2222", nombre: "Juan Pérez", email: "juan@correo.cl", vendedorNombre: "Juan Pérez" };
  const r = await ve(U.c1.token, "prospectos.guardar", { avisos: [sucio, aviso(2), aviso(3, { vendedorTipo: "automotora", vendedorNombre: "Autos del Sur", destacado: true }), { id: "falso", href: "http://malo.cl" }] });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual([r.nuevos, r.repetidos, r.descartados], [3, 0, 1]);
  assert.equal(guardados().length, antes + 3);
  const p1 = guardados().find((p) => p.aviso_id === "CL-AD-2000001");
  assert.deepEqual([p1.fuente, p1.local_id, p1.estado, p1.creado_por, p1.vendedor_tipo, p1.vendedor_nombre], ["chileautos", L1, "nuevo", U.c1.id, "particular", null]);
  assert.equal(p1.href, "/vehiculos/detalles/toyota-yaris-2019/CL-AD-2000001/", "sin los parámetros de seguimiento");
  const texto = JSON.stringify(guardados());
  for (const dato of ["1111", "Juan", "juan@correo.cl"]) assert.ok(!texto.includes(dato), `no se guarda «${dato}»`);
  assert.equal(guardados().find((p) => p.aviso_id === "CL-AD-2000003").vendedor_nombre, "Autos del Sur", "el nombre de una automotora sí");
  // Repetirlos no duplica: solo entra lo nuevo.
  const r2 = await ve(U.jefe.token, "prospectos.guardar", { avisos: [aviso(1), aviso(4)] });
  assert.deepEqual([r2.nuevos, r2.repetidos], [1, 1]);
  assert.equal(guardados().length, antes + 4);
  assert.equal((await ve(U.c1.token, "prospectos.guardar", { avisos: [] })).error, "avisos_invalidos");
  assert.equal((await ve(U.c1.token, "prospectos.guardar", { avisos: [{ x: 1 }] })).error, "avisos_invalidos");
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "prospectos.guardar"));
});

test("Lista: los más recientes primero, con el conteo por estado; cada local ve solo los suyos", async () => {
  const r = await ve(U.c1.token, "prospectos.lista");
  assert.equal(r.prospectos.length, 4);
  assert.deepEqual(r.conteo, { nuevo: 4 });
  assert.ok(r.prospectos.every((p) => p.local_id === L1));
  // La sucursal ve su propia lista (vacía) y puede guardar el mismo aviso sin chocar con el de la otra.
  assert.deepEqual((await ve(U.c2.token, "prospectos.lista")).prospectos, []);
  const sur = await ve(U.c2.token, "prospectos.guardar", { avisos: [aviso(1)] });
  assert.equal(sur.nuevos, 1, "el mismo aviso en otro local es otro prospecto");
  assert.equal((await ve(U.c1.token, "prospectos.lista")).prospectos.length, 4);
  // Y no puede tocar los de otro local.
  const ajeno = (await ve(U.c1.token, "prospectos.lista")).prospectos[0];
  assert.equal((await ve(U.c2.token, "prospectos.estado", { id: ajeno.id, estado: "descartado" })).status, 404);
  assert.equal((await ve(U.c2.token, "prospectos.convertido", { id: ajeno.id, leadId: "x" })).status, 404);
});

test("Estado y notas: contactado, respondió, descartado; «convertido» no se puede poner a mano", async () => {
  const p = (await ve(U.c1.token, "prospectos.lista")).prospectos.find((x) => x.aviso_id === "CL-AD-2000002");
  const r = await ve(U.c1.token, "prospectos.estado", { id: p.id, estado: "contactado", notas: "Le escribí por Chileautos hoy" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual([r.prospecto.estado, r.prospecto.notas], ["contactado", "Le escribí por Chileautos hoy"]);
  assert.equal((await ve(U.jefe.token, "prospectos.estado", { id: p.id, estado: "respondio" })).prospecto.estado, "respondio");
  assert.equal((await ve(U.c1.token, "prospectos.estado", { id: p.id, estado: "convertido" })).error, "estado_invalido");
  assert.equal((await ve(U.c1.token, "prospectos.estado", { id: p.id, estado: "inventado" })).error, "estado_invalido");
  assert.equal((await ve(U.c1.token, "prospectos.estado", { id: "no-existe", estado: "nuevo" })).status, 404);
  const d = (await ve(U.c1.token, "prospectos.lista")).prospectos.find((x) => x.aviso_id === "CL-AD-2000004");
  await ve(U.c1.token, "prospectos.estado", { id: d.id, estado: "descartado", notas: "Precio muy alto" });
  const filtrada = await ve(U.c1.token, "prospectos.lista", { estado: "descartado" });
  assert.deepEqual(filtrada.prospectos.map((x) => x.aviso_id), ["CL-AD-2000004"]);
  assert.deepEqual(filtrada.conteo, { nuevo: 2, respondio: 1, descartado: 1 }, "el conteo es de todos, no solo del filtro");
});

test("Convertir: el lead de compra se crea con el auto del aviso y el prospecto queda enlazado", async () => {
  const p = (await ve(U.c1.token, "prospectos.lista")).prospectos.find((x) => x.aviso_id === "CL-AD-2000002");
  // Sin la patente que entrega el dueño no se puede crear.
  const mal = await ve(U.c1.token, "leads.create", { cliente: { nombre: "Pedro Soto", telefono: "9 8765 4321" }, lead: { tipo: "compra", fuente: "Chileautos", vehiculoOfrecido: { patente: "", marca: "Toyota", modelo: "Yaris 2", anio: p.anio, km: p.km } } });
  assert.equal(mal.error, "patente_invalida");
  const r = await ve(U.c1.token, "leads.create", {
    cliente: { nombre: "Pedro Soto", telefono: "9 8765 4321" },
    lead: { tipo: "compra", fuente: "Chileautos", notas: `Prospecto de Chileautos: https://www.chileautos.cl${p.href}`, vehiculoOfrecido: { patente: "ABCD12", marca: "Toyota", modelo: "Yaris 2", version: p.version, anio: p.anio, km: p.km, transmision: "Automática", combustible: "Bencina", precioEsperado: p.precio } },
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual([r.lead.tipo, r.lead.fuente, r.lead.etapa], ["compra", "Chileautos", "nuevo"]);
  assert.equal(r.lead.asignado_a, U.c1.id);
  assert.equal(r.lead.vehiculo_ofrecido.patente, "ABCD12");
  assert.equal(r.lead.vehiculo_ofrecido.precioEsperado, p.precio);
  assert.match(r.lead.notas, /chileautos\.cl\/vehiculos\/detalles\/toyota-yaris-2019\/CL-AD-2000002\//);
  // Enlaza el prospecto con el lead.
  const e = await ve(U.c1.token, "prospectos.convertido", { id: p.id, leadId: r.lead.id });
  assert.equal(e.status, 200, JSON.stringify(e));
  assert.deepEqual([e.prospecto.estado, e.prospecto.lead_id], ["convertido", r.lead.id]);
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "prospectos.convertir"));
  // Ya convertido: no se cambia de estado ni se vuelve a convertir con otro lead falso.
  assert.equal((await ve(U.c1.token, "prospectos.estado", { id: p.id, estado: "nuevo" })).error, "prospecto_convertido");
  assert.equal((await ve(U.c1.token, "prospectos.convertido", { id: p.id, leadId: "no-existe" })).error, "lead_invalido");
  assert.equal((await ve(U.c1.token, "prospectos.lista", { estado: "convertido" })).prospectos[0].lead_id, r.lead.id);
  // Un lead de otro local no sirve para enlazar.
  const otro = db.tablas.leads.length ? db.tablas.leads[0] : null;
  const p3 = (await ve(U.c1.token, "prospectos.lista")).prospectos.find((x) => x.aviso_id === "CL-AD-2000003");
  const falso = { id: "lead-de-otro-local", local_id: L2 };
  db.tablas.leads.push(falso);
  assert.equal((await ve(U.c1.token, "prospectos.convertido", { id: p3.id, leadId: falso.id })).error, "lead_invalido");
  db.tablas.leads.splice(db.tablas.leads.indexOf(falso), 1);
  assert.ok(otro === null || otro.id !== falso.id);
});
