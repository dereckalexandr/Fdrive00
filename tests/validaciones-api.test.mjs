// Perfil del Validador: revisión de documentos, creación automática por etapa y bloqueo del cierre de venta,
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
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const filaVal = (id) => db.tablas.validaciones.find((v) => v.id === id);
const docsFila = (id) => db.tablas.validacion_docs.filter((d) => d.validacion_id === id);
let archN = 0;
const archivo = (extra = {}) => ({ id: `arch${String(100000 + ++archN)}`, nombre: "doc.jpg", tipo: "image/jpeg", tam: 120000, ...extra });

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}
async function vehiculo() {
  const r = await ve(U.jefe.token, "inventario.save", { datos: { patente: `VV${String(1000 + ++n)}`, marca: "Toyota", modelo: "Yaris", anio: 2020, km: 40000, precioLista: 10000000, costo: 8500000 } });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.vehiculo;
}
async function leadReservado(token, veh) {
  veh = veh || (await vehiculo());
  const l = (await ve(token, "leads.create", { cliente: { nombre: `Cliente ${++n}`, telefono: `9${String(20000000 + n)}` }, lead: {} })).lead;
  const cot = (await ve(token, "cotizaciones.save", { leadId: l.id, vehiculoId: veh.id, datos: {} })).cotizacion;
  const res = (await ve(token, "reservas.crear", { cotizacionId: cot.id, monto: 500000 })).reserva;
  assert.ok(res, "no se pudo reservar");
  return { lead: l, veh };
}
const DATOS = (extra = {}) => ({ precioFinal: 9800000, montoParteDePago: 0, montoFinanciado: 0, fechaEntrega: hoy(), ...extra });
const cerrar = (token, leadId, datos) => ve(token, "cierres.crear", { leadId, datos });
/** Sube y aprueba todos los documentos requeridos de una validación (la debe tener tomada el Validador). */
async function aprobarTodo(validador, id) {
  for (const d of docsFila(id)) {
    if (d.estado === "aprobado" || d.estado === "no_aplica") continue;
    if ((d.archivos ?? []).length === 0) assert.equal((await ve(validador.token, "validacion.adjuntar", { id, docId: d.id, archivo: archivo() })).status, 200);
    const r = await ve(validador.token, "validacion.revisar", { id, docId: d.id, estado: "aprobado" });
    assert.equal(r.status, 200, JSON.stringify(r));
  }
}

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  L2 = (await crm(admin, "locales.create", { nombre: "Sucursal Sur" })).local.id;
  const ventas = { otorgar: ["ventas.operar"], quitar: [] };
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("jefeSur", "Jorge Sur", "8.765.432-K", ["jefe_local"], L2);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1, ventas);
  await crear("e2", "Ema Dos", "7.654.321-6", ["ejecutivo"], L1, ventas);
  await crear("t1", "Tito Tasador", "5.555.555-9", ["tasador"], L1);
  await crear("mkt", "Marta Marketing", "10.000.013-K", ["marketing"], L1);
});

test("Sin Validadores en el local: la validación se crea pero no frena la venta (la supervisora sigue aprobando sola)", async () => {
  const x = await leadReservado(U.jefe.token);
  const c = await cerrar(U.jefe.token, x.lead.id, DATOS());
  assert.equal(c.status, 200, JSON.stringify(c));
  assert.equal(c.cierre.estado, "aprobada", "no hay Validador: no se exige");
  assert.equal(c.validacion.exige, false);
  assert.equal(db.tablas.validaciones.filter((v) => v.cierre_id === c.cierre.id).length, 1);
  // El vehículo creado también recibió su validación de documentos.
  assert.equal(db.tablas.validaciones.filter((v) => v.tipo === "vehiculo").length >= 1, true);

  const y = await leadReservado(U.e1.token);
  const c2 = await cerrar(U.e1.token, y.lead.id, DATOS());
  const a = await ve(U.jefe.token, "cierres.aprobar", { id: c2.cierre.id });
  assert.equal(a.status, 200, "sin Validadores el supervisor aprueba sin esperar documentos");
});

test("Documentos que se piden según el tipo de validación", async () => {
  const v = (await ve(U.jefe.token, "inventario.save", { datos: { patente: "DDDD11", marca: "Kia", modelo: "Rio", anio: 2019, km: 1000, precioLista: 9000000, costo: 7000000 } })).vehiculo;
  const vv = db.tablas.validaciones.find((x) => x.vehiculo_id === v.id && x.tipo === "vehiculo");
  assert.ok(vv, "se crea sola al ingresar el vehículo");
  assert.equal(vv.estado, "pendiente");
  assert.deepEqual(docsFila(vv.id).map((d) => d.clave), ["padron", "permiso_circulacion", "revision_tecnica", "soap", "multas_prendas"]);

  const x = await leadReservado(U.e1.token);
  const c = await cerrar(U.e1.token, x.lead.id, DATOS({ montoFinanciado: 3000000, financiera: "Autofin", comisionFinanciera: 200000 }));
  assert.equal(c.status, 200, JSON.stringify(c));
  const claves = docsFila(c.validacion.id).map((d) => d.clave);
  for (const k of ["padron", "cedula_cliente", "domicilio", "comprobante_pago", "renta", "antecedentes_credito"]) assert.ok(claves.includes(k), k);
  assert.ok(!claves.includes("docs_parte_pago"), "sin parte de pago");
  U.cierreFin = c.cierre;
  U.valFin = c.validacion;
});

test("Permisos básicos: quién entra al módulo y quién revisa", async () => {
  assert.equal((await ve(U.mkt.token, "validacion.list", { vista: "cola" })).status, 403);
  assert.equal((await ve(U.e1.token, "validacion.list", { vista: "cola" })).status, 403, "el ejecutivo no ve la cola");
  assert.equal((await ve(U.e1.token, "validacion.resumen")).status, 403);
  assert.equal((await ve(U.e1.token, "validacion.tomar", { id: U.valFin.id })).status, 403);
  assert.equal((await ve(U.e1.token, "validacion.list", { vista: "origen", cierreId: U.cierreFin.id })).validaciones.length, 1, "quien trabaja el lead ve su validación");
  assert.equal((await ve(U.e2.token, "validacion.list", { vista: "origen", cierreId: U.cierreFin.id })).validaciones.length, 0, "Ema no ve el lead de Eva");
  assert.equal((await ve(U.e2.token, "validacion.get", { id: U.valFin.id })).status, 404);
});

test("Con un Validador en el local, la venta espera su validación (también la de la supervisora)", async () => {
  await crear("v1", "Vera Validadora", "11.111.111-1", ["validador"], L1);
  await crear("v2", "Víctor Validador", "13.579.246-2", ["validador"], L1);
  await crear("vSur", "Vanesa Sur", "14.000.000-0", ["validador"], L2);

  const y = await leadReservado(U.jefe.token);
  const c = await cerrar(U.jefe.token, y.lead.id, DATOS());
  assert.equal(c.cierre.estado, "pendiente", "la supervisora tampoco aprueba sola");
  assert.equal(c.validacion.exige, true);
  assert.equal((await ve(U.jefe.token, "cierres.aprobar", { id: c.cierre.id })).error, "validacion_pendiente");
  U.cierreJefe = c.cierre; U.valJefe = c.validacion;
  assert.equal((await ve(U.jefe.token, "cierres.aprobar", { id: U.cierreFin.id })).error, "validacion_pendiente");
});

test("Cola del Validador: solo su local; el primero la toma; el supervisor ve todo y asigna", async () => {
  const cola = await ve(U.v1.token, "validacion.list", { vista: "cola" });
  assert.equal(cola.status, 200);
  assert.ok(cola.validaciones.some((v) => v.id === U.valFin.id));
  assert.equal((await ve(U.vSur.token, "validacion.list", { vista: "cola" })).validaciones.length, 0, "otro local no la ve");
  assert.equal((await ve(U.vSur.token, "validacion.get", { id: U.valFin.id })).status, 404);

  const t = await ve(U.v1.token, "validacion.tomar", { id: U.valFin.id });
  assert.equal(t.status, 200, JSON.stringify(t));
  assert.equal(t.validacion.estado, "en_revision");
  assert.equal(t.validacion.validador, "Vera Validadora");
  assert.equal((await ve(U.v2.token, "validacion.tomar", { id: U.valFin.id })).error, "validacion_ya_tomada");

  assert.equal((await ve(U.v1.token, "validacion.asignar", { id: U.valJefe.id, validadorId: U.v2.id })).status, 403, "asignar es del supervisor");
  assert.equal((await ve(U.jefe.token, "validacion.asignar", { id: U.valJefe.id, validadorId: U.vSur.id })).error, "asignado_invalido");
  const a = await ve(U.jefe.token, "validacion.asignar", { id: U.valJefe.id, validadorId: U.v2.id });
  assert.equal(a.status, 200, JSON.stringify(a));
  assert.equal(a.validacion.validador, "Víctor Validador");
  assert.equal((await ve(U.v1.token, "validacion.liberar", { id: U.valJefe.id })).status, 403, "Vera no libera la de Víctor");
  assert.equal((await ve(U.v2.token, "validacion.liberar", { id: U.valJefe.id })).status, 200);
  assert.equal(filaVal(U.valJefe.id).estado, "pendiente");
  assert.equal((await ve(U.v2.token, "validacion.tomar", { id: U.valJefe.id })).status, 200);
});

test("Revisar un documento: aprobar exige archivo; observar y rechazar exigen un motivo", async () => {
  const docs = docsFila(U.valFin.id);
  const padron = docs.find((d) => d.clave === "padron");
  assert.equal((await ve(U.v1.token, "validacion.revisar", { id: U.valFin.id, docId: padron.id, estado: "aprobado" })).error, "doc_sin_archivo");
  assert.equal((await ve(U.v1.token, "validacion.revisar", { id: U.valFin.id, docId: padron.id, estado: "observado" })).error, "comentario_requerido");
  assert.equal((await ve(U.v1.token, "validacion.revisar", { id: U.valFin.id, docId: padron.id, estado: "magia", comentario: "x" })).error, "estado_doc_invalido");
  assert.equal((await ve(U.v2.token, "validacion.revisar", { id: U.valFin.id, docId: padron.id, estado: "observado", comentario: "No es mía" })).status, 403, "solo quien la tomó");
  assert.equal((await ve(U.e1.token, "validacion.revisar", { id: U.valFin.id, docId: padron.id, estado: "aprobado" })).status, 403);

  // Archivos: tipo y tamaño.
  assert.equal((await ve(U.v1.token, "validacion.adjuntar", { id: U.valFin.id, docId: padron.id, archivo: archivo({ tipo: "text/html" }) })).error, "archivo_tipo_invalido");
  assert.equal((await ve(U.v1.token, "validacion.adjuntar", { id: U.valFin.id, docId: padron.id, archivo: archivo({ tam: 9 * 1024 * 1024 }) })).error, "archivo_muy_grande");
  const ar = archivo({ tipo: "application/pdf", nombre: "padron.pdf" });
  const sub = await ve(U.v1.token, "validacion.adjuntar", { id: U.valFin.id, docId: padron.id, archivo: ar });
  assert.equal(sub.status, 200, JSON.stringify(sub));
  assert.equal(sub.docs.find((d) => d.id === padron.id).archivos.length, 1);
  assert.equal((await ve(U.v1.token, "validacion.revisar", { id: U.valFin.id, docId: padron.id, estado: "aprobado" })).status, 200);
  assert.equal((await ve(U.v1.token, "validacion.adjuntar", { id: U.valFin.id, docId: padron.id, archivo: archivo() })).error, "doc_cerrado", "un documento aprobado ya no se toca");
});

test("Observado: quien trabaja la venta corrige el documento y vuelve a revisión", async () => {
  const doc = docsFila(U.valFin.id).find((d) => d.clave === "cedula_cliente");
  assert.equal((await ve(U.v1.token, "validacion.adjuntar", { id: U.valFin.id, docId: doc.id, archivo: archivo() })).status, 200);
  const o = await ve(U.v1.token, "validacion.revisar", { id: U.valFin.id, docId: doc.id, estado: "observado", comentario: "Falta el reverso de la cédula" });
  assert.equal(o.status, 200, JSON.stringify(o));
  assert.equal(o.validacion.estado, "observada");
  assert.ok(db.tablas.lead_eventos.some((e) => /observó «Cédula de identidad del cliente/.test(e.detalle) && /Falta el reverso/.test(e.detalle)));

  assert.equal((await ve(U.e2.token, "validacion.adjuntar", { id: U.valFin.id, docId: doc.id, archivo: archivo() })).status, 404, "Ema no ve ese lead");
  assert.equal((await ve(U.mkt.token, "validacion.adjuntar", { id: U.valFin.id, docId: doc.id, archivo: archivo() })).status, 403);
  const fix = await ve(U.e1.token, "validacion.adjuntar", { id: U.valFin.id, docId: doc.id, archivo: archivo() });
  assert.equal(fix.status, 200, JSON.stringify(fix));
  const d2 = fix.docs.find((d) => d.id === doc.id);
  assert.equal(d2.estado, "pendiente", "vuelve a revisión");
  assert.equal(d2.archivos.length, 2);
  assert.equal(fix.validacion.estado, "en_revision");
  assert.equal((await ve(U.e1.token, "validacion.adjuntar", { id: U.valFin.id, docId: doc.id, archivo: archivo() })).status, 200);
  assert.equal((await ve(U.e1.token, "validacion.adjuntar", { id: U.valFin.id, docId: doc.id, archivo: archivo() })).error, "demasiados_archivos");
  const quitar = await ve(U.e1.token, "validacion.quitar", { id: U.valFin.id, docId: doc.id, archivoId: d2.archivos[0].id });
  assert.equal(quitar.docs.find((d) => d.id === doc.id).archivos.length, 2);
  assert.equal((await ve(U.v1.token, "validacion.revisar", { id: U.valFin.id, docId: doc.id, estado: "rechazado", comentario: "Ilegible" })).validacion.estado, "rechazada");
});

test("Rechazado y 'no aplica': se corrige, y lo que no corresponde se declara", async () => {
  const sap = docsFila(U.valFin.id).find((d) => d.clave === "soap");
  assert.equal((await ve(U.v1.token, "validacion.revisar", { id: U.valFin.id, docId: sap.id, estado: "no_aplica" })).error, "comentario_requerido");
  const r = await ve(U.v1.token, "validacion.revisar", { id: U.valFin.id, docId: sap.id, estado: "no_aplica", comentario: "Vehículo nuevo, exento" });
  assert.equal(r.status, 200);
  assert.equal(r.docs.find((d) => d.id === sap.id).estado, "no_aplica");
});

test("Todo aprobado: la validación queda aprobada y recién entonces se aprueba la venta", async () => {
  const doc = docsFila(U.valFin.id).find((d) => d.clave === "cedula_cliente");
  await ve(U.e1.token, "validacion.quitar", { id: U.valFin.id, docId: doc.id, archivoId: doc.archivos[0].id }).catch(() => {});
  await aprobarTodo(U.v1, U.valFin.id);
  const v = filaVal(U.valFin.id);
  assert.equal(v.estado, "aprobada");
  assert.ok(v.resuelta_en);
  assert.ok(db.tablas.lead_eventos.some((e) => /Validación VAL-\d+ aprobada por Vera Validadora/.test(e.detalle)));
  assert.equal((await ve(U.v1.token, "validacion.adjuntar", { id: U.valFin.id, docId: doc.id, archivo: archivo() })).error, "validacion_estado_invalido");

  const a = await ve(U.jefe.token, "cierres.aprobar", { id: U.cierreFin.id });
  assert.equal(a.status, 200, JSON.stringify(a));
  assert.equal(a.cierre.estado, "aprobada");
});

test("Documentos del vehículo ya aprobados se reutilizan en la validación de la venta", async () => {
  const veh = await vehiculo();
  const vVeh = db.tablas.validaciones.find((x) => x.vehiculo_id === veh.id && x.tipo === "vehiculo");
  assert.equal((await ve(U.v1.token, "validacion.tomar", { id: vVeh.id })).status, 200);
  await aprobarTodo(U.v1, vVeh.id);
  assert.equal(filaVal(vVeh.id).estado, "aprobada");

  const x = await leadReservado(U.e1.token, veh);
  const c = await cerrar(U.e1.token, x.lead.id, DATOS());
  const docs = docsFila(c.validacion.id);
  for (const k of ["padron", "permiso_circulacion", "revision_tecnica", "soap", "multas_prendas"]) {
    const d = docs.find((y) => y.clave === k);
    assert.equal(d.estado, "aprobado", `${k} ya estaba aprobado`);
    assert.equal(d.archivos[0].v, vVeh.id, "el archivo sigue guardado en la validación original");
  }
  assert.equal(docs.find((d) => d.clave === "cedula_cliente").estado, "pendiente");
  assert.equal(c.validacion.estado, "pendiente", "faltan los del cliente");
  // Un archivo reutilizado no se puede quitar desde la nueva validación.
  U.cierreReut = c.cierre; U.valReut = c.validacion;
  await ve(U.v2.token, "validacion.tomar", { id: c.validacion.id });
  const pad = docs.find((d) => d.clave === "padron");
  assert.equal((await ve(U.jefe.token, "validacion.quitar", { id: c.validacion.id, docId: pad.id, archivoId: pad.archivos[0].id })).error, "doc_cerrado");
});

test("Cierres retirados dejan de pedir validación; la anulación no la reabre", async () => {
  const ret = await ve(U.e1.token, "cierres.retirar", { id: U.cierreReut.id });
  assert.equal(ret.status, 200);
  const cola = await ve(U.v2.token, "validacion.list", { vista: "mias" });
  assert.ok(!cola.validaciones.some((v) => v.id === U.valReut.id), "ya no aparece");
  assert.equal((await ve(U.e1.token, "validacion.list", { vista: "origen", cierreId: U.cierreReut.id })).validaciones.length, 0);
});

test("Cierre antiguo sin validación: al aprobar se crea y bloquea", async () => {
  const x = await leadReservado(U.e1.token);
  const c = await cerrar(U.e1.token, x.lead.id, DATOS());
  db.tablas.validaciones = db.tablas.validaciones.filter((v) => v.cierre_id !== c.cierre.id);
  const a = await ve(U.jefe.token, "cierres.aprobar", { id: c.cierre.id });
  assert.equal(a.error, "validacion_pendiente");
  assert.equal(db.tablas.validaciones.filter((v) => v.cierre_id === c.cierre.id).length, 1, "se creó al intentar aprobar");
});

test("Tasación directa completada: pide la validación de la compra", async () => {
  const t = (await ve(U.t1.token, "tasaciones.directa", { datos: { vehiculo: { patente: "CCCC33", marca: "Mazda", modelo: "3", anio: 2018, km: 60000 }, contacto: { nombre: "Don Pedro", telefono: "912345678" } } })).tasacion;
  assert.equal(db.tablas.validaciones.filter((v) => v.tasacion_id === t.id).length, 0);
  const done = await ve(U.t1.token, "tasaciones.completar", { id: t.id, borrador: { valorCompra: 5000000, valorVenta: 6500000 } });
  assert.equal(done.status, 200, JSON.stringify(done));
  const v = db.tablas.validaciones.find((x) => x.tasacion_id === t.id);
  assert.ok(v);
  assert.equal(v.tipo, "compra");
  assert.equal(v.sujeto.vendedor, "Don Pedro");
  assert.ok(docsFila(v.id).some((d) => d.clave === "cedula_vendedor"));
  assert.equal(docsFila(v.id).find((d) => d.clave === "comprobante_pago").requerido, false);
  assert.equal((await ve(U.t1.token, "validacion.get", { id: v.id })).puedeAdjuntar, true, "el Tasador puede subir los documentos");
  assert.equal((await ve(U.mkt.token, "validacion.get", { id: v.id })).status, 403);
});

test("Archivos: los sube y ve quien corresponde", async () => {
  const key = `dval::${U.valFin.id}::arch100001`;
  assert.equal((await kv(U.v1.token, "set", key, { value: "data:application/pdf;base64,AAA" })).status, 200);
  assert.equal((await kv(U.e1.token, "set", key, { value: "data:image/jpeg;base64,BBB" })).status, 200, "quien trabaja la venta sube correcciones");
  assert.equal((await kv(U.e1.token, "get", key)).status, 200);
  assert.equal((await kv(U.jefe.token, "get", key)).status, 200);
  assert.equal((await kv(U.mkt.token, "get", key)).status, 200, "Marketing ve los leads");
  assert.equal((await kv(U.mkt.token, "set", key, { value: "x" })).status, 403);
  assert.equal((await kv(U.v1.token, "delete", key)).status, 200);
});

test("Resumen y alerta: cola, tiempos y validaciones sin tomar", async () => {
  const mio = await ve(U.v1.token, "validacion.resumen");
  assert.equal(mio.status, 200);
  assert.equal(mio.validadores.length, 1);
  assert.ok(mio.validadores[0].aprobadas >= 2);
  const todos = await ve(U.jefe.token, "validacion.resumen");
  assert.deepEqual(todos.validadores.map((x) => x.nombre).sort(), ["Vera Validadora", "Víctor Validador"]);
  assert.equal((await ve(U.v1.token, "validacion.resumen", { mes: "2026-13" })).error, "mes_invalido");

  const antes = (await ve(U.jefe.token, "gestion.resumen")).conteos.validacionesSinTomar;
  const x = await leadReservado(U.e1.token);
  const c = await cerrar(U.e1.token, x.lead.id, DATOS());
  assert.equal((await ve(U.jefe.token, "gestion.resumen")).conteos.validacionesSinTomar, antes, "recién creada: aún no molesta");
  filaVal(c.validacion.id).solicitada_en = new Date(Date.now() - 9 * 3_600_000).toISOString();
  const g = await ve(U.jefe.token, "gestion.resumen");
  assert.equal(g.conteos.validacionesSinTomar, antes + 1);
  assert.equal(g.config.horas_validacion, 8);
  assert.equal((await crm(admin, "config.set", { clave: "horas_validacion", valor: 0 })).status, 400);
  assert.equal((await ve(U.v1.token, "validacion.equipo")).status, 403);
  assert.equal((await ve(U.jefe.token, "validacion.equipo")).validadores.length, 2);
});

test("La cuenta maestra ve todo pero no revisa", async () => {
  const r = await ve(admin, "validacion.list", { vista: "local", localId: L1 });
  assert.equal(r.status, 200);
  assert.ok(r.validaciones.length >= 3);
  assert.equal((await ve(admin, "validacion.tomar", { id: U.valJefe.id })).status, 403);
  assert.equal((await ve(admin, "validacion.revisar", { id: U.valJefe.id, docId: randomUUID(), estado: "aprobado" })).status, 403);
  assert.equal((await ve(admin, "validacion.resumen", { localId: L1 })).status, 200);
});
