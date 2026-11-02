// Sueldo mínimo para la calculadora del sitio público: se lee de las páginas de referencia, se recuerda y nunca falla hacia el cliente.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { iniciarFuncion, api, nuevaIp, paginasMinimo } from "./helpers/api-env.mjs";

before(async () => { await iniciarFuncion(); });

test("Calculadora: entrega el sueldo mínimo leído de las páginas y lo recuerda sin volver a consultarlas", async () => {
  paginasMinimo.respuestas["https://www.calcular.cl/sueldo-minimo-chile.html"] = "<p>El ingreso mínimo mensual (IMM) vigente es de $560.000.</p>";
  paginasMinimo.respuestas["https://finclaro.cl/sueldo-minimo"] = "<title>Sueldo Mínimo Chile 2026: $553.553 | FinClaro</title>";
  nuevaIp();
  const a = await api({ action: "public", op: "calculadora.parametros" });
  assert.equal(a.status, 200, JSON.stringify(a));
  assert.equal(a.sueldoMinimo, 560000, "se queda con el más reciente (el más alto)");
  assert.equal(a.fuente, "web");
  assert.equal(paginasMinimo.llamadas.length, 2);
  const b = await api({ action: "public", op: "calculadora.parametros" });
  assert.equal(b.sueldoMinimo, 560000);
  assert.equal(paginasMinimo.llamadas.length, 2, "la segunda vez sale de la memoria");
});
