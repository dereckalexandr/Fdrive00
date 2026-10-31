// Perfil del Inspector: solicitudes con cola y agenda, resultado visible sin datos del propietario y comisión por tramos,
// contra la función real y una base falsa en memoria.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const kv = (token, op, key, extra = {}) => api({ action: "kv", token, op, key, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1; let L2;
let n = 0;
const enH = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
const VEH = { patente: "ABCD12", marca: "Toyota", modelo: "Yaris", anio: 2018, km: 78000 };
const datos = (o = {}) => ({ vehiculo: VEH, direccion: "Av. Vitacura 1234, Vitacura", fechaHora: enH(30), contactoLugar: "Sra. Ana 912345678", notas: "Estacionamiento -2", ...o });
const fila = (id) => db.tablas.inspecciones.find((x) => x.id === id);
const patenteN = () => `WXYZ${String(10 + ++n).padStart(2, "0")}`;
const vehN = () => ({ ...VEH, patente: patenteN() });

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}
async function lead(token, asignarA) {
  const r = await ve(token, "leads.create", { cliente: { nombre: `Cliente ${++n}`, telefono: `9${String(40000000 + n)}` }, lead: {}, asignarA });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.lead;
}
const pedir = (token, leadId, d = datos()) => ve(token, "inspecciones.pedir", { origen: "lead", leadId, datos: d });
const claveFicha = (u, id = `${Date.now()}${++n}`) => `inspeccion::${u.id}::${id}`;
const resumen = (o = {}) => ({ buenos: 40, regulares: 1, malos: 0, noAplica: 5, sinRevisar: 0, destacados: [{ seccion: "1. Motor", item: "Ruidos anormales", estado: "Regular", observacion: "Ruido leve" }], observaciones: "Vehículo en buen estado general", ...o });
const registrar = (u, key, extra = {}) => ve(u.token, "inspecciones.registrar", { key, vehiculo: VEH, resumen: resumen(), fotos: [], fecha: "2026-06-10", ...extra });

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  L2 = (await crm(admin, "locales.create", { nombre: "Sucursal Sur" })).local.id;
  const ventas = { otorgar: ["ventas.operar"], quitar: [] };
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1, ventas);
  await crear("e2", "Ema Dos", "7.654.321-6", ["ejecutivo"], L1, ventas);
  await crear("t1", "Tito Tasador", "5.555.555-9", ["tasador"], L1);
  await crear("i1", "Ivo Inspector", "12.000.000-4", ["inspector"], L1);
  await crear("i2", "Irma Inspectora", "13.000.000-2", ["inspector"], L1);
  await crear("iSur", "Iker Sur", "14.000.000-0", ["inspector"], L2);
  await crear("jefeSur", "Jorge Sur", "8.765.432-K", ["jefe_local"], L2);
  await crear("mkt", "Marta Marketing", "10.000.013-K", ["marketing"], L1);
});

test("Permisos básicos: quién pide, quién inspecciona y quién no entra", async () => {
  for (const op of ["inspecciones.list", "inspecciones.resumen", "inspecciones.equipo", "inspecciones.pedir"]) {
    assert.equal((await ve(U.mkt.token, op, { vista: "cola" })).status, 403, `${op}: marketing`);
  }
  U.l1 = await lead(U.e1.token);
  assert.equal((await pedir(U.i1.token, U.l1.id)).status, 403, "el Inspector no pide: inspecciona");
  assert.equal((await ve(U.e1.token, "inspecciones.list", { vista: "cola" })).status, 403, "el ejecutivo no ve la cola");
  assert.equal((await ve(U.e1.token, "inspecciones.resumen")).status, 403);
  assert.equal((await ve(U.e1.token, "inspecciones.tomar", { id: randomUUID() })).status, 403);
  assert.equal((await ve(U.e1.token, "inspecciones.registrar", { key: "inspeccion::x::1" })).status, 403);
  assert.equal((await ve(U.i1.token, "leads.list")).status, 403, "el Inspector no entra a los leads");
});

test("Pedir una inspección desde un lead: valida los datos y queda en la cola con fecha, hora y dirección", async () => {
  const mal = (o) => pedir(U.e1.token, U.l1.id, datos(o));
  assert.equal((await mal({ direccion: "" })).error, "direccion_requerida");
  assert.equal((await mal({ fechaHora: "" })).error, "fecha_invalida");
  assert.equal((await mal({ fechaHora: enH(24 * 400) })).error, "fecha_invalida");
  assert.equal((await mal({ vehiculo: { ...VEH, patente: "12" } })).error, "patente_invalida");
  assert.equal((await ve(U.e1.token, "inspecciones.pedir", { origen: "otro", datos: datos() })).error, "origen_invalido");
  assert.equal((await pedir(U.e2.token, U.l1.id)).status, 404, "Ema no ve el lead de Eva");

  const r = await pedir(U.e1.token, U.l1.id);
  assert.equal(r.status, 200, JSON.stringify(r));
  const x = r.inspeccion;
  assert.equal(x.estado, "pendiente");
  assert.equal(x.origen, "lead");
  assert.equal(x.folio, `INS-${String(x.numero).padStart(6, "0")}`);
  assert.equal(x.direccion, "Av. Vitacura 1234, Vitacura");
  assert.equal(x.contacto_lugar, "Sra. Ana 912345678");
  assert.equal(x.solicitante, "Eva Uno");
  assert.match(x.cliente, /^Cliente /);
  assert.equal(x.inspector_id, null);
  assert.ok(Date.parse(x.agendada_para) > Date.now());
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === U.l1.id && e.tipo === "inspeccion" && /pedida por Eva Uno/.test(e.detalle)));
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "inspeccion.pedir" && b.detalle.patente === "ABCD12"));
  U.x1 = x;
  assert.equal((await pedir(U.e1.token, U.l1.id)).error, "inspeccion_en_curso", "la misma patente no se pide dos veces");
  assert.equal((await pedir(U.jefe.token, (await lead(U.e1.token)).id)).error, "inspeccion_en_curso", "ni el supervisor, para esa patente");
});

test("Quién ve qué: la cola la ven Inspectores y supervisor; cada solicitante, lo suyo; otro local, nada", async () => {
  assert.equal((await ve(U.i1.token, "inspecciones.list", { vista: "cola" })).inspecciones.length, 1);
  assert.equal((await ve(U.jefe.token, "inspecciones.list", { vista: "cola" })).inspecciones.length, 1);
  assert.equal((await ve(U.iSur.token, "inspecciones.list", { vista: "cola" })).inspecciones.length, 0, "otro local no la ve");
  assert.equal((await ve(U.e1.token, "inspecciones.list", { vista: "solicitadas" })).inspecciones.length, 1);
  assert.equal((await ve(U.e2.token, "inspecciones.list", { vista: "solicitadas" })).inspecciones.length, 0);
  assert.equal((await ve(U.e1.token, "inspecciones.get", { id: U.x1.id })).status, 200);
  assert.equal((await ve(U.e2.token, "inspecciones.get", { id: U.x1.id })).status, 404);
  assert.equal((await ve(U.iSur.token, "inspecciones.get", { id: U.x1.id })).status, 404);
  assert.equal((await ve(U.e1.token, "inspecciones.list", { vista: "origen", leadId: U.l1.id })).inspecciones.length, 1);
  assert.equal((await ve(U.e2.token, "inspecciones.list", { vista: "origen", leadId: U.l1.id })).status, 404);
  assert.equal((await ve(U.e1.token, "inspecciones.list", { vista: "rara" })).error, "vista_invalida");
});

test("Tomar: la primera persona se la queda; la segunda recibe un aviso; la agenda avisa de choques", async () => {
  const a = await ve(U.i1.token, "inspecciones.tomar", { id: U.x1.id });
  assert.equal(a.status, 200, JSON.stringify(a));
  assert.equal(a.inspeccion.estado, "en_proceso");
  assert.equal(a.inspeccion.inspector, "Ivo Inspector");
  assert.equal(a.choque, false);
  assert.equal((await ve(U.i2.token, "inspecciones.tomar", { id: U.x1.id })).error, "inspeccion_ya_tomada");
  assert.equal((await ve(U.admin_no_toma_placeholder || U.e1.token, "inspecciones.tomar", { id: U.x1.id })).status, 403);
  assert.equal((await ve(U.i1.token, "inspecciones.list", { vista: "cola" })).inspecciones.length, 0);
  const ag = await ve(U.i1.token, "inspecciones.list", { vista: "agenda" });
  assert.equal(ag.inspecciones.length, 1);
  assert.equal(ag.inspecciones[0].id, U.x1.id);
  assert.equal((await ve(U.i2.token, "inspecciones.list", { vista: "agenda" })).inspecciones.length, 0);
  assert.ok(db.tablas.lead_eventos.some((e) => /Ivo Inspector tomó la inspección/.test(e.detalle)));

  // Segunda inspección para la misma hora: Ivo recibe aviso de choque.
  const l2 = await lead(U.e1.token);
  const x2 = (await pedir(U.e1.token, l2.id, datos({ vehiculo: vehN(), fechaHora: U.x1.agendada_para }))).inspeccion;
  const b = await ve(U.i1.token, "inspecciones.tomar", { id: x2.id });
  assert.equal(b.status, 200);
  assert.equal(b.choque, true);
  U.x2 = x2;
});

test("Supervisor: asigna, devuelve a la cola y reprograma; el Inspector libera lo suyo", async () => {
  assert.equal((await ve(U.i1.token, "inspecciones.asignar", { id: U.x2.id, inspectorId: U.i2.id })).status, 403, "asignar es del supervisor");
  assert.equal((await ve(U.jefe.token, "inspecciones.asignar", { id: U.x2.id, inspectorId: U.iSur.id })).error, "asignado_invalido", "otro local");
  assert.equal((await ve(U.jefe.token, "inspecciones.asignar", { id: U.x2.id, inspectorId: U.e1.id })).error, "asignado_invalido", "no es Inspector");
  const a = await ve(U.jefe.token, "inspecciones.asignar", { id: U.x2.id, inspectorId: U.i2.id });
  assert.equal(a.status, 200, JSON.stringify(a));
  assert.equal(a.inspeccion.inspector, "Irma Inspectora");
  assert.equal((await ve(U.i1.token, "inspecciones.liberar", { id: U.x2.id })).status, 403, "Ivo no libera la de Irma");
  assert.equal((await ve(U.i2.token, "inspecciones.liberar", { id: U.x2.id })).status, 200);
  assert.equal(fila(U.x2.id).estado, "pendiente");
  assert.equal(fila(U.x2.id).inspector_id, null);

  const nueva = { direccion: "Los Leones 500, Providencia", fechaHora: enH(50), contactoLugar: "Portería" };
  assert.equal((await ve(U.e2.token, "inspecciones.reprogramar", { id: U.x2.id, datos: nueva })).status, 404, "Ema no ve el lead de Eva");
  const rp = await ve(U.e1.token, "inspecciones.reprogramar", { id: U.x2.id, datos: nueva });
  assert.equal(rp.status, 200, "quien la pidió puede reprogramar");
  assert.equal(rp.inspeccion.direccion, "Los Leones 500, Providencia");
  assert.equal((await ve(U.e1.token, "inspecciones.reprogramar", { id: U.x2.id, datos: { ...nueva, direccion: "" } })).error, "direccion_requerida");
  assert.equal((await ve(U.jefe.token, "inspecciones.reprogramar", { id: U.x2.id, datos: nueva })).status, 200);
});

test("Cancelar: motivo obligatorio; solo el solicitante (en la cola), el Inspector de ella o el supervisor", async () => {
  assert.equal((await ve(U.e1.token, "inspecciones.cancelar", { id: U.x2.id, motivo: "" })).error, "motivo_requerido");
  assert.equal((await ve(U.mkt.token, "inspecciones.cancelar", { id: U.x2.id, motivo: "No me gusta" })).status, 403);
  const c = await ve(U.e1.token, "inspecciones.cancelar", { id: U.x2.id, motivo: "El cliente ya no vende" });
  assert.equal(c.status, 200);
  assert.equal(c.inspeccion.estado, "cancelada");
  assert.equal((await ve(U.e1.token, "inspecciones.cancelar", { id: U.x2.id, motivo: "Otra vez" })).error, "inspeccion_estado_invalido");
  assert.equal((await ve(U.i1.token, "inspecciones.tomar", { id: U.x2.id })).error, "inspeccion_estado_invalido");
  // Agendada: Eva ya no puede cancelarla (la tiene un Inspector); el supervisor sí.
  assert.equal((await ve(U.e1.token, "inspecciones.cancelar", { id: U.x1.id, motivo: "Cambié de idea" })).status, 403);
});

test("Otros orígenes: desde el inventario y desde una tasación", async () => {
  const v = (await ve(U.jefe.token, "inventario.save", { datos: { patente: patenteN(), marca: "Kia", modelo: "Rio", anio: 2020, km: 30000, precioLista: 9000000, costo: 7000000 } })).vehiculo;
  assert.ok(v, "no se creó el vehículo");
  const veh = { patente: v.patente, marca: "Kia", modelo: "Rio", anio: 2020, km: 30000 };
  assert.equal((await ve(U.e1.token, "inspecciones.pedir", { origen: "vehiculo", vehiculoId: randomUUID(), datos: datos({ vehiculo: veh }) })).status, 404);
  const ok = await ve(U.e1.token, "inspecciones.pedir", { origen: "vehiculo", vehiculoId: v.id, datos: datos({ vehiculo: veh }) });
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(ok.inspeccion.origen, "vehiculo");
  assert.ok(!ok.inspeccion.lead_id);
  assert.equal((await ve(U.e1.token, "inspecciones.list", { vista: "origen", vehiculoId: v.id })).inspecciones.length, 1);
  assert.equal((await ve(U.jefeSur.token, "inspecciones.pedir", { origen: "vehiculo", vehiculoId: v.id, datos: datos({ vehiculo: veh }) })).status, 404, "otro local");

  const l = await lead(U.e1.token);
  const pt = vehN();
  const tas = (await ve(U.e1.token, "tasaciones.pedir", { leadId: l.id, datos: { vehiculo: pt } })).tasacion;
  assert.equal((await ve(U.t1.token, "inspecciones.pedir", { origen: "tasacion", tasacionId: tas.id, datos: datos({ vehiculo: pt }) })).status, 403, "el Tasador no pide inspecciones: es del ejecutivo que gestiona el lead");
  const ins = await ve(U.e1.token, "inspecciones.pedir", { origen: "tasacion", tasacionId: tas.id, datos: datos({ vehiculo: pt }) });
  assert.equal(ins.status, 200, JSON.stringify(ins));
  assert.equal(ins.inspeccion.origen, "tasacion");
  assert.equal(ins.inspeccion.lead_id, l.id, "queda ligada al lead de la tasación");
  assert.equal((await ve(U.e2.token, "inspecciones.pedir", { origen: "tasacion", tasacionId: tas.id, datos: datos({ vehiculo: vehN() }) })).status, 403, "Ema no pidió esa tasación");
});

test("Registrar el resultado: completa la solicitud y el equipo ve el estado SIN datos del propietario", async () => {
  const key = claveFicha(U.i1, "1700000001");
  assert.equal((await registrar(U.i2, key, { solicitudId: U.x1.id })).status, 403, "la clave no es de Irma");
  assert.equal((await registrar(U.i1, key, { solicitudId: U.x2.id })).status, 403, "la 2 está cancelada y no es de Ivo");
  assert.equal((await registrar(U.i1, "inspeccion::" + U.i1.id + "::con espacio")).error, "inspeccion_invalida");

  // Se intenta colar datos del propietario: no deben guardarse.
  const r = await registrar(U.i1, key, {
    solicitudId: U.x1.id, propietarioNombre: "Juan Pérez Soto", propietarioRun: "11.222.333-4",
    vehiculo: { ...VEH, propietarioNombre: "Juan Pérez Soto" }, resumen: { ...resumen(), propietarioNombre: "Juan Pérez Soto", propietarioRun: "11.222.333-4" },
  });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.inspeccion.estado, "completada");
  assert.equal(r.inspeccion.resultado.veredicto, "con_observaciones");
  assert.equal(r.inspeccion.resultado.regulares, 1);
  assert.equal(r.inspeccion.fichaKey, key, "su Inspector recibe la clave de su ficha");
  assert.ok(Date.parse(fila(U.x1.id).completada_en) > 0);
  assert.ok(!/Juan|11\.222|propietario/i.test(JSON.stringify(fila(U.x1.id))), "la fila guardada no tiene datos del propietario");

  for (const quien of [U.e1, U.jefe, U.t1]) {
    const g = await ve(quien.token, "inspecciones.get", { id: U.x1.id });
    if (g.status !== 200) continue;
    assert.ok(!/Juan|11\.222|propietario/i.test(JSON.stringify(g)), "ninguna respuesta lleva datos del propietario");
    assert.equal(g.inspeccion.fichaKey, null, "otros perfiles no reciben la clave de la ficha");
    assert.equal(g.inspeccion.tieneFicha, true);
    assert.equal(g.inspeccion.resultado.destacados[0].item, "Ruidos anormales");
  }
  assert.ok(db.tablas.lead_eventos.some((e) => /realizada por Ivo Inspector: Con observaciones/.test(e.detalle)));
  assert.equal((await ve(U.i1.token, "inspecciones.tomar", { id: U.x1.id })).error, "inspeccion_estado_invalido");
  U.key1 = key;
});

test("Editar la ficha actualiza el resultado sin duplicar ni contar dos veces", async () => {
  const antes = db.tablas.inspecciones.length;
  const r = await registrar(U.i1, U.key1, { resumen: resumen({ malos: 2, destacados: [{ seccion: "Motor", item: "Fugas", estado: "Malo", observacion: "Pierde aceite" }] }) });
  assert.equal(r.status, 200);
  assert.equal(r.inspeccion.resultado.veredicto, "con_fallas");
  assert.equal(db.tablas.inspecciones.length, antes);
  assert.equal((await registrar(U.i2, U.key1)).status, 403, "otra persona no puede tocar esa ficha");
});

test("Inspección espontánea: se registra sola, sin solicitud, y cuenta igual", async () => {
  const key = claveFicha(U.i1, "1700000002");
  const r = await registrar(U.i1, key, { vehiculo: { ...VEH, patente: patenteN() } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.inspeccion.origen, "espontanea");
  assert.equal(r.inspeccion.estado, "completada");
  assert.equal(r.inspeccion.local_id, L1);
  assert.equal((await ve(U.e1.token, "inspecciones.list", { vista: "solicitadas" })).inspecciones.some((x) => x.id === r.inspeccion.id), false);
  U.esp = r.inspeccion;
  U.keyEsp = key;
});

test("Eliminar la ficha: la espontánea desaparece y la pedida vuelve a agendada", async () => {
  assert.equal((await ve(U.i2.token, "inspecciones.eliminar", { key: U.keyEsp })).status, 403);
  assert.equal((await ve(U.i1.token, "inspecciones.eliminar", { key: U.keyEsp })).status, 200);
  assert.equal(fila(U.esp.id), undefined);
  assert.equal((await ve(U.i1.token, "inspecciones.eliminar", { key: U.keyEsp })).status, 200, "repetir no falla");

  assert.equal((await ve(U.i1.token, "inspecciones.eliminar", { key: U.key1 })).status, 200);
  const f = fila(U.x1.id);
  assert.equal(f.estado, "en_proceso");
  assert.equal(f.inspeccion_key, null);
  assert.deepEqual(f.resultado, {});
  assert.equal(f.completada_en, null);
  // Se rehace con otra ficha.
  const nueva = claveFicha(U.i1, "1700000003");
  assert.equal((await registrar(U.i1, nueva, { solicitudId: U.x1.id })).status, 200);
  U.key1 = nueva;
});

test("Fotos del resultado: las sube quien inspecciona; las ven quienes piden o miran los leads", async () => {
  const key = "ifoto::1700000003::abcdef123456";
  assert.equal((await kv(U.i1.token, "set", key, { value: "data:image/jpeg;base64,AAA" })).status, 200);
  assert.equal((await kv(U.e1.token, "get", key)).status, 200);
  assert.equal((await kv(U.jefe.token, "get", key)).status, 200);
  assert.equal((await kv(U.t1.token, "get", key)).status, 200);
  assert.equal((await kv(U.e1.token, "set", key, { value: "x" })).status, 403);
  assert.equal((await kv(U.e1.token, "delete", key)).status, 403);
  assert.equal((await kv(U.i1.token, "delete", key)).status, 200);
  // La ficha completa es del Inspector y, solo para leer, del Jefe Local de su mismo local.
  assert.equal((await kv(U.i1.token, "set", U.key1, { value: "{}" })).status, 200);
  assert.equal((await kv(U.e1.token, "get", U.key1)).status, 403);
  assert.equal((await kv(U.i2.token, "get", U.key1)).status, 403);
});

test("Fichas de inspectores: el Jefe Local de su local las lee completas (solo lectura); otro local, ejecutivos y demás no", async () => {
  const ficha = `inspeccion::${U.i1.id}::f1`;
  const val = `tasacion::${U.i1.id}::v1`;
  const foto = `foto::${U.i1.id}::p1`;
  for (const k of [ficha, val, foto]) assert.equal((await kv(U.i1.token, "set", k, { value: JSON.stringify({ propietarioNombre: "Don Pedro", propietarioRun: "1-9" }) })).status, 200);
  for (const k of [ficha, val, foto]) {
    assert.equal((await kv(U.jefe.token, "get", k)).status, 200, `jefe lee ${k}`);
    assert.equal((await kv(U.jefeSur.token, "get", k)).status, 403, "el Jefe de otro local no");
    assert.equal((await kv(U.e1.token, "get", k)).status, 403, "el ejecutivo no");
    assert.equal((await kv(U.mkt.token, "get", k)).status, 403);
    assert.equal((await kv(U.jefe.token, "set", k, { value: "x" })).status, 403, "solo lectura");
    assert.equal((await kv(U.jefe.token, "delete", k)).status, 403, "no borra");
  }
  assert.equal((await kv(U.jefe.token, "get", `inspeccion::${U.iSur.id}::f1`)).status, 403, "ficha de otro local");
  const l = await api({ action: "kv", token: U.jefe.token, op: "list", prefix: `inspeccion::${U.i1.id}::` });
  assert.equal(l.status, 200);
  assert.ok(l.keys.includes(ficha));
  assert.equal((await api({ action: "kv", token: U.jefe.token, op: "list", prefix: `inspeccion::${U.iSur.id}::` })).status, 403);
  assert.equal((await api({ action: "kv", token: U.jefe.token, op: "list", prefix: "inspeccion::" })).status, 403, "no se lista todo");
  const eq = await ve(U.jefe.token, "inspecciones.fichas_equipo");
  assert.equal(eq.status, 200);
  const ids = eq.inspectores.map((x) => x.id);
  assert.ok(ids.includes(U.i1.id) && ids.includes(U.i2.id));
  assert.ok(!ids.includes(U.iSur.id), "solo su local");
  assert.ok(!ids.includes(U.e1.id), "los ejecutivos no inspeccionan");
  assert.equal((await ve(U.e1.token, "inspecciones.fichas_equipo")).status, 403);
  assert.equal((await ve(U.i1.token, "inspecciones.fichas_equipo")).status, 403);
  const todos = await ve(admin, "inspecciones.fichas_equipo");
  assert.equal(todos.status, 200);
  assert.ok(todos.inspectores.map((x) => x.id).includes(U.iSur.id), "la cuenta maestra ve todos los locales");
});

test("Resumen y comisión: tramos de inspecciones del mes ($35.000 c/u por defecto, o tramos propios)", async () => {
  // Ivo ya tiene 1 realizada (la de Eva). Se suman espontáneas hasta 3.
  for (let i = 0; i < 2; i++) assert.equal((await registrar(U.i1, claveFicha(U.i1), { vehiculo: { ...VEH, patente: patenteN() } })).status, 200);
  const mio = await ve(U.i1.token, "inspecciones.resumen");
  assert.equal(mio.status, 200);
  assert.equal(mio.inspectores.length, 1, "el Inspector ve solo lo suyo");
  const yo = mio.inspectores[0];
  assert.equal(yo.nombre, "Ivo Inspector");
  assert.equal(yo.hechas, 3);
  assert.equal(yo.pedidas, 1);
  assert.equal(yo.espontaneas, 2);
  assert.equal(yo.produccion.total, 3 * 35000);
  assert.equal(yo.personalizado, false);

  const todos = await ve(U.jefe.token, "inspecciones.resumen");
  const nombres = todos.inspectores.map((x) => x.nombre);
  assert.ok(nombres.includes("Ivo Inspector") && nombres.includes("Irma Inspectora"));
  assert.ok(!nombres.includes("Iker Sur"), "otro local no aparece");
  assert.equal((await ve(U.iSur.token, "inspecciones.resumen")).inspectores[0].hechas, 0);

  // Tramos propios para Ivo: 1–2 a $50.000 y desde 3 a $60.000 (se aplica el tramo a todas las del mes).
  const upd = await crm(admin, "usuarios.update", { id: U.i1.id, datos: { nombre: "Ivo Inspector", roles: ["inspector"], localId: L1, comision: { tramos: { inspecciones: [{ min: 1, max: 2, rate: 50000 }, { min: 3, max: "", rate: 60000 }] } } } });
  assert.equal(upd.status, 200, JSON.stringify(upd));
  const otra = (await ve(U.i1.token, "inspecciones.resumen")).inspectores[0];
  assert.equal(otra.personalizado, true);
  assert.equal(otra.produccion.total, 3 * 60000);
  assert.equal((await ve(U.i1.token, "inspecciones.resumen", { mes: "2026-13" })).error, "mes_invalido");
  assert.equal((await ve(U.i1.token, "inspecciones.resumen", { mes: "2019-01" })).inspectores[0].hechas, 0);
});

test("Alerta al supervisor: solicitudes sin tomar pasado el plazo o muy cerca de su fecha", async () => {
  const sin = await ve(U.jefe.token, "gestion.resumen");
  assert.equal(sin.conteos.inspeccionesSinTomar, 0);
  const l = await lead(U.e1.token);
  const x = (await pedir(U.e1.token, l.id, datos({ vehiculo: vehN(), fechaHora: enH(5) }))).inspeccion;
  const con = await ve(U.jefe.token, "gestion.resumen");
  assert.equal(con.conteos.inspeccionesSinTomar, 1, "es para dentro de 5 h");
  assert.equal(con.inspeccionesSinTomar[0].id, x.id);
  assert.equal(con.inspeccionesSinTomar[0].solicitante, "Eva Uno");
  assert.equal(con.config.horas_inspeccion, 8);
  await ve(U.i2.token, "inspecciones.tomar", { id: x.id });
  assert.equal((await ve(U.jefe.token, "gestion.resumen")).conteos.inspeccionesSinTomar, 0);
  // Lejana y recién pedida: no molesta.
  const l3 = await lead(U.e1.token);
  await pedir(U.e1.token, l3.id, datos({ vehiculo: vehN(), fechaHora: enH(24 * 10) }));
  assert.equal((await ve(U.jefe.token, "gestion.resumen")).conteos.inspeccionesSinTomar, 0);
  assert.equal((await crm(admin, "config.set", { clave: "horas_inspeccion", valor: 12 })).status, 200);
  assert.equal((await crm(admin, "config.set", { clave: "horas_inspeccion", valor: 0 })).status, 400);
  await crm(admin, "config.set", { clave: "horas_inspeccion", valor: 8 });
});

test("Equipo: el supervisor ve a los Inspectores de su local", async () => {
  const r = await ve(U.jefe.token, "inspecciones.equipo");
  assert.deepEqual(r.inspectores.map((x) => x.nombre).sort(), ["Irma Inspectora", "Ivo Inspector"]);
  assert.equal((await ve(U.e1.token, "inspecciones.equipo")).status, 403);
});

test("La cuenta maestra ve todo pero no inspecciona", async () => {
  const r = await ve(admin, "inspecciones.list", { vista: "local", localId: L1 });
  assert.equal(r.status, 200);
  assert.ok(r.inspecciones.length >= 3);
  assert.equal((await ve(admin, "inspecciones.tomar", { id: U.x1.id })).status, 403);
  assert.equal((await ve(admin, "inspecciones.registrar", { key: "inspeccion::x::1" })).status, 403);
  const res = await ve(admin, "inspecciones.resumen", { localId: L1 });
  assert.equal(res.status, 200);
});

test("Valorización del Inspector: el Jefe Local corrige los precios de las de su local, con registro; nada más cambia", async () => {
  const key = `tasacion::${U.i1.id}::v9`;
  const base = { propietario: "Don Pedro", patente: "ABCD12", valorComercial: 8900000, observaciones: "Original", checklist: { parachoques_delantero: { estado: "Repintado", valor: 150000, fotos: ["f1"] }, techo: { estado: "Golpe", valor: 200000 } } };
  assert.equal((await kv(U.i1.token, "set", key, { value: JSON.stringify(base) })).status, 200);
  const ajustar = (token, extra, k = key) => ve(token, "inspecciones.valorizacion_ajustar", { key: k, ...extra });

  // Permisos: el ejecutivo y el inspector no; el Jefe de otro local, tampoco.
  assert.equal((await ajustar(U.e1.token, { valorComercial: 1 })).status, 403);
  assert.equal((await ajustar(U.i1.token, { valorComercial: 1 })).status, 403);
  assert.equal((await ajustar(U.jefeSur.token, { valorComercial: 1 })).status, 404);

  // Validaciones.
  assert.equal((await ajustar(U.jefe.token, {})).error, "sin_cambio");
  assert.equal((await ajustar(U.jefe.token, { valorComercial: -5 })).error, "valor_invalido");
  assert.equal((await ajustar(U.jefe.token, { valorComercial: "abc" })).error, "valor_invalido");
  assert.equal((await ajustar(U.jefe.token, { items: { parachoques_delantero: "x" } })).error, "valor_invalido");
  assert.equal((await ajustar(U.jefe.token, { items: { inventado: 5 } })).error, "item_invalido");
  assert.equal((await ajustar(U.jefe.token, { valorComercial: 8900000 })).error, "sin_cambio", "mismo valor: nada que guardar");
  assert.equal((await ajustar(U.jefe.token, { valorComercial: 1 }, "inspeccion::" + U.i1.id + "::x")).error, "clave_invalida", "solo valorizaciones");
  assert.equal((await ajustar(U.jefe.token, { valorComercial: 1 }, `tasacion::${U.iSur.id}::v9`)).status, 404, "inspector de otro local");

  // Cambio correcto: valor comercial y un ítem.
  const r = await ajustar(U.jefe.token, { valorComercial: 9200000, items: { parachoques_delantero: 120000 } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.cambios, 2);
  const leido = JSON.parse((await kv(U.jefe.token, "get", key)).value);
  assert.equal(leido.valorComercial, 9200000);
  assert.equal(leido.checklist.parachoques_delantero.valor, 120000);
  assert.equal(leido.checklist.techo.valor, 200000, "lo que no se tocó queda igual");
  assert.deepEqual(leido.checklist.parachoques_delantero.fotos, ["f1"], "las fotos no se pierden");
  assert.equal(leido.observaciones, "Original");
  assert.equal(leido.ajustes.length, 2);
  assert.equal(leido.ajustes[0].por, "Julia Jefa");
  assert.equal(leido.ajustes[0].antes, 8900000);
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "valorizacion.ajustar"), "queda en la bitácora");
  // El inspector sigue pudiendo leer su ficha con los cambios.
  assert.equal(JSON.parse((await kv(U.i1.token, "get", key)).value).valorComercial, 9200000);
  // La cuenta maestra también puede.
  assert.equal((await ve(admin, "inspecciones.valorizacion_ajustar", { key, items: { techo: 180000 } })).status, 200);
});

test("Pedir o reprogramar una inspección eligiendo el lugar: local con su dirección registrada, o en terreno", async () => {
  const l = await lead(U.e1.token);
  // Los locales con su dirección, para la lista desplegable.
  const lug = await ve(U.e1.token, "inspecciones.lugares");
  assert.equal(lug.status, 200, JSON.stringify(lug));
  assert.deepEqual(lug.lugares.map((x) => x.nombre).sort(), ["Casa matriz", "Sucursal Sur"]);
  const matriz = lug.lugares.find((x) => x.nombre === "Casa matriz");
  const sur = lug.lugares.find((x) => x.nombre === "Sucursal Sur");
  assert.equal(matriz.direccion, "", "aún sin dirección registrada");

  // Sin dirección registrada en Configuración no se puede elegir el local.
  const sinDir = await pedir(U.e1.token, l.id, datos({ direccion: "", lugar: { tipo: "local", localId: matriz.id } }));
  assert.equal(sinDir.error, "local_sin_direccion");
  assert.equal((await pedir(U.e1.token, l.id, datos({ direccion: "", lugar: { tipo: "local", localId: randomUUID() } }))).error, "lugar_invalido");
  assert.equal((await pedir(U.e1.token, l.id, datos({ direccion: "", lugar: { tipo: "terreno", calle: "x", comuna: "Providencia" } }))).error, "calle_requerida");

  // La dirección se registra en Configuración (locales.update).
  assert.equal((await crm(admin, "locales.update", { id: matriz.id, nombre: "Casa matriz", direccion: "Av. Vitacura 1234, Vitacura", activo: true })).status, 200);
  const ok = await pedir(U.e1.token, l.id, datos({ direccion: "texto que se ignora", lugar: { tipo: "local", localId: matriz.id } }));
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(fila(ok.inspeccion.id).direccion, "Casa matriz · Av. Vitacura 1234, Vitacura");

  // En terreno: calle, comuna y referencia.
  const l2 = await lead(U.e1.token);
  const terreno = await pedir(U.e1.token, l2.id, datos({ vehiculo: vehN(), direccion: "", fechaHora: enH(50), lugar: { tipo: "terreno", calle: "Av. Providencia 2222", comuna: "Providencia", referencia: "Oficina 5" } }));
  assert.equal(terreno.status, 200, JSON.stringify(terreno));
  assert.equal(fila(terreno.inspeccion.id).direccion, "Av. Providencia 2222, Providencia (Oficina 5)");

  // Reprogramar a otro lugar.
  const rp = await ve(U.e1.token, "inspecciones.reprogramar", { id: terreno.inspeccion.id, datos: { lugar: { tipo: "terreno", calle: "Los Leones 100", comuna: "Ñuñoa" }, fechaHora: enH(60), contactoLugar: "" } });
  assert.equal(rp.status, 200, JSON.stringify(rp));
  assert.equal(fila(terreno.inspeccion.id).direccion, "Los Leones 100, Ñuñoa");
  assert.equal((await ve(U.e1.token, "inspecciones.reprogramar", { id: terreno.inspeccion.id, datos: { lugar: { tipo: "local", localId: sur.id }, fechaHora: enH(60) } })).error, "local_sin_direccion");

  // Un local desactivado ya no se ofrece.
  assert.equal((await crm(admin, "locales.update", { id: sur.id, nombre: "Sucursal Sur", direccion: "Calle Sur 10, Santiago", activo: false })).status, 200);
  assert.deepEqual((await ve(U.e1.token, "inspecciones.lugares")).lugares.map((x) => x.nombre), ["Casa matriz"]);
});

test("Inventario en solo vista: quien ve el inventario revisa las inspecciones del vehículo (también las pedidas desde el lead) y las lee, sin poder modificarlas", async () => {
  await crear("an", "Ana Anunciante", "15.000.000-9", ["anunciante"], L1);
  const pt = vehN();
  const v = (await ve(U.jefe.token, "inventario.save", { datos: { patente: pt.patente, marca: "Kia", modelo: "Rio", anio: 2020, km: 30000, precioLista: 9000000, costo: 7000000 } })).vehiculo;
  assert.ok(v);
  // Una inspección pedida desde un lead con la misma patente del vehículo del inventario.
  const l = await lead(U.e1.token);
  const ok = await pedir(U.e1.token, l.id, datos({ vehiculo: pt }));
  assert.equal(ok.status, 200, JSON.stringify(ok));
  for (const quien of [U.an, U.e2, U.t1]) {
    const r = await ve(quien.token, "inspecciones.list", { vista: "origen", vehiculoId: v.id });
    assert.equal(r.status, 200, `${quien.nombre}: ${JSON.stringify(r)}`);
    assert.ok(r.inspecciones.some((x) => x.id === ok.inspeccion.id), `${quien.nombre} ve la inspección del vehículo`);
  }
  // Puede leer las fotos de la inspección y los archivos de los documentos del vehículo; quien no ve el inventario, no.
  assert.equal((await kv(U.an.token, "get", "ifoto::ficha1::foto1")).status, 200);
  assert.equal((await kv(U.an.token, "get", "dval::val1::arch1")).status, 200);
  assert.equal((await kv(U.i2.token, "get", "dval::val1::arch1")).status, 403);
  // Solo vista: no escribe ni borra.
  assert.equal((await kv(U.an.token, "set", "ifoto::ficha1::foto1", { value: "x" })).status, 403);
  assert.equal((await kv(U.an.token, "set", "dval::val1::arch1", { value: "x" })).status, 403);
  assert.equal((await ve(U.an.token, "inspecciones.cancelar", { id: ok.inspeccion.id, motivo: "No debería poder" })).status, 403);
});

test("Informes en PDF: quien ve la inspección realizada recibe su ficha y su valorización sin datos del propietario ni el CAV", async () => {
  const l = await lead(U.e1.token);
  const veh = vehN();
  const ped = await pedir(U.e1.token, l.id, datos({ vehiculo: veh }));
  assert.equal(ped.status, 200, JSON.stringify(ped));
  const id = ped.inspeccion.id;
  assert.equal((await ve(U.e1.token, "inspecciones.informes", { id })).error, "inspeccion_sin_ficha", "aún no está realizada");
  assert.equal((await ve(U.i1.token, "inspecciones.tomar", { id })).status, 200);
  const key = claveFicha(U.i1);
  const ficha = { inscripcion: veh.patente, marca: "Toyota", modelo: "Yaris", anio: "2018", fecha: "2026-06-10", inspectorNombre: "Ivo Inspector", propietarioNombre: "Juan Pérez Soto", propietarioRun: "11.222.333-4", cavFileData: "data:application/pdf;base64,AAAA", cavFileName: "cav.pdf", fotosEquipo: ["f1"], checklist: { motor_ruidos: { estado: "Regular", observacion: "Ruido leve" } } };
  assert.equal((await kv(U.i1.token, "set", key, { value: JSON.stringify(ficha) })).status, 200);
  assert.equal((await registrar(U.i1, key, { solicitudId: id, vehiculo: veh })).status, 200);

  // Sin valorización hecha desde esa inspección.
  const sin = await ve(U.e1.token, "inspecciones.informes", { id });
  assert.equal(sin.status, 200, JSON.stringify(sin));
  assert.equal(sin.valorizacion, null);
  assert.equal(sin.inspeccion.checklist.motor_ruidos.estado, "Regular");
  assert.equal(sin.inspector, "Ivo Inspector");

  // El Inspector valoriza desde esa inspección (otra valorización suya, de otro vehículo, no se mezcla).
  const tas = (k, o) => kv(U.i1.token, "set", `tasacion::${U.i1.id}::${k}`, { value: JSON.stringify({ propietario: "Juan Pérez Soto", vehiculo: "Toyota Yaris", patente: veh.patente, fecha: "2026-06-11", valorComercial: 9000000, checklist: {}, ...o }) });
  assert.equal((await tas("t1", { inspeccionId: key })).status, 200);
  assert.equal((await tas("t2", { inspeccionId: "inspeccion::otro::x", valorComercial: 1 })).status, 200);
  const con = await ve(U.e1.token, "inspecciones.informes", { id });
  assert.equal(con.valorizacion.valorComercial, 9000000);
  assert.equal(con.valorizacion.inspeccionId, key);
  for (const prohibido of ["Juan", "11.222", "cavFileData", "base64", "propietario"]) assert.ok(!JSON.stringify(con).includes(prohibido), `no debe aparecer «${prohibido}»`);

  // Quién puede pedirlos: quien ve el lead, el Inspector y el supervisor; no otro ejecutivo ni otro local.
  assert.equal((await ve(U.jefe.token, "inspecciones.informes", { id })).status, 200);
  assert.equal((await ve(U.i1.token, "inspecciones.informes", { id })).status, 200);
  assert.equal((await ve(U.e2.token, "inspecciones.informes", { id })).status, 404, "otro ejecutivo");
  assert.equal((await ve(U.jefeSur.token, "inspecciones.informes", { id })).status, 404, "otro local");
  assert.equal((await ve(U.mkt.token, "inspecciones.informes", { id })).status, 403);
});

test("Eliminar fichas del Inspector: solo el Jefe Local de su local (o la cuenta maestra); borra la ficha, sus fotos y el registro, y queda en la bitácora", async () => {
  // Una valorización con una foto.
  const kt = `tasacion::${U.i1.id}::vdel`;
  assert.equal((await kv(U.i1.token, "set", kt, { value: JSON.stringify({ patente: "ABCD12", valorComercial: 5, checklist: { techo: { estado: "Rayado", valor: 1, fotos: ["fdel1"] } } }) })).status, 200);
  assert.equal((await kv(U.i1.token, "set", `foto::${U.i1.id}::fdel1`, { value: "data:image/jpeg;base64,AAA" })).status, 200);
  // Una inspección pedida desde un lead, ya realizada y con una foto.
  const l = await lead(U.e1.token);
  const veh = vehN();
  const ped = await pedir(U.e1.token, l.id, datos({ vehiculo: veh }));
  assert.equal((await ve(U.i1.token, "inspecciones.tomar", { id: ped.inspeccion.id })).status, 200);
  const ki = claveFicha(U.i1);
  const fid = ki.split("::").pop();
  assert.equal((await kv(U.i1.token, "set", ki, { value: JSON.stringify({ inscripcion: veh.patente, fotosEquipo: ["fi1"], checklist: {} }) })).status, 200);
  assert.equal((await kv(U.i1.token, "set", `ifoto::${fid}::fi1`, { value: "data:image/jpeg;base64,BBB" })).status, 200);
  assert.equal((await registrar(U.i1, ki, { solicitudId: ped.inspeccion.id, vehiculo: veh, fotos: ["fi1"] })).status, 200);

  const borrar = (token, key) => ve(token, "inspecciones.ficha_eliminar", { key });
  for (const quien of [U.e1, U.i1, U.t1]) assert.equal((await borrar(quien.token, kt)).status, 403, "solo supervisores");
  assert.equal((await borrar(U.jefeSur.token, kt)).status, 404, "Jefe de otro local");
  assert.equal((await borrar(U.jefe.token, "inspeccion::x::y")).error, "clave_invalida");
  assert.equal((await borrar(U.jefe.token, `tasacion::${U.i1.id}::noexiste`)).status, 404);

  assert.equal((await borrar(U.jefe.token, kt)).status, 200);
  assert.equal((await kv(U.i1.token, "get", kt)).value ?? null, null, "la valorización ya no está");
  assert.equal((await kv(U.i1.token, "get", `foto::${U.i1.id}::fdel1`)).value ?? null, null, "ni su foto");

  assert.equal((await borrar(U.jefe.token, ki)).status, 200);
  assert.equal((await kv(U.i1.token, "get", ki)).value ?? null, null);
  assert.equal((await kv(U.i1.token, "get", `ifoto::${fid}::fi1`)).value ?? null, null, "ni la foto de la inspección");
  assert.equal(db.tablas.inspecciones.some((x) => x.id === ped.inspeccion.id), false, "ni su registro");
  assert.ok(db.tablas.lead_eventos.some((e) => /Julia Jefa eliminó la ficha de la inspección INS-/.test(e.detalle)), "queda anotado en el lead");
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "inspeccion.eliminar_ficha") && db.tablas.bitacora.some((b) => b.accion === "valorizacion.eliminar"));

  // La cuenta maestra también puede.
  const k2 = `tasacion::${U.i1.id}::vdel2`;
  assert.equal((await kv(U.i1.token, "set", k2, { value: JSON.stringify({ patente: "ABCD12", checklist: {} }) })).status, 200);
  assert.equal((await borrar(admin, k2)).status, 200);
});
