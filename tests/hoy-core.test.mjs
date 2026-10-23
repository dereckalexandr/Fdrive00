import { test } from "node:test";
import assert from "node:assert/strict";
import { clasificarLeadHoy, ordenarHoy, faltaProximaAccion, GRUPOS_HOY } from "../supabase/functions/api/ventas-core.js";

// 21-oct-2026, 15:00 en Chile (UTC-3 en esa fecha) = 18:00Z
const AHORA = new Date("2026-10-21T18:00:00Z");
const h = (horas) => new Date(AHORA.getTime() + horas * 3_600_000).toISOString();
const lead = (o = {}) => ({ id: "l1", etapa: "contactado", creado_en: h(-72), ultimo_contacto: h(-48), ...o });
const tarea = (horas, o = {}) => ({ id: "t" + horas, vence_en: h(horas), hecha: false, ...o });
const grupo = (l, tareas = [], extra = {}) => clasificarLeadHoy({ lead: l, tareas, ahora: AHORA, ...extra }).grupo;

test("Un lead cerrado no aparece en «Hoy»", () => {
  assert.equal(clasificarLeadHoy({ lead: lead({ etapa: "ganado" }), ahora: AHORA }), null);
  assert.equal(clasificarLeadHoy({ lead: lead({ etapa: "perdido" }), ahora: AHORA }), null);
  assert.equal(clasificarLeadHoy({ lead: null, ahora: AHORA }), null);
});

test("Primer contacto: dentro del plazo es «recién llegado»; pasado el plazo, «sin primer contacto» (y al Jefe pasado su plazo)", () => {
  const nuevo = (horas) => lead({ etapa: "nuevo", ultimo_contacto: null, creado_en: h(-horas) });
  assert.equal(grupo(nuevo(0.5)), "por_atender");
  assert.equal(grupo(nuevo(1.9)), "por_atender");
  assert.equal(grupo(nuevo(2)), "sin_contacto");
  assert.equal(clasificarLeadHoy({ lead: nuevo(3), ahora: AHORA }).nivelJefe, false);
  assert.equal(clasificarLeadHoy({ lead: nuevo(4), ahora: AHORA }).nivelJefe, true);
  assert.equal(grupo(nuevo(1.5), [], { horasPrimerContacto: 1 }), "sin_contacto", "el plazo es configurable");
  assert.equal(grupo(nuevo(30), [tarea(-5)]), "sin_contacto", "sin contactar manda sobre una tarea vencida");
  // Con un contacto registrado ya no es «sin primer contacto» aunque siga en «nuevo».
  assert.notEqual(grupo(lead({ etapa: "nuevo", creado_en: h(-10), ultimo_contacto: h(-1) })), "sin_contacto");
});

test("Próxima acción: vencida, de hoy, programada o ninguna", () => {
  assert.equal(grupo(lead(), [tarea(-3)]), "vencida", "ya pasó la hora");
  assert.equal(grupo(lead(), [tarea(-30)]), "vencida");
  assert.equal(grupo(lead(), [tarea(2)]), "hoy", "más tarde, hoy");
  assert.equal(grupo(lead(), [tarea(48)]), "programada");
  assert.equal(grupo(lead(), []), "sin_accion");
  assert.equal(grupo(lead(), [tarea(-3, { hecha: true })]), "sin_accion", "las tareas hechas no cuentan");
  assert.equal(grupo(lead({ etapa: "seguimiento" }), [tarea(48), tarea(-3)]), "vencida", "si hay una vencida y otra futura, manda la más cercana (la vencida)");
  const c = clasificarLeadHoy({ lead: lead(), tareas: [tarea(48), tarea(2)], ahora: AHORA });
  assert.equal(c.proxima.id, "t2", "la próxima acción es la más cercana en el tiempo");
});

test("«Hoy» se mide por el día de Chile, no por el de UTC", () => {
  // 23:30 hora de Chile del 21 es 02:30Z del 22. Una tarea a las 23:50 Chile sigue siendo «hoy».
  const tarde = new Date("2026-10-22T02:30:00Z");
  const t = [{ id: "x", vence_en: "2026-10-22T02:50:00Z", hecha: false }];
  assert.equal(clasificarLeadHoy({ lead: lead(), tareas: t, ahora: tarde }).grupo, "hoy");
});

test("Marca de estancado: sin actividad por los días configurados", () => {
  const viejo = lead({ etapa: "seguimiento", ultimo_contacto: h(-24 * 9), actualizado_en: h(-24 * 9), creado_en: h(-24 * 12) });
  assert.equal(clasificarLeadHoy({ lead: viejo, ahora: AHORA }).estancado, true);
  assert.equal(clasificarLeadHoy({ lead: viejo, ahora: AHORA, diasDetenido: 10 }).estancado, false);
  assert.equal(clasificarLeadHoy({ lead: lead({ ultimo_contacto: h(-5) , actualizado_en: h(-5) }), ahora: AHORA }).estancado, false);
});

test("Orden: primer contacto, recién llegados, vencidas, hoy, sin acción, programados; dentro de cada grupo, lo más urgente primero", () => {
  const mk = (id, l, tareas) => ({ lead: { ...l, id }, hoy: clasificarLeadHoy({ lead: { ...l, id }, tareas, ahora: AHORA }) });
  const items = [
    mk("prog", lead(), [tarea(72)]),
    mk("sinaccion", lead(), []),
    mk("hoyB", lead(), [tarea(4)]),
    mk("hoyA", lead(), [tarea(1)]),
    mk("venc", lead(), [tarea(-6)]),
    mk("recien", lead({ etapa: "nuevo", ultimo_contacto: null, creado_en: h(-0.5) }), []),
    mk("sinc2", lead({ etapa: "nuevo", ultimo_contacto: null, creado_en: h(-3) }), []),
    mk("sinc1", lead({ etapa: "nuevo", ultimo_contacto: null, creado_en: h(-9) }), []),
  ];
  assert.deepEqual(ordenarHoy(items).map((x) => x.lead.id), ["sinc1", "sinc2", "recien", "venc", "hoyA", "hoyB", "sinaccion", "prog"]);
  assert.deepEqual(GRUPOS_HOY.map((g) => g.id), ["sin_contacto", "por_atender", "vencida", "hoy", "sin_accion", "programada"]);
});

test("¿Hay que pedir el siguiente paso? Lead abierto sin ninguna tarea pendiente que aún no venza", () => {
  assert.equal(faltaProximaAccion(lead(), []), true);
  assert.equal(faltaProximaAccion(lead(), [tarea(-2)], AHORA), true, "una tarea vencida no cuenta como siguiente paso");
  assert.equal(faltaProximaAccion(lead(), [tarea(2)], AHORA), false);
  assert.equal(faltaProximaAccion(lead(), [tarea(2, { hecha: true })], AHORA), true);
  assert.equal(faltaProximaAccion(lead({ etapa: "ganado" }), []), false, "no se pide al cerrar");
  assert.equal(faltaProximaAccion(lead({ etapa: "perdido" }), []), false);
  assert.equal(faltaProximaAccion(null, []), false);
});
