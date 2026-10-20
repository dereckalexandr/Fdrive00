import { test } from "node:test";
import assert from "node:assert/strict";
import { escaparHtml, correoValido, destinatariosValidos, limpiarAsunto, plantillaCorreo } from "../supabase/functions/api/avisos-core.js";

test("Escapar HTML: nada de lo que escribe una persona se interpreta como código", () => {
  assert.equal(escaparHtml(`<b>"Hola" & 'chao'</b>`), "&lt;b&gt;&quot;Hola&quot; &amp; &#39;chao&#39;&lt;/b&gt;");
  assert.equal(escaparHtml(null), "");
});

test("Correos: válidos, inválidos y repetidos", () => {
  assert.ok(correoValido("ana@mail.cl"));
  for (const x of ["", "ana", "ana@", "a b@mail.cl", "a@b", "<a@b.cl>", "a@b.cl,c@d.cl", null, undefined, 5]) assert.equal(correoValido(x), false, String(x));
  assert.deepEqual(destinatariosValidos(["ana@mail.cl", "ANA@mail.cl", "malo", "luis@mail.cl", null]), ["ana@mail.cl", "luis@mail.cl"]);
});

test("Asunto: una sola línea, sin saltos que inyecten encabezados", () => {
  assert.equal(limpiarAsunto("Hola\r\nBcc: x@y.cl"), "Hola Bcc: x@y.cl");
  assert.equal(limpiarAsunto("a".repeat(400)).length, 150);
});

test("Plantilla: HTML escapado, texto plano y enlace solo si es http(s)", () => {
  const m = plantillaCorreo({ titulo: "Nuevo <lead>", lineas: ["Cliente <script>x</script>", "", null, "Teléfono 9 1234"], enlace: "https://app.cl/plataforma" });
  assert.ok(!m.html.includes("<script>"));
  assert.ok(m.html.includes("&lt;script&gt;"));
  assert.ok(m.html.includes('href="https://app.cl/plataforma"'));
  assert.ok(m.texto.includes("Teléfono 9 1234"));
  assert.ok(m.texto.includes("https://app.cl/plataforma"));
  const sin = plantillaCorreo({ titulo: "x", lineas: ["y"], enlace: "javascript:alert(1)" });
  assert.ok(!sin.html.includes("href="));
  assert.ok(!sin.texto.includes("javascript"));
});
