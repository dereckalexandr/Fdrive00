import { test } from "node:test";
import assert from "node:assert/strict";
import { etapaDeOperacion, etapasDeTipo, ayudaDeEtapa } from "../supabase/functions/api/compras-core.js";
import { diasEnEtapa, colorDeAntiguedad, etapaNombre, ETAPAS, ETAPAS_TODAS, ETAPAS_ABIERTAS } from "../supabase/functions/api/ventas-core.js";

const AHORA = new Date("2026-10-23T12:00:00Z");

test("Etapas por tipo de lead: columnas del tablero", () => {
  assert.deepEqual(etapasDeTipo("venta"), ["nuevo", "contactado", "seguimiento", "cotizado", "reservado", "ganado", "perdido"]);
  assert.deepEqual(etapasDeTipo("compra"), ["nuevo", "contactado", "tasacion", "cotizado", "reservado", "documentos", "ganado", "perdido"]);
  assert.deepEqual(etapasDeTipo("consignacion"), ["nuevo", "contactado", "tasacion", "contrato", "cotizado", "ganado", "perdido"]);
  assert.ok(etapasDeTipo("compra", { conSeguimiento: true }).includes("seguimiento"));
  assert.equal(ETAPAS.length, 7);
  for (const t of ["venta", "compra", "consignacion"]) for (const e of etapasDeTipo(t, { conSeguimiento: true })) assert.ok(ETAPAS_TODAS.some((x) => x.id === e), e);
});

test("Nombres de etapa por tipo y ayuda de las automáticas", () => {
  assert.equal(etapaDeOperacion("compra", "tasacion", "x"), "Tasación pedida");
  assert.equal(etapaDeOperacion("compra", "reservado", "x"), "Oferta aceptada");
  assert.equal(etapaDeOperacion("consignacion", "tasacion", "x"), "Tasación o inspección");
  assert.equal(etapaDeOperacion("consignacion", "cotizado", "x"), "En validación");
  assert.equal(etapaDeOperacion("venta", "cotizado", "Cotizado"), "Cotizado");
  assert.equal(etapaNombre("documentos"), "Documentos y pago");
  assert.match(ayudaDeEtapa("compra", "tasacion"), /tasación/i);
  assert.equal(ayudaDeEtapa("venta", "nuevo"), "");
  assert.ok(ETAPAS_ABIERTAS.includes("documentos") && ETAPAS_ABIERTAS.includes("contrato"));
});

test("Días en la etapa y semáforo", () => {
  assert.equal(diasEnEtapa({ etapa_desde: "2026-10-20T12:00:00Z" }, AHORA), 3);
  assert.equal(diasEnEtapa({ actualizado_en: "2026-10-23T08:00:00Z" }, AHORA), 0);
  assert.equal(diasEnEtapa({ creado_en: "2026-10-13T12:00:00Z" }, AHORA), 10);
  assert.equal(diasEnEtapa({ etapa_desde: "2026-10-20T12:00:00Z", actualizado_en: "2026-10-23T11:00:00Z" }, AHORA), 3);
  assert.equal(diasEnEtapa({}, AHORA), 0);
  assert.equal(colorDeAntiguedad(0), "verde");
  assert.equal(colorDeAntiguedad(2), "verde");
  assert.equal(colorDeAntiguedad(3), "ambar");
  assert.equal(colorDeAntiguedad(6), "ambar");
  assert.equal(colorDeAntiguedad(7), "rojo");
});
