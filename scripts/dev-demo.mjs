// Entorno de demostración LOCAL para trabajar el diseño sin tocar producción.
//
// Levanta la función real contra una base falsa en memoria, con datos de ejemplo, y abre la interfaz apuntando a ella.
// Nada de esto toca Supabase. Uso:  node scripts/dev-demo.mjs   y abrir http://127.0.0.1:5199
//
// Accesos de demostración (clave de todos: Prueba12345):
//   Administrador (cuenta maestra): admin@prueba.cl / MaestraSegura123
//   Jefe Local 12.345.678-5 · Ejecutivo 6.000.000-K · Tasador 5.555.555-9 · Inspector 12.000.000-4
//   Validador 13.000.000-2 · Anunciante 14.000.000-0 · Marketing 10.000.013-K
import { createServer as crearHttp } from "node:http";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, manejar, db, boostr, ADMIN_EMAIL, ADMIN_PW } from "../tests/helpers/api-env.mjs";

const CLAVE = "Prueba12345";
const PUERTO_API = 54321;
const PUERTO_WEB = 5199;

await iniciarFuncion();
const admin = await loginAdmin();
const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
const U = {};
const L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
async function crear(clave, nombre, rut, roles, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId: L1, extra, email: `${clave}@demo.cl` }, clave: CLAVE });
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: CLAVE });
  U[clave] = { id: r.usuario.id, token: l.token, nombre };
}
const habil = { otorgar: ["ventas.operar", "compras.operar", "consignaciones.operar"], quitar: [] };
await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"]);
await crear("e1", "Eva Contreras", "6.000.000-K", ["ejecutivo"], habil);
await crear("e2", "Marcos Rojas", "7.654.321-6", ["ejecutivo"], habil);
await crear("tasador", "Tito Tasador", "5.555.555-9", ["tasador"]);
await crear("insp", "Ivo Inspector", "12.000.000-4", ["inspector"]);
await crear("val", "Vera Validadora", "13.000.000-2", ["validador"]);
await crear("anu", "Ana Anunciante", "14.000.000-0", ["anunciante"]);
await crear("mkt", "Marta Marketing", "10.000.013-K", ["marketing"]);

// Patentes de ejemplo para la consulta de datos por patente (la API real está simulada).
boostr.respuestas.GPDD74 = { status: "success", data: { plate: "GPDD74", dv: "8", make: "SUBARU", model: "NEW WRX S AWD CVT 2.0T", year: 2014, type: "AUTOMOVIL", engine: "H983322" } };
boostr.respuestas.BCYT91 = { status: "success", data: { plate: "BCYT91", dv: "1", make: "TOYOTA", model: "YARIS 1.5 GLI", year: 2019, type: "AUTOMOVIL", engine: "1NZ123" } };

// En la demostración nadie debe cambiar su clave al entrar.
for (const u of db.tablas.usuarios) u.debe_cambiar_clave = false;

const foto = (c1, c2) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='640' height='400'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/></linearGradient></defs><rect width='640' height='400' fill='url(#g)'/><g fill='white' opacity='.85'><rect x='150' y='190' width='340' height='80' rx='30'/><rect x='215' y='140' width='210' height='70' rx='30'/><circle cx='220' cy='280' r='34'/><circle cx='420' cy='280' r='34'/></g></svg>`)}`;
const AUTOS = [
  ["Toyota", "Yaris", 2021, 38000, 9890000, "#0f172a", "#475569"], ["Hyundai", "Tucson", 2022, 21000, 17490000, "#7c2d12", "#f59e0b"],
  ["Kia", "Rio 5", 2020, 52000, 8590000, "#1e3a8a", "#38bdf8"], ["Suzuki", "Swift", 2023, 9000, 11990000, "#14532d", "#4ade80"],
  ["Chevrolet", "Sail", 2019, 67000, 6290000, "#581c87", "#c084fc"], ["Nissan", "Qashqai", 2021, 44000, 15290000, "#334155", "#94a3b8"],
];
const vehs = [];
for (const [i, [marca, modelo, anio, km, precio, c1, c2]] of AUTOS.entries()) {
  const r = await ve(U.jefe.token, "inventario.save", { datos: { patente: `${"BCDFGH"[i]}${"KLMNPR"[i]}${"TVWXYZ"[i]}${"BCDFGH"[(i + 2) % 6]}${10 + i}`, marca, modelo, anio, km, precioLista: precio, costo: Math.round(precio * 0.84), color: ["Gris", "Rojo", "Azul", "Verde", "Morado", "Plomo"][i], transmision: i % 2 ? "Automática" : "Mecánica", combustible: "Bencina" } });
  if (!r.vehiculo) throw new Error("No se pudo crear el vehículo de ejemplo: " + JSON.stringify(r));
  vehs.push(r.vehiculo);
  // Foto de ejemplo (dibujo) para ver las tarjetas con imagen.
  db.tablas.vehiculos.find((v) => v.id === r.vehiculo.id).fotos = ["f1"];
  db.tablas.kv_store.push({ key: `vfoto::${r.vehiculo.id}::f1`, value: foto(c1, c2), shared: true, updated_at: new Date().toISOString() });
}
const NOMBRES = ["Camila Soto", "Pedro Núñez", "Javiera Pino", "Rodrigo Vera", "Daniela Muñoz", "Felipe Araya", "Sofía Castro", "Tomás Herrera"];
const leads = [];
for (const [i, nombre] of NOMBRES.entries()) {
  const quien = i % 2 ? U.e2 : U.e1;
  const r = await ve(quien.token, "leads.create", { cliente: { nombre, telefono: `9${String(70000000 + i * 1137)}`, email: `c${i}@mail.cl` }, lead: { vehiculoId: vehs[i % vehs.length].id, fuente: ["Sitio web", "Instagram", "Referido", "Marketplace"][i % 4] } });
  if (r.lead) leads.push({ lead: r.lead, quien });
}
for (const [i, etapa] of ["contactado", "seguimiento", "contactado"].entries()) if (leads[i]) await ve(leads[i].quien.token, "leads.mover", { id: leads[i].lead.id, etapa });
for (const i of [0, 1, 2]) {
  if (!leads[i]) continue;
  await ve(leads[i].quien.token, "cotizaciones.save", { leadId: leads[i].lead.id, vehiculoId: vehs[i].id, datos: { descuento: i === 1 ? 250000 : 0 } });
}

// Una valorización del Inspector con fotos (para ver la ficha de inspectores del Jefe Local).
{
  const kv = (op, key, value) => api({ action: "kv", token: U.insp.token, op, key, ...(value ? { value } : {}) });
  await kv("set", `foto::${U.insp.id}::pf1`, foto("#7c2d12", "#f59e0b"));
  await kv("set", `foto::${U.insp.id}::pf2`, foto("#1e3a8a", "#38bdf8"));
  await kv("set", `tasacion::${U.insp.id}::t1`, JSON.stringify({
    fecha: "2026-10-19", propietario: "Don Pedro Soto", vehiculo: "Toyota Yaris 2019", patente: "BKTD10", anio: "2019", kilometraje: "52000", valorComercial: 8900000, estadoGeneral: "Bueno",
    observaciones: "Pintura con detalles.", inspectorNombre: "Ivo Inspector", guardadoEl: new Date().toISOString(),
    checklist: { parachoques_delantero: { estado: "Repintado", valor: 150000, fotos: ["pf1"] }, tapabarro_delantero_izquierdo: { estado: "Golpe", valor: 200000, fotos: ["pf2"] } },
  }));
}

// Una inspección con fotos vinculada a una tasación en curso (para ver las fotos del inspector desde Tasaciones).
{
  const kvI = (key, value) => api({ action: "kv", token: U.insp.token, op: "set", key, value });
  await kvI(`inspeccion::${U.insp.id}::i1`, JSON.stringify({ inscripcion: "BKTD.10-1", marca: "Toyota", modelo: "Yaris", anio: "2021", fecha: "2026-10-18", inspectorNombre: "Ivo Inspector", guardadoEl: new Date().toISOString(), fotosEquipo: ["a1", "a2", "a3"] }));
  await kvI("ifoto::i1::a1", foto("#0f172a", "#475569"));
  await kvI("ifoto::i1::a2", foto("#14532d", "#4ade80"));
  await kvI("ifoto::i1::a3", foto("#581c87", "#c084fc"));
  const t = (await ve(U.e1.token, "tasaciones.pedir", { leadId: leads[0].lead.id, datos: { vehiculo: { patente: "BKTD10", marca: "Toyota", modelo: "Yaris", anio: 2021, km: 38000 } } })).tasacion;
  await ve(U.tasador.token, "tasaciones.tomar", { id: t.id });
  await ve(U.tasador.token, "tasaciones.guardar", { id: t.id, borrador: { inspeccion: { key: `inspeccion::${U.insp.id}::i1`, fecha: "2026-10-18", inspector: "Ivo Inspector", patente: "BKTD10", marca: "Toyota", modelo: "Yaris", anio: "2021" } } });
}

// Una compra con la oferta aceptada, para ver los requisitos (datos del vendedor y documentos) antes de pedir el pago.
{
  const l = (await ve(U.e1.token, "leads.create", { cliente: { nombre: "Don Hernán Vidal", telefono: "955512345" }, lead: { tipo: "compra", fuente: "Llamada", vehiculoOfrecido: { patente: "HHRR55", marca: "Suzuki", modelo: "Baleno", anio: 2019, km: 61000, transmision: "Mecánica", combustible: "Bencina", duenos: 2, prenda: "no", mantenciones: "si", precioEsperado: 7500000 } } })).lead;
  if (l) {
    const p = await ve(U.e1.token, "compras.pedirTasacion", { leadId: l.id });
    await ve(U.tasador.token, "tasaciones.tomar", { id: p.tasacion.id });
    const t = await ve(U.tasador.token, "tasaciones.completar", { id: p.tasacion.id, borrador: { aplicaPara: "compra", valorCompra: 6800000, valorVenta: 8900000 } });
    const o = await ve(U.e1.token, "compras.ofertar", { leadId: l.id, tasacionId: t.tasacion.id, datos: { monto: 6500000 } });
    await ve(U.e1.token, "compras.responder", { id: o.compra.id, acepta: true });
  }
}

// Un lead de compra con la tasación lista y aplicable a compra y consignación, para ver los dos botones de oferta.
{
  const l = (await ve(U.e1.token, "leads.create", { cliente: { nombre: "Sra. Paula Reyes", telefono: "955500111" }, lead: { tipo: "compra", fuente: "Sitio web", vehiculoOfrecido: { patente: "MNOP12", marca: "Mini", modelo: "Cooper", anio: 2020, km: 45000, transmision: "Automática", combustible: "Bencina", duenos: 1, prenda: "no", mantenciones: "si", precioEsperado: 14500000 } } })).lead;
  if (l) {
    const p = await ve(U.e1.token, "compras.pedirTasacion", { leadId: l.id });
    await ve(U.tasador.token, "tasaciones.tomar", { id: p.tasacion.id });
    await ve(U.tasador.token, "tasaciones.completar", { id: p.tasacion.id, borrador: { aplicaPara: "ambas", valorCompra: 12000000, valorConsignacion: 13000000, valorVenta: 15500000 } });
  }
}

// Un lead de consignación, para ver los requisitos (datos del dueño y documentos) antes de registrar el contrato.
await ve(U.e1.token, "leads.create", { cliente: { nombre: "Doña Marta Silva", telefono: "955567890" }, lead: { tipo: "consignacion", fuente: "Visita al local", vehiculoOfrecido: { patente: "JJKK77", marca: "Nissan", modelo: "Kicks", anio: 2021, km: 33000, transmision: "Automática", combustible: "Bencina", duenos: 1, prenda: "no", mantenciones: "si", precioEsperado: 11500000 } } });

// Tareas y antigüedades distintas para ver la vista «Hoy» con todos sus grupos.
{
  const enH = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
  const mia = (i) => leads[i] && leads[i].quien;
  const tarea = (i, h, titulo, tipo = "llamada") => leads[i] && ve(mia(i).token, "tareas.create", { leadId: leads[i].lead.id, titulo, tipo, venceEn: enH(h) });
  await tarea(0, -6, "Llamar para confirmar interés");
  await tarea(1, 3, "Enviar cotización por WhatsApp", "whatsapp");
  await tarea(2, 70, "Seguimiento semanal");
  if (leads[5]) db.tablas.leads.find((l) => l.id === leads[5].lead.id).creado_en = enH(-6);
  if (leads[6]) db.tablas.leads.find((l) => l.id === leads[6].lead.id).creado_en = enH(-3);
}

// Servidor de la función simulada (misma dirección que la real: /functions/v1/api).
crearHttp(async (req, res) => {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  const cuerpo = Buffer.concat(trozos);
  const r = await manejar(new Request(`http://x${req.url}`, { method: req.method, headers: { ...req.headers, "x-forwarded-for": "127.0.0.1" }, body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : cuerpo }));
  const salida = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
  res.end(salida);
}).listen(PUERTO_API, "127.0.0.1");

process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${PUERTO_API}`;
process.env.VITE_SUPABASE_ANON_KEY = "demo";
const { createServer } = await import("vite");
const vite = await createServer({ server: { port: PUERTO_WEB, host: "127.0.0.1", strictPort: true } });
await vite.listen();
console.log(`\nDemostración lista: http://127.0.0.1:${PUERTO_WEB}\nAdministrador: ${ADMIN_EMAIL} / ${ADMIN_PW}\nPersonas: RUT de arriba con la clave ${CLAVE}\n`);
