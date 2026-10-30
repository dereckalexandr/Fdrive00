// Vista «Hoy» de los leads y petición del siguiente paso, contra la función real.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1; let L2; let n = 0;
const enH = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
// Un momento de «más tarde, hoy» según el día de Chile: a mitad de camino entre ahora y la medianoche de Chile (con +0,2 h la prueba fallaba cerca de la medianoche).
const masTardeHoy = () => {
  const ahora = new Date();
  const hms = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(ahora).split(":").map(Number);
  const restante = 86_400_000 - ((hms[0] * 60 + hms[1]) * 60 + hms[2]) * 1000;
  return new Date(ahora.getTime() + restante / 2).toISOString();
};

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, JSON.stringify(r));
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token };
}
async function lead(token, extra = {}) {
  const r = await ve(token, "leads.create", { cliente: { nombre: `Cliente ${++n}`, telefono: `9${String(50000000 + n)}` }, lead: {}, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.lead;
}
const fila = (id) => db.tablas.leads.find((l) => l.id === id);
const hoy = async (token, todos = false) => (await ve(token, "leads.hoy", { todos })).leads;
const grupoDe = (lista, id) => (lista.find((x) => x.id === id) || {}).grupo;
const vieja = (id, horas) => { fila(id).creado_en = enH(-horas); };

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  L2 = (await crm(admin, "locales.create", { nombre: "Sucursal Sur" })).local.id;
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1);
  await crear("e2", "Ema Dos", "7.654.321-6", ["ejecutivo"], L1);
  await crear("jefeSur", "Jorge Sur", "8.765.432-K", ["jefe_local"], L2);
  await crear("tasador", "Tito Tasador", "5.555.555-9", ["tasador"], L1);
});

test("Cada ejecutivo ve solo sus leads abiertos, clasificados por qué hacer primero", async () => {
  const nuevo = await lead(U.e1.token);
  const sinContacto = await lead(U.e1.token); vieja(sinContacto.id, 3);
  const otro = await lead(U.e2.token);
  const r = await ve(U.e1.token, "leads.hoy");
  assert.equal(r.status, 200, JSON.stringify(r));
  const ids = r.leads.map((x) => x.id);
  assert.ok(ids.includes(nuevo.id) && ids.includes(sinContacto.id));
  assert.ok(!ids.includes(otro.id), "no ve los de otro ejecutivo");
  assert.equal(grupoDe(r.leads, nuevo.id), "por_atender");
  assert.equal(grupoDe(r.leads, sinContacto.id), "sin_contacto");
  assert.ok(r.leads[0].id === sinContacto.id, "lo más urgente va primero");
  assert.deepEqual(r.plazos, { primerContacto: 2, jefe: 4 });
  assert.equal(r.resumen.sin_contacto, 1);
  assert.equal(r.resumen.por_atender, 1);
  const f = r.leads.find((x) => x.id === nuevo.id);
  assert.equal(f.cliente.nombre.startsWith("Cliente"), true);
  assert.ok(f.cliente.telefono);
  assert.equal(f.tipo, "venta");
});

test("Próxima acción: vencida, de hoy, programada y sin acción", async () => {
  const hecho = async (l) => (await ve(U.e1.token, "leads.nota", { id: l.id, tipo: "llamada", detalle: "Llamé" })).pedirProximaAccion;
  const a = await lead(U.e1.token); await hecho(a);
  const b = await lead(U.e1.token); await hecho(b);
  const c = await lead(U.e1.token); await hecho(c);
  const d = await lead(U.e1.token); await hecho(d);
  const tarea = (l, horas, titulo) => ve(U.e1.token, "tareas.create", { leadId: l.id, titulo, tipo: "llamada", venceEn: horas === "hoy" ? masTardeHoy() : enH(horas) });
  await tarea(a, -5, "Llamar de nuevo");
  await tarea(b, "hoy", "Enviar cotización");
  await tarea(c, 72, "Seguimiento");
  const lista = await hoy(U.e1.token);
  assert.equal(grupoDe(lista, a.id), "vencida");
  assert.equal(grupoDe(lista, b.id), "hoy");
  assert.equal(grupoDe(lista, c.id), "programada");
  assert.equal(grupoDe(lista, d.id), "sin_accion");
  assert.equal(lista.find((x) => x.id === a.id).proxima.titulo, "Llamar de nuevo");
  assert.equal(lista.find((x) => x.id === d.id).proxima, null);
  const orden = lista.map((x) => x.grupo);
  const pesos = ["sin_contacto", "por_atender", "vencida", "hoy", "sin_accion", "programada"];
  assert.deepEqual(orden, [...orden].sort((x, y) => pesos.indexOf(x) - pesos.indexOf(y)), "agrupados en el orden de atención");
});

test("Los leads cerrados no aparecen; el supervisor ve todo su local (no otro); quien no trabaja leads, nada", async () => {
  const x = await lead(U.e1.token);
  await ve(U.e1.token, "leads.nota", { id: x.id, tipo: "llamada", detalle: "ok" });
  assert.equal((await ve(U.e1.token, "leads.mover", { id: x.id, etapa: "perdido", motivo: "Precio" })).status, 200);
  assert.ok(!(await hoy(U.e1.token)).some((l) => l.id === x.id), "un lead perdido no está en Hoy");
  const delE2 = await lead(U.e2.token);
  const todos = await hoy(U.jefe.token, true);
  assert.ok(todos.some((l) => l.id === delE2.id));
  assert.ok(todos.some((l) => l.asignado && l.asignado.nombre === "Eva Uno"));
  assert.ok(!(await hoy(U.jefe.token, false)).some((l) => l.id === delE2.id), "sin «todos», el supervisor ve solo los suyos");
  assert.deepEqual(await hoy(U.jefeSur.token, true), [], "otro local, nada");
  assert.equal((await ve(U.tasador.token, "leads.hoy")).status, 403);
  assert.equal((await ve(U.e1.token, "leads.hoy", { todos: true })).leads.every((l) => l.asignado && l.asignado.nombre === "Eva Uno"), true, "un ejecutivo no puede pedir «todos»");
  assert.equal((await ve(null, "leads.hoy")).status, 401);
});

test("Se pide el siguiente paso cuando el lead queda sin ninguna acción futura", async () => {
  const l = await lead(U.e1.token);
  // Registrar un contacto: queda sin próxima acción -> se pide.
  let r = await ve(U.e1.token, "leads.nota", { id: l.id, tipo: "whatsapp", detalle: "Escribí" });
  assert.equal(r.pedirProximaAccion, true);
  // Una vez agendada, ya no se pide.
  const t = await ve(U.e1.token, "tareas.create", { leadId: l.id, titulo: "Llamar mañana", tipo: "llamada", venceEn: enH(20) });
  assert.equal(t.status, 200);
  r = await ve(U.e1.token, "leads.nota", { id: l.id, tipo: "llamada", detalle: "Hablamos" });
  assert.equal(r.pedirProximaAccion, false, "ya tiene un siguiente paso");
  r = await ve(U.e1.token, "leads.mover", { id: l.id, etapa: "seguimiento" });
  assert.equal(r.pedirProximaAccion, false);
  // Al marcar esa tarea como hecha, vuelve a quedar sin acción -> se pide.
  r = await ve(U.e1.token, "tareas.hecha", { id: t.tarea.id });
  assert.equal(r.status, 200);
  assert.equal(r.pedirProximaAccion, true);
  // Si solo queda una tarea vencida, tampoco cuenta.
  const v = await ve(U.e1.token, "tareas.create", { leadId: l.id, titulo: "Vencida", tipo: "llamada", venceEn: enH(-2) });
  assert.equal((await ve(U.e1.token, "leads.nota", { id: l.id, tipo: "nota", detalle: "nota" })).pedirProximaAccion, true);
  assert.ok(v.tarea);
  // Al cerrar el lead no se pide.
  r = await ve(U.e1.token, "leads.mover", { id: l.id, etapa: "perdido", motivo: "Precio" });
  assert.equal(r.pedirProximaAccion, false);
});

test("El plazo del primer contacto se puede configurar", async () => {
  const l = await lead(U.e1.token); vieja(l.id, 1.5);
  assert.equal(grupoDe(await hoy(U.e1.token), l.id), "por_atender");
  assert.equal((await crm(admin, "config.set", { clave: "horas_primer_contacto", valor: 1 })).status, 200);
  assert.equal(grupoDe(await hoy(U.e1.token), l.id), "sin_contacto");
  assert.equal((await crm(admin, "config.set", { clave: "horas_primer_contacto", valor: 0 })).status, 400, "no se acepta 0");
  const cfg = await crm(admin, "config.get");
  assert.equal(cfg.config.horas_primer_contacto, 1);
});
