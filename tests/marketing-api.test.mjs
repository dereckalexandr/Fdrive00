// Perfil de Marketing y RRSS: campañas con aprobación, calendario de contenido, material por vehículo, leads por campaña y resultados,
// contra la función real y una base falsa en memoria.
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
const CAMP = { nombre: "Ofertas de octubre", canal: "instagram", objetivo: "Más consultas SUV", desde: "2026-10-01", hasta: "2026-10-31", presupuesto: 300000 };
const manana = () => new Date(Date.now() + 86_400_000).toISOString();
const fila = (t, id) => db.tablas[t].find((x) => x.id === id);

async function crear(clave, nombre, rut, roles, localId, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId, extra }, clave: CLAVE });
  assert.equal(r.status, 200, `${nombre}: ${JSON.stringify(r)}`);
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}
async function vehiculo(token = U.jefe.token) {
  const r = await ve(token, "inventario.save", { datos: { patente: `MK${String(1000 + ++n)}`, marca: "Hyundai", modelo: "Venue", anio: 2023, km: 56000, precioLista: 12480000, costo: 10000000 } });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.vehiculo;
}
const campania = (token, extra = {}, id) => ve(token, "marketing.campanias.save", { id, datos: { ...CAMP, ...extra } });
/** Campaña aprobada lista para usar. */
async function aprobada(extra = {}) {
  const c = (await campania(U.mkt.token, extra)).campania;
  assert.equal((await ve(U.mkt.token, "marketing.campanias.enviar", { id: c.id })).status, 200);
  if (Number(extra.presupuesto ?? CAMP.presupuesto) > 0) assert.equal((await ve(U.jefe.token, "marketing.campanias.aprobar", { id: c.id })).status, 200);
  return c;
}

before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  L2 = (await crm(admin, "locales.create", { nombre: "Sucursal Sur" })).local.id;
  const ventas = { otorgar: ["ventas.operar"], quitar: [] };
  await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"], L1);
  await crear("jefeSur", "Jorge Sur", "8.765.432-K", ["jefe_local"], L2);
  await crear("mkt", "Marta Marketing", "10.000.013-K", ["marketing"], L1);
  await crear("mktSur", "Mario Sur", "14.000.000-0", ["marketing"], L2);
  await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], L1, ventas);
  await crear("an", "Ana Anunciante", "11.111.111-1", ["anunciante"], L1);
});

test("Permisos básicos: quién entra y quién escribe", async () => {
  for (const op of ["marketing.campanias.list", "marketing.publicaciones.list", "marketing.material.list", "marketing.resultados"]) {
    assert.equal((await ve(U.e1.token, op)).status, 403, `${op}: ejecutivo`);
    assert.equal((await ve(U.an.token, op)).status, 403, `${op}: anunciante`);
    assert.equal((await ve(U.mkt.token, op)).status, 200, `${op}: marketing`);
    assert.equal((await ve(U.jefe.token, op)).status, 200, `${op}: el supervisor mira`);
  }
  assert.equal((await campania(U.jefe.token)).status, 403, "el supervisor no crea campañas");
  assert.equal((await campania(U.e1.token)).status, 403);
  assert.equal((await ve(admin, "marketing.campanias.save", { localId: L1, datos: CAMP })).status, 403, "la cuenta maestra tampoco");
});

test("Crear y editar una campaña: valida los datos y queda en borrador", async () => {
  assert.equal((await campania(U.mkt.token, { nombre: "x" })).error, "nombre_campania_invalido");
  assert.equal((await campania(U.mkt.token, { canal: "radio" })).error, "canal_invalido");
  assert.equal((await campania(U.mkt.token, { hasta: "2026-09-01" })).error, "fechas_invertidas");
  assert.equal((await campania(U.mkt.token, { presupuesto: -1 })).error, "presupuesto_invalido");
  const r = await campania(U.mkt.token);
  assert.equal(r.status, 200, JSON.stringify(r));
  const c = r.campania;
  assert.equal(c.estado, "borrador");
  assert.equal(c.folio, `CAM-${String(c.numero).padStart(4, "0")}`);
  assert.equal(c.presupuesto, 300000);
  assert.equal(c.metricas.leads, 0);
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "campania.crear"));
  const e = await campania(U.mkt.token, { nombre: "Ofertas de octubre v2", presupuesto: 350000 }, c.id);
  assert.equal(e.campania.nombre, "Ofertas de octubre v2");
  assert.equal((await ve(U.mktSur.token, "marketing.campanias.get", { id: c.id })).status, 404, "otro local no la ve");
  U.c1 = c;
});

test("Aprobación: con presupuesto la aprueba el Jefe Local; sin presupuesto sale sola", async () => {
  assert.equal((await ve(U.jefe.token, "marketing.campanias.aprobar", { id: U.c1.id })).error, "campania_estado_invalido", "aún no se envía");
  const env = await ve(U.mkt.token, "marketing.campanias.enviar", { id: U.c1.id });
  assert.equal(env.campania.estado, "pendiente");
  assert.equal((await ve(U.mkt.token, "marketing.campanias.aprobar", { id: U.c1.id })).status, 403, "Marketing no se aprueba solo");
  assert.equal((await ve(U.jefeSur.token, "marketing.campanias.aprobar", { id: U.c1.id })).status, 404, "otro local");
  assert.equal((await ve(U.jefe.token, "marketing.campanias.rechazar", { id: U.c1.id, motivo: "" })).error, "motivo_requerido");
  const rech = await ve(U.jefe.token, "marketing.campanias.rechazar", { id: U.c1.id, motivo: "Presupuesto muy alto" });
  assert.equal(rech.campania.estado, "rechazada");
  assert.equal(rech.campania.motivo_rechazo, "Presupuesto muy alto");
  // Al editarla vuelve a borrador y se puede reenviar.
  const ed = await campania(U.mkt.token, { presupuesto: 200000 }, U.c1.id);
  assert.equal(ed.campania.estado, "borrador");
  await ve(U.mkt.token, "marketing.campanias.enviar", { id: U.c1.id });
  const ok = await ve(U.jefe.token, "marketing.campanias.aprobar", { id: U.c1.id });
  assert.equal(ok.campania.estado, "aprobada");
  assert.equal(ok.campania.presupuesto_aprobado, 200000);
  assert.equal(ok.campania.aprobado_por, "Julia Jefa");
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "campania.aprobar" && b.detalle.presupuesto === 200000));

  const libre = (await campania(U.mkt.token, { nombre: "Orgánica de verano", presupuesto: 0 })).campania;
  const l2 = await ve(U.mkt.token, "marketing.campanias.enviar", { id: libre.id });
  assert.equal(l2.campania.estado, "aprobada", "sin costo no necesita aprobación");
  assert.equal(l2.campania.presupuesto_aprobado, 0);
  U.libre = l2.campania;
});

test("Alerta al supervisor: campañas esperando aprobación", async () => {
  const antes = (await ve(U.jefe.token, "gestion.resumen")).conteos.campaniasPorAprobar;
  const c = (await campania(U.mkt.token, { nombre: "Campaña TikTok", canal: "tiktok" })).campania;
  await ve(U.mkt.token, "marketing.campanias.enviar", { id: c.id });
  const g = await ve(U.jefe.token, "gestion.resumen");
  assert.equal(g.conteos.campaniasPorAprobar, antes + 1);
  assert.equal(g.campaniasPorAprobar[0].nombre, "Campaña TikTok");
  await ve(U.jefe.token, "marketing.campanias.aprobar", { id: c.id });
  assert.equal((await ve(U.jefe.token, "gestion.resumen")).conteos.campaniasPorAprobar, antes);
  assert.equal((await ve(U.mkt.token, "gestion.resumen")).status, 403);
});

test("Resultados anotados a mano: el gasto no pasa de lo aprobado; subir el presupuesto pide aprobar de nuevo", async () => {
  assert.equal((await ve(U.mkt.token, "marketing.campanias.resultados", { id: U.c1.id, datos: { gasto: 250000 } })).error, "gasto_excede_presupuesto");
  assert.equal((await ve(U.mkt.token, "marketing.campanias.resultados", { id: U.libre.id, datos: { gasto: 1000 } })).error, "gasto_excede_presupuesto");
  assert.equal((await ve(U.jefe.token, "marketing.campanias.resultados", { id: U.c1.id, datos: { gasto: 1000 } })).status, 403, "los anota Marketing");
  const r = await ve(U.mkt.token, "marketing.campanias.resultados", { id: U.c1.id, datos: { gasto: 150000, alcance: 20000, impresiones: 45000, clics: 900 } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.campania.gasto, 150000);
  assert.equal(r.campania.metricas.consumo, 75);
  assert.equal((await campania(U.mkt.token, { presupuesto: 100000 }, U.c1.id)).error, "presupuesto_menor_que_gasto");
  const sube = await campania(U.mkt.token, { presupuesto: 400000 }, U.c1.id);
  assert.equal(sube.campania.estado, "pendiente", "más presupuesto = nueva aprobación");
  assert.equal(sube.campania.presupuesto_aprobado, 200000, "lo aprobado no cambia hasta que apruebe");
  assert.equal((await ve(U.mkt.token, "marketing.campanias.resultados", { id: U.c1.id, datos: { gasto: 160000 } })).error, "campania_estado_invalido", "mientras espera aprobación no se anotan resultados");
  assert.equal((await ve(U.jefe.token, "marketing.campanias.aprobar", { id: U.c1.id })).campania.presupuesto_aprobado, 400000);
});

test("Leads por campaña: solo campañas aprobadas del local; el lead muestra su campaña", async () => {
  const pendiente = (await campania(U.mkt.token, { nombre: "Sin aprobar" })).campania;
  await ve(U.mkt.token, "marketing.campanias.enviar", { id: pendiente.id });
  const ajena = (await campania(U.mktSur.token, { nombre: "Campaña del sur" })).campania;
  await ve(U.mktSur.token, "marketing.campanias.enviar", { id: ajena.id });
  await ve(U.jefeSur.token, "marketing.campanias.aprobar", { id: ajena.id });

  const lead = (campaniaId) => ve(U.e1.token, "leads.create", { cliente: { nombre: `Cliente ${++n}`, telefono: `9${String(50000000 + n)}` }, lead: { fuente: "Instagram", campaniaId } });
  assert.equal((await lead(pendiente.id)).error, "campania_invalida", "aún sin aprobar");
  assert.equal((await lead(ajena.id)).error, "campania_invalida", "de otro local");
  assert.equal((await lead(randomUUID())).error, "campania_invalida");
  const cat = await ve(U.e1.token, "catalogos");
  assert.ok(cat.campanias.some((c) => c.id === U.c1.id));
  assert.ok(!cat.campanias.some((c) => c.id === pendiente.id || c.id === ajena.id), "el formulario solo ofrece las aprobadas del local");

  U.leadsC1 = [];
  for (let i = 0; i < 4; i++) { const r = await lead(U.c1.id); assert.equal(r.status, 200, JSON.stringify(r)); U.leadsC1.push(r.lead); }
  const sin = await ve(U.e1.token, "leads.create", { cliente: { nombre: "Sin campaña", telefono: "955555555" }, lead: { fuente: "Llamada" } });
  assert.equal(sin.status, 200);
  assert.equal(fila("leads", sin.lead.id).campania_id ?? null, null);
  const g = await ve(U.e1.token, "leads.get", { id: U.leadsC1[0].id });
  assert.equal(g.campania.nombre, "Ofertas de octubre");
  // Editar el lead sin enviar la campaña la conserva; enviarla vacía la quita.
  const base = { fuente: "Instagram", parteDePago: { tiene: false }, financiamiento: { quiere: false } };
  assert.equal((await ve(U.e1.token, "leads.update", { id: U.leadsC1[0].id, lead: base })).status, 200);
  assert.equal(fila("leads", U.leadsC1[0].id).campania_id, U.c1.id);
  assert.equal((await ve(U.e1.token, "leads.update", { id: U.leadsC1[0].id, lead: { ...base, campaniaId: pendiente.id } })).error, "campania_invalida");
  assert.equal((await ve(U.e1.token, "leads.update", { id: U.leadsC1[0].id, lead: { ...base, campaniaId: U.c1.id } })).status, 200, "la que ya tiene siempre se acepta");
  assert.equal((await ve(U.e1.token, "leads.update", { id: U.leadsC1[3].id, lead: { ...base, campaniaId: "" } })).status, 200);
  assert.equal(fila("leads", U.leadsC1[3].id).campania_id ?? null, null);
});

test("Resultados de la campaña: leads, ventas, costo por lead y por venta", async () => {
  // Dos ventas aprobadas de los leads de la campaña.
  db.tablas.cierres.push({ id: randomUUID(), lead_id: U.leadsC1[0].id, estado: "aprobada", precio_final: 9000000, mes: mesChile() });
  db.tablas.cierres.push({ id: randomUUID(), lead_id: U.leadsC1[1].id, estado: "aprobada", precio_final: 8000000, mes: mesChile() });
  const r = await ve(U.mkt.token, "marketing.campanias.get", { id: U.c1.id });
  const m = r.campania.metricas;
  assert.equal(m.leads, 3, "uno se quitó de la campaña");
  assert.equal(m.ventas, 2);
  assert.equal(m.monto, 17000000);
  assert.equal(m.costoPorLead, 50000, "$150.000 / 3 leads");
  assert.equal(m.costoPorVenta, 75000);
  const res = await ve(U.mkt.token, "marketing.resultados");
  assert.equal(res.status, 200);
  const ig = res.fuentes.find((f) => f.fuente === "Instagram");
  assert.ok(ig.leads >= 3);
  assert.equal(ig.margen, undefined, "Marketing no ve márgenes");
  assert.ok(res.fuentes.find((f) => f.fuente === "Llamada"));
  assert.equal(res.campanias.find((c) => c.id === U.c1.id).metricas.leads, 3);
  assert.equal(res.totales.gasto, 150000);
  assert.equal(res.totales.ventasDeCampanias, 2);
  assert.equal((await ve(U.mkt.token, "marketing.resultados", { mes: "2026-13" })).error, "mes_invalido");
  assert.equal((await ve(U.mktSur.token, "marketing.resultados")).campanias.some((c) => c.id === U.c1.id), false, "otro local no ve estas campañas");
});

test("Finalizar y cancelar campañas", async () => {
  const f = await ve(U.mkt.token, "marketing.campanias.finalizar", { id: U.libre.id });
  assert.equal(f.campania.estado, "finalizada");
  assert.equal((await ve(U.mkt.token, "marketing.campanias.finalizar", { id: U.libre.id })).error, "campania_estado_invalido");
  assert.equal((await ve(U.mkt.token, "marketing.campanias.cancelar", { id: U.libre.id })).error, "campania_estado_invalido");
  const lead = await ve(U.e1.token, "leads.create", { cliente: { nombre: "Tarde", telefono: "966666666" }, lead: { campaniaId: U.libre.id } });
  assert.equal(lead.error, "campania_invalida", "una campaña finalizada ya no recibe leads");
  const c = (await campania(U.mkt.token, { nombre: "Para cancelar" })).campania;
  assert.equal((await ve(U.e1.token, "marketing.campanias.cancelar", { id: c.id })).status, 403);
  assert.equal((await ve(U.jefe.token, "marketing.campanias.cancelar", { id: c.id })).campania.estado, "cancelada", "también el supervisor");
  assert.equal((await ve(U.mkt.token, "marketing.campanias.list", { estado: "cancelada" })).campanias.length, 1);
  assert.ok(!(await ve(U.mkt.token, "marketing.campanias.list")).campanias.some((x) => x.estado === "cancelada" && x.id !== c.id));
});

test("Calendario de contenido: crear, mover de estado, atrasadas y eliminar", async () => {
  const v = await vehiculo();
  const d = (o = {}) => ({ titulo: "Reel Hyundai Venue", red: "instagram", tipo: "reel", texto: "Conoce el SUV del año", estado: "programada", fechaProgramada: manana(), vehiculoId: v.id, campaniaId: U.c1.id, ...o });
  const guardar = (token, datos, id) => ve(token, "marketing.publicaciones.save", { id, datos });
  assert.equal((await guardar(U.e1.token, d())).status, 403);
  assert.equal((await guardar(U.jefe.token, d())).status, 403, "el supervisor mira");
  assert.equal((await guardar(U.mkt.token, d({ titulo: "ab" }))).error, "titulo_publicacion_invalido");
  assert.equal((await guardar(U.mkt.token, d({ fechaProgramada: undefined }))).error, "fecha_requerida");
  assert.equal((await guardar(U.mkt.token, d({ campaniaId: randomUUID() }))).error, "campania_invalida");
  assert.equal((await guardar(U.mkt.token, d({ vehiculoId: randomUUID() }))).error, "vehiculo_invalido");
  const r = await guardar(U.mkt.token, d());
  assert.equal(r.status, 200, JSON.stringify(r));
  const p = r.publicacion;
  assert.match(p.folio, /^POST-/);
  assert.equal(p.estado, "programada");
  assert.equal(p.responsable_id, U.mkt.id);

  const lista = await ve(U.mkt.token, "marketing.publicaciones.list", { mes: mesChile(new Date(p.fecha_programada)) });
  const x = lista.publicaciones.find((y) => y.id === p.id);
  assert.match(x.vehiculo, /Hyundai Venue 2023/);
  assert.equal(x.campania, "Ofertas de octubre");
  assert.equal((await ve(U.jefe.token, "marketing.publicaciones.list", { mes: mesChile(new Date(p.fecha_programada)) })).publicaciones.length >= 1, true);
  assert.equal((await ve(U.mktSur.token, "marketing.publicaciones.list", { mes: mesChile(new Date(p.fecha_programada)) })).publicaciones.length, 0, "otro local no la ve");

  // Pasa a publicada con su enlace.
  assert.equal((await ve(U.mkt.token, "marketing.publicaciones.estado", { id: p.id, estado: "publicada", url: "http://x" })).error, "url_invalida");
  const pub = await ve(U.mkt.token, "marketing.publicaciones.estado", { id: p.id, estado: "publicada", url: "https://www.instagram.com/reel/abc" });
  assert.equal(pub.publicacion.estado, "publicada");
  assert.equal(pub.publicacion.url, "https://www.instagram.com/reel/abc");
  assert.equal((await ve(U.mkt.token, "marketing.publicaciones.eliminar", { id: p.id })).error, "publicacion_no_eliminable");

  // Una idea suelta se puede eliminar; una programada que quedó atrasada se cuenta.
  const idea = (await guardar(U.mkt.token, { titulo: "Idea de sorteo", red: "facebook" })).publicacion;
  assert.equal(idea.estado, "idea");
  assert.equal((await ve(U.mkt.token, "marketing.publicaciones.eliminar", { id: idea.id })).status, 200);
  const vieja = (await guardar(U.mkt.token, d({ titulo: "Post atrasado", fechaProgramada: new Date(Date.now() + 3600e3).toISOString() }))).publicacion;
  fila("publicaciones_rrss", vieja.id).fecha_programada = new Date(Date.now() - 2 * 3600e3).toISOString();
  const l2 = await ve(U.mkt.token, "marketing.publicaciones.list", { mes: mesChile() });
  assert.equal(l2.atrasadas >= 1, true);
  assert.equal(l2.resumen.porEstado.programada >= 1, true);
  assert.equal((await ve(U.mkt.token, "marketing.publicaciones.list", { mes: "xx" })).error, "mes_invalido");
});

test("Material por vehículo: se pide, se reúne y queda con su enlace", async () => {
  const v = await vehiculo();
  const guardar = (token, datos) => ve(token, "marketing.material.save", { datos });
  assert.equal((await guardar(U.e1.token, { vehiculoId: v.id, tipo: "reel" })).status, 403);
  assert.equal((await guardar(U.jefe.token, { vehiculoId: v.id, tipo: "reel", notas: "Para la campaña de octubre" })).status, 200, "el supervisor puede pedirlo");
  assert.equal((await guardar(U.mkt.token, { vehiculoId: randomUUID(), tipo: "reel" })).error, "vehiculo_invalido");
  assert.equal((await guardar(U.mkt.token, { vehiculoId: v.id, tipo: "reel", estado: "listo" })).error, "url_invalida");
  const listo = await guardar(U.mkt.token, { vehiculoId: v.id, tipo: "reel", estado: "listo", url: "https://drive.google.com/drive/folders/abc" });
  assert.equal(listo.material.estado, "listo");
  assert.equal(db.tablas.material_vehiculo.filter((m) => m.vehiculo_id === v.id && m.tipo === "reel").length, 1, "no se duplica por vehículo y tipo");
  await guardar(U.mkt.token, { vehiculoId: v.id, tipo: "fotos" });
  const l = await ve(U.mkt.token, "marketing.material.list");
  assert.equal(l.material.filter((m) => m.vehiculo.includes(v.patente)).length, 2);
  assert.equal((await ve(U.mktSur.token, "marketing.material.list")).material.length, 0);
  const id = l.material.find((m) => m.tipo === "fotos").id;
  assert.equal((await ve(U.e1.token, "marketing.material.eliminar", { id })).status, 403);
  assert.equal((await ve(U.mkt.token, "marketing.material.eliminar", { id })).status, 200);
});
