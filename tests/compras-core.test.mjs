import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compraNombre, consignacionNombre, folioCompra, folioConsignacion, permisoDeTipo, etapaDeOperacion, validarVehiculoOfrecido, validarOferta,
  validarRespuestaOferta, validarPagoCompra, validarTransicionCompra, vehiculoDeCompra, validarConsignacion, vencimientoConsignacion, diasParaVencer,
  validarTransicionConsignacion, validarExtension, margenConsignacion, vehiculoDeConsignacion, verificarPisoConsignado, metricasCompras, filasConsignacion,
} from "../supabase/functions/api/compras-core.js";
import { calcularProduccion, tramosEfectivos } from "../supabase/functions/api/comisiones-core.js";

const AHORA = new Date("2026-10-19T15:00:00Z");
const OFRECIDO = { patente: "ab-cd 12", marca: "Toyota", modelo: "Yaris", anio: 2018, km: 78000 };
const TAS = { estado: "completada", valor_compra: 6500000, valor_venta: 8500000, patente: "ABCD12", vehiculo: { patente: "ABCD12", marca: "Toyota", modelo: "Yaris", anio: 2018, km: 80000, color: "Gris", transmision: "Automática" } };

test("Nombres, folios y permisos por tipo de lead", () => {
  assert.equal(folioCompra(12), "CMP-00012");
  assert.equal(folioConsignacion(7), "CNS-00007");
  assert.equal(compraNombre("pago_pendiente"), "Pago por aprobar");
  assert.equal(consignacionNombre("vigente"), "Vigente");
  assert.equal(permisoDeTipo("venta"), "ventas.operar");
  assert.equal(permisoDeTipo("compra"), "compras.operar");
  assert.equal(permisoDeTipo("consignacion"), "consignaciones.operar");
  assert.equal(permisoDeTipo("otra"), "ventas.operar");
  assert.equal(etapaDeOperacion("compra", "cotizado", "Cotizado"), "Oferta hecha");
  assert.equal(etapaDeOperacion("compra", "ganado", "x"), "Comprado");
  assert.equal(etapaDeOperacion("consignacion", "ganado", "x"), "Consignado");
  assert.equal(etapaDeOperacion("venta", "cotizado", "Cotizado"), "Cotizado");
  assert.equal(etapaDeOperacion("compra", "nuevo", "Nuevo"), "Nuevo");
});

test("Vehículo que ofrece el cliente", () => {
  const ok = validarVehiculoOfrecido(OFRECIDO);
  assert.ok(ok.ok);
  assert.equal(ok.value.patente, "ABCD12");
  assert.equal(validarVehiculoOfrecido({ ...OFRECIDO, patente: "12" }).error, "patente_invalida");
  assert.equal(validarVehiculoOfrecido({ ...OFRECIDO, km: "" }).error, "km_invalido");
  assert.equal(validarVehiculoOfrecido(null).error, "patente_invalida");
});

test("Oferta: tasación completada, del mismo vehículo y sin pasar de lo tasado", () => {
  assert.ok(validarOferta({ monto: 6000000 }, TAS, "ABCD12").ok);
  assert.ok(validarOferta({ monto: 6500000 }, TAS, "abcd12").ok, "justo lo tasado se permite");
  assert.equal(validarOferta({ monto: 6500001 }, TAS, "ABCD12").error, "oferta_excede_tasacion");
  assert.equal(validarOferta({ monto: 0 }, TAS, "ABCD12").error, "monto_invalido");
  assert.equal(validarOferta({ monto: "" }, TAS, "ABCD12").error, "monto_invalido");
  assert.equal(validarOferta({ monto: 5000000 }, { ...TAS, estado: "en_proceso" }, "ABCD12").error, "tasacion_incompleta");
  assert.equal(validarOferta({ monto: 5000000 }, null, "ABCD12").error, "tasacion_incompleta");
  assert.equal(validarOferta({ monto: 5000000 }, TAS, "ZZZZ99").error, "tasacion_no_corresponde");
});

test("Respuesta del cliente: aceptar, o rechazar con motivo", () => {
  assert.deepEqual(validarRespuestaOferta({ acepta: true }).value, { acepta: true, motivo: null });
  assert.equal(validarRespuestaOferta({ acepta: false }).error, "motivo_requerido");
  assert.equal(validarRespuestaOferta({ acepta: false, motivo: "Quiere más" }).value.motivo, "Quiere más");
  assert.equal(validarRespuestaOferta(null).error, "motivo_requerido");
});

test("Pago de la compra: hasta lo ofertado, con medio y fecha", () => {
  const c = { monto_oferta: 6000000 };
  const ok = validarPagoCompra({ montoFinal: 5800000, medioPago: "Transferencia", fechaPago: "2026-10-19" }, c, AHORA);
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(ok.value.monto_final, 5800000);
  assert.equal(validarPagoCompra({ montoFinal: 6000001, medioPago: "Efectivo", fechaPago: "2026-10-19" }, c, AHORA).error, "monto_excede_oferta");
  assert.equal(validarPagoCompra({ montoFinal: 0, medioPago: "Efectivo", fechaPago: "2026-10-19" }, c, AHORA).error, "monto_invalido");
  assert.equal(validarPagoCompra({ montoFinal: 100, medioPago: "Trueque", fechaPago: "2026-10-19" }, c, AHORA).error, "medio_invalido");
  assert.equal(validarPagoCompra({ montoFinal: 100, medioPago: "Efectivo", fechaPago: "ayer" }, c, AHORA).error, "fecha_invalida");
  assert.equal(validarPagoCompra({ montoFinal: 100, medioPago: "Efectivo", fechaPago: "2026-08-01" }, c, AHORA).error, "fecha_invalida");
  assert.equal(validarPagoCompra({ montoFinal: 100, medioPago: "Efectivo", fechaPago: "2026-12-30" }, c, AHORA).error, "fecha_invalida");
});

test("Estados de la compra", () => {
  assert.ok(validarTransicionCompra("oferta", "responder").ok);
  assert.ok(!validarTransicionCompra("aceptada", "responder").ok);
  assert.ok(validarTransicionCompra("aceptada", "solicitarPago").ok);
  assert.ok(!validarTransicionCompra("oferta", "solicitarPago").ok);
  assert.ok(validarTransicionCompra("pago_pendiente", "aprobar").ok);
  assert.ok(validarTransicionCompra("pago_pendiente", "rechazarPago").ok);
  assert.ok(!validarTransicionCompra("comprada", "aprobar").ok);
  assert.ok(validarTransicionCompra("comprada", "anular").ok);
  assert.ok(!validarTransicionCompra("oferta", "anular").ok);
  assert.ok(validarTransicionCompra("oferta", "cancelar").ok);
  assert.ok(!validarTransicionCompra("comprada", "cancelar").ok);
});

test("El vehículo comprado entra en preparación, con el costo pagado y el valor de venta esperado", () => {
  const v = vehiculoDeCompra({ monto_final: 5800000, patente: "ABCD12" }, TAS);
  assert.equal(v.estado, "preparacion");
  assert.equal(v.costo, 5800000);
  assert.equal(v.precio_lista, 8500000);
  assert.equal(v.origen, "compra");
  assert.equal(v.color, "Gris");
  assert.equal(vehiculoDeCompra({ monto_final: 1, vehiculo: OFRECIDO }, null).precio_lista, null);
});

test("Contrato de consignación: piso, publicación y plazo", () => {
  const ok = validarConsignacion({ precioPiso: 8000000, precioPublicacion: 8990000, plazoDias: 60, notas: " Llaves en el local " });
  assert.ok(ok.ok);
  assert.equal(ok.value.plazo_dias, 60);
  assert.equal(ok.value.notas, "Llaves en el local");
  assert.equal(validarConsignacion({ precioPiso: 8000000, precioPublicacion: 8990000 }).value.plazo_dias, 90, "plazo por defecto");
  assert.equal(validarConsignacion({ precioPiso: 8000000, precioPublicacion: 7000000 }).error, "publicacion_bajo_piso");
  assert.equal(validarConsignacion({ precioPiso: 0, precioPublicacion: 7000000 }).error, "precio_invalido");
  assert.equal(validarConsignacion({ precioPiso: "x", precioPublicacion: 1 }).error, "precio_invalido");
  assert.equal(validarConsignacion({ precioPiso: 1, precioPublicacion: 1, plazoDias: 5 }).error, "plazo_invalido");
  assert.equal(validarConsignacion({ precioPiso: 1, precioPublicacion: 1, plazoDias: 400 }).error, "plazo_invalido");
});

test("Vencimiento de la consignación y estados", () => {
  assert.equal(vencimientoConsignacion("2026-10-19T15:00:00Z", 30), "2026-11-18");
  assert.equal(diasParaVencer("2026-10-22", AHORA), 4);
  assert.ok(diasParaVencer("2026-10-10", AHORA) < 0);
  assert.equal(diasParaVencer(null, AHORA), null);
  assert.ok(validarTransicionConsignacion("en_validacion", "cancelar").ok);
  assert.ok(!validarTransicionConsignacion("vigente", "cancelar").ok);
  assert.ok(validarTransicionConsignacion("vigente", "devolver").ok);
  assert.ok(!validarTransicionConsignacion("vendida", "devolver").ok);
  assert.ok(validarTransicionConsignacion("vigente", "extender").ok);
  assert.equal(validarExtension({ dias: 30 }).value, 30);
  assert.equal(validarExtension({ dias: 3 }).error, "plazo_invalido");
  assert.equal(validarExtension({ dias: 500 }).error, "plazo_invalido");
});

test("Consignado: vehículo con costo = piso, no se vende bajo el piso y el margen paga la comisión", () => {
  const c = { patente: "ABCD12", vehiculo: OFRECIDO, precio_piso: 8000000, precio_publicacion: 8990000 };
  const v = vehiculoDeConsignacion({ ...c, vehiculo: { ...OFRECIDO, patente: "ABCD12" } });
  assert.equal(v.estado, "disponible");
  assert.equal(v.costo, 8000000);
  assert.equal(v.precio_piso, 8000000);
  assert.equal(v.precio_lista, 8990000);
  assert.equal(v.origen, "consignacion");
  assert.ok(verificarPisoConsignado({ precio_piso: 8000000 }, 8000000).ok);
  assert.equal(verificarPisoConsignado({ precio_piso: 8000000 }, 7999999).error, "bajo_precio_piso");
  assert.ok(verificarPisoConsignado({ precio_piso: null }, 1).ok, "un vehículo normal no tiene piso");
  assert.ok(verificarPisoConsignado(null, 1).ok);
  assert.equal(margenConsignacion(8900000, 8000000), 900000);
});

test("Producción: compras por tramos y consignaciones al 25 % del margen", () => {
  const compras = [
    { ejecutivo_id: "e1", estado: "comprada", mes: "2026-10", monto_final: 5000000 }, { ejecutivo_id: "e1", estado: "comprada", mes: "2026-10", monto_final: 4000000 },
    { ejecutivo_id: "e1", estado: "comprada", mes: "2026-09", monto_final: 1 }, { ejecutivo_id: "e1", estado: "anulada", mes: "2026-10", monto_final: 1 },
    { ejecutivo_id: "e2", estado: "comprada", mes: "2026-10", monto_final: 1 }, { ejecutivo_id: "e1", estado: "oferta", mes: null, monto_final: null },
  ];
  assert.deepEqual(metricasCompras(compras, "e1", "2026-10"), { hechas: 2, montoPagado: 9000000, abiertas: 1 });
  const consig = [
    { ejecutivo_id: "e1", estado: "vendida", mes: "2026-10", precio_venta: 8900000, precio_piso: 8000000 },
    { ejecutivo_id: "e1", estado: "vendida", mes: "2026-09", precio_venta: 1, precio_piso: 1 }, { ejecutivo_id: "e2", estado: "vendida", mes: "2026-10", precio_venta: 1, precio_piso: 1 },
    { ejecutivo_id: "e1", estado: "vigente", mes: null },
  ];
  const filas = filasConsignacion(consig, "e1", "2026-10");
  assert.deepEqual(filas, [{ precioVenta: 8900000, precioPiso: 8000000, descuentos: 0 }]);
  const p = calcularProduccion({ comprasN: 2, consigRows: filas }, tramosEfectivos(null));
  assert.equal(p.compras.total, 2 * 100000, "compras: tramo 1 a 5 = $100.000 c/u");
  assert.equal(p.consignaciones.total, Math.round(900000 * 0.25), "consignaciones: 25 % del margen");
  assert.equal(p.total, 200000 + 225000);
});
