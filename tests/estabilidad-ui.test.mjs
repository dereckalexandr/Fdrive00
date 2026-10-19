// Guardas contra errores de pantalla que congelan el sitio. Se revisa el código fuente de las pantallas del CRM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");
const pantallas = readdirSync(SRC).filter((f) => /^crm-.*\.jsx$/.test(f));

test("Ninguna pantalla crea la función `api` nueva en cada dibujo (provoca un ciclo infinito de peticiones)", () => {
  // Si `api` cambia en cada dibujo y es dependencia de useCarga, la pantalla vuelve a pedir sus datos sin parar y el sitio se congela.
  const malas = [];
  for (const f of pantallas) {
    const lineas = readFileSync(join(SRC, f), "utf8").split("\n");
    lineas.forEach((l, i) => {
      if (/const api = (apiProp \|\| )?\(\(?\s*op\b[^)]*\)\s*=>/.test(l) && !/useCallback|useMemo/.test(l)) malas.push(`${f}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepEqual(malas, [], "usa `apiPorDefecto` (crm-ui.jsx) o useCallback:\n" + malas.join("\n"));
});

test("Los módulos usan la misma función por defecto para hablar con el servidor", () => {
  for (const f of ["crm-anuncios.jsx", "crm-marketing.jsx", "crm-inspecciones.jsx", "crm-validaciones.jsx", "crm-tasaciones.jsx"]) {
    const s = readFileSync(join(SRC, f), "utf8");
    assert.match(s, /const api = apiProp \|\| apiPorDefecto;/, f);
  }
});

test("Las pantallas principales están protegidas con la red de seguridad contra pantallas en blanco", () => {
  assert.match(readFileSync(join(SRC, "main.jsx"), "utf8"), /<ErrorBoundary>/);
  assert.match(readFileSync(join(SRC, "crm-ventas.jsx"), "utf8"), /<ErrorBoundary clave=\{tab\}>/);
});
