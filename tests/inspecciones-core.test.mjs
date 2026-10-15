import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inspeccionNombre, origenNombre, folioInspeccion, validarFechaHora, validarSolicitudInspeccion, validarReprogramacion,
  resumirInspeccion, veredictoDe, validarResultadoInspeccion, idDeClave, claveEsDe, validarTransicionInspeccion,
  ordenarAgenda, hayChoque, metricasInspector, colaInspecciones, diaChile,
} from "../supabase/functions/api/inspecciones-core.js";

const AHORA = new Date("2026-06-10T15:00:00Z");
const enH = (h) => new Date(AHORA.getTime() + h * 3_600_000).toISOString();
const VEH = { patente: "ab cd-12", marca: "Toyota", modelo: "Yaris", anio: 2018, km: 78000 };
const SECC = [
  { title: "1. Motor", items: [{ id: "a", label: "Ruidos" }, { id: "b", label: "Fugas" }, { id: "c", label: "Batería" }] },
  { title: "2. Frenos", items: [{ id: "d", label: "Frenos" }] },
];

test("Nombres y folio", () => {
  assert.equal(folioInspeccion(7), "INS-000007");
  assert.equal(inspeccionNombre("en_proceso"), "Agendada");
  assert.equal(inspeccionNombre("completada"), "Realizada");
  assert.equal(origenNombre("espontanea"), "Espontánea");
});

test("Fecha y hora: válida, sin pasado lejano ni futuro lejano", () => {
  assert.ok(validarFechaHora(enH(24), AHORA).ok);
  assert.ok(validarFechaHora(enH(-5), AHORA).ok, "hoy más temprano se tolera");
  assert.equal(validarFechaHora("mañana", AHORA).error, "fecha_invalida");
  assert.equal(validarFechaHora(enH(-48), AHORA).error, "fecha_invalida");
  assert.equal(validarFechaHora(enH(24 * 200), AHORA).error, "fecha_invalida");
});

test("Solicitud: vehículo, dirección y fecha obligatorios", () => {
  const ok = validarSolicitudInspeccion({ vehiculo: VEH, direccion: "  Av. Vitacura 1234, Vitacura ", fechaHora: enH(30), contactoLugar: "Sra. Ana 9 1234 5678", notas: "Estacionamiento subterráneo" }, AHORA);
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(ok.value.vehiculo.patente, "ABCD12");
  assert.equal(ok.value.direccion, "Av. Vitacura 1234, Vitacura");
  assert.equal(ok.value.contactoLugar, "Sra. Ana 9 1234 5678");
  assert.equal(validarSolicitudInspeccion({ vehiculo: VEH, direccion: "x", fechaHora: enH(30) }, AHORA).error, "direccion_requerida");
  assert.equal(validarSolicitudInspeccion({ vehiculo: VEH, direccion: "Av. Vitacura 1234", fechaHora: "" }, AHORA).error, "fecha_invalida");
  assert.equal(validarSolicitudInspeccion({ vehiculo: { ...VEH, patente: "1" }, direccion: "Av. Vitacura 1234", fechaHora: enH(30) }, AHORA).error, "patente_invalida");
  assert.equal(validarSolicitudInspeccion(null, AHORA).error, "patente_invalida");
  assert.ok(validarReprogramacion({ direccion: "Otra calle 55", fechaHora: enH(50) }, AHORA).ok);
  assert.equal(validarReprogramacion({ direccion: "", fechaHora: enH(50) }, AHORA).error, "direccion_requerida");
});

test("Resumen del checklist: cuenta estados y destaca lo grave primero", () => {
  const r = resumirInspeccion({
    a: { estado: "Bueno", observacion: "" }, b: { estado: "Malo", observacion: "Pierde aceite" },
    c: { estado: "Regular", observacion: "" }, d: { estado: "", observacion: "Revisar en taller" },
  }, SECC);
  assert.deepEqual([r.buenos, r.regulares, r.malos, r.noAplica, r.sinRevisar], [1, 1, 1, 0, 1]);
  assert.equal(r.destacados.length, 3);
  assert.equal(r.destacados[0].estado, "Malo");
  assert.equal(r.destacados[0].item, "Fugas");
  assert.equal(r.destacados[0].seccion, "1. Motor");
  assert.equal(veredictoDe(r), "con_fallas");
  assert.equal(veredictoDe({ malos: 0, regulares: 1, destacados: [] }), "con_observaciones");
  assert.equal(veredictoDe({ malos: 0, regulares: 0, destacados: [] }), "sin_observaciones");
  assert.deepEqual(resumirInspeccion(null, null).destacados, []);
});

test("Claves de ficha: solo las de la propia persona", () => {
  assert.equal(idDeClave("inspeccion::u1::123"), "123");
  assert.equal(idDeClave("foto::u1::123"), null);
  assert.equal(idDeClave("inspeccion::u1"), null);
  assert.ok(claveEsDe("inspeccion::u1::123", "u1"));
  assert.ok(!claveEsDe("inspeccion::u2::123", "u1"));
  assert.ok(!claveEsDe("inspeccion::u1::12 3", "u1"));
});

test("Resultado: se queda con lo conocido y descarta los datos del propietario", () => {
  const r = validarResultadoInspeccion({
    key: "inspeccion::u1::1700", vehiculo: { patente: "ab-cd12", marca: "Kia", modelo: "Rio", anio: 2019, propietarioNombre: "Juan Pérez", propietarioRun: "1-9" },
    resumen: { buenos: 30, regulares: 2, malos: 1, destacados: [{ seccion: "Motor", item: "Fugas", estado: "Malo", observacion: "Aceite", propietarioNombre: "Juan" }], observaciones: "Todo ok", propietarioRun: "11.111.111-1" },
    fotos: ["abc12345", "../malo", "abc12345", "xyz98765"], propietarioNombre: "Juan Pérez", fecha: "2026-06-10",
  });
  assert.ok(r.ok, JSON.stringify(r));
  const texto = JSON.stringify(r.value);
  assert.ok(!/Juan|11\.111|propietario/i.test(texto), "ningún dato del propietario: " + texto);
  assert.equal(r.value.vehiculo.patente, "ABCD12");
  assert.equal(r.value.resumen.veredicto, "con_fallas");
  assert.deepEqual(r.value.fotos, ["abc12345", "xyz98765"]);
  assert.equal(r.value.fecha, "2026-06-10");
  assert.equal(validarResultadoInspeccion({ key: "tasacion::u1::1", vehiculo: { patente: "ABCD12" } }).error, "inspeccion_invalida");
  assert.equal(validarResultadoInspeccion({ key: "inspeccion::u1::1", vehiculo: { patente: "12" } }).error, "patente_invalida");
  const minimo = validarResultadoInspeccion({ key: "inspeccion::u1::1", vehiculo: { patente: "ABCD12" } });
  assert.ok(minimo.ok);
  assert.equal(minimo.value.resumen.veredicto, "sin_observaciones");
});

test("Estados: qué acciones permite cada uno", () => {
  assert.ok(validarTransicionInspeccion("pendiente", "tomar").ok);
  assert.ok(!validarTransicionInspeccion("en_proceso", "tomar").ok);
  assert.ok(validarTransicionInspeccion("en_proceso", "liberar").ok);
  assert.ok(!validarTransicionInspeccion("pendiente", "liberar").ok);
  assert.ok(validarTransicionInspeccion("pendiente", "asignar").ok && validarTransicionInspeccion("en_proceso", "asignar").ok);
  assert.ok(validarTransicionInspeccion("en_proceso", "completar").ok);
  assert.ok(!validarTransicionInspeccion("completada", "cancelar").ok);
  assert.ok(!validarTransicionInspeccion("cancelada", "reprogramar").ok);
});

test("Agenda del Inspector: orden por fecha, vencidas marcadas, y aviso de choque", () => {
  const f = (id, h, estado = "en_proceso", inspector = "i1") => ({ id, estado, inspector_id: inspector, agendada_para: enH(h) });
  const ag = ordenarAgenda([f("c", 30), f("a", -2), f("b", 5), f("x", 1, "completada")], AHORA);
  assert.deepEqual(ag.map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(ag.map((x) => x.vencida), [true, false, false]);
  const filas = [f("a", 10), f("b", 40, "en_proceso", "i2")];
  assert.ok(hayChoque(filas, "i1", enH(10.5)));
  assert.ok(!hayChoque(filas, "i1", enH(13)), "a más de 90 min no choca");
  assert.ok(!hayChoque(filas, "i1", enH(10), "a"), "ignora la propia");
  assert.ok(!hayChoque(filas, "i1", enH(40)), "otro inspector no cuenta");
  assert.equal(diaChile("2026-06-10T03:00:00Z"), "2026-06-09");
});

test("Métricas del Inspector y cola", () => {
  const ahoraReal = new Date();
  const h = (n) => new Date(ahoraReal.getTime() + n * 3_600_000).toISOString();
  const mes = ahoraReal.toLocaleDateString("en-CA", { timeZone: "America/Santiago" }).slice(0, 7);
  const f = (o) => ({ inspector_id: "i1", estado: "completada", origen: "lead", solicitada_en: h(-10), completada_en: h(-4), resultado: { veredicto: "sin_observaciones" }, ...o });
  const filas = [
    f({}), f({ resultado: { veredicto: "con_fallas" }, solicitada_en: h(-20) }), f({ origen: "espontanea" }),
    f({ completada_en: "2020-05-01T12:00:00Z" }), f({ inspector_id: "i2" }), f({ estado: "en_proceso", completada_en: null }),
  ];
  const m = metricasInspector(filas, "i1", mes);
  assert.equal(m.hechas, 3);
  assert.equal(m.pedidas, 2);
  assert.equal(m.espontaneas, 1);
  assert.equal(m.conFallas, 1);
  assert.equal(m.tiempoMedioHoras, 11, "6 h y 16 h → 11 h; las espontáneas no cuentan");
  assert.equal(m.agendadas, 1);

  const cola = [
    { estado: "pendiente", solicitada_en: h(-2), agendada_para: h(100) }, { estado: "pendiente", solicitada_en: h(-9), agendada_para: h(100) },
    { estado: "pendiente", solicitada_en: h(-1), agendada_para: h(10) }, { estado: "en_proceso", solicitada_en: h(-50), agendada_para: h(1) },
  ];
  const c = colaInspecciones(cola, ahoraReal, 8);
  assert.equal(c.pendientes, 3);
  assert.equal(c.masAntiguaHoras, 9);
  assert.equal(c.atrasadas.length, 2, "una lleva más de 8 h y otra es para dentro de 10 h (menos de 24)");
});
