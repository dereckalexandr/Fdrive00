// Visitas a la sucursal: el cliente recibe la invitación para su calendario (.ics + enlace a Google Calendar),
// y los formularios del CRM exigen su correo.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db, correos, entorno, google } from "./helpers/api-env.mjs";
import { armarIcs, enlaceGoogleCalendar, enlacesOutlook, textoFechaVisita, escaparIcs, plegarIcs, fechaIcs } from "../supabase/functions/api/calendario-core.js";
import { validarCliente } from "../supabase/functions/api/ventas-core.js";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const U = {};
let admin; let L1; let n = 0;
const manana11 = () => { const d = new Date(Date.now() + 86_400_000); d.setUTCHours(14, 0, 0, 0); return d.toISOString(); }; // 11:00 en Chile (verano)

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra, email: `${clave}@empresa.cl` }, clave: "Prueba12345" });
  assert.equal(r.status, 200, JSON.stringify(r));
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: "Prueba12345" });
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  db.tablas.locales.find((l) => l.id === L1).direccion = "Av. Las Condes 1234, Las Condes";
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1, { otorgar: ["ventas.operar", "compras.operar", "consignaciones.operar"], quitar: [] });
});

test("Archivo de calendario (.ics): evento de 1 hora, con lugar, invitado, recordatorio y líneas plegadas", () => {
  const ics = armarIcs({
    uid: "visita-1@drivefuturo", inicio: "2026-11-20T14:00:00.000Z", titulo: "Visita a Autos, Prueba; Ltda", descripcion: "Te atiende: Eva\nLleva tu carnet",
    lugar: "Av. Las Condes 1234, Las Condes", organizador: { nombre: "Autos Prueba", email: "Autos Prueba <avisos@prueba.cl>" }, invitado: { nombre: "Ana", email: "ana@x.cl" },
    ahora: "2026-11-19T12:00:00.000Z",
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /METHOD:REQUEST\r\n/);
  assert.match(ics, /DTSTART:20261120T140000Z\r\n/);
  assert.match(ics, /DTEND:20261120T150000Z\r\n/, "dura una hora");
  assert.match(ics, /SUMMARY:Visita a Autos\\, Prueba\\; Ltda\r\n/);
  assert.match(ics.replace(/\r\n /g, ""), /DESCRIPTION:Te atiende: Eva\\nLleva tu carnet/);
  assert.match(ics, /ORGANIZER;CN=Autos Prueba:mailto:avisos@prueba\.cl/);
  assert.match(ics.replace(/\r\n /g, ""), /ATTENDEE;CN=Ana;.*:mailto:ana@x\.cl/);
  assert.match(ics, /BEGIN:VALARM/);
  assert.ok(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75), "ninguna línea supera 75 bytes");
  assert.equal(escaparIcs("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  assert.equal(plegarIcs("x".repeat(80)), `${"x".repeat(75)}\r\n ${"x".repeat(5)}`);
  assert.equal(fechaIcs("2026-01-02T03:04:05Z"), "20260102T030405Z");
});

test("Enlace de Google Calendar y fecha en hora de Chile", () => {
  const u = new URL(enlaceGoogleCalendar({ inicio: "2026-11-20T14:00:00.000Z", titulo: "Visita", lugar: "Av. Las Condes 1234" }));
  assert.equal(u.hostname, "calendar.google.com");
  assert.equal(u.searchParams.get("action"), "TEMPLATE");
  assert.equal(u.searchParams.get("dates"), "20261120T140000Z/20261120T150000Z");
  assert.equal(u.searchParams.get("location"), "Av. Las Condes 1234");
  assert.match(textoFechaVisita("2026-11-20T14:00:00.000Z"), /^viernes 20 de noviembre a las 11:00$/);

  // Outlook: abre el calendario con la visita lista para guardar (cuentas personales y de trabajo).
  const o = enlacesOutlook({ inicio: "2026-11-20T14:00:00.000Z", titulo: "Visita", lugar: "Av. Las Condes 1234", descripcion: "Te atiende: Eva" });
  for (const [url, host] of [[o.personal, "outlook.live.com"], [o.trabajo, "outlook.office.com"]]) {
    const x = new URL(url);
    assert.equal(x.hostname, host);
    assert.equal(x.searchParams.get("rru"), "addevent");
    assert.equal(x.searchParams.get("startdt"), "2026-11-20T14:00:00Z");
    assert.equal(x.searchParams.get("enddt"), "2026-11-20T15:00:00Z");
    assert.equal(x.searchParams.get("subject"), "Visita");
    assert.equal(x.searchParams.get("location"), "Av. Las Condes 1234");
    assert.equal(x.searchParams.get("body"), "Te atiende: Eva");
  }
});

test("Formularios del CRM: el correo del cliente es obligatorio", async () => {
  assert.equal(validarCliente({ nombre: "Ana Pérez", telefono: "912345678" }, { exigirCorreo: true }).error, "correo_requerido");
  assert.equal(validarCliente({ nombre: "Ana Pérez", telefono: "912345678" }).ok, true, "los canales automáticos (sitio, WhatsApp) no lo exigen");
  const sin = await ve(U.e1.token, "leads.create", { exigirCorreo: true, cliente: { nombre: "Sin Correo", telefono: "911110000" }, lead: { tipo: "venta", fuente: "Llamada" } });
  assert.equal(sin.error, "correo_requerido");
  const comp = await ve(U.e1.token, "leads.create", { exigirCorreo: true, cliente: { nombre: "Carlos Vende", telefono: "911110001" }, lead: { tipo: "compra", fuente: "Llamada", vehiculoOfrecido: { patente: "AABB11", marca: "Kia", modelo: "Rio", anio: 2019, km: 50000 } } });
  assert.equal(comp.error, "correo_requerido", "también en compra");

  // Cliente que ya existe sin correo: el formulario lo pide y queda guardado en su ficha.
  const viejo = await ve(U.e1.token, "leads.create", { cliente: { nombre: "Cliente Antiguo", telefono: "911110002" }, lead: { tipo: "venta", fuente: "Llamada" } });
  assert.equal(viejo.status, 200);
  const otra = (extra) => ve(U.e1.token, "leads.create", { exigirCorreo: true, cliente: { id: viejo.cliente.id }, lead: { tipo: "venta", fuente: "Referido" }, ...extra });
  assert.equal((await otra({})).error, "correo_requerido");
  assert.equal((await otra({ correoCliente: "malo" })).error, "email_invalido");
  assert.equal((await otra({ correoCliente: "Antiguo@Mail.cl" })).status, 200);
  assert.equal(db.tablas.clientes.find((c) => c.id === viejo.cliente.id).email, "antiguo@mail.cl");

  // Editar los datos del cliente desde el lead también lo exige.
  assert.equal((await ve(U.e1.token, "clientes.save", { id: viejo.cliente.id, exigirCorreo: true, datos: { nombre: "Cliente Antiguo", telefono: "911110002", email: "" } })).error, "correo_requerido");
});

test("Agendar una visita: el cliente recibe la invitación de calendario por correo", async () => {
  const l = await ve(U.e1.token, "leads.create", { exigirCorreo: true, cliente: { nombre: "Ana Visita", telefono: "922220000", email: "ana.visita@mail.cl" }, lead: { tipo: "venta", fuente: "Llamada" } });
  assert.equal(l.status, 200, JSON.stringify(l));
  const antes = correos.length;
  const t = await ve(U.e1.token, "tareas.create", { leadId: l.lead.id, titulo: "Visita a la sucursal", tipo: "visita", venceEn: manana11() });
  assert.equal(t.status, 200, JSON.stringify(t));
  assert.equal(t.invitacion, "enviada");
  const c = correos.slice(antes).find((x) => x.to[0] === "ana.visita@mail.cl");
  assert.ok(c, "sale un correo al cliente");
  assert.match(c.subject, /Tu visita a .+: .+ a las 11:00/);
  assert.equal(c.reply_to, "e1@empresa.cl", "las respuestas le llegan al ejecutivo");
  assert.match(c.html, /calendar\.google\.com\/calendar\/render/);
  assert.match(c.html, /Agregar a Google Calendar/);
  assert.ok(c.html.includes("https://outlook.live.com/calendar/0/deeplink/compose?"), "botón para Outlook.com / Hotmail");
  assert.ok(c.html.includes("https://outlook.office.com/calendar/0/deeplink/compose?"), "botón para Outlook de trabajo");
  assert.ok(c.text.includes("Agregar a Outlook (Hotmail / Outlook.com): https://outlook.live.com/"));
  assert.match(c.html, /Av\. Las Condes 1234/);
  const adj = c.attachments[0];
  assert.equal(adj.filename, "invitacion.ics");
  assert.match(adj.content_type, /text\/calendar.*method=REQUEST/);
  const ics = Buffer.from(adj.content, "base64").toString("utf8").replace(/\r\n /g, "");
  assert.match(ics, /ATTENDEE;CN=Ana Visita;.*mailto:ana\.visita@mail\.cl/);
  assert.match(ics, /LOCATION:Av\. Las Condes 1234\\, Las Condes/);
  assert.match(ics, new RegExp(`UID:visita-${t.tarea.id}@drivefuturo`));
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === l.lead.id && /Invitación de calendario enviada/.test(e.detalle)));

  // Una llamada no envía invitación.
  const ll = await ve(U.e1.token, "tareas.create", { leadId: l.lead.id, titulo: "Llamar", tipo: "llamada", venceEn: manana11() });
  assert.equal(ll.invitacion, null);

  // Cliente sin correo (llegó por WhatsApp o por el sitio): la visita se agenda igual y se avisa.
  const s = await ve(U.e1.token, "leads.create", { cliente: { nombre: "Sin Mail", telefono: "933330000" }, lead: { tipo: "venta", fuente: "Llamada" } });
  const ts = await ve(U.e1.token, "tareas.create", { leadId: s.lead.id, titulo: "Visita", tipo: "visita", venceEn: manana11() });
  assert.equal(ts.status, 200);
  assert.equal(ts.invitacion, "sin_correo");
  n++;
});

test("Reprogramar una visita: mismo evento con la nueva hora (secuencia mayor); el calendario del cliente se actualiza", async () => {
  const l = await ve(U.e1.token, "leads.create", { exigirCorreo: true, cliente: { nombre: "Rita Cambio", telefono: "944440000", email: "rita@mail.cl" }, lead: { tipo: "venta", fuente: "Llamada" } });
  const t = await ve(U.e1.token, "tareas.create", { leadId: l.lead.id, titulo: "Visita", tipo: "visita", venceEn: manana11() });
  assert.equal(t.invitacion, "enviada");
  assert.equal(db.tablas.tareas.find((x) => x.id === t.tarea.id).invitacion_enviada, true);

  const nueva = new Date(Date.parse(manana11()) + 2 * 86_400_000 + 3_600_000).toISOString(); // dos días después, 12:00
  assert.equal((await ve(U.e1.token, "tareas.reprogramar", { id: t.tarea.id, venceEn: "2020-01-01T10:00:00Z" })).error, "fecha_pasada");
  assert.equal((await ve(U.e1.token, "tareas.reprogramar", { id: t.tarea.id, venceEn: "mañana" })).error, "fecha_invalida");
  const antes = correos.length;
  const r = await ve(U.e1.token, "tareas.reprogramar", { id: t.tarea.id, venceEn: nueva });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.invitacion, "enviada");
  assert.equal(r.tarea.vence_en, nueva);
  assert.ok(r.tarea.reprogramada_en);
  const c = correos.slice(antes).find((x) => x.to[0] === "rita@mail.cl");
  assert.match(c.subject, /Cambio de horario de tu visita/);
  assert.match(c.html, /antes: .+ a las 11:00/);
  const ics = Buffer.from(c.attachments[0].content, "base64").toString("utf8").replace(/\r\n /g, "");
  assert.match(ics, new RegExp(`UID:visita-${t.tarea.id}@drivefuturo`), "mismo evento");
  assert.match(ics, /SEQUENCE:1/);
  assert.match(ics, /METHOD:REQUEST/);
  assert.match(ics, new RegExp(`DTSTART:${nueva.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`));
  assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === l.lead.id && /Tarea reprogramada/.test(e.detalle)));
});

test("Cancelar una visita: sale de la agenda sin contar como cumplida y el cliente recibe la cancelación", async () => {
  const l = await ve(U.e1.token, "leads.create", { exigirCorreo: true, cliente: { nombre: "Cata Cancela", telefono: "955550000", email: "cata@mail.cl" }, lead: { tipo: "compra", fuente: "Llamada", vehiculoOfrecido: { patente: "CCDD22", marca: "Kia", modelo: "Rio", anio: 2019, km: 50000 } } });
  assert.equal(l.status, 200, JSON.stringify(l));
  const t = await ve(U.e1.token, "tareas.create", { leadId: l.lead.id, titulo: "Visita para tasar", tipo: "visita", venceEn: manana11() });
  assert.equal(t.invitacion, "enviada", "también en leads de compra");
  const antes = correos.length;
  const c = await ve(U.e1.token, "tareas.cancelar", { id: t.tarea.id, motivo: "El cliente vendió el auto" });
  assert.equal(c.status, 200, JSON.stringify(c));
  assert.equal(c.invitacion, "enviada");
  const fila = db.tablas.tareas.find((x) => x.id === t.tarea.id);
  assert.equal(fila.cancelada, true);
  assert.equal(fila.hecha, true, "sale de las listas de pendientes");
  assert.equal(fila.hecha_en, null, "no cuenta como tarea cumplida");
  assert.equal(fila.motivo_cancelacion, "El cliente vendió el auto");
  const m = correos.slice(antes).find((x) => x.to[0] === "cata@mail.cl");
  assert.match(m.subject, /Visita cancelada/);
  assert.doesNotMatch(m.html, /vendió el auto/, "el motivo interno no se le envía al cliente");
  assert.doesNotMatch(m.html, /plataforma/, "sin enlace a la plataforma");
  const ics = Buffer.from(m.attachments[0].content, "base64").toString("utf8").replace(/\r\n /g, "");
  assert.match(ics, /METHOD:CANCEL/);
  assert.match(ics, /STATUS:CANCELLED/);
  assert.match(ics, new RegExp(`UID:visita-${t.tarea.id}@drivefuturo`));
  assert.match(ics, /SEQUENCE:1/);
  assert.equal(m.attachments[0].filename, "cancelacion.ics");

  // Cerrada: ya no se reprograma, cancela ni marca.
  assert.equal((await ve(U.e1.token, "tareas.cancelar", { id: t.tarea.id })).error, "tarea_cerrada");
  assert.equal((await ve(U.e1.token, "tareas.reprogramar", { id: t.tarea.id, venceEn: manana11() })).error, "tarea_cerrada");
  assert.equal((await ve(U.e1.token, "tareas.hecha", { id: t.tarea.id, hecha: false })).error, "tarea_cerrada");
  assert.ok(!(await ve(U.e1.token, "tareas.list")).tareas.some((x) => x.id === t.tarea.id), "no aparece en la agenda");

  // Una llamada se cancela sin correo al cliente; una visita sin invitación previa tampoco envía nada.
  const ll = await ve(U.e1.token, "tareas.create", { leadId: l.lead.id, titulo: "Llamar", tipo: "llamada", venceEn: manana11() });
  const n0 = correos.length;
  const cl = await ve(U.e1.token, "tareas.cancelar", { id: ll.tarea.id });
  assert.equal(cl.invitacion, null);
  assert.equal(correos.length, n0);
});

test("Con Google Calendar conectado: Google invita al cliente, y al reprogramar o cancelar actualiza su calendario", async () => {
  Object.assign(entorno, { GOOGLE_CLIENT_ID: "cliente.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "secreto", GOOGLE_REFRESH_TOKEN: "1//token" });
  try {
    const l = await ve(U.e1.token, "leads.create", { exigirCorreo: true, cliente: { nombre: "Olga Outlook", telefono: "966660000", email: "olga@hotmail.com" }, lead: { tipo: "venta", fuente: "Llamada" } });
    const antesCorreos = correos.length;
    const t = await ve(U.e1.token, "tareas.create", { leadId: l.lead.id, titulo: "Visita para ver el Tucson", tipo: "visita", venceEn: manana11() });
    assert.equal(t.status, 200, JSON.stringify(t));
    assert.equal(t.invitacion, "enviada");
    assert.equal(correos.slice(antesCorreos).filter((c) => c.to[0] === "olga@hotmail.com").length, 0, "no sale correo por Resend: invita Google");
    const crear = google.llamadas.filter((x) => x.metodo === "POST" && x.ruta && x.ruta.endsWith("/calendars/primary/events")).pop();
    assert.equal(crear.query.sendUpdates, "all", "Google le envía la invitación");
    assert.match(crear.auth, /^Bearer ya29\.prueba/);
    assert.deepEqual(crear.cuerpo.attendees.map((a) => a.email), ["olga@hotmail.com", "e1@empresa.cl"], "cliente y ejecutivo invitados");
    assert.equal(crear.cuerpo.start.timeZone, "America/Santiago");
    assert.equal(Date.parse(crear.cuerpo.end.dateTime) - Date.parse(crear.cuerpo.start.dateTime), 3_600_000);
    assert.equal(crear.cuerpo.location, "Av. Las Condes 1234, Las Condes");
    assert.match(crear.cuerpo.description, /Visita para ver el Tucson/);
    const fila = db.tablas.tareas.find((x) => x.id === t.tarea.id);
    assert.ok(fila.google_event_id, "guarda el id del evento");
    assert.equal(fila.invitacion_enviada, true);

    // Reprogramar: se mueve el MISMO evento.
    const nueva = new Date(Date.parse(manana11()) + 86_400_000).toISOString();
    const r = await ve(U.e1.token, "tareas.reprogramar", { id: t.tarea.id, venceEn: nueva });
    assert.equal(r.invitacion, "enviada");
    const mover = google.llamadas.filter((x) => x.metodo === "PATCH").pop();
    assert.ok(mover.ruta.endsWith(`/events/${fila.google_event_id}`));
    assert.equal(mover.query.sendUpdates, "all");
    assert.equal(new Date(google.eventos[fila.google_event_id].start.dateTime).toISOString(), nueva);

    // Cancelar: Google lo quita del calendario del cliente.
    const c = await ve(U.e1.token, "tareas.cancelar", { id: t.tarea.id });
    assert.equal(c.invitacion, "enviada");
    assert.equal(google.eventos[fila.google_event_id].status, "cancelled");
    assert.equal(google.llamadas.filter((x) => x.metodo === "DELETE").pop().query.sendUpdates, "all");
    assert.equal(correos.slice(antesCorreos).filter((m) => m.to[0] === "olga@hotmail.com").length, 0);
    assert.ok(db.tablas.lead_eventos.some((e) => e.lead_id === l.lead.id && /Google Calendar/.test(e.detalle)));

    // Si Google falla, la visita se agenda igual y el CRM avisa.
    google.fallar = 500;
    const f = await ve(U.e1.token, "tareas.create", { leadId: l.lead.id, titulo: "Otra visita", tipo: "visita", venceEn: manana11() });
    assert.equal(f.status, 200);
    assert.equal(f.invitacion, "fallida");
    assert.ok(db.tablas.bitacora.some((b) => b.accion === "aviso.fallido" && b.detalle.asunto === "Google Calendar"));
  } finally {
    delete entorno.GOOGLE_CLIENT_ID; delete entorno.GOOGLE_CLIENT_SECRET; delete entorno.GOOGLE_REFRESH_TOKEN;
  }
});
