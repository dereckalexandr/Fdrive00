// Liquidación de sueldo: monto en palabras, contenido del documento desde una fila de la nómina, PDF y operación del servidor.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { montoEnPalabras, armarLiquidacion, nombreMesLargo } from "../supabase/functions/api/liquidacion-core.js";
import { calcularFila, parametrosNomina, validarTrabajador } from "../supabase/functions/api/nomina-core.js";
import { buildLiquidacionesPdf } from "../src/pdf-report.js";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";

test("Monto en palabras", () => {
  assert.equal(montoEnPalabras(0), "cero pesos");
  assert.equal(montoEnPalabras(1), "un peso");
  assert.equal(montoEnPalabras(100), "cien pesos");
  assert.equal(montoEnPalabras(101), "ciento un pesos");
  assert.equal(montoEnPalabras(1000), "mil pesos");
  assert.equal(montoEnPalabras(21000), "veintiún mil pesos");
  assert.equal(montoEnPalabras(31500), "treinta y un mil quinientos pesos");
  assert.equal(montoEnPalabras(1000000), "un millón de pesos");
  assert.equal(montoEnPalabras(2000000), "dos millones de pesos");
  assert.equal(montoEnPalabras(805925), "ochocientos cinco mil novecientos veinticinco pesos");
  assert.equal(montoEnPalabras(1366376), "un millón trescientos sesenta y seis mil trescientos setenta y seis pesos");
  assert.equal(montoEnPalabras(21500000), "veintiún millones quinientos mil pesos");
  assert.equal(nombreMesLargo("2026-11"), "noviembre de 2026");
});

test("Contenido: haberes, descuentos con su tasa, líquido en palabras y aportes del empleador", () => {
  const ficha = { sueldoBase: 1400000, contrato: "indefinido", gratificacion: true, colacion: 50000, afp: "habitat", salud: "isapre", planSaludUf: 3.2 };
  const fila = { nombre: "Rosa Contreras", rut: "11111111-1", ficha, variables: { bonos: 100000, diasAusente: 2 }, ...calcularFila(ficha, { bonos: 100000, diasAusente: 2 }, parametrosNomina()) };
  const d = armarLiquidacion({ mes: "2026-11", fila, empresa: { razon_social: "Empresa Demo SpA", rut: "76557869-8", domicilio: "Pericles 897", comuna: "Las Condes" }, trabajador: { cargo: "Administrativa", ficha: { fechaIngreso: "2025-03-01" } }, parametros: parametrosNomina() });
  assert.equal(d.periodo, "noviembre de 2026");
  assert.equal(d.empresa.rut, "76.557.869-8");
  assert.equal(d.trabajador.rut, "11.111.111-1");
  assert.equal(d.trabajador.diasTrabajados, 28);
  assert.equal(d.trabajador.fechaIngreso, "2025-03-01");
  assert.equal(d.imponibles[0].detalle, "28 días trabajados");
  assert.ok(d.imponibles.some((x) => x.concepto === "Gratificación legal"));
  assert.equal(d.noImponibles[0].concepto, "Colación");
  assert.equal(d.descuentos[0].detalle, "11,27%");
  assert.equal(d.descuentos[1].detalle, "plan 3,2 UF");
  assert.equal(d.imponibles.reduce((s, x) => s + x.monto, 0), d.totalImponible);
  assert.equal(d.descuentos.reduce((s, x) => s + x.monto, 0), d.totalDescuentos);
  assert.equal(d.totalHaberes - d.totalDescuentos, d.liquido);
  assert.equal(d.liquidoPalabras, montoEnPalabras(d.liquido));
  assert.equal(d.empleador[0].detalle, "3,5%");

  const pdf = buildLiquidacionesPdf([d, { ...d, trabajador: { ...d.trabajador, nombre: "Otra Persona" } }], { fmt: (n) => `$${Number(n).toLocaleString("es-CL")}` });
  const texto = Buffer.from(pdf).toString("latin1");
  assert.ok(texto.startsWith("%PDF-1.4"));
  assert.match(texto, /\/Count 2/); // una página por trabajador
  assert.match(texto, /Rosa Contreras/);
  assert.match(texto, /Firma del trabajador/);
  assert.match(texto, /L\xcdQUIDO A PAGAR/);
});

test("Ficha: fecha de ingreso y correo opcionales, validados", () => {
  const base = { nombre: "Ana Pérez", ficha: { sueldoBase: 600000 } };
  assert.equal(validarTrabajador({ ...base, ficha: { ...base.ficha, fechaIngreso: "2026-02-30x" } }).error, "fecha_invalida");
  assert.equal(validarTrabajador({ ...base, ficha: { ...base.ficha, correo: "malo" } }).error, "email_invalido");
  const ok = validarTrabajador({ ...base, ficha: { ...base.ficha, fechaIngreso: "2025-03-01", correo: "Ana@Correo.cl" } });
  assert.equal(ok.value.ficha.fechaIngreso, "2025-03-01");
  assert.equal(ok.value.ficha.correo, "ana@correo.cl");
});

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
let admin; let L1; let jefe;
before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  await crm(admin, "usuarios.create", { datos: { nombre: "Julia Jefa", rut: "12.345.678-5", roles: ["jefe_local"], localId: L1 }, clave: "Prueba12345" });
  nuevaIp();
  jefe = (await api({ action: "userLogin", rut: "12.345.678-5", password: "Prueba12345" })).token;
});

test("Servidor: liquidaciones solo de una nómina guardada; todas o una; avisa si faltan los datos de la empresa", async () => {
  const mes = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }).slice(0, 7);
  const a = await ve(admin, "fin.trabajador_guardar", { localId: L1, trabajador: { nombre: "Pedro Soto", rut: "11.111.111-1", cargo: "Vendedor", ficha: { sueldoBase: 800000, fechaIngreso: "2024-01-15" } } });
  const b = await ve(admin, "fin.trabajador_guardar", { localId: L1, trabajador: { nombre: "Luisa Díaz", cargo: "Secretaria", ficha: { sueldoBase: 700000 } } });
  assert.equal((await ve(jefe, "fin.nomina_liquidaciones", { mes })).error, "nomina_sin_guardar");
  const prop = (await ve(admin, "fin.nomina", { localId: L1, mes })).propuesta;
  assert.equal((await ve(admin, "fin.nomina_guardar", { localId: L1, mes, parametros: prop.parametros, filas: prop.filas.map((f) => ({ trabajadorId: f.trabajadorId, variables: f.variables })) })).status, 200);

  let r = await ve(jefe, "fin.nomina_liquidaciones", { mes });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.liquidaciones.length, 2);
  assert.equal(r.faltaEmpresa, true);
  db.tablas.kv_store.push({ key: "empresa::datos", value: JSON.stringify({ razon_social: "Empresa Demo SpA", rut: "76557869-8", domicilio: "Pericles 897", comuna: "Las Condes" }) });
  r = await ve(jefe, "fin.nomina_liquidaciones", { mes, trabajadorId: a.trabajador.id });
  assert.equal(r.liquidaciones.length, 1);
  assert.equal(r.faltaEmpresa, false);
  const d = r.liquidaciones[0];
  assert.equal(d.trabajador.nombre, "Pedro Soto");
  assert.equal(d.trabajador.cargo, "Vendedor");
  assert.equal(d.trabajador.fechaIngreso, "2024-01-15");
  assert.equal(d.empresa.razonSocial, "Empresa Demo SpA");
  assert.ok(d.liquido > 0 && d.liquidoPalabras.endsWith("pesos"));
  assert.equal((await ve(jefe, "fin.nomina_liquidaciones", { mes, trabajadorId: "no-existe" })).status, 404);
  assert.ok(b.trabajador.id);
});
