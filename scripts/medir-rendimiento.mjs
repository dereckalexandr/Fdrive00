// Mide cuántas consultas a la base hace cada operación del CRM (contra la función real y una base falsa con datos de ejemplo).
import { pathToFileURL } from "node:url";
const RAIZ = process.cwd();
const env = await import(pathToFileURL(`${RAIZ}/tests/helpers/api-env.mjs`).href);

const { iniciarFuncion, api, nuevaIp, loginAdmin, crm } = env;
await iniciarFuncion();
const db = env.db;
const admin = await loginAdmin();
const L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
const U = {};
async function crear(clave, nombre, rut, roles, extra) {
  const r = await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId: L1, extra }, clave: "Prueba12345" });
  nuevaIp();
  const l = await api({ action: "userLogin", rut, password: "Prueba12345" });
  U[clave] = { id: r.usuario.id, token: l.token };
}
await crear("jefe", "Julia Jefa", "12.345.678-5", ["jefe_local"]);
await crear("e1", "Eva Uno", "6.000.000-K", ["ejecutivo"], { otorgar: ["ventas.operar"], quitar: [] });
await crear("e2", "Ema Dos", "7.654.321-6", ["ejecutivo"], { otorgar: ["ventas.operar"], quitar: [] });
await crear("an", "Ana Anunciante", "11.111.111-1", ["anunciante"]);
await crear("val", "Vera Validadora", "13.579.246-2", ["validador"]);
await crear("insp", "Ivo Inspector", "13.000.000-2", ["inspector"]);
await crear("mkt", "Marta Marketing", "10.000.013-K", ["marketing"]);
const ve = (u, op, extra = {}) => api({ action: "ventas", token: U[u].token, op, ...extra });

// Datos de ejemplo: 40 vehículos, 120 leads.
const vehs = [];
for (let i = 0; i < 40; i++) vehs.push((await ve("jefe", "inventario.save", { datos: { patente: `ZZ${1000 + i}`, marca: "Toyota", modelo: "Yaris", anio: 2020, km: 40000, precioLista: 10000000, costo: 8500000 } })).vehiculo);
for (let i = 0; i < 120; i++) await ve(i % 2 ? "e1" : "e2", "leads.create", { cliente: { nombre: `Cliente ${i}`, telefono: `9${String(60000000 + i)}` }, lead: { fuente: "Instagram", vehiculoId: vehs[i % 40].id } });
for (let i = 0; i < 6; i++) {
  const l = (await ve("e1", "leads.create", { cliente: { nombre: `Cot ${i}`, telefono: `9${String(70000000 + i)}` }, lead: {} })).lead;
  const cot = (await ve("e1", "cotizaciones.save", { leadId: l.id, vehiculoId: vehs[i].id, datos: {} })).cotizacion;
  if (i < 3) await ve("e1", "reservas.crear", { cotizacionId: cot.id, monto: 500000 });
}

process.env.LATENCIA_MS = "35";
const casos = [
  ["jefe", "catalogos"], ["e1", "catalogos"], ["jefe", "leads.list", { todos: true }], ["e1", "leads.list", {}], ["jefe", "inventario.list"], ["jefe", "tareas.list", { todas: true }],
  ["jefe", "reservas.list"], ["jefe", "cotizaciones.pendientes"], ["jefe", "cierres.list", { estado: "pendiente" }], ["jefe", "comisiones.resumen"], ["e1", "comisiones.resumen"],
  ["jefe", "gestion.resumen"], ["jefe", "gestion.embudo"], ["e1", "leads.get", {}], ["jefe", "tasaciones.list", { vista: "local" }], ["jefe", "inspecciones.list", { vista: "local" }],
  ["jefe", "validacion.list", { vista: "local" }], ["an", "anuncios.cola"], ["an", "anuncios.list"], ["an", "anuncios.resumen"], ["mkt", "marketing.campanias.list"], ["mkt", "marketing.resultados"],
  ["val", "validacion.list", { vista: "cola" }], ["jefe", "inspecciones.resumen"], ["jefe", "validacion.resumen"],
];
const lead = (await ve("e1", "leads.list", {})).leads[0];
console.log("operación".padEnd(40), "consultas", "ms (35 ms por consulta)");
const filas = [];
for (const [u, op, extra] of casos) {
  const e2 = op === "leads.get" ? { id: lead.id } : extra || {};
  // La primera llamada de cada persona llena sus cachés; se mide la segunda y la primera.
  db.consultas.length = 0;
  const t0 = performance.now();
  const r = await ve(u, op, e2);
  const ms = Math.round(performance.now() - t0);
  const n = db.consultas.length;
  const porTabla = {};
  for (const c of db.consultas) porTabla[c.tabla] = (porTabla[c.tabla] || 0) + 1;
  filas.push({ op: `${u}:${op}`, n, ms, status: r.status, tablas: Object.entries(porTabla).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, c]) => `${t}×${c}`).join(" ") });
}
for (const f of filas.sort((a, b) => b.n - a.n)) console.log(f.op.padEnd(40), String(f.n).padStart(6), String(f.ms).padStart(6), f.status === 200 ? "" : `[${f.status}]`, f.tablas);
// Escenario "entrar al módulo de Ventas": lo que dispara la pantalla de inicio de un jefe
db.consultas.length = 0;
const t1 = performance.now();
await Promise.all([ve("jefe", "catalogos"), ve("jefe", "leads.list", { todos: true }), ve("jefe", "tareas.list", { todas: true }), ve("jefe", "reservas.list"), ve("jefe", "cotizaciones.pendientes"), ve("jefe", "comisiones.resumen"), ve("jefe", "gestion.resumen"), ve("jefe", "cotizaciones.pendientes"), ve("jefe", "cierres.list", { estado: "pendiente" })]);
console.log("\nEntrar a Ventas como Jefe Local: 9 peticiones en paralelo,", db.consultas.length, "consultas a la base en total,", Math.round(performance.now() - t1), "ms con 35 ms por consulta");
process.exit(0);
