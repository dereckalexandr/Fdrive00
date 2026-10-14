import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ETAPAS, ETAPAS_ACTIVAS, normalizarPatente, patenteValida, soloDigitos,
  validarVehiculo, ocultarCosto, validarCliente, validarLead, validarCambioEtapa, elegirAsignado,
  calcularCotizacion, cuotaEstimada, validarCotizacion, estadoCotizacionInicial, requiereNuevaAprobacion, validarReserva, reservaVencida, textoVencimiento,
  validarCierre, margenVenta, mesChile, esMes, nombreMes, cierreNombre,
  validarTarea, claseTarea, agruparTareas, contarPorEtapa, leadsPorAtender, puedeEditarLead,
} from "../supabase/functions/api/ventas-core.js";

const VEH = { patente: "ab cd-12", marca: "Toyota", modelo: "Yaris", anio: 2020, km: 45000, precioLista: 9500000, costo: 8000000 };

test("Patente: normaliza y valida los dos formatos chilenos", () => {
  assert.equal(normalizarPatente("ab cd-12"), "ABCD12");
  assert.ok(patenteValida("ABCD12"));
  assert.ok(patenteValida("ab1234"));
  assert.ok(!patenteValida("ABC123"));
  assert.ok(!patenteValida(""));
  assert.equal(soloDigitos("+56 9 1234 5678"), "56912345678");
});

test("Vehículo: alta correcta con valores por defecto", () => {
  const r = validarVehiculo(VEH);
  assert.ok(r.ok);
  assert.equal(r.value.patente, "ABCD12");
  assert.equal(r.value.estado, "disponible");
  assert.equal(r.value.precio_lista, 9500000);
  assert.equal(r.value.transmision, null);
  assert.deepEqual(r.value.fotos, []);
});

test("Vehículo: rechaza datos malos", () => {
  assert.equal(validarVehiculo({ ...VEH, patente: "123" }).error, "patente_invalida");
  assert.equal(validarVehiculo({ ...VEH, marca: "" }).error, "marca_modelo_requeridos");
  assert.equal(validarVehiculo({ ...VEH, anio: 1900 }).error, "anio_invalido");
  assert.equal(validarVehiculo({ ...VEH, anio: "" }).error, "anio_invalido");
  assert.equal(validarVehiculo({ ...VEH, km: -5 }).error, "km_invalido");
  assert.equal(validarVehiculo({ ...VEH, precioLista: "abc" }).error, "precio_invalido");
  assert.equal(validarVehiculo({ ...VEH, estado: "robado" }).error, "estado_invalido");
  assert.equal(validarVehiculo({ ...VEH, transmision: "Cuántica" }).error, "transmision_invalida");
  assert.equal(validarVehiculo({ ...VEH, combustible: "Agua" }).error, "combustible_invalido");
  assert.equal(validarVehiculo(null).error, "patente_invalida");
});

test("Vehículo: fotos solo con ids válidos, sin repetir, máximo 8", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `foto${i}abcdef`);
  const r = validarVehiculo({ ...VEH, fotos: ["../hack", "ok1234ab", "ok1234ab", ...ids] });
  assert.ok(!r.value.fotos.includes("../hack"));
  assert.equal(r.value.fotos.filter((f) => f === "ok1234ab").length, 1);
  assert.equal(r.value.fotos.length, 8);
});

test("El costo del vehículo se oculta a quien no puede editar el inventario", () => {
  const v = { id: 1, patente: "ABCD12", costo: 8000000, precio_lista: 9500000 };
  assert.equal(ocultarCosto(v, false).costo, undefined);
  assert.equal(ocultarCosto(v, false).precio_lista, 9500000);
  assert.equal(ocultarCosto(v, true).costo, 8000000);
});

test("Cliente: validaciones", () => {
  const ok = validarCliente({ nombre: "  Ana   Soto ", rut: "12.345.678-5", telefono: "+56 9 1234 5678", email: "ANA@x.cl" });
  assert.ok(ok.ok);
  assert.equal(ok.value.nombre, "Ana Soto");
  assert.equal(ok.value.rut, "12345678-5");
  assert.equal(ok.value.email, "ana@x.cl");
  assert.equal(validarCliente({ nombre: "A", telefono: "912345678" }).error, "nombre_invalido");
  assert.equal(validarCliente({ nombre: "Ana Soto", rut: "12345678-9", telefono: "912345678" }).error, "rut_invalido");
  assert.equal(validarCliente({ nombre: "Ana Soto", telefono: "123" }).error, "telefono_invalido");
  assert.equal(validarCliente({ nombre: "Ana Soto", email: "no" }).error, "email_invalido");
  assert.equal(validarCliente({ nombre: "Ana Soto" }).error, "contacto_requerido");
  // El RUT es opcional.
  assert.equal(validarCliente({ nombre: "Ana Soto", telefono: "912345678" }).value.rut, null);
});

test("Lead: parte de pago y financiamiento solo se guardan si se marcan", () => {
  const sin = validarLead({ vehiculoInteres: "Un SUV", fuente: "Llamada", parteDePago: { tiene: false, marca: "x" }, financiamiento: { quiere: false, pie: 5 } });
  assert.deepEqual(sin.value.parte_pago, {});
  assert.deepEqual(sin.value.financiamiento, {});

  const con = validarLead({
    parteDePago: { tiene: true, patente: "ab-cd12", marca: "Kia", modelo: "Rio", anio: 2015, km: 90000, valor: 3000000 },
    financiamiento: { quiere: true, pie: 2000000, banco: "Banco X", estado: "por_evaluar" },
  });
  assert.equal(con.value.parte_pago.patente, "ABCD12");
  assert.equal(con.value.parte_pago.valor, 3000000);
  assert.equal(con.value.financiamiento.pie, 2000000);

  assert.equal(validarLead({ parteDePago: { tiene: true, anio: 1800 } }).error, "parte_pago_invalida");
  assert.equal(validarLead({ parteDePago: { tiene: true, patente: "123" } }).error, "patente_invalida");
  assert.equal(validarLead({ financiamiento: { quiere: true, estado: "inventado" } }).error, "financiamiento_invalido");
});

test("Etapas: solo se puede mover a las disponibles; perder exige motivo", () => {
  assert.deepEqual(ETAPAS_ACTIVAS, ["nuevo", "contactado", "seguimiento", "cotizado", "reservado", "ganado", "perdido"]);
  assert.equal(ETAPAS.length, 7);
  assert.equal(validarCambioEtapa({ desde: "nuevo", hacia: "ganado" }).error, "etapa_automatica", "'Cerrado ganado' solo lo pone el cierre de venta");
  assert.equal(validarCambioEtapa({ desde: "ganado", hacia: "seguimiento", puedeReabrir: true }).error, "venta_cerrada", "una venta cerrada solo se revierte anulando el cierre");
  assert.equal(validarCambioEtapa({ desde: "nuevo", hacia: "cotizado" }).error, "etapa_automatica", "cotizado y reservado cambian solos");
  assert.equal(validarCambioEtapa({ desde: "nuevo", hacia: "reservado" }).error, "etapa_automatica");
  assert.equal(validarCambioEtapa({ desde: "nuevo", hacia: "nuevo" }).error, "sin_cambio");
  assert.equal(validarCambioEtapa({ desde: "nuevo", hacia: "perdido" }).error, "motivo_requerido");
  const perder = validarCambioEtapa({ desde: "seguimiento", hacia: "perdido", motivo: "Precio" });
  assert.deepEqual(perder.value, { etapa: "perdido", motivo_perdida: "Precio" });
  // Al volver a una etapa abierta se limpia el motivo.
  assert.equal(validarCambioEtapa({ desde: "perdido", hacia: "seguimiento", puedeReabrir: true }).value.motivo_perdida, null);
});

test("Un lead cerrado solo lo reabre el supervisor", () => {
  assert.equal(validarCambioEtapa({ desde: "perdido", hacia: "contactado" }).error, "lead_cerrado");
  assert.ok(validarCambioEtapa({ desde: "perdido", hacia: "contactado", puedeReabrir: true }).ok);
});

test("Reparto rotativo: quien nunca recibió, luego quien lleva más tiempo", () => {
  const c = [{ id: "b", nombre: "B" }, { id: "a", nombre: "A" }, { id: "c", nombre: "C" }];
  assert.equal(elegirAsignado(c, {}).id, "a", "todos nuevos: desempate estable por id");
  assert.equal(elegirAsignado(c, { a: "2026-10-01T10:00:00Z", b: "2026-10-02T10:00:00Z" }).id, "c", "c nunca recibió");
  assert.equal(elegirAsignado(c, { a: "2026-10-03T10:00:00Z", b: "2026-10-01T10:00:00Z", c: "2026-10-02T10:00:00Z" }).id, "b");
  assert.equal(elegirAsignado([], {}), null);
  assert.equal(elegirAsignado(null, {}), null);
});

test("Reparto rotativo: repartidos varios leads seguidos quedan parejos", () => {
  const c = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const ultima = {};
  const cuenta = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 9; i++) {
    const quien = elegirAsignado(c, ultima);
    ultima[quien.id] = new Date(Date.UTC(2026, 9, 1, 10, i)).toISOString();
    cuenta[quien.id]++;
  }
  assert.deepEqual(cuenta, { a: 3, b: 3, c: 3 });
});

test("Tareas: validación", () => {
  const ok = validarTarea({ titulo: "  Llamar   a Ana ", tipo: "llamada", venceEn: "2026-10-14T15:00:00Z" });
  assert.ok(ok.ok);
  assert.equal(ok.value.titulo, "Llamar a Ana");
  assert.equal(validarTarea({ titulo: "ab", venceEn: "2026-10-14T15:00:00Z" }).error, "titulo_invalido");
  assert.equal(validarTarea({ titulo: "Llamar", tipo: "magia", venceEn: "2026-10-14T15:00:00Z" }).error, "tipo_invalido");
  assert.equal(validarTarea({ titulo: "Llamar", venceEn: "mañana" }).error, "fecha_invalida");
});

test("Tareas: vencida, hoy o próxima según el día en Chile", () => {
  const ahora = new Date("2026-10-14T15:00:00Z"); // 12:00 en Santiago (UTC-3 en octubre)
  assert.equal(claseTarea("2026-10-14T20:00:00Z", ahora), "hoy");
  assert.equal(claseTarea("2026-10-13T10:00:00Z", ahora), "vencida");
  assert.equal(claseTarea("2026-10-15T14:00:00Z", ahora), "proxima");
  // 02:00 UTC del día 15 es todavía el 14 por la noche en Chile: sigue siendo "hoy".
  assert.equal(claseTarea("2026-10-15T02:00:00Z", ahora), "hoy");
});

test("Tareas: se agrupan y ordenan, y las hechas no aparecen", () => {
  const ahora = new Date("2026-10-14T15:00:00Z");
  const g = agruparTareas([
    { id: 1, vence_en: "2026-10-14T22:00:00Z" }, { id: 2, vence_en: "2026-10-14T13:00:00Z" },
    { id: 3, vence_en: "2026-10-12T13:00:00Z" }, { id: 4, vence_en: "2026-10-20T13:00:00Z" },
    { id: 5, vence_en: "2026-10-14T13:00:00Z", hecha: true },
  ], ahora);
  assert.deepEqual(g.vencidas.map((t) => t.id), [3]);
  assert.deepEqual(g.hoy.map((t) => t.id), [2, 1]);
  assert.deepEqual(g.proximas.map((t) => t.id), [4]);
});

test("Embudo: conteos por etapa y leads por atender", () => {
  const leads = [
    { etapa: "nuevo", ultimo_contacto: null }, { etapa: "nuevo", ultimo_contacto: "2026-10-01T00:00:00Z" },
    { etapa: "contactado" }, { etapa: "perdido" }, { etapa: "rara" },
  ];
  const c = contarPorEtapa(leads);
  assert.equal(c.nuevo, 2); assert.equal(c.contactado, 1); assert.equal(c.perdido, 1); assert.equal(c.ganado, 0);
  assert.equal(leadsPorAtender(leads).length, 1);
});

test("Permiso para editar un lead: dueño habilitado para ventas, o supervisor", () => {
  const lead = { asignado_a: "u1" };
  const base = { esAdmin: false, lead };
  assert.ok(puedeEditarLead({ ...base, usuarioId: "u1", permisos: ["leads.propios", "ventas.operar"] }));
  assert.ok(!puedeEditarLead({ ...base, usuarioId: "u1", permisos: ["leads.propios"] }), "sin habilitación de ventas");
  assert.ok(!puedeEditarLead({ ...base, usuarioId: "u2", permisos: ["leads.propios", "ventas.operar"] }), "lead ajeno");
  assert.ok(!puedeEditarLead({ ...base, usuarioId: "u2", permisos: ["leads.local"] }), "ver el local no es modificar");
  assert.ok(puedeEditarLead({ ...base, usuarioId: "u2", permisos: ["leads.asignar"] }));
  assert.ok(puedeEditarLead({ ...base, esAdmin: true, usuarioId: "master", permisos: [] }));
});

const LISTA = 9500000;
const FIN = { quiere: true, pie: 2000000, banco: "Banco X", estado: "por_evaluar", plazoMeses: 36, tasaMensualPct: 1 };
const PP = { tiene: true, patente: "AB1234", marca: "Kia", modelo: "Rio", anio: 2015, km: 90000, valor: 3000000 };

test("Cuota estimada: con y sin interés", () => {
  assert.equal(cuotaEstimada(1200000, 12, 0), 100000);
  // La cuota es correcta si, pagándola cada mes con su interés, el crédito queda saldado.
  const cuota = cuotaEstimada(10000000, 48, 1.2);
  let saldo = 10000000;
  for (let i = 0; i < 48; i++) saldo = saldo * 1.012 - cuota;
  assert.ok(Math.abs(saldo) < 100, `saldo final ${saldo}`);
  assert.equal(cuota, 275276);
  assert.equal(cuotaEstimada(0, 12, 1), 0);
  assert.equal(cuotaEstimada(1000000, 0, 1), 0);
});

test("Cotización: precio final, parte de pago, pie, saldo y cuota", () => {
  const c = calcularCotizacion({ precioLista: LISTA, descuento: 300000, parteDePago: PP, financiamiento: FIN });
  assert.equal(c.precioFinal, 9200000);
  assert.equal(c.descuentoPct, 3.2);
  assert.equal(c.parte, 3000000);
  assert.equal(c.saldo, 6200000);
  assert.equal(c.montoFinanciar, 4200000);
  assert.equal(c.cuota, cuotaEstimada(4200000, 36, 1));
  assert.equal(c.excede, false);
  // Sin financiamiento ni parte de pago: todo es saldo y no hay cuota.
  const simple = calcularCotizacion({ precioLista: LISTA, descuento: 0, parteDePago: {}, financiamiento: {} });
  assert.deepEqual([simple.precioFinal, simple.saldo, simple.montoFinanciar, simple.cuota], [LISTA, LISTA, 0, 0]);
  // La parte de pago más el pie no pueden superar el precio.
  assert.equal(calcularCotizacion({ precioLista: 5000000, descuento: 0, parteDePago: { tiene: true, valor: 4000000 }, financiamiento: { quiere: true, pie: 2000000 } }).excede, true);
});

test("Cotización: validación de lo que ingresa la persona", () => {
  const ok = validarCotizacion({ descuento: 300000, parteDePago: PP, financiamiento: FIN, notas: " hola " }, LISTA);
  assert.ok(ok.ok);
  assert.equal(ok.value.precio_lista, LISTA, "el precio de lista lo fija el servidor");
  assert.equal(ok.value.precio_final, 9200000);
  assert.equal(ok.value.financiamiento.plazo_meses, 36);
  assert.equal(ok.value.parte_pago.patente, "AB1234");
  assert.equal(validarCotizacion({}, LISTA).value.descuento, 0);

  assert.equal(validarCotizacion({ descuento: -1 }, LISTA).error, "descuento_invalido");
  assert.equal(validarCotizacion({ descuento: LISTA + 1 }, LISTA).error, "descuento_invalido");
  assert.equal(validarCotizacion({ descuento: "abc" }, LISTA).error, "descuento_invalido");
  assert.equal(validarCotizacion({}, null).error, "vehiculo_sin_precio");
  assert.equal(validarCotizacion({}, 0).error, "vehiculo_sin_precio");
  assert.equal(validarCotizacion({ financiamiento: { ...FIN, plazoMeses: 0 } }, LISTA).error, "financiamiento_invalido");
  assert.equal(validarCotizacion({ financiamiento: { ...FIN, tasaMensualPct: 50 } }, LISTA).error, "financiamiento_invalido");
  assert.equal(validarCotizacion({ parteDePago: { ...PP, valor: 9000000 }, financiamiento: FIN }, LISTA).error, "pago_excede_precio");
});

test("Descuentos: sin descuento o aprobado por quien puede, vigente; si no, espera aprobación", () => {
  assert.equal(estadoCotizacionInicial({ descuento: 0, puedeAprobar: false }), "vigente");
  assert.equal(estadoCotizacionInicial({ descuento: 1, puedeAprobar: false }), "pendiente");
  assert.equal(estadoCotizacionInicial({ descuento: 1, puedeAprobar: true }), "vigente");
});

test("Editar una cotización: vuelve a aprobación solo si cambia el descuento o el precio", () => {
  const aprobada = { descuento: 300000, precio_lista: LISTA, estado: "vigente" };
  assert.equal(requiereNuevaAprobacion(aprobada, { descuento: 300000, precio_lista: LISTA }), false, "cambiar la parte de pago no la reabre");
  assert.equal(requiereNuevaAprobacion(aprobada, { descuento: 400000, precio_lista: LISTA }), true);
  assert.equal(requiereNuevaAprobacion(aprobada, { descuento: 300000, precio_lista: LISTA + 1 }), true, "cambió el precio de lista");
  assert.equal(requiereNuevaAprobacion(aprobada, { descuento: 0, precio_lista: LISTA }), false, "sin descuento no hay qué aprobar");
  assert.equal(requiereNuevaAprobacion({ ...aprobada, estado: "rechazada" }, { descuento: 300000, precio_lista: LISTA }), true, "una rechazada no se aprueba sola");
  assert.equal(requiereNuevaAprobacion({ ...aprobada, estado: "pendiente" }, { descuento: 300000, precio_lista: LISTA }), true);
});

test("Reserva: monto, días y medio de pago", () => {
  const ok = validarReserva({ monto: 500000, dias: 5, medioPago: "Transferencia", notas: " ok " }, { precioFinal: 9200000 });
  assert.deepEqual(ok.value, { monto: 500000, dias: 5, medio_pago: "Transferencia", notas: "ok" });
  assert.equal(validarReserva({ monto: 500000 }, { diasDefecto: 3 }).value.dias, 3, "usa los días de la configuración");
  assert.equal(validarReserva({ monto: 0 }, {}).error, "monto_invalido");
  assert.equal(validarReserva({ monto: "x" }, {}).error, "monto_invalido");
  assert.equal(validarReserva({ monto: 9300000 }, { precioFinal: 9200000 }).error, "monto_invalido", "no puede superar el precio");
  assert.equal(validarReserva({ monto: 1, dias: 99 }, {}).error, "dias_invalidos");
  assert.equal(validarReserva({ monto: 1, medioPago: "Trueque" }, {}).error, "medio_invalido");
});

test("Reserva: vencimiento y su texto", () => {
  const ahora = new Date("2026-10-14T12:00:00Z");
  assert.equal(reservaVencida({ estado: "activa", vence_en: "2026-10-14T11:00:00Z" }, ahora), true);
  assert.equal(reservaVencida({ estado: "activa", vence_en: "2026-10-14T13:00:00Z" }, ahora), false);
  assert.equal(reservaVencida({ estado: "cancelada", vence_en: "2026-10-01T00:00:00Z" }, ahora), false, "una cerrada no se vuelve a vencer");
  assert.equal(textoVencimiento("2026-10-14T11:00:00Z", ahora), "vencida");
  assert.equal(textoVencimiento("2026-10-14T17:00:00Z", ahora), "vence en 5 h");
  assert.equal(textoVencimiento("2026-10-17T12:00:00Z", ahora), "vence en 3 d");
});

const AHORA = new Date("2026-10-14T15:00:00Z");
const CIERRE = { precioFinal: 9200000, montoParteDePago: 3000000, montoFinanciado: 4000000, financiera: "Autofin", comisionFinanciera: 600000, seguro: true, fechaEntrega: "2026-10-20", notas: " listo " };

test("Cierre de venta: datos correctos", () => {
  const r = validarCierre(CIERRE, AHORA);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value, {
    precio_final: 9200000, monto_parte_pago: 3000000, monto_financiado: 4000000, financiera: "Autofin", comision_financiera: 600000,
    seguro: true, fecha_entrega: "2026-10-20", notas: "listo",
  });
  // Venta al contado: sin financiera ni comisión, y el seguro es opcional.
  const contado = validarCierre({ precioFinal: 9200000, fechaEntrega: "2026-10-14" }, AHORA);
  assert.deepEqual([contado.value.financiera, contado.value.comision_financiera, contado.value.seguro, contado.value.monto_financiado], [null, 0, false, 0]);
});

test("Cierre de venta: rechaza datos incoherentes", () => {
  const mal = (cambio) => validarCierre({ ...CIERRE, ...cambio }, AHORA).error;
  assert.equal(mal({ precioFinal: 0 }), "precio_cierre_invalido");
  assert.equal(mal({ precioFinal: "abc" }), "precio_cierre_invalido");
  assert.equal(mal({ montoParteDePago: -1 }), "pagos_invalidos");
  assert.equal(mal({ montoParteDePago: 6000000 }), "pagos_exceden_precio", "parte de pago + financiado no pueden superar el precio");
  assert.equal(mal({ financiera: "" }), "financiera_requerida");
  assert.equal(mal({ financiera: "Banco inventado" }), "financiera_requerida");
  assert.equal(mal({ comisionFinanciera: -5 }), "comision_invalida");
  assert.equal(mal({ fechaEntrega: "" }), "fecha_entrega_invalida");
  assert.equal(mal({ fechaEntrega: "20-10-2026" }), "fecha_entrega_invalida");
  assert.equal(mal({ fechaEntrega: "2026-02-30" }), "fecha_entrega_invalida", "fecha que no existe");
  assert.equal(mal({ fechaEntrega: "2025-01-01" }), "fecha_entrega_invalida", "demasiado antigua");
  assert.equal(mal({ fechaEntrega: "2028-01-01" }), "fecha_entrega_invalida", "demasiado lejana");
  assert.equal(validarCierre(null, AHORA).error, "precio_cierre_invalido");
});

test("Cierre de venta: sin financiamiento no se exige financiera aunque venga una", () => {
  const r = validarCierre({ ...CIERRE, montoFinanciado: 0, financiera: "", comisionFinanciera: 999 }, AHORA);
  assert.ok(r.ok);
  assert.equal(r.value.comision_financiera, 0, "sin crédito no hay comisión de financiera");
});

test("Meses según el día en Chile y margen de la venta", () => {
  assert.equal(mesChile(new Date("2026-10-14T15:00:00Z")), "2026-10");
  assert.equal(mesChile(new Date("2026-11-01T01:30:00Z")), "2026-10", "01:30 UTC del 1 de noviembre aún es 31 de octubre en Chile");
  assert.ok(esMes("2026-10") && !esMes("2026-13") && !esMes("26-10") && !esMes(null));
  assert.equal(nombreMes("2026-10"), "octubre 2026");
  assert.equal(nombreMes("x"), "");
  assert.equal(margenVenta(9200000, 8000000), 1200000);
  assert.equal(margenVenta(9200000, null), null);
  assert.equal(cierreNombre("pendiente"), "Esperando aprobación");
});
