// Finanzas: reglas puras (validación de movimientos, saldos, flujo de caja, estado de resultados, rentabilidad y CSV).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validarMovimiento, calcularSaldos, flujoMensual, estadoResultados, rentabilidadVehiculo, periodo, movimientosCsv, claveCaja, categoriaConVehiculo, POR_DEPOSITAR,
} from "../supabase/functions/api/finanzas-core.js";

const base = { tipo: "egreso", categoria: "arriendo", monto: 850000, fecha: "2026-11-05", descripcion: "Arriendo noviembre" };

test("Movimiento válido: normaliza montos, medio por defecto y deja el vehículo solo en gastos de vehículo", () => {
  const v = validarMovimiento({ ...base, monto: "850000.4", vehiculoId: "v1", documentoTipo: "factura", documentoNumero: " 123 " });
  assert.equal(v.ok, true);
  assert.equal(v.value.monto, 850000);
  assert.equal(v.value.medio, "efectivo"); // sin cuenta = caja
  assert.equal(v.value.vehiculo_id, null); // el arriendo no es de un vehículo
  assert.equal(v.value.documento_numero, "123");
  const r = validarMovimiento({ ...base, categoria: "reparacion", vehiculoId: "v1", cuentaId: "cta1" });
  assert.equal(r.value.vehiculo_id, "v1");
  assert.equal(r.value.medio, "transferencia");
  assert.equal(categoriaConVehiculo("pago_consignante"), true);
  assert.equal(categoriaConVehiculo("sueldos"), false);
});

test("Movimiento inválido: tipo, categoría de otro tipo, monto, fecha, fecha futura, descripción y traspaso a la misma cuenta", () => {
  assert.equal(validarMovimiento({ ...base, tipo: "otro" }).error, "fin_tipo");
  assert.equal(validarMovimiento({ ...base, categoria: "aporte_capital" }).error, "fin_categoria");
  assert.equal(validarMovimiento({ ...base, monto: 0 }).error, "fin_monto");
  assert.equal(validarMovimiento({ ...base, monto: -5 }).error, "fin_monto");
  assert.equal(validarMovimiento({ ...base, fecha: "2026-13-01" }).error, "fin_fecha");
  assert.equal(validarMovimiento({ ...base, fecha: "2026-12-01" }, { hoy: "2026-11-23" }).error, "fin_fecha_futura");
  assert.equal(validarMovimiento({ ...base, descripcion: " a " }).error, "fin_descripcion");
  assert.equal(validarMovimiento({ tipo: "traspaso", monto: 1000, fecha: "2026-11-01", descripcion: "Depósito", cuentaId: "", cuentaDestinoId: "" }).error, "fin_traspaso");
  const t = validarMovimiento({ tipo: "traspaso", monto: 1000, fecha: "2026-11-01", descripcion: "Depósito de la caja", cuentaId: "", cuentaDestinoId: "cta1" });
  assert.equal(t.ok, true);
  assert.equal(t.value.categoria, "traspaso");
  assert.equal(t.value.cuenta_destino_id, "cta1");
});

test("Saldos: saldo inicial desde su fecha, ingresos, egresos y traspasos entre la caja y el banco", () => {
  const caja = claveCaja("L1");
  const s = calcularSaldos([{ clave: "cta1", saldo_inicial: 1000000, desde: "2026-11-01" }], [
    { fecha: "2026-10-31", tipo: "ingreso", monto: 999, cuenta_id: "cta1", local_id: "L1" }, // antes del saldo inicial: ya está incluido en él
    { fecha: "2026-11-02", tipo: "ingreso", monto: 500000, cuenta_id: "cta1", local_id: "L1" },
    { fecha: "2026-11-03", tipo: "egreso", monto: 200000, cuenta_id: "cta1", local_id: "L1" },
    { fecha: "2026-11-03", tipo: "ingreso", monto: 300000, cuenta_id: null, local_id: "L1" },
    { fecha: "2026-11-04", tipo: "traspaso", monto: 250000, cuenta_id: null, cuenta_destino_id: "cta1", local_id: "L1" },
    { fecha: "2026-11-04", tipo: "ingreso", monto: 70000, cuenta_id: POR_DEPOSITAR, local_id: "L1" },
  ]);
  assert.equal(s.cta1.saldo, 1000000 + 500000 - 200000 + 250000);
  assert.equal(s[caja].saldo, 300000 - 250000);
  assert.equal(s[POR_DEPOSITAR].saldo, 70000);
});

test("Flujo mensual: entradas y salidas por mes, sin contar los traspasos", () => {
  const f = flujoMensual([
    { fecha: "2026-10-10", tipo: "ingreso", monto: 100 }, { fecha: "2026-11-01", tipo: "egreso", monto: 40 },
    { fecha: "2026-11-02", tipo: "ingreso", monto: 70 }, { fecha: "2026-11-03", tipo: "traspaso", monto: 999 },
  ]);
  assert.deepEqual(f, [{ mes: "2026-10", entradas: 100, salidas: 0, neto: 100 }, { mes: "2026-11", entradas: 70, salidas: 40, neto: 30 }]);
});

test("Estado de resultados: margen bruto de las ventas, otros ingresos y gastos; fuera los aportes, retiros y gastos de vehículos", () => {
  const r = estadoResultados({
    ventas: [{ precio: 10000000, costo: 8500000 }, { precio: 5000000, costo: 4200000 }],
    manuales: [
      { tipo: "egreso", categoria: "arriendo", monto: 800000 },
      { tipo: "egreso", categoria: "sueldos", monto: 1200000 },
      { tipo: "egreso", categoria: "reparacion", monto: 300000, vehiculo_id: "v1" }, // es costo del vehículo
      { tipo: "egreso", categoria: "reparacion", monto: 50000 }, // sin vehículo: gasto del período
      { tipo: "egreso", categoria: "retiro_dueno", monto: 2000000 },
      { tipo: "ingreso", categoria: "aporte_capital", monto: 5000000 },
      { tipo: "ingreso", categoria: "comision_financiera", monto: 400000 },
    ],
  });
  assert.equal(r.unidades, 2);
  assert.equal(r.margenBruto, 15000000 - 12700000);
  assert.equal(r.totalOtros, 400000);
  assert.equal(r.totalGastos, 800000 + 1200000 + 50000);
  assert.equal(r.resultado, 2300000 + 400000 - 2050000);
  assert.equal(r.gastos[0].id, "sueldos"); // de mayor a menor
});

test("Rentabilidad de un vehículo y períodos", () => {
  assert.deepEqual(rentabilidadVehiculo({ costoCompra: 8000000, gastos: 500000, precioVenta: 10000000 }), { invertido: 8500000, margen: 1500000, margenPct: 15 });
  assert.deepEqual(rentabilidadVehiculo({ costoCompra: 8000000, gastos: 0 }), { invertido: 8000000, margen: null, margenPct: null });
  assert.deepEqual(periodo("2026-02"), { desde: "2026-02-01", hasta: "2026-02-28" });
  assert.deepEqual(periodo("2026"), { desde: "2026-01-01", hasta: "2026-12-31" });
  assert.equal(periodo("noviembre"), null);
});

test("CSV para el contador: punto y coma, egresos en negativo y textos con comillas escapados", () => {
  const csv = movimientosCsv([
    { fecha: "2026-11-05", tipo: "egreso", categoria: "arriendo", descripcion: 'Arriendo "local"; noviembre', monto: 800000, origen: "manual", estado: "vigente", medio: "transferencia", documento_tipo: "factura", documento_numero: "55", cuenta_id: "cta1" },
    { fecha: "2026-11-06", tipo: "ingreso", categoria: "venta_vehiculo", descripcion: "Venta", monto: 9000000, origen: "venta", folio: "VTA-00001", estado: "vigente", medio: "credito", cuenta_id: POR_DEPOSITAR },
  ], (id) => (id === "cta1" ? "BCI" : "Otra"));
  const filas = csv.split("\r\n");
  assert.equal(filas.length, 3);
  assert.ok(filas[0].startsWith("Fecha;Tipo;Categoría"));
  assert.ok(filas[1].includes('"Arriendo ""local""; noviembre"'));
  assert.ok(filas[1].includes(";-800000;Manual;Vigente"));
  assert.ok(filas[2].includes(";9000000;CRM (VTA-00001);Vigente"));
});
