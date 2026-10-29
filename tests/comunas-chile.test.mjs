import { test } from "node:test";
import assert from "node:assert/strict";
import { COMUNAS_CHILE, COMUNAS_POR_REGION } from "../supabase/functions/api/comunas-chile.js";

test("Comunas de Chile: las 346, sin repetir y repartidas en las 16 regiones", () => {
  assert.equal(COMUNAS_CHILE.length, 346);
  assert.equal(new Set(COMUNAS_CHILE).size, 346, "sin repetidas");
  assert.equal(Object.keys(COMUNAS_POR_REGION).length, 16);
  const por = Object.fromEntries(Object.entries(COMUNAS_POR_REGION).map(([r, c]) => [r, c.length]));
  assert.equal(por["Metropolitana de Santiago"], 52);
  assert.equal(por["Valparaíso"], 38);
  assert.equal(por["Arica y Parinacota"], 4);
  for (const c of ["Santiago", "Ñuñoa", "Las Condes", "Maipú", "Puerto Montt", "Punta Arenas", "Isla de Pascua", "Cabo de Hornos", "Alto Biobío", "Torres del Paine"]) assert.ok(COMUNAS_CHILE.includes(c), c);
  assert.deepEqual([...COMUNAS_CHILE], [...COMUNAS_CHILE].sort((a, b) => a.localeCompare(b, "es")), "en orden alfabético");
});
