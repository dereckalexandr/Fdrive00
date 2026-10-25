import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tasacionNombre, folioTasacion, validarVehiculoTasacion, validarSolicitudTasacion, validarTasacionDirecta,
  limpiarEstimacion, limpiarInspeccionRef, validarBorradorTasacion, validarCompletarTasacion, validarTransicionTasacion,
  topeParteDePago, verificarTopeParteDePago, fusionarParteDePago, metricasTasador, colaTasaciones,
} from "../supabase/functions/api/tasaciones-core.js";

const VEH = { patente: "ab cd-12", marca: "Toyota", modelo: "Yaris", anio: 2018, km: 78000, version: "1.5 GLI", color: "Gris", transmision: "Automática", combustible: "Bencina" };

test("Folio y nombres de estado", () => {
  assert.equal(folioTasacion(12), "TAS-000012");
  assert.equal(tasacionNombre("pendiente"), "Por tomar");
  assert.equal(tasacionNombre("en_proceso"), "En proceso");
});

test("Vehículo a tasar: datos correctos y normalizados", () => {
  const r = validarVehiculoTasacion(VEH);
  assert.ok(r.ok);
  assert.equal(r.value.patente, "ABCD12");
  assert.equal(r.value.km, 78000);
  assert.equal(r.value.transmision, "Automática");
  const minimo = validarVehiculoTasacion({ patente: "ab1234", marca: "Kia", modelo: "Rio", anio: 2015, km: 0 });
  assert.ok(minimo.ok);
  assert.equal(minimo.value.version, null);
});

test("Vehículo a tasar: rechaza datos malos", () => {
  const mal = (c) => validarVehiculoTasacion({ ...VEH, ...c }).error;
  assert.equal(mal({ patente: "123" }), "patente_invalida");
  assert.equal(mal({ marca: "" }), "marca_modelo_requeridos");
  assert.equal(mal({ anio: 1900 }), "anio_invalido");
  assert.equal(mal({ anio: "" }), "anio_invalido");
  assert.equal(mal({ km: "" }), "km_invalido", "el kilometraje es obligatorio");
  assert.equal(mal({ km: -1 }), "km_invalido");
  assert.equal(mal({ transmision: "Cuántica" }), "transmision_invalida");
  assert.equal(mal({ combustible: "Agua" }), "combustible_invalido");
  assert.equal(validarVehiculoTasacion(null).error, "patente_invalida");
});

test("Solicitud de un ejecutivo y tasación directa", () => {
  const s = validarSolicitudTasacion({ vehiculo: VEH, notas: "  El cliente quiere $5.000.000  " });
  assert.equal(s.value.notas, "El cliente quiere $5.000.000");
  assert.equal(validarSolicitudTasacion({ vehiculo: { ...VEH, patente: "x" } }).error, "patente_invalida");

  const d = validarTasacionDirecta({ vehiculo: VEH, contacto: { nombre: "  Pedro  Soto ", telefono: "+56 9 1234 5678" } });
  assert.deepEqual(d.value.contacto, { nombre: "Pedro Soto", telefono: "+56 9 1234 5678" });
  assert.deepEqual(validarTasacionDirecta({ vehiculo: VEH }).value.contacto, {}, "el contacto es opcional");
  assert.equal(validarTasacionDirecta({ vehiculo: VEH, contacto: { nombre: "Al" } }).error, "nombre_invalido");
  assert.equal(validarTasacionDirecta({ vehiculo: VEH, contacto: { telefono: "123" } }).error, "telefono_invalido");
});

test("Estimación de Chileautos: solo se guardan los datos conocidos y limpios", () => {
  const e = limpiarEstimacion({
    promedio: 8500000.4, publicacion: 9000000, compra: 6500000, margenBruto: 2000000, nAvisos: 5, nValidos: 12, nDescartados: 3,
    anioMin: 2017, anioMax: 2019, kmMax: 93600, transmision: "automatica", combustible: "bencina",
    url: "https://www.chileautos.cl/vehiculos/?q=abc", capturadaEn: "2026-10-14T15:00:00Z", hackeo: "<script>", __proto__: { x: 1 },
    avisos: [{ titulo: "Toyota Yaris 2018", anio: 2018, km: 70000, precio: 8000000, href: "/vehiculos/detalles/abc" }, { titulo: "x".repeat(200), href: "https://malo.com" }],
  });
  assert.equal(e.promedio, 8500000);
  assert.equal(e.compra, 6500000);
  assert.equal(e.hackeo, undefined);
  assert.equal(e.url, "https://www.chileautos.cl/vehiculos/?q=abc");
  assert.equal(e.avisos[0].href, "/vehiculos/detalles/abc");
  assert.equal(e.avisos[1].titulo.length, 80);
  assert.equal(e.avisos[1].href, null, "un enlace a otro sitio se descarta");
  assert.equal(limpiarEstimacion({ url: "https://malo.com/x" }).url, undefined);
  assert.equal(limpiarEstimacion({ promedio: -5 }).promedio, undefined);
  assert.deepEqual(limpiarEstimacion(null), {});
  assert.deepEqual(limpiarEstimacion("texto"), {});
  assert.equal(limpiarEstimacion({ avisos: Array.from({ length: 9 }, () => ({ titulo: "a" })) }).avisos.length, 5);
});

test("Inspección vinculada: solo la clave y datos del vehículo, nunca del propietario", () => {
  const ok = limpiarInspeccionRef({ key: "inspeccion::ABC123::xyz789", fecha: "2026-10-06", inspector: "Beto", patente: "ab-cd12", marca: "Toyota", modelo: "Yaris", anio: 2018, propietarioNombre: "Juan", propietarioRun: "12.345.678-5" });
  assert.equal(ok.key, "inspeccion::ABC123::xyz789");
  assert.equal(ok.patente, "ABCD12");
  assert.equal(ok.propietarioNombre, undefined);
  assert.equal(ok.propietarioRun, undefined);
  assert.deepEqual(limpiarInspeccionRef({ key: "vendors" }), {}, "no se puede vincular cualquier registro del almacenamiento");
  assert.deepEqual(limpiarInspeccionRef({ key: "admin_auth" }), {});
  assert.deepEqual(limpiarInspeccionRef({ key: "inspeccion::../x::y" }), {});
  assert.deepEqual(limpiarInspeccionRef(null), {});
});

test("Borrador: todo opcional, pero lo que llega debe ser válido", () => {
  assert.deepEqual(validarBorradorTasacion({}).value, {});
  const b = validarBorradorTasacion({ valorCompra: "6500000", valorVenta: 8500000, observaciones: "  Pintura nueva  ", fotos: ["abcdef12", "abcdef12", "../x", "ok1234ab"], vehiculo: VEH });
  assert.equal(b.value.valor_compra, 6500000);
  assert.equal(b.value.valor_venta, 8500000);
  assert.equal(b.value.observaciones, "Pintura nueva");
  assert.deepEqual(b.value.fotos, ["abcdef12", "ok1234ab"]);
  assert.equal(b.value.vehiculo.patente, "ABCD12");
  assert.equal(validarBorradorTasacion({ valorCompra: "abc" }).error, "valor_compra_invalido");
  assert.equal(validarBorradorTasacion({ valorVenta: -1 }).error, "valor_venta_invalido");
  assert.equal(validarBorradorTasacion({ vehiculo: { ...VEH, patente: "1" } }).error, "patente_invalida");
  assert.equal(validarBorradorTasacion({ fotos: Array.from({ length: 12 }, (_, i) => `foto${i}abcd`) }).value.fotos.length, 6);
  assert.deepEqual(validarBorradorTasacion({ estimacion: null }).value.estimacion, {});
});

test("Completar: valor de compra y de venta obligatorios, y la venta no puede ser menor", () => {
  const ok = validarCompletarTasacion({ valor_compra: 6500000, valor_venta: 8500000 });
  assert.deepEqual(ok.value, { valor_compra: 6500000, valor_venta: 8500000, margen_esperado: 2000000 });
  assert.ok(validarCompletarTasacion({ valor_compra: 5, valor_venta: 5 }).ok, "igual no es menor");
  assert.equal(validarCompletarTasacion({ valor_venta: 8500000 }).error, "valor_compra_invalido");
  assert.equal(validarCompletarTasacion({ valor_compra: 0, valor_venta: 1 }).error, "valor_compra_invalido");
  assert.equal(validarCompletarTasacion({ valor_compra: 6500000 }).error, "valor_venta_invalido");
  assert.equal(validarCompletarTasacion({ valor_compra: 6500000, valor_venta: 6000000 }).error, "valor_venta_menor");
  assert.equal(validarCompletarTasacion(null).error, "valor_compra_invalido");
});

test("Estados: qué acción se permite en cada uno", () => {
  assert.ok(validarTransicionTasacion("pendiente", "tomar").ok);
  assert.ok(!validarTransicionTasacion("en_proceso", "tomar").ok);
  assert.ok(validarTransicionTasacion("en_proceso", "liberar").ok);
  assert.ok(!validarTransicionTasacion("pendiente", "liberar").ok);
  assert.ok(validarTransicionTasacion("en_proceso", "completar").ok);
  assert.ok(!validarTransicionTasacion("pendiente", "completar").ok, "primero hay que tomarla");
  assert.ok(!validarTransicionTasacion("completada", "completar").ok);
  assert.ok(!validarTransicionTasacion("completada", "guardar").ok, "una tasación completada no se edita");
  assert.ok(validarTransicionTasacion("pendiente", "cancelar").ok && validarTransicionTasacion("en_proceso", "cancelar").ok);
  assert.ok(!validarTransicionTasacion("completada", "cancelar").ok && !validarTransicionTasacion("cancelada", "cancelar").ok);
  assert.ok(!validarTransicionTasacion("pendiente", "inventada").ok);
});

test("Tope del vehículo en parte de pago: lo tasado se puede bajar pero no subir", () => {
  assert.equal(topeParteDePago({ estado: "completada", valor_compra: 6500000 }), 6500000);
  assert.equal(topeParteDePago({ estado: "en_proceso", valor_compra: 6500000 }), null, "mientras no esté completada no hay tope");
  assert.equal(topeParteDePago(null), null);
  const pp = (valor) => ({ tiene: true, valor });
  assert.ok(verificarTopeParteDePago(pp(6500000), 6500000).ok);
  assert.ok(verificarTopeParteDePago(pp(5000000), 6500000).ok, "negociar a la baja es válido");
  assert.equal(verificarTopeParteDePago(pp(6500001), 6500000).error, "parte_pago_excede_tasacion");
  assert.ok(verificarTopeParteDePago(pp(9999999), null).ok, "sin tasación no hay tope");
  assert.ok(verificarTopeParteDePago({ tiene: false, valor: 99999999 }, 6500000).ok, "si ya no entrega el vehículo, no aplica");
});

test("Editar la parte de pago conserva el vínculo con la tasación", () => {
  const actual = { tiene: true, valor: 6500000, tasacion_id: "t1" };
  assert.deepEqual(fusionarParteDePago(actual, { tiene: true, valor: 6000000, marca: "Toyota" }), { tiene: true, valor: 6000000, marca: "Toyota", tasacion_id: "t1" });
  assert.deepEqual(fusionarParteDePago(actual, { tiene: false }), { tiene: false }, "si ya no entrega el vehículo, se suelta");
  assert.deepEqual(fusionarParteDePago({ tiene: true }, { tiene: true, valor: 1 }), { tiene: true, valor: 1 });
  assert.deepEqual(fusionarParteDePago(actual, null), {});
});

const T = (extra) => ({ tasador_id: "t1", estado: "completada", solicitada_en: "2026-10-10T12:00:00Z", completada_en: "2026-10-10T16:00:00Z", valor_compra: 6000000, valor_venta: 7500000, ...extra });

test("Métricas del Tasador: hechas en el mes, tiempo medio y margen esperado", () => {
  const lista = [
    T(), T({ completada_en: "2026-10-12T12:00:00Z", valor_venta: 7000000 }),              // 4 h y 48 h
    T({ tasador_id: "t2" }),                                                                // de otro tasador
    T({ completada_en: "2026-09-20T12:00:00Z", solicitada_en: "2026-09-20T10:00:00Z" }),     // otro mes
    T({ estado: "en_proceso", completada_en: null }),
  ];
  const m = metricasTasador(lista, "t1", "2026-10");
  assert.equal(m.hechas, 2);
  assert.equal(m.tiempoMedioHoras, 26);
  assert.equal(m.enProceso, 1);
  assert.equal(m.valorCompraTotal, 12000000);
  assert.equal(m.margenEsperadoMedio, 1250000);
  assert.equal(metricasTasador(lista, "t1", "2026-09").hechas, 1);
  assert.deepEqual(metricasTasador([], "t1", "2026-10"), { hechas: 0, tiempoMedioHoras: 0, enProceso: 0, valorCompraTotal: 0, margenEsperadoMedio: 0 });
});

test("Cola de solicitudes: cuántas esperan y cuáles ya pasaron el plazo", () => {
  const ahora = new Date("2026-10-14T18:00:00Z");
  const hace = (h) => new Date(ahora.getTime() - h * 3_600_000).toISOString();
  const c = colaTasaciones([
    { id: "a", estado: "pendiente", solicitada_en: hace(10) }, { id: "b", estado: "pendiente", solicitada_en: hace(2) },
    { id: "c", estado: "en_proceso", solicitada_en: hace(50) }, { id: "d", estado: "completada", solicitada_en: hace(80) },
  ], ahora, 8);
  assert.equal(c.pendientes, 2);
  assert.equal(c.masAntiguaHoras, 10);
  assert.deepEqual(c.atrasadas.map((t) => t.id), ["a"]);
  assert.deepEqual(colaTasaciones([], ahora, 8), { pendientes: 0, masAntiguaHoras: 0, atrasadas: [] });
});

test("Completar con decisión del Tasador: compra, consignación, no aplica y retoma", () => {
  const e = (o) => validarCompletarTasacion(o).error;
  // Retoma (parte de pago): el valor de retoma manda y queda también como valor de compra.
  const rt = validarCompletarTasacion({ tipo: "parte_pago", valor_retoma: 5000000, valor_venta: 6000000 });
  assert.deepEqual([rt.ok, rt.value.valor_compra, rt.value.valor_retoma, rt.value.margen_esperado], [true, 5000000, 5000000, 1000000]);
  assert.equal(validarCompletarTasacion({ tipo: "parte_pago", valor_compra: 5000000, valor_venta: 6000000 }).value.valor_retoma, 5000000, "tasaciones en proceso de antes: se toma el valor de compra");
  assert.equal(e({ tipo: "parte_pago", valor_venta: 6000000 }), "valor_retoma_invalido");
  assert.equal(e({ tipo: "parte_pago", valor_retoma: 7000000, valor_venta: 6000000 }), "valor_venta_menor");
  // Las demás: hay que decidir.
  assert.equal(e({ tipo: "directa", valor_compra: 5000000, valor_venta: 6000000 }), "aplica_para_requerido");
  const c = validarCompletarTasacion({ tipo: "directa", aplica_para: "compra", valor_compra: 5000000, valor_venta: 6000000, valor_retoma: 4800000 });
  assert.deepEqual([c.value.aplica_para, c.value.valor_compra, c.value.valor_retoma, c.value.valor_consignacion], ["compra", 5000000, 4800000, null]);
  assert.equal(e({ tipo: "directa", aplica_para: "compra", valor_compra: 5000000 }), "valor_venta_invalido");
  const k = validarCompletarTasacion({ tipo: "directa", aplica_para: "consignacion", valor_consignacion: 7000000 });
  assert.deepEqual([k.ok, k.value.aplica_para, k.value.valor_consignacion, k.value.valor_compra], [true, "consignacion", 7000000, null]);
  assert.equal(e({ tipo: "directa", aplica_para: "consignacion" }), "valor_consignacion_invalido");
  const n = validarCompletarTasacion({ tipo: "directa", aplica_para: "ninguna", observaciones: "Siniestro grave" });
  assert.deepEqual([n.ok, n.value.aplica_para, n.value.valor_compra], [true, "ninguna", null]);
  assert.equal(e({ tipo: "directa", aplica_para: "ninguna" }), "motivo_no_aplica_requerido");
  // El borrador acepta los nuevos campos y rechaza una decisión inválida.
  const b = validarBorradorTasacion({ valorConsignacion: 7000000, valorRetoma: 4800000, aplicaPara: "consignacion" });
  assert.deepEqual([b.value.valor_consignacion, b.value.valor_retoma, b.value.aplica_para], [7000000, 4800000, "consignacion"]);
  assert.equal(validarBorradorTasacion({ aplicaPara: "x" }).error, "aplica_para_invalido");
});
