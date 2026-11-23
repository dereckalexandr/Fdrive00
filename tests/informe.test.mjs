// Informe financiero del mes: períodos y variaciones, alertas, contenido desde el servidor (mismos números que las pestañas) y PDF.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { periodoAnterior, variacion, nombrePeriodo, armarInforme } from "../supabase/functions/api/informe-core.js";
import { buildInformeMensualPdf } from "../src/pdf-report.js";
import { iniciarFuncion, api, nuevaIp, loginAdmin, crm, db } from "./helpers/api-env.mjs";

test("Períodos, variación y nombre", () => {
  assert.equal(periodoAnterior("2026-01"), "2025-12");
  assert.equal(periodoAnterior("2026-11"), "2026-10");
  assert.equal(periodoAnterior("2026"), "2025");
  assert.equal(variacion(120, 100), 20);
  assert.equal(variacion(-50, 100), -150);
  assert.equal(variacion(10, 0), null);
  assert.equal(nombrePeriodo("2026-11"), "noviembre de 2026");
  assert.equal(nombrePeriodo("2026"), "año 2026");
});

test("Alertas: resultado negativo, saldo negativo, cuentas sin conciliar o con diferencias, sin respaldo, fijos, nómina, ventas sin costo, stock antiguo", () => {
  const vacio = { ingresosVentas: 0, costoVentas: 0, margenBruto: 0, otrosIngresos: [], totalOtros: 0, gastos: [], totalGastos: 0, resultado: -5000, unidades: 0 };
  const d = armarInforme({
    periodo: "2026-11", hoy: "2026-11-30",
    resumen: {
      periodo: { desde: "2026-11-01", hasta: "2026-11-30" }, resultados: { ...vacio, gastos: [{ id: "arriendo", nombre: "Arriendo", monto: 5000 }], totalGastos: 5000 },
      caja: { entradas: 0, salidas: 5000, neto: -5000 }, saldoTotal: -5000,
      cuentas: [{ clave: "A", nombre: "Banco A", tipo: "banco", saldo: 100 }, { clave: "B", nombre: "Banco B", tipo: "banco", saldo: 0 }, { clave: "C", nombre: "Banco C", tipo: "banco", saldo: 0 }, { clave: "caja", nombre: "Caja", tipo: "caja", saldo: -5100 }],
      porCobrar: [], totalPorCobrar: 0, porPagar: [{ tipo: "nomina", folio: "Nómina 2026-11", vehiculo: "Previred", falta: 300 }], totalPorPagar: 300,
    },
    resumenAnterior: { resultados: { ...vacio, resultado: 1000, gastos: [{ id: "arriendo", nombre: "Arriendo", monto: 4000 }], totalGastos: 4000 }, caja: { neto: 0 } },
    rentabilidad: { ventas: [{ folio: "VTA-1", sinCosto: true, precio: 1, costo: 0, margen: 1 }], stock: [{ consignado: false, dias: 120, invertido: 5000000, vehiculo: "Kia" }], totales: {} },
    sinRespaldo: { cantidad: 2, monto: 9000 },
    conciliaciones: { A: { hasta: "2026-11-15", faltan: 0, diferencia: 0 }, B: { hasta: "2026-11-30", faltan: 1, diferencia: -800 } },
    fijosPendientes: 1, nomina: { aplica: true, guardada: false, trabajadores: 3 },
  });
  const t = d.alertas.map((a) => a.texto).join("\n");
  assert.equal(d.alertas[0].nivel, "alta");
  for (const frase of ["resultado del período es negativo", "Caja tiene saldo negativo", "Banco B: la última conciliación", "Banco C: nunca se ha conciliado", "Banco A: conciliada hasta el 2026-11-15",
    "2 movimientos sin factura", "1 gasto fijo", "no está guardada (3 trabajadores)", "Pagos de nómina pendientes: Previred", "1 venta sin costo", "más de 90 días"]) assert.ok(t.includes(frase), frase);
  assert.equal(d.cifras[0].variacion, -600);
  assert.deepEqual(d.resultados.grupos.map((g) => [g.id, g.monto, g.anterior]), [["operacion", 5000, 4000]]);
  assert.equal(d.anterior, "octubre de 2026");
});

const ve = (token, op, extra = {}) => api({ action: "ventas", token, op, ...extra });
let admin; let L1; let jefe; let ejecutivo;
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const mes = hoy.slice(0, 7);
before(async () => {
  await iniciarFuncion();
  admin = await loginAdmin();
  L1 = (await crm(admin, "locales.create", { nombre: "Casa matriz" })).local.id;
  for (const [rut, nombre, roles] of [["12.345.678-5", "Julia Jefa", ["jefe_local"]], ["6.000.000-K", "Eva Uno", ["ejecutivo"]]]) {
    await crm(admin, "usuarios.create", { datos: { nombre, rut, roles, localId: L1 }, clave: "Prueba12345" });
    nuevaIp();
    const t = (await api({ action: "userLogin", rut, password: "Prueba12345" })).token;
    if (roles[0] === "jefe_local") jefe = t; else ejecutivo = t;
  }
  const veh = { id: randomUUID(), local_id: L1, patente: "ABCD12", marca: "Kia", modelo: "Rio", anio: 2020, estado: "vendido", activo: true, costo: 8000000, origen: "compra", fotos: [] };
  db.tablas.vehiculos.push(veh);
  const c = { id: randomUUID(), numero: 9, local_id: L1, lead_id: randomUUID(), vehiculo_id: veh.id, reserva_id: null, reserva_monto: 0, precio_final: 10000000, costo: 8000000, estado: "aprobada", mes, aprobado_en: new Date().toISOString(), vehiculo_snapshot: { marca: "Kia", modelo: "Rio", patente: "ABCD12" } };
  db.tablas.cierres.push(c);
  db.tablas.cierre_pagos.push({ id: randomUUID(), cierre_id: c.id, local_id: L1, medio: "efectivo", monto: 10000000, fecha_pago: hoy, estado: "vigente", archivos: [], cuenta_id: null });
  db.tablas.kv_store.push({ key: "empresa::datos", value: JSON.stringify({ razon_social: "Empresa Demo SpA", rut: "76557869-8" }) });
});

test("Servidor: mismos números que el Resumen, permisos y PDF", async () => {
  await ve(admin, "fin.mov_guardar", { localId: L1, mov: { tipo: "egreso", categoria: "arriendo", monto: 900000, fecha: hoy, descripcion: "Arriendo oficina" } });
  assert.equal((await ve(ejecutivo, "fin.informe", { periodo: mes })).status, 403);
  assert.equal((await ve(jefe, "fin.informe", { periodo: "noviembre" })).error, "mes_invalido");
  const r = await ve(jefe, "fin.informe", { periodo: mes });
  assert.equal(r.status, 200, JSON.stringify(r));
  const res = await ve(jefe, "fin.resumen", { periodo: mes });
  const inf = r.informe;
  assert.equal(inf.cifras.find((c) => c.id === "resultado").monto, res.resultados.resultado);
  assert.equal(inf.resultados.resultado, 10000000 - 8000000 - 900000);
  assert.equal(inf.caja.saldoTotal, res.saldoTotal);
  assert.equal(inf.ventas.length, 1);
  assert.equal(inf.empresa.razonSocial, "Empresa Demo SpA");
  assert.equal(inf.empresa.local, "Casa matriz");
  assert.ok(inf.alertas.some((a) => a.texto.includes("sin factura"))); // el arriendo no tiene respaldo
  assert.ok(db.tablas.bitacora.some((b) => b.accion === "finanzas.informe"));
  const anual = await ve(jefe, "fin.informe", { periodo: mes.slice(0, 4) });
  assert.equal(anual.status, 200);
  assert.equal(anual.informe.nombrePeriodo, `año ${mes.slice(0, 4)}`);

  const pdf = Buffer.from(buildInformeMensualPdf(inf, { fmt: (n) => `$${Number(n).toLocaleString("es-CL")}` })).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  for (const t of ["Cifras clave", "Estado de resultados", "Caja y bancos", "Por cobrar y por pagar", "Inventario", "EMPRESA DEMO SPA"]) assert.ok(pdf.includes(t), t);
  assert.ok(!pdf.includes("?..."));
});
