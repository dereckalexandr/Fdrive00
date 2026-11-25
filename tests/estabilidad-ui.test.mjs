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
  assert.match(readFileSync(join(SRC, "crm-ventas.jsx"), "utf8"), /<ErrorBoundary clave=\{tabVigente\}>/);
});

test("El sitio público y el CRM conviven: «/plataforma» abre el CRM", () => {
  const s = readFileSync(join(SRC, "main.jsx"), "utf8");
  assert.match(s, /"\/plataforma"/);
  assert.match(s, /import\("\.\/sitio-publico\.jsx"\)/);
  assert.match(readFileSync(join(SRC, "sitio-publico.jsx"), "utf8"), /href="\/plataforma"/);
});

test("Pista: pistacrm.com muestra la presentación y app.pistacrm.com abre el CRM", () => {
  const s = readFileSync(join(SRC, "main.jsx"), "utf8");
  assert.match(s, /import\("\.\/sitio-pista\.jsx"\)/);
  assert.match(s, /"pistacrm\.com"/);
  assert.match(s, /"app\.pistacrm\.com"/);
  assert.match(readFileSync(join(SRC, "sitio-pista.jsx"), "utf8"), /https:\/\/app\.pistacrm\.com/);
});

test("Tema Pista: el CRM usa Noche y Naranja; el sitio de la automotora conserva sus colores", () => {
  const css = readFileSync(join(SRC, "index.css"), "utf8");
  assert.match(css, /\.tema-pista\s*\{[^}]*--stone-900: 14 27 44;[^}]*--amber-500: 255 107 26;/);
  assert.match(css, /:root\s*\{[^}]*--amber-500: 245 158 11;/);
  assert.match(readFileSync(join(SRC, "main.jsx"), "utf8"), /classList\.add\("tema-pista"\)/);
});

test("El sitio público no pide datos internos: no menciona costo ni patente al mostrar vehículos", () => {
  const s = readFileSync(join(SRC, "sitio-publico.jsx"), "utf8");
  assert.ok(!/\.costo\b|\.patente\b|precio_lista|\.notas\b/.test(s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/placeholder="[^"]*"/g, "").replace(/datos\.patente|f\.patente|patente:/g, "")), "la pantalla del visitante no debe leer campos internos del vehículo");
});
