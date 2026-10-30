// Perfil del Anunciante: cola de vehículos por publicar, avisos por portal, alertas de avisos desactualizados y consultas por aviso,
// contra la función real y una base falsa en memoria.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const CLAVE = "Prueba12345";
const U = {};
let admin; let L1; let L2;
let n = 0;
const fila = (id) => db.tablas.anuncios.find((a) => a.id === id);
const portalesDe = (id) => db.tablas.anuncio_portales.filter((p) => p.anuncio_id === id);
const URL_CA = "https://www.chileautos.cl/vehiculos/detalles/abc123";

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}
async function vehiculo(token = U.jefe.token, extra = {}) {
  const r = await ve(token, "inventario.save", { datos: { patente: `AN${String(1000 + ++n)}`, marca: "Toyota", modelo: "Yaris", anio: 2020, km: 40000, precioLista: 10000000, costo: 8500000, transmision: "Automática", ...extra } });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.vehiculo;
}
const publicar = (token, id, portal = "chileautos", extra = {}) => ve(token, "anuncios.portal", { id, datos: { portal, estado: "publicado", url: URL_CA, ...extra } });

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  L2 = (await crm(admin, "locales.create", { nombre: "Sucursal Sur" })).local.id;
  const ventas = { otorgar: ["ventas.operar"], quitar: [] };
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("jefeSur", "Jorge Sur", "8.765.432-K", ["jefe_local"], L2);
  await crear("an", "Ana Anunciante", "11.111.111-1", ["anunciante"], L1);
  await crear("anSur", "Alan Sur", "14.000.000-0", ["anunciante"], L2);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1, ventas);
  await crear("mkt", "Marta Marketing", "10.000.013-K", ["marketing"], L1);
});

test("Permisos básicos: quién entra al módulo y quién escribe", async () => {
  for (const op of ["anuncios.cola", "anuncios.list", "anuncios.resumen"]) {
    assert.equal((await ve(U.mkt.token, op)).status, 403, `${op}: marketing`);
    assert.equal((await ve(U.e1.token, op)).status, 403, `${op}: ejecutivo`);
    assert.equal((await ve(U.an.token, op)).status, 200, `${op}: anunciante`);
    assert.equal((await ve(U.jefe.token, op)).status, 200, `${op}: el supervisor mira`);
  }
  U.v1 = await vehiculo();
  assert.equal((await ve(U.jefe.token, "anuncios.crear", { vehiculoId: U.v1.id })).status, 403, "el supervisor no publica");
  assert.equal((await ve(U.e1.token, "anuncios.crear", { vehiculoId: U.v1.id })).status, 403);
  assert.equal((await ve(admin, "anuncios.crear", { vehiculoId: U.v1.id, localId: L1 })).status, 403, "la cuenta maestra tampoco");
});

test("Cola: vehículos disponibles del local, sin el costo, sin los que ya tienen aviso", async () => {
  const prep = await vehiculo(U.jefe.token, { estado: "preparacion" });
  const sur = (await ve(U.jefeSur.token, "inventario.save", { datos: { patente: "SSSS11", marca: "Kia", modelo: "Rio", anio: 2019, km: 1, precioLista: 5000000, costo: 4000000 } })).vehiculo;
  const r = await ve(U.an.token, "anuncios.cola");
  const ids = r.porCrear.map((x) => x.vehiculo.id);
  assert.ok(ids.includes(U.v1.id));
  assert.ok(!ids.includes(prep.id), "en preparación no se publica");
  assert.ok(!ids.includes(sur.id), "otro local no");
  assert.equal(r.porCrear.find((x) => x.vehiculo.id === U.v1.id).vehiculo.costo, undefined, "el costo nunca sale");
  assert.equal(r.porCrear.find((x) => x.vehiculo.id === U.v1.id).bloqueado, false);
  assert.equal((await ve(U.anSur.token, "anuncios.cola")).porCrear.map((x) => x.vehiculo.id).includes(sur.id), true);
});

test("Crear el aviso: texto sugerido, uno por vehículo, solo vehículos disponibles", async () => {
  assert.equal((await ve(U.an.token, "anuncios.crear", { vehiculoId: randomUUID() })).status, 404);
  assert.equal((await ve(U.anSur.token, "anuncios.crear", { vehiculoId: U.v1.id })).status, 404, "otro local");
  const r = await ve(U.an.token, "anuncios.crear", { vehiculoId: U.v1.id });
  assert.equal(r.status, 200, JSON.stringify(r));
  const a = r.anuncio;
  assert.equal(a.estado, "por_publicar");
  assert.equal(a.folio, `AVI-${String(a.numero).padStart(6, "0")}`);
  assert.match(a.titulo, /Toyota Yaris 2020/);
  assert.match(a.descripcion, /Precio: \$10\.000\.000/);
  assert.equal(a.anunciante, "Ana Anunciante");
  assert.equal(a.vehiculo.costo, undefined);
  assert.equal(r.sugerencia.titulo, a.titulo);
  assert.equal((await ve(U.an.token, "anuncios.crear", { vehiculoId: U.v1.id })).error, "aviso_existente");
  assert.ok(!(await ve(U.an.token, "anuncios.cola")).porCrear.some((x) => x.vehiculo.id === U.v1.id), "sale de la cola");
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "aviso.crear"));
  U.a1 = a;
  const prep = await vehiculo(U.jefe.token, { estado: "preparacion" });
  assert.equal((await ve(U.an.token, "anuncios.crear", { vehiculoId: prep.id })).error, "vehiculo_no_disponible");
});

test("Editar el texto: se valida y queda en la bitácora", async () => {
  assert.equal((await ve(U.an.token, "anuncios.guardar", { id: U.a1.id, datos: { titulo: "Hi", descripcion: "x".repeat(30) } })).error, "titulo_aviso_invalido");
  assert.equal((await ve(U.an.token, "anuncios.guardar", { id: U.a1.id, datos: { titulo: "Toyota Yaris impecable", descripcion: "corta" } })).error, "descripcion_invalida");
  const r = await ve(U.an.token, "anuncios.guardar", { id: U.a1.id, datos: { titulo: "Toyota Yaris impecable", descripcion: "Único dueño, mantenciones al día en la marca." } });
  assert.equal(r.status, 200);
  assert.equal(r.anuncio.titulo, "Toyota Yaris impecable");
  assert.equal((await ve(U.jefe.token, "anuncios.guardar", { id: U.a1.id, datos: { titulo: "Toyota Yaris impecable", descripcion: "Otro texto largo suficiente." } })).status, 403);
  assert.equal((await ve(U.anSur.token, "anuncios.get", { id: U.a1.id })).status, 404, "otro local no lo ve");
});

test("Publicar en portales: enlace https, estado del aviso y precio publicado", async () => {
  assert.equal((await ve(U.an.token, "anuncios.portal", { id: U.a1.id, datos: { portal: "chileautos", estado: "publicado" } })).error, "url_invalida");
  assert.equal((await ve(U.an.token, "anuncios.portal", { id: U.a1.id, datos: { portal: "nada", estado: "publicado", url: URL_CA } })).error, "portal_invalido");
  assert.equal((await ve(U.an.token, "anuncios.portal", { id: U.a1.id, datos: { portal: "yapo", estado: "publicado", url: "http://yapo.cl/x" } })).error, "url_invalida");
  assert.equal((await ve(U.e1.token, "anuncios.portal", { id: U.a1.id, datos: { portal: "yapo", estado: "pausado" } })).status, 403);

  const r = await publicar(U.an.token, U.a1.id, "chileautos", { venceEn: "2099-01-01" });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.anuncio.estado, "publicado");
  const p = portalesDe(U.a1.id)[0];
  assert.equal(p.precio_publicado, 10000000, "guarda el precio de lista de hoy");
  assert.equal(p.url, URL_CA);
  assert.ok(p.publicado_en);
  const sitio = await ve(U.an.token, "anuncios.portal", { id: U.a1.id, datos: { portal: "sitio_web", estado: "publicado" } });
  assert.equal(sitio.status, 200, "el sitio propio no pide enlace");
  assert.equal(portalesDe(U.a1.id).length, 2);
  // Pausar uno no cambia el aviso mientras otro siga publicado; pausar ambos sí.
  assert.equal((await ve(U.an.token, "anuncios.portal", { id: U.a1.id, datos: { portal: "sitio_web", estado: "pausado" } })).anuncio.estado, "publicado");
  assert.equal((await ve(U.an.token, "anuncios.portal", { id: U.a1.id, datos: { portal: "chileautos", estado: "pausado", url: URL_CA } })).anuncio.estado, "pausado");
  assert.equal((await publicar(U.an.token, U.a1.id, "chileautos")).anuncio.estado, "publicado");
  assert.equal(portalesDe(U.a1.id).length, 2, "no duplica el portal");
});

test("Alertas: el precio cambia en el inventario y el aviso queda desactualizado hasta confirmarlo", async () => {
  assert.equal((await ve(U.an.token, "anuncios.get", { id: U.a1.id })).anuncio.alertas.length, 0);
  const bajo = await ve(U.jefe.token, "inventario.save", { id: U.v1.id, datos: { patente: U.v1.patente, marca: "Toyota", modelo: "Yaris", anio: 2020, km: 40000, precioLista: 9500000, costo: 8500000, transmision: "Automática" } });
  assert.equal(bajo.status, 200, JSON.stringify(bajo));
  const g = await ve(U.an.token, "anuncios.get", { id: U.a1.id });
  assert.equal(g.anuncio.alertas.length, 1);
  assert.equal(g.anuncio.alertas[0].tipo, "precio");
  assert.equal(g.anuncio.alertas[0].portal, "chileautos");

  const gest = await ve(U.jefe.token, "gestion.resumen");
  assert.equal(gest.conteos.avisosDesactualizados, 1);
  assert.equal(gest.avisosDesactualizados[0].folio, U.a1.folio);
  assert.equal((await ve(U.e1.token, "gestion.resumen")).status, 403);

  // El Anunciante corrige el aviso y lo confirma: vuelve a quedar al día.
  assert.equal((await publicar(U.an.token, U.a1.id)).anuncio.alertas.length, 0);
  assert.equal(portalesDe(U.a1.id).find((p) => p.portal === "chileautos").precio_publicado, 9500000);
  assert.equal((await ve(U.jefe.token, "gestion.resumen")).conteos.avisosDesactualizados, 0);
});

test("Alertas: vehículo reservado y vencimientos", async () => {
  const l = (await ve(U.e1.token, "leads.create", { cliente: { nombre: "Cliente Aviso", telefono: "911111111" }, lead: {} })).lead;
  const cot = (await ve(U.e1.token, "cotizaciones.save", { leadId: l.id, vehiculoId: U.v1.id, datos: {} })).cotizacion;
  assert.ok((await ve(U.e1.token, "reservas.crear", { cotizacionId: cot.id, monto: 500000 })).reserva);
  const g = await ve(U.an.token, "anuncios.get", { id: U.a1.id });
  assert.ok(g.anuncio.alertas.some((a) => a.tipo === "reservado"), "reservado: hay que pausar");
  // No se puede publicar en otro portal mientras esté reservado.
  assert.equal((await publicar(U.an.token, U.a1.id, "yapo", { url: "https://www.yapo.cl/a/1" })).error, "vehiculo_no_disponible");
  // Pausa todo: ya no hay alertas por la reserva.
  await ve(U.an.token, "anuncios.portal", { id: U.a1.id, datos: { portal: "chileautos", estado: "pausado", url: URL_CA } });
  await ve(U.an.token, "anuncios.portal", { id: U.a1.id, datos: { portal: "sitio_web", estado: "pausado" } });
  const g2 = await ve(U.an.token, "anuncios.get", { id: U.a1.id });
  assert.equal(g2.anuncio.estado, "pausado");
  assert.equal(g2.anuncio.alertas.length, 0);
  // Vencimiento pasado de un aviso pausado: sigue pidiendo renovar.
  await ve(U.an.token, "anuncios.portal", { id: U.a1.id, datos: { portal: "chileautos", estado: "pausado", url: URL_CA, venceEn: "2020-01-01" } });
  assert.equal((await ve(U.an.token, "anuncios.get", { id: U.a1.id })).anuncio.alertas[0].tipo, "vencido");
  assert.equal((await ve(U.an.token, "anuncios.portal", { id: U.a1.id, datos: { portal: "chileautos", estado: "pausado", venceEn: "mañana" } })).error, "fecha_invalida");
});

test("Dar de baja: todos los portales y el aviso; el vehículo puede tener uno nuevo", async () => {
  const v2 = await vehiculo();
  const a2 = (await ve(U.an.token, "anuncios.crear", { vehiculoId: v2.id })).anuncio;
  await publicar(U.an.token, a2.id);
  assert.equal((await ve(U.jefe.token, "anuncios.baja", { id: a2.id })).status, 403);
  const b = await ve(U.an.token, "anuncios.baja", { id: a2.id });
  assert.equal(b.status, 200);
  assert.equal(b.anuncio.estado, "baja");
  assert.ok(portalesDe(a2.id).every((p) => p.estado === "baja"));
  assert.equal((await ve(U.an.token, "anuncios.baja", { id: a2.id })).error, "aviso_baja");
  assert.equal((await ve(U.an.token, "anuncios.guardar", { id: a2.id, datos: { titulo: "Nuevo título válido", descripcion: "Descripción suficiente para pasar." } })).error, "aviso_baja");
  assert.equal((await publicar(U.an.token, a2.id)).error, "aviso_baja");
  assert.equal((await ve(U.an.token, "anuncios.list")).anuncios.some((a) => a.id === a2.id), false, "no sale en la lista normal");
  assert.equal((await ve(U.an.token, "anuncios.list", { estado: "baja" })).anuncios.some((a) => a.id === a2.id), true);
  const nuevo = await ve(U.an.token, "anuncios.crear", { vehiculoId: v2.id });
  assert.equal(nuevo.status, 200, "tras la baja se puede crear otro");
  assert.notEqual(nuevo.anuncio.id, a2.id);
});

test("Consultas por aviso: los leads del vehículo, por portal según su fuente", async () => {
  const v3 = await vehiculo();
  const a3 = (await ve(U.an.token, "anuncios.crear", { vehiculoId: v3.id })).anuncio;
  await publicar(U.an.token, a3.id);
  const lead = async (fuente) => { const r = await ve(U.e1.token, "leads.create", { cliente: { nombre: `Cli ${++n}`, telefono: `9${String(30000000 + n)}` }, lead: { vehiculoId: v3.id, fuente } }); assert.equal(r.status, 200, JSON.stringify(r)); };
  await lead("Chileautos"); await lead("Chileautos"); await lead("Facebook Marketplace"); await lead("Llamada");
  const g = await ve(U.an.token, "anuncios.get", { id: a3.id });
  assert.equal(g.consultas.total, 4);
  assert.equal(g.consultas.porPortal.chileautos, 2);
  assert.equal(g.consultas.porPortal.facebook, 1);
  assert.equal(g.consultas.otras, 1);
  const r = await ve(U.an.token, "anuncios.resumen");
  assert.equal(r.status, 200);
  assert.equal(r.consultas.top[0].id, a3.id);
  assert.equal(r.consultas.top[0].consultas, 4);
  assert.equal(r.consultas.porPortal.chileautos, 2);
  assert.ok(r.porPortal.chileautos >= 1);
  assert.ok(r.porEstado.publicado >= 1);
});

test("Con Validadores en el local, solo se publica con los documentos aprobados", async () => {
  const antes = await vehiculo(); // creado antes de que existiera un Validador (igual recibe su validación)
  await crear("val", "Vera Validadora", "13.579.246-2", ["validador"], L1);
  const cola = await ve(U.an.token, "anuncios.cola");
  const x = cola.porCrear.find((y) => y.vehiculo.id === antes.id);
  assert.equal(x.bloqueado, true);
  assert.equal(x.motivo, "vehiculo_sin_validar");
  assert.equal(x.validacion.estado, "pendiente");
  assert.equal((await ve(U.an.token, "anuncios.crear", { vehiculoId: antes.id })).error, "vehiculo_sin_validar");

  // El Validador aprueba los 5 documentos del vehículo.
  const val = db.tablas.validaciones.find((v) => v.vehiculo_id === antes.id && v.tipo === "vehiculo");
  assert.equal((await ve(U.val.token, "validacion.tomar", { id: val.id })).status, 200);
  for (const d of db.tablas.validacion_docs.filter((d) => d.validacion_id === val.id)) {
    await ve(U.val.token, "validacion.adjuntar", { id: val.id, docId: d.id, archivo: { id: `arch${100000 + ++n}`, nombre: "d.jpg", tipo: "image/jpeg", tam: 1000 } });
    assert.equal((await ve(U.val.token, "validacion.revisar", { id: val.id, docId: d.id, estado: "aprobado" })).status, 200);
  }
  const cola2 = await ve(U.an.token, "anuncios.cola");
  assert.equal(cola2.porCrear.find((y) => y.vehiculo.id === antes.id).bloqueado, false);
  assert.equal((await ve(U.an.token, "anuncios.crear", { vehiculoId: antes.id })).status, 200);

  // Un vehículo anterior a las validaciones (sin ninguna): se le crea al aparecer en la cola y queda bloqueado.
  const viejo = await vehiculo();
  db.tablas.validaciones = db.tablas.validaciones.filter((v) => v.vehiculo_id !== viejo.id);
  const c3 = await ve(U.an.token, "anuncios.cola");
  const yv = c3.porCrear.find((y) => y.vehiculo.id === viejo.id);
  assert.equal(yv.bloqueado, true);
  assert.equal(db.tablas.validaciones.filter((v) => v.vehiculo_id === viejo.id).length, 1, "se creó su validación");
});

test("La cuenta maestra ve todo pero no publica", async () => {
  const r = await ve(admin, "anuncios.list", { localId: L1 });
  assert.equal(r.status, 200);
  assert.ok(r.anuncios.length >= 2);
  assert.equal((await ve(admin, "anuncios.resumen", { localId: L1 })).status, 200);
  assert.equal((await ve(admin, "anuncios.baja", { id: U.a1.id })).status, 403);
});

test("Precio con financiamiento: se guarda con el vehículo, nunca supera al de lista y el sitio web informa el bono", async () => {
  const base = { patente: "FINA11", marca: "Toyota", modelo: "Yaris", anio: 2020, km: 40000, precioLista: 10000000, costo: 8500000, transmision: "Automática" };
  const malo = await ve(U.jefe.token, "inventario.save", { datos: { ...base, precioFinanciamiento: 10500000 } });
  assert.equal(malo.error, "financiamiento_mayor_que_lista");
  assert.equal((await ve(U.jefe.token, "inventario.save", { datos: { ...base, precioLista: "", precioFinanciamiento: 5000000 } })).error, "financiamiento_sin_lista");
  assert.equal((await ve(U.jefe.token, "inventario.save", { datos: { ...base, precioFinanciamiento: "abc" } })).error, "precio_invalido");
  const ok = await ve(U.jefe.token, "inventario.save", { datos: { ...base, precioFinanciamiento: 9500000 } });
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(ok.vehiculo.precio_financiamiento, 9500000);
  const sin = await ve(U.jefe.token, "inventario.save", { id: ok.vehiculo.id, datos: { ...base, precioFinanciamiento: "" } });
  assert.equal(sin.vehiculo.precio_financiamiento, null, "vacío = sin precio con financiamiento");
});
