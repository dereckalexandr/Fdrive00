// Panel de gestión del Jefe Local: alertas, embudo del equipo, reasignación en lote y avisos.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";
import { mesChile } from "../supabase/functions/api/ventas-core.js";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1; let L2;
let n = 0;
const MES = mesChile();
const haceH = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const fila = (id) => db.tablas.leads.find((l) => l.id === id);
/** Leads creados en el mes actual (los "envejecidos" de otros meses no cuentan en su embudo). */
const delMes = () => db.tablas.leads.filter((l) => mesChile(l.creado_en) === MES);

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}
/** Crea un lead (asignado a quien pida) y lo "envejece" para simular el paso del tiempo. */
async function lead(token, { fuente = "Sitio web", asignarA, etapa, horas, actividadHoras, contactoHoras } = {}) {
  const r = await ve(token, "leads.create", { cliente: { nombre: `Cliente ${++n}`, telefono: `9${String(20000000 + n)}` }, lead: { fuente }, asignarA });
  assert.equal(r.status, 200, JSON.stringify(r));
  const f = fila(r.lead.id);
  if (etapa) f.etapa = etapa;
  if (horas !== undefined) { f.creado_en = haceH(horas); f.actualizado_en = haceH(horas); f.ultima_actividad = null; }
  if (actividadHoras !== undefined) { f.ultima_actividad = haceH(actividadHoras); f.actualizado_en = haceH(actividadHoras); }
  if (contactoHoras !== undefined) f.ultimo_contacto = haceH(contactoHoras);
  return r.lead;
}
async function vehiculo() {
  const r = await ve(U.jefe.token, "inventario.save", { datos: { patente: `QQ${String(1000 + ++n)}`, marca: "Toyota", modelo: "Yaris", anio: 2020, km: 1, precioLista: 10000000, costo: 8500000 } });
  return r.vehiculo;
}
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  L2 = (await crm(admin, "locales.create", { nombre: "Sucursal Sur" })).local.id;
  const ventas = { otorgar: ["ventas.operar"], quitar: [] };
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1, ventas);
  await crear("e2", "Ema Dos", "7.654.321-6", ["ejecutivo"], L1, ventas);
  await crear("e3", "Eli Tres", "9.876.543-3", ["ejecutivo"], L1);
  await crear("jefeSur", "Jorge Sur", "8.765.432-K", ["jefe_local"], L2);
  await crear("mkt", "Marta Marketing", "13.579.246-2", ["marketing"], L1);
});

test("Solo el supervisor del local usa el panel de gestión", async () => {
  for (const op of ["gestion.resumen", "gestion.embudo", "leads.reasignarLote", "avisos.crear"]) {
    assert.equal((await ve(U.e1.token, op, { ids: ["x"], texto: "hola", para: U.e2.id })).status, 403, `${op}: ejecutivo`);
    assert.equal((await ve(U.mkt.token, op, { ids: ["x"], texto: "hola", para: U.e2.id })).status, 403, `${op}: marketing`);
  }
  const sur = await ve(U.jefeSur.token, "gestion.resumen");
  assert.equal(sur.status, 200);
  assert.equal(sur.conteos.abiertos, 0, "otro local no ve estos datos");
});

test("Alertas: sin atender, detenidos, sin asignar, con los plazos por defecto (4 h y 7 días)", async () => {
  U.A = await lead(U.e1.token, { horas: 5 });                                  // sin atender
  U.B = await lead(U.e1.token, { horas: 1 });                                  // nuevo, aún a tiempo
  U.C = await lead(U.e2.token, { horas: 50, contactoHoras: 40, etapa: "contactado", actividadHoras: 40 }); // contactado hace poco
  U.D = await lead(U.e1.token, { horas: 24 * 20, etapa: "seguimiento", actividadHoras: 24 * 10 });       // detenido
  U.E = await lead(U.e2.token, { horas: 24 * 20, etapa: "seguimiento", actividadHoras: 24 * 2 });        // activo
  U.F = await lead(U.e2.token, { horas: 24 * 20, etapa: "cotizado", actividadHoras: 24 * 8 });           // detenido
  U.G = await lead(U.e1.token, { horas: 24 * 40, etapa: "reservado", actividadHoras: 24 * 30 });         // reservado: no se marca
  U.H = await lead(U.e1.token, { horas: 6 });                                  // sin atender y sin asignar
  fila(U.H.id).asignado_a = null;

  const r = await ve(U.jefe.token, "gestion.resumen");
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual(r.config, { horas_sin_contacto: 4, dias_detenido: 7 });
  const ids = (lista) => lista.map((x) => x.id).sort();
  assert.deepEqual(ids(r.sinAtender), ids([U.A, U.H]));
  assert.deepEqual(ids(r.detenidos), ids([U.D, U.F]));
  assert.deepEqual(ids(r.sinAsignar), [U.H.id]);
  assert.deepEqual(r.conteos, { abiertos: 8, sinAtender: 2, detenidos: 2, sinAsignar: 1, tareasVencidas: 0, reservasPorVencer: 0 });
  const a = r.sinAtender.find((x) => x.id === U.A.id);
  assert.equal(a.ejecutivo, "Eva Uno");
  assert.equal(a.etapa, "nuevo");
  assert.match(a.cliente, /^Cliente /);
  assert.ok(Date.parse(r.detenidos.find((x) => x.id === U.D.id).ultima_actividad) < Date.now() - 9 * 86_400_000);
});

test("Carga por ejecutivo: cada uno con sus alertas, y los leads sin dueño aparte", async () => {
  const r = await ve(U.jefe.token, "gestion.resumen");
  const por = Object.fromEntries(r.equipo.map((e) => [e.nombre, e]));
  assert.deepEqual([por["Eva Uno"].abiertos, por["Eva Uno"].sinAtender, por["Eva Uno"].detenidos], [4, 1, 1]);
  assert.deepEqual([por["Ema Dos"].abiertos, por["Ema Dos"].sinAtender, por["Ema Dos"].detenidos], [3, 0, 1]);
  assert.deepEqual([por["Sin asignar"].abiertos, por["Sin asignar"].sinAtender], [1, 1]);
  assert.equal(r.equipo[0].nombre, "Sin asignar", "lo sin dueño va primero");
  assert.ok(!por["Eli Tres"], "Eli no está habilitada para ventas");
});

test("Los plazos salen de la configuración", async () => {
  assert.equal((await crm(admin, "config.set", { clave: "horas_sin_contacto", valor: 8 })).status, 200);
  assert.equal((await crm(admin, "config.set", { clave: "dias_detenido", valor: 9 })).status, 200);
  const r = await ve(U.jefe.token, "gestion.resumen");
  assert.deepEqual(r.config, { horas_sin_contacto: 8, dias_detenido: 9 });
  assert.deepEqual(r.sinAtender.map((x) => x.id), [], "5 h y 6 h ya no pasan el plazo de 8 h");
  assert.deepEqual(r.detenidos.map((x) => x.id), [U.D.id], "el de 8 días ya no está detenido con 9");
  await crm(admin, "config.set", { clave: "horas_sin_contacto", valor: 4 });
  await crm(admin, "config.set", { clave: "dias_detenido", valor: 7 });
});

test("Cualquier actividad saca al lead de 'detenido': la nota queda registrada y renueva la marca", async () => {
  const antes = await ve(U.jefe.token, "gestion.resumen");
  assert.ok(antes.detenidos.some((x) => x.id === U.D.id));
  const nota = await ve(U.e1.token, "leads.nota", { id: U.D.id, tipo: "llamada", detalle: "Retomé el contacto" });
  assert.equal(nota.status, 200);
  assert.ok(fila(U.D.id).ultima_actividad, "se guardó la marca de actividad");
  const despues = await ve(U.jefe.token, "gestion.resumen");
  assert.ok(!despues.detenidos.some((x) => x.id === U.D.id));
  assert.equal(despues.conteos.detenidos, 1);
});

test("Tareas vencidas del equipo: con su ejecutivo y el cliente", async () => {
  const ayer = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const manana = new Date(Date.now() + 86_400_000).toISOString();
  await ve(U.e2.token, "tareas.create", { leadId: U.E.id, titulo: "Llamar para confirmar", venceEn: ayer });
  await ve(U.e2.token, "tareas.create", { leadId: U.E.id, titulo: "Enviar fotos", venceEn: manana });
  const r = await ve(U.jefe.token, "gestion.resumen");
  assert.equal(r.conteos.tareasVencidas, 1);
  const t = r.tareasVencidas[0];
  assert.equal(t.titulo, "Llamar para confirmar");
  assert.equal(t.ejecutivo, "Ema Dos");
  assert.match(t.cliente, /^Cliente /);
  assert.equal(r.equipo.find((e) => e.nombre === "Ema Dos").tareasVencidas, 1);
});

test("Reservas por vencer: las que caen en las próximas 48 horas", async () => {
  const x = await lead(U.e1.token);
  const y = await lead(U.e1.token);
  const v1 = await vehiculo(); const v2 = await vehiculo();
  for (const [l, v, dias] of [[x, v1, 1], [y, v2, 5]]) {
    const c = (await ve(U.e1.token, "cotizaciones.save", { leadId: l.id, vehiculoId: v.id, datos: {} })).cotizacion;
    const r = await ve(U.e1.token, "reservas.crear", { cotizacionId: c.id, monto: 300000, dias });
    assert.equal(r.status, 200, JSON.stringify(r));
  }
  const g = await ve(U.jefe.token, "gestion.resumen");
  assert.equal(g.conteos.reservasPorVencer, 1);
  assert.equal(g.reservasPorVencer[0].lead_id, x.id);
  assert.match(g.reservasPorVencer[0].vehiculo, /Toyota Yaris/);
  assert.equal(g.reservasPorVencer[0].ejecutivo, "Eva Uno");
  assert.equal(g.equipo.find((e) => e.nombre === "Eva Uno").reservasPorVencer, 1);
  U.reservado = { x, y };
});

test("Embudo del mes: de los leads que llegaron, cuántos llegan a cada paso", async () => {
  // Una venta completa para tener un lead vendido.
  const v = await vehiculo();
  const l = await lead(U.e1.token, { fuente: "WhatsApp" });
  await ve(U.e1.token, "leads.nota", { id: l.id, tipo: "llamada", detalle: "ok" });
  const c = (await ve(U.e1.token, "cotizaciones.save", { leadId: l.id, vehiculoId: v.id, datos: {} })).cotizacion;
  await ve(U.e1.token, "reservas.crear", { cotizacionId: c.id, monto: 400000 });
  const cierre = (await ve(U.e1.token, "cierres.crear", { leadId: l.id, datos: { precioFinal: 9800000, fechaEntrega: hoy() } })).cierre;
  assert.equal((await ve(U.jefe.token, "cierres.aprobar", { id: cierre.id })).status, 200);
  // Un lead perdido, con motivo.
  const p = await lead(U.e2.token, { fuente: "Llamada" });
  await ve(U.e2.token, "leads.mover", { id: p.id, etapa: "perdido", motivo: "Precio" });

  const r = await ve(U.jefe.token, "gestion.embudo");
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.mes, MES);
  const pasos = Object.fromEntries(r.embudo.pasos.map((x) => [x.id, x]));
  assert.equal(pasos.leads.n, delMes().length, "solo los leads creados este mes");
  assert.ok(delMes().length < db.tablas.leads.length, "hay leads de meses anteriores que no cuentan");
  assert.equal(pasos.vendidos.n, 1);
  assert.equal(pasos.reservados.n, 3, "el vendido y las dos reservas anteriores");
  assert.equal(pasos.cotizados.n, 3);
  assert.equal(r.embudo.perdidos, 1);
  assert.ok(pasos.contactados.n >= 3);
  assert.ok(pasos.vendidos.pctTotal > 0 && pasos.vendidos.pctTotal < 100);
  U.l = l;
});

test("Rendimiento por fuente: conversión, monto vendido y margen", async () => {
  const r = await ve(U.jefe.token, "gestion.embudo");
  const wa = r.fuentes.find((f) => f.fuente === "WhatsApp");
  assert.deepEqual([wa.leads, wa.cotizados, wa.reservados, wa.vendidos, wa.conversion], [1, 1, 1, 1, 100]);
  assert.equal(wa.monto, 9800000);
  assert.equal(wa.margen, 1300000, "la supervisora ve el margen");
  const llamada = r.fuentes.find((f) => f.fuente === "Llamada");
  assert.equal(llamada.perdidos, 1);
  assert.equal(llamada.vendidos, 0);
  const web = r.fuentes.find((f) => f.fuente === "Sitio web");
  assert.equal(web.leads, delMes().filter((l) => l.fuente === "Sitio web").length);
  assert.equal(r.fuentes[0].fuente, "Sitio web", "la fuente con más leads va primero");
  assert.equal(r.margenVisible, true);
  assert.deepEqual(r.motivos, [{ motivo: "Precio", n: 1 }]);
});

test("Actividad por ejecutivo en el mes", async () => {
  const r = await ve(U.jefe.token, "gestion.embudo");
  const eva = r.equipo.find((e) => e.nombre === "Eva Uno");
  assert.equal(eva.ventas, 1);
  assert.ok(eva.contactos >= 2, "llamadas registradas por Eva");
  assert.ok(eva.cotizaciones >= 3);
  assert.ok(eva.reservas >= 3);
  assert.equal(eva.leadsRecibidos, delMes().filter((l) => l.asignado_a === U.e1.id).length);
  const ema = r.equipo.find((e) => e.nombre === "Ema Dos");
  assert.equal(ema.ventas, 0);
  assert.equal(ema.contactos, 0);
  assert.ok(!r.equipo.some((e) => e.nombre === "Eli Tres"));
  // Cumplir una tarea suma.
  const t = db.tablas.tareas.find((x) => x.asignado_a === U.e2.id && !x.hecha);
  await ve(U.e2.token, "tareas.hecha", { id: t.id });
  const r2 = await ve(U.jefe.token, "gestion.embudo");
  assert.equal(r2.equipo.find((e) => e.nombre === "Ema Dos").tareasCumplidas, 1);
});

test("El embudo respeta el mes: un lead de otro mes no cuenta en este", async () => {
  const viejo = await lead(U.e2.token, { fuente: "Referido" });
  fila(viejo.id).creado_en = "2026-01-15T15:00:00.000Z";
  const actual = await ve(U.jefe.token, "gestion.embudo");
  assert.ok(!actual.fuentes.some((f) => f.fuente === "Referido"));
  const enero = await ve(U.jefe.token, "gestion.embudo", { mes: "2026-01" });
  assert.equal(enero.embudo.total, 1);
  assert.equal(enero.fuentes[0].fuente, "Referido");
  assert.equal((await ve(U.jefe.token, "gestion.embudo", { mes: "2026-13" })).error, "mes_invalido");
  assert.equal((await ve(U.jefeSur.token, "gestion.embudo")).embudo.total, 0);
  fila(viejo.id).creado_en = new Date().toISOString();
});

test("Reasignar en lote: los leads y sus tareas pendientes pasan a otro ejecutivo", async () => {
  const a = await lead(U.e1.token); const b = await lead(U.e1.token); const c = await lead(U.e1.token);
  await ve(U.e1.token, "tareas.create", { leadId: a.id, titulo: "Llamar mañana", venceEn: new Date(Date.now() + 86_400_000).toISOString() });
  const r = await ve(U.jefe.token, "leads.reasignarLote", { ids: [a.id, b.id, c.id], asignarA: U.e2.id });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.reasignados, 3);
  assert.deepEqual(r.omitidos, []);
  for (const l of [a, b, c]) assert.equal(fila(l.id).asignado_a, U.e2.id);
  assert.equal(db.tablas.tareas.find((t) => t.lead_id === a.id).asignado_a, U.e2.id, "la tarea se fue con el lead");
  assert.equal((await ve(U.e1.token, "leads.get", { id: a.id })).status, 404, "Eva ya no lo ve");
  assert.equal((await ve(U.e2.token, "leads.get", { id: a.id })).status, 200);
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === a.id && /en lote/.test(e.detalle)));
  const f = db.tablas.bitacora.find((x) => x.accion === "lead.reasignar_lote");
  assert.equal(f.detalle.reasignados, 3);
  assert.equal(f.detalle.destino, "Ema Dos");
});

test("Reasignar en lote: omite lo que no corresponde y lo informa", async () => {
  const ya = await lead(U.e2.token);
  const perdido = await lead(U.e1.token);
  await ve(U.e1.token, "leads.mover", { id: perdido.id, etapa: "perdido", motivo: "Precio" });
  const ajeno = (await ve(U.jefeSur.token, "leads.create", { cliente: { nombre: "Cliente Sur", telefono: "955555551" }, lead: {}, asignarA: "auto" }));
  const r = await ve(U.jefe.token, "leads.reasignarLote", { ids: [ya.id, perdido.id, randomUUID(), ajeno.lead ? ajeno.lead.id : randomUUID()], asignarA: U.e2.id });
  assert.equal(r.reasignados, 0);
  const motivos = Object.fromEntries(r.omitidos.map((o) => [o.id, o.motivo]));
  assert.equal(motivos[ya.id], "sin_cambio");
  assert.equal(motivos[perdido.id], "lead_cerrado");
  assert.equal(r.omitidos.filter((o) => o.motivo === "no_existe").length, 2, "uno inexistente y uno de otro local");
  if (ajeno.lead) assert.equal(fila(ajeno.lead.id).asignado_a === U.e2.id, false, "no se toca el lead de otro local");
});

test("Reasignar en lote: validaciones y reparto automático", async () => {
  assert.equal((await ve(U.jefe.token, "leads.reasignarLote", { ids: [], asignarA: U.e2.id })).error, "lote_invalido");
  assert.equal((await ve(U.jefe.token, "leads.reasignarLote", { ids: Array.from({ length: 51 }, () => randomUUID()), asignarA: U.e2.id })).error, "lote_invalido");
  const x = await lead(U.e1.token);
  assert.equal((await ve(U.jefe.token, "leads.reasignarLote", { ids: [x.id], asignarA: U.e3.id })).error, "asignado_invalido", "Eli no está habilitada");
  assert.equal(fila(x.id).asignado_a, U.e1.id);

  const lote = [await lead(U.e1.token), await lead(U.e1.token), await lead(U.e1.token), await lead(U.e1.token)];
  const r = await ve(U.jefe.token, "leads.reasignarLote", { ids: lote.map((l) => l.id), asignarA: "auto" });
  assert.equal(r.reasignados, 4, JSON.stringify(r));
  assert.ok(lote.every((l) => fila(l.id).asignado_a === U.e2.id), "con dos ejecutivos, el automático nunca repite al dueño actual");
});

test("Un lead con un cierre de venta en curso no se reasigna", async () => {
  const v = await vehiculo();
  const l = await lead(U.e1.token);
  const c = (await ve(U.e1.token, "cotizaciones.save", { leadId: l.id, vehiculoId: v.id, datos: {} })).cotizacion;
  await ve(U.e1.token, "reservas.crear", { cotizacionId: c.id, monto: 300000 });
  await ve(U.e1.token, "cierres.crear", { leadId: l.id, datos: { precioFinal: 9900000, fechaEntrega: hoy() } });
  const r = await ve(U.jefe.token, "leads.reasignarLote", { ids: [l.id], asignarA: U.e2.id });
  assert.deepEqual(r.omitidos, [{ id: l.id, motivo: "cierre_en_curso" }]);
  assert.equal(fila(l.id).asignado_a, U.e1.id, "la comisión de la venta es de quien la cerró");
});

test("Avisos: el supervisor avisa a un ejecutivo y este lo ve hasta marcarlo como leído", async () => {
  assert.equal((await ve(U.jefe.token, "avisos.crear", { para: U.e1.id, texto: "ab" })).error, "aviso_invalido");
  assert.equal((await ve(U.jefe.token, "avisos.crear", { texto: "Llama hoy a este cliente" })).error, "destinatario_requerido");
  assert.equal((await ve(U.jefe.token, "avisos.crear", { para: U.e3.id, texto: "Hola Eli" })).error, "asignado_invalido");
  assert.equal((await ve(U.jefe.token, "avisos.crear", { para: randomUUID(), texto: "Hola" })).error, "asignado_invalido");

  const lead1 = await lead(U.e1.token);
  const r = await ve(U.jefe.token, "avisos.crear", { leadId: lead1.id, texto: "  Este cliente llamó dos veces, atiéndelo hoy  " });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.aviso.para, U.e1.id, "sin destinatario explícito va al dueño del lead");
  assert.equal(r.aviso.texto, "Este cliente llamó dos veces, atiéndelo hoy");
  await ve(U.jefe.token, "avisos.crear", { para: U.e1.id, texto: "Reunión de equipo a las 10" });

  const mios = await ve(U.e1.token, "avisos.mios");
  assert.equal(mios.avisos.length, 2);
  const conLead = mios.avisos.find((a) => a.lead_id === lead1.id);
  assert.match(conLead.cliente, /^Cliente /);
  assert.equal(conLead.de_nombre, "Julia Jefa");
  assert.equal((await ve(U.e2.token, "avisos.mios")).avisos.length, 0, "Ema no recibe avisos de Eva");

  assert.equal((await ve(U.e2.token, "avisos.leer", { id: conLead.id })).status, 404, "otra persona no puede marcarlo");
  assert.equal((await ve(U.e1.token, "avisos.leer", { id: conLead.id })).ok, true);
  assert.equal((await ve(U.e1.token, "avisos.mios")).avisos.length, 1);
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === lead1.id && e.tipo === "aviso" && /Julia Jefa/.test(e.detalle)));
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "aviso.crear" && b.detalle.para === "Eva Uno"));
});

test("Avisos: no se puede avisar sobre un lead de otro local, y los ejecutivos no avisan", async () => {
  const x = await lead(U.e1.token);
  assert.equal((await ve(U.jefeSur.token, "avisos.crear", { leadId: x.id, texto: "Hola" })).status, 404);
  assert.equal((await ve(U.e1.token, "avisos.crear", { para: U.e2.id, texto: "Hola" })).status, 403);
});

test("Listas largas: se consultan en lotes para no armar direcciones kilométricas", async () => {
  // 130 leads con 130 clientes distintos, insertados directamente.
  const cliente0 = db.tablas.clientes.length;
  for (let i = 0; i < 130; i++) {
    const c = { id: randomUUID(), local_id: L1, nombre: `Masivo ${i}`, telefono: `98${String(100000 + i)}` };
    db.tablas.clientes.push(c);
    db.tablas.leads.push({ id: randomUUID(), local_id: L1, etapa: "nuevo", cliente_id: c.id, asignado_a: U.e2.id, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString(), ultimo_contacto: null, fuente: "Masivo", parte_pago: {}, financiamiento: {}, tipo: "venta" });
  }
  assert.equal(db.tablas.clientes.length, cliente0 + 130);
  const antes = db.consultas.filter((q) => q.tabla === "clientes").length;
  const r = await ve(U.jefe.token, "leads.list", { todos: true });
  assert.ok(r.clientes.filter((c) => c.nombre.startsWith("Masivo")).length === 130, "llegaron los 130 clientes");
  assert.ok(db.consultas.filter((q) => q.tabla === "clientes").length - antes >= 2, "se pidieron en más de una consulta");
});

test("Si faltan las tablas de la entrega 3, el resto del módulo sigue funcionando", async () => {
  const guardadas = { ...db.tablas };
  delete db.tablas.avisos;
  try {
    assert.equal((await ve(U.jefe.token, "gestion.resumen")).status, 200);
    assert.equal((await ve(U.e1.token, "leads.list")).status, 200);
    assert.equal((await ve(U.e1.token, "avisos.mios")).error, "crm_not_installed");
    assert.equal((await ve(U.jefe.token, "avisos.crear", { para: U.e1.id, texto: "Hola Eva" })).error, "crm_not_installed");
  } finally { Object.assign(db.tablas, guardadas); }
});
