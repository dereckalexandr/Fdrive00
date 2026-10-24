// Módulo comercial (entrega 2A) contra la función real y una base falsa en memoria.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const kv = (token, op, key, extra = {}) => api({ action: "kv", token, op, key, ...extra });
const CLAVE = "Prueba12345";
const CLIENTE = { nombre: "Cecilia Mora", rut: "11.111.111-1", telefono: "+56 9 8765 4321", email: "ceci@mail.cl" };
const VEH = { patente: "ABCD12", marca: "Toyota", modelo: "Yaris", anio: 2020, km: 45000, precioLista: 9500000, costo: 8000000 };

const U = {}; // usuarios y tokens
let admin; let L1; let L2;

async function crear(admin, clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  assert.equal(l.status, 200);
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  L2 = (await crm(admin, "locales.create", { nombre: "Sucursal Sur" })).local.id;
  const ventas = { otorgar: ["ventas.operar"], quitar: [] };
  await crear(admin, "jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear(admin, "e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1, ventas);
  await crear(admin, "e2", "Ema Dos", "7.654.321-6", ["ejecutivo"], L1, ventas);
  await crear(admin, "e3", "Eli Tres", "9.876.543-3", ["ejecutivo"], L1, { otorgar: [], quitar: ["ventas.operar"] }); // sin habilitación de ventas
  await crear(admin, "jefeSur", "Jorge Sur", "8.765.432-K", ["jefe_local"], L2);
  await crear(admin, "tasador", "Tito Tasador", "5.555.555-9", ["tasador"], L1);
});

test("Sin sesión o con una sesión que no corresponde, no se entra al módulo", async () => {
  assert.equal((await ve(null, "leads.list")).status, 401);
  assert.equal((await ve("x.y", "leads.list")).status, 401);
  assert.equal((await ve(U.tasador.token, "leads.list")).status, 403, "un tasador no tiene permisos de leads");
});

test("Inventario: solo quien puede editarlo lo carga; el costo se oculta al resto", async () => {
  const sinPerm = await ve(U.e1.token, "inventario.save", { datos: VEH });
  assert.equal(sinPerm.status, 403);

  const mal = await ve(U.jefe.token, "inventario.save", { datos: { ...VEH, patente: "123" } });
  assert.equal(mal.error, "patente_invalida");

  const ok = await ve(U.jefe.token, "inventario.save", { datos: VEH });
  assert.equal(ok.status, 200);
  assert.equal(ok.vehiculo.local_id, L1);
  assert.equal(ok.vehiculo.patente, "ABCD12");
  U.vehiculo = ok.vehiculo;

  assert.equal((await ve(U.jefe.token, "inventario.save", { datos: VEH })).error, "patente_duplicada");

  const listaJefe = await ve(U.jefe.token, "inventario.list");
  assert.equal(listaJefe.vehiculos[0].costo, 8000000);
  assert.equal(listaJefe.puedeEditar, true);
  const listaEje = await ve(U.e1.token, "inventario.list");
  assert.equal(listaEje.vehiculos.length, 1);
  assert.equal(listaEje.vehiculos[0].costo, undefined, "el ejecutivo no ve el costo");
  assert.equal(listaEje.puedeEditar, false);
  assert.equal(JSON.stringify(listaEje).includes("8000000"), false);
});

test("Inventario: cada local ve solo lo suyo", async () => {
  assert.equal((await ve(U.jefeSur.token, "inventario.list")).vehiculos.length, 0);
  const otro = await ve(U.jefeSur.token, "inventario.save", { datos: { ...VEH, patente: "WXYZ99", modelo: "Rio" } });
  assert.equal(otro.status, 200);
  assert.equal(otro.vehiculo.local_id, L2);
  assert.equal((await ve(U.jefe.token, "inventario.list")).vehiculos.length, 1);
  // No puede tocar el vehículo del otro local aunque conozca su id.
  assert.equal((await ve(U.jefe.token, "inventario.setEstado", { id: otro.vehiculo.id, estado: "vendido" })).status, 404);
  assert.equal((await ve(U.jefe.token, "inventario.archivar", { id: otro.vehiculo.id })).status, 404);
});

test("Inventario: cambiar estado, editar y archivar, todo con bitácora", async () => {
  assert.equal((await ve(U.jefe.token, "inventario.setEstado", { id: U.vehiculo.id, estado: "inventado" })).error, "estado_invalido");
  assert.equal((await ve(U.jefe.token, "inventario.setEstado", { id: U.vehiculo.id, estado: "preparacion" })).vehiculo.estado, "preparacion");
  await ve(U.jefe.token, "inventario.setEstado", { id: U.vehiculo.id, estado: "disponible" });
  const ed = await ve(U.jefe.token, "inventario.save", { id: U.vehiculo.id, datos: { ...VEH, precioLista: 9000000 } });
  assert.equal(ed.vehiculo.precio_lista, 9000000);
  const f = db.tablas.bitacora.find((b) => b.accion === "vehiculo.editar");
  assert.deepEqual(f.detalle.cambios.precio_lista, { antes: 9500000, despues: 9000000 });
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "vehiculo.crear"));
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "vehiculo.estado"));

  const extra = await ve(U.jefe.token, "inventario.save", { datos: { ...VEH, patente: "QQQQ11", modelo: "Corolla" } });
  await ve(U.jefe.token, "inventario.archivar", { id: extra.vehiculo.id });
  assert.equal((await ve(U.jefe.token, "inventario.list")).vehiculos.some((v) => v.patente === "QQQQ11"), false);
});

test("Fotos del inventario: las ve quien trabaja con leads/inventario; solo las sube quien edita", async () => {
  const key = `vfoto::${U.vehiculo.id}::abc123xyz`;
  assert.equal((await kv(U.jefe.token, "set", key, { value: "data:image/jpeg;base64,AAA" })).status, 200);
  assert.equal((await kv(U.e1.token, "get", key)).status, 200);
  assert.equal((await kv(U.e1.token, "set", key, { value: "x" })).status, 403);
  assert.equal((await kv(U.e1.token, "delete", key)).status, 403);
  assert.equal((await kv(U.tasador.token, "set", key, { value: "x" })).status, 403);
  assert.equal((await kv(U.jefe.token, "delete", key)).status, 200);
});

test("Leads: el ejecutivo habilitado crea y se queda con el lead; sin habilitación no puede", async () => {
  const sin = await ve(U.e3.token, "leads.create", { cliente: CLIENTE, lead: { fuente: "Llamada" } });
  assert.equal(sin.status, 403, "Eli no está habilitada para ventas");

  const mal = await ve(U.e1.token, "leads.create", { cliente: { nombre: "A" }, lead: {} });
  assert.equal(mal.error, "nombre_invalido");

  const r = await ve(U.e1.token, "leads.create", { cliente: CLIENTE, lead: { vehiculoId: U.vehiculo.id, fuente: "Llamada", financiamiento: { quiere: true, pie: 2000000 } } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.lead.etapa, "nuevo");
  assert.equal(r.lead.asignado_a, U.e1.id);
  assert.equal(r.lead.local_id, L1);
  assert.equal(r.lead.financiamiento.pie, 2000000);
  U.lead1 = r.lead;
  U.cliente1 = r.cliente;

  // Aunque el ejecutivo pida otra asignación, se queda con el lead.
  const otro = await ve(U.e1.token, "leads.create", { cliente: { nombre: "Daniel Rojas", telefono: "912345678" }, lead: {}, asignarA: U.e2.id });
  assert.equal(otro.lead.asignado_a, U.e1.id);
  U.lead2 = otro.lead;

  // Mismo RUT = mismo cliente (no se duplica).
  const dup = await ve(U.e1.token, "leads.create", { cliente: CLIENTE, lead: { fuente: "WhatsApp" } });
  assert.equal(dup.cliente.id, U.cliente1.id);
  assert.equal(db.tablas.clientes.filter((c) => c.rut === "11111111-1").length, 1);

  // No puede usar un vehículo de otro local.
  const sur = (await ve(U.jefeSur.token, "inventario.list")).vehiculos[0];
  assert.equal((await ve(U.e1.token, "leads.create", { cliente: CLIENTE, lead: { vehiculoId: sur.id } })).error, "vehiculo_invalido");
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "lead.crear"));
});

test("Visibilidad: cada ejecutivo ve SOLO sus leads; el supervisor ve todo el local, otro local nada", async () => {
  const e1 = await ve(U.e1.token, "leads.list");
  assert.ok(e1.leads.length >= 2 && e1.leads.every((l) => l.asignado_a === U.e1.id));
  assert.equal(e1.veTodo, false);
  assert.equal(e1.puedeAsignar, false);

  const e2 = await ve(U.e2.token, "leads.list");
  assert.equal(e2.leads.length, 0);
  assert.equal((await ve(U.e2.token, "leads.get", { id: U.lead1.id })).status, 404, "no ve el lead de otra persona");
  assert.equal((await ve(U.e2.token, "leads.list", { todos: true })).leads.length, 0, "pedir 'todos' no le sirve");

  const jefe = await ve(U.jefe.token, "leads.list", { todos: true });
  assert.ok(jefe.leads.length >= 2);
  assert.equal(jefe.puedeAsignar, true);
  assert.equal((await ve(U.jefe.token, "leads.get", { id: U.lead1.id })).status, 200);

  assert.equal((await ve(U.jefeSur.token, "leads.list", { todos: true })).leads.length, 0);
  assert.equal((await ve(U.jefeSur.token, "leads.get", { id: U.lead1.id })).status, 404);
});

test("Los datos del lead traen el cliente y el vehículo, sin el costo para el ejecutivo", async () => {
  const l = await ve(U.e1.token, "leads.list");
  const lead = l.leads.find((x) => x.id === U.lead1.id);
  const cli = l.clientes.find((c) => c.id === lead.cliente_id);
  assert.equal(cli.nombre, "Cecilia Mora");
  const veh = l.vehiculos.find((v) => v.id === lead.vehiculo_id);
  assert.equal(veh.patente, "ABCD12");
  assert.equal(veh.costo, undefined);
  const g = await ve(U.e1.token, "leads.get", { id: U.lead1.id });
  assert.equal(g.vehiculo.costo, undefined);
  assert.equal(g.puedeEditar, true);
  assert.ok(g.eventos.some((e) => e.tipo === "creado"));
});

test("El supervisor asigna a mano o con reparto rotativo (solo a quien está habilitado para ventas)", async () => {
  const a = await ve(U.jefe.token, "leads.create", { cliente: { nombre: "Fabiola Paz", telefono: "911111111" }, lead: {}, asignarA: U.e2.id });
  assert.equal(a.lead.asignado_a, U.e2.id);
  assert.equal((await ve(U.jefe.token, "leads.create", { cliente: { nombre: "Gonzalo Paz", telefono: "922222222" }, lead: {}, asignarA: U.e3.id })).error, "asignado_invalido");
  assert.equal((await ve(U.jefe.token, "leads.create", { cliente: { nombre: "Gonzalo Paz", telefono: "922222222" }, lead: {}, asignarA: U.tasador.id })).error, "asignado_invalido");

  // Reparto automático: alterna entre quienes pueden y nunca elige a Eli (sin habilitación).
  const quienes = [];
  for (let i = 0; i < 6; i++) {
    const r = await ve(U.jefe.token, "leads.create", { cliente: { nombre: `Cliente Auto ${i}`, telefono: `93333333${i}` }, lead: {}, asignarA: "auto" });
    quienes.push(r.lead.asignado_a);
    await new Promise((res) => setTimeout(res, 5));
  }
  assert.ok(!quienes.includes(U.e3.id));
  const e1 = quienes.filter((q) => q === U.e1.id).length;
  const e2 = quienes.filter((q) => q === U.e2.id).length;
  assert.equal(e1 + e2, 6);
  assert.ok(Math.abs(e1 - e2) <= 1, `reparto parejo: ${e1} / ${e2}`);
});

test("Etapas: el dueño mueve su lead; no a etapas futuras; perder exige motivo; solo el supervisor reabre", async () => {
  assert.equal((await ve(U.e1.token, "leads.mover", { id: U.lead1.id, etapa: "ganado" })).error, "etapa_automatica");
  assert.equal((await ve(U.e1.token, "leads.mover", { id: U.lead1.id, etapa: "perdido" })).error, "motivo_requerido");
  const m = await ve(U.e1.token, "leads.mover", { id: U.lead1.id, etapa: "seguimiento" });
  assert.equal(m.lead.etapa, "seguimiento");

  // Otro ejecutivo no puede mover un lead ajeno (ni siquiera lo ve).
  assert.equal((await ve(U.e2.token, "leads.mover", { id: U.lead1.id, etapa: "contactado" })).status, 404);

  const perdido = await ve(U.e1.token, "leads.mover", { id: U.lead2.id, etapa: "perdido", motivo: "Precio" });
  assert.equal(perdido.lead.etapa, "perdido");
  assert.equal(perdido.lead.motivo_perdida, "Precio");
  assert.equal((await ve(U.e1.token, "leads.mover", { id: U.lead2.id, etapa: "contactado" })).error, "lead_cerrado");
  const reabre = await ve(U.jefe.token, "leads.mover", { id: U.lead2.id, etapa: "contactado" });
  assert.equal(reabre.lead.etapa, "contactado");
  assert.equal(reabre.lead.motivo_perdida, null);
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "lead.mover" && b.detalle.a === "perdido"));
});

test("Un permiso de solo ver el local (leads.local) no permite modificar nada", async () => {
  await crear(admin, "mkt", "Marta Marketing", "13.579.246-2", ["marketing"], L1);
  const l = await ve(U.mkt.token, "leads.list", { todos: true });
  assert.ok(l.leads.length > 0, "ve los leads del local");
  assert.equal(l.puedeAsignar, false);
  assert.equal((await ve(U.mkt.token, "leads.mover", { id: U.lead1.id, etapa: "contactado" })).status, 403);
  assert.equal((await ve(U.mkt.token, "leads.nota", { id: U.lead1.id, tipo: "nota", detalle: "hola" })).status, 403);
  assert.equal((await ve(U.mkt.token, "leads.create", { cliente: CLIENTE, lead: {} })).status, 403);
  assert.equal((await ve(U.mkt.token, "leads.reasignar", { id: U.lead1.id, asignarA: U.e2.id })).status, 403);
});

test("Reasignar: solo el supervisor, y solo a quien puede recibir leads", async () => {
  assert.equal((await ve(U.e1.token, "leads.reasignar", { id: U.lead1.id, asignarA: U.e2.id })).status, 403);
  assert.equal((await ve(U.jefe.token, "leads.reasignar", { id: U.lead1.id, asignarA: U.e3.id })).error, "asignado_invalido");
  const r = await ve(U.jefe.token, "leads.reasignar", { id: U.lead1.id, asignarA: U.e2.id });
  assert.equal(r.lead.asignado_a, U.e2.id);
  // El dueño anterior pierde el acceso y el nuevo lo gana.
  assert.equal((await ve(U.e1.token, "leads.get", { id: U.lead1.id })).status, 404);
  assert.equal((await ve(U.e2.token, "leads.get", { id: U.lead1.id })).status, 200);
  const auto = await ve(U.jefe.token, "leads.reasignar", { id: U.lead1.id });
  assert.equal(auto.lead.asignado_a, U.e1.id, "el automático no repite a la misma persona");
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "lead.reasignar"));
  assert.ok(db.tablas.lead_eventos.some((e) => e.tipo === "asignacion"));
});

test("Seguimiento: un contacto registra la fecha y saca al lead de 'Nuevo'", async () => {
  const nuevo = (await ve(U.e2.token, "leads.create", { cliente: { nombre: "Hilda Vega", telefono: "944444444" }, lead: {} })).lead;
  assert.equal(nuevo.etapa, "nuevo");
  assert.equal((await ve(U.e2.token, "leads.nota", { id: nuevo.id, tipo: "nota", detalle: "   " })).error, "detalle_requerido");
  assert.equal((await ve(U.e2.token, "leads.nota", { id: nuevo.id, tipo: "baile" })).error, "tipo_invalido");
  const nota = await ve(U.e2.token, "leads.nota", { id: nuevo.id, tipo: "nota", detalle: "Prefiere SUV" });
  assert.equal(nota.lead.etapa, "nuevo", "una nota no cuenta como contacto");
  assert.equal(nota.lead.ultimo_contacto, null);
  const llamada = await ve(U.e2.token, "leads.nota", { id: nuevo.id, tipo: "llamada", detalle: "No contestó, reintentar" });
  assert.equal(llamada.lead.etapa, "contactado");
  assert.ok(llamada.lead.ultimo_contacto);
  const g = await ve(U.e2.token, "leads.get", { id: nuevo.id });
  assert.ok(g.eventos.some((e) => e.tipo === "llamada") && g.eventos.some((e) => e.tipo === "etapa"));
});

test("Tareas: se agendan sobre un lead propio, cada uno ve las suyas y solo el supervisor ve las del local", async () => {
  const manana = new Date(Date.now() + 86_400_000).toISOString();
  const ayer = new Date(Date.now() - 2 * 86_400_000).toISOString();
  assert.equal((await ve(U.e2.token, "tareas.create", { leadId: U.lead1.id, titulo: "ab", venceEn: manana })).error, "titulo_invalido");
  // El lead de Cecilia es de Eva (la reasignación automática se lo devolvió).
  const t = await ve(U.e1.token, "tareas.create", { leadId: U.lead1.id, titulo: "Llamar a Cecilia", tipo: "llamada", venceEn: manana });
  assert.equal(t.status, 200);
  assert.equal(t.tarea.asignado_a, U.e1.id);
  U.tarea = t.tarea;

  // Ema no puede agendar sobre un lead que no es suyo.
  assert.equal((await ve(U.e2.token, "tareas.create", { leadId: U.lead1.id, titulo: "Intrusa", venceEn: manana })).status, 404);
  await ve(U.e2.token, "tareas.create", { titulo: "Revisar cartera", venceEn: ayer });

  const mias = await ve(U.e1.token, "tareas.list");
  assert.deepEqual(mias.tareas.map((x) => x.titulo), ["Llamar a Cecilia"]);
  assert.equal(mias.leads[U.lead1.id].cliente, "Cecilia Mora");
  assert.equal((await ve(U.e1.token, "tareas.list", { todas: true })).tareas.length, 1, "pedir 'todas' no le sirve");
  const local = await ve(U.jefe.token, "tareas.list", { todas: true });
  assert.ok(local.tareas.length >= 2);

  assert.equal((await ve(U.e2.token, "tareas.hecha", { id: U.tarea.id })).status, 403);
  assert.equal((await ve(U.e1.token, "tareas.hecha", { id: U.tarea.id })).tarea.hecha, true);
  assert.equal((await ve(U.e1.token, "tareas.list")).tareas.length, 0, "las hechas salen de la lista");
});

test("Clientes: cada ejecutivo ve los suyos; el supervisor, todos; la búsqueda funciona", async () => {
  const e1 = await ve(U.e1.token, "clientes.list");
  assert.ok(e1.clientes.length >= 1);
  const jefe = await ve(U.jefe.token, "clientes.list");
  assert.ok(jefe.clientes.length > e1.clientes.length);
  assert.equal((await ve(U.jefe.token, "clientes.list", { q: "cecilia" })).clientes.length, 1);
  assert.equal((await ve(U.jefe.token, "clientes.list", { q: "11111111-1" })).clientes.length, 1);
  assert.equal((await ve(U.jefeSur.token, "clientes.list")).clientes.length, 0, "otro local no ve estos clientes");

  const ed = await ve(U.e1.token, "clientes.save", { id: U.cliente1.id, datos: { ...CLIENTE, telefono: "+56 9 1111 2222" } });
  assert.equal(ed.status, 200, "Eva creó/atendió a este cliente");
  const intruso = await ve(U.e2.token, "clientes.save", { id: db.tablas.clientes.find((c) => c.nombre === "Daniel Rojas").id, datos: { nombre: "Daniel Rojas", telefono: "912345678" } });
  assert.equal(intruso.status, 403, "Ema no atiende a Daniel");
});

test("Cuenta maestra: con dos locales debe elegir en cuál crea; luego ve y reasigna", async () => {
  const sinLocal = await ve(admin, "inventario.save", { datos: { ...VEH, patente: "AAAA11" } });
  assert.equal(sinLocal.error, "sin_local");
  const ok = await ve(admin, "inventario.save", { localId: L1, datos: { ...VEH, patente: "AAAA11" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.vehiculo.local_id, L1);
  const lead = await ve(admin, "leads.create", { localId: L1, cliente: { nombre: "Ivo Pérez", telefono: "955555555" }, lead: {}, asignarA: U.e1.id });
  assert.equal(lead.status, 200);
  assert.equal(lead.lead.asignado_a, U.e1.id);
  assert.ok((await ve(admin, "leads.list", { localId: L1, todos: true })).leads.length > 0);
  const cat = await ve(admin, "catalogos");
  assert.equal(cat.locales.length, 2);
  assert.ok(cat.fuentes_lead.includes("Llamada"));
});

test("Catálogos: cualquier persona del módulo recibe fuentes y motivos, sin locales", async () => {
  const c = await ve(U.e1.token, "catalogos");
  assert.ok(c.fuentes_lead.length > 0 && c.motivos_perdida.length > 0);
  assert.deepEqual(c.locales, []);
  assert.equal(c.etapas.length, 7);
});

test("Si se desactiva a un ejecutivo: pierde el acceso y deja de recibir leads automáticos", async () => {
  await crm(admin, "usuarios.setActivo", { id: U.e2.id, activo: false });
  assert.equal((await ve(U.e2.token, "leads.list")).status, 401);
  for (let i = 0; i < 4; i++) {
    const r = await ve(U.jefe.token, "leads.create", { cliente: { nombre: `Cliente Post ${i}`, telefono: `96666666${i}` }, lead: {}, asignarA: "auto" });
    assert.equal(r.lead.asignado_a, U.e1.id, "solo queda Eva habilitada");
  }
});

test("Si se le quita la habilitación de ventas, ya no puede crear ni modificar leads", async () => {
  await crm(admin, "usuarios.update", { id: U.e1.id, datos: { nombre: "Eva Uno", roles: ["ejecutivo"], localId: L1, extra: { otorgar: [], quitar: [] } } });
  assert.equal((await ve(U.e1.token, "leads.create", { cliente: CLIENTE, lead: {} })).status, 403);
  const propio = (await ve(U.e1.token, "leads.list")).leads[0];
  assert.equal((await ve(U.e1.token, "leads.mover", { id: propio.id, etapa: "contactado" })).status, 403, "ve sus leads pero ya no los modifica");
});

test("Si faltan las tablas del módulo comercial, lo dice claramente", async () => {
  const guardadas = { ...db.tablas };
  delete db.tablas.vehiculos;
  try {
    const r = await ve(U.jefe.token, "inventario.list");
    assert.equal(r.status, 503);
    assert.equal(r.error, "crm_not_installed");
  } finally { Object.assign(db.tablas, guardadas); }
});
