import test from "node:test";
import assert from "node:assert/strict";
import { precioSugeridoCompra, notasLeadDeProspecto, REBAJA_COMPRA_SUGERIDA } from "../supabase/functions/api/prospectos-core.js";

test("Precio sugerido de compra: el publicado menos $1.500.000, sin bajar de cero", () => {
  assert.equal(REBAJA_COMPRA_SUGERIDA, 1_500_000);
  assert.equal(precioSugeridoCompra(8_500_000), 7_000_000);
  assert.equal(precioSugeridoCompra(4_900_000), 3_400_000);
  assert.equal(precioSugeridoCompra(1_000_000), 0, "nunca negativo");
  assert.equal(precioSugeridoCompra(null), 0);
  assert.equal(precioSugeridoCompra("texto"), 0);
});

test("La nota del lead incluye el precio publicado y la compra sugerida", () => {
  const n = notasLeadDeProspecto({ vendedor_tipo: "particular", href: "/vehiculos/detalles/x-y-z/CL-AD-1234567/", precio: 8_500_000 });
  assert.match(n, /precio publicado \$8\.500\.000/);
  assert.match(n, /compra sugerida \$7\.000\.000/);
});
