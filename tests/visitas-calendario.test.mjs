// Visitas a la sucursal: el cliente recibe la invitación para su calendario (.ics + enlace a Google Calendar),
// y los formularios del CRM exigen su correo.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db, correos } from "./helpers/api-env.mjs";
import { armarIcs, enlaceGoogleCalendar, textoFechaVisita, escaparIcs, plegarIcs, fechaIcs } from "../supabase/functions/api/calendario-core.js";
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
