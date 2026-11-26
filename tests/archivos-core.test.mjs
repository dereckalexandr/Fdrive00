import test from "node:test";
import assert from "node:assert/strict";
import {
  PREFIJOS_ARCHIVO, MARCADOR, esClaveArchivo, esMarcador, rutaDeMarcador, marcadorDe, rutaArchivo, leerDataUrl, aDataUrl, archivoEnLaBase,
} from "../supabase/functions/api/archivos-core.js";

test("Solo son archivos las fotos y documentos; la configuración pequeña se queda en la base", () => {
  for (const p of PREFIJOS_ARCHIVO) assert.equal(esClaveArchivo(`${p}::a::b`), true, p);
  for (const k of ["inspeccion::u::f", "tasacion::u::t", "empresa::datos", "whatsapp::config", "fin::conciliacion::x", "admin_auth", "fotografia::x", "foto", ""])
    assert.equal(esClaveArchivo(k), false, k);
  assert.equal(esClaveArchivo(null), false);
  assert.equal(esClaveArchivo(undefined), false);
});

test("Marcador: se reconoce, se arma y se lee de vuelta; un data: o un texto cualquiera no lo es", () => {
  const m = marcadorDe("df/ifoto/ficha1/foto1");
  assert.equal(m, `${MARCADOR}df/ifoto/ficha1/foto1`);
  assert.equal(esMarcador(m), true);
  assert.equal(rutaDeMarcador(m), "df/ifoto/ficha1/foto1");
  assert.equal(esMarcador("data:image/jpeg;base64,AAAA"), false);
  assert.equal(esMarcador("@archivo:con espacios"), false);
  assert.equal(esMarcador(`${MARCADOR}${"x".repeat(700)}`), false, "no acepta valores enormes");
  assert.equal(rutaDeMarcador("otra cosa"), null);
  assert.equal(esMarcador(null), false);
});

test("Ruta en Storage: <espacio>/<prefijo>/<resto por carpetas>, sin poder escapar de su carpeta", () => {
  assert.equal(rutaArchivo("ifoto::ficha1::foto-9_a"), "df/ifoto/ficha1/foto-9_a");
  assert.equal(rutaArchivo("dval::fin-1234::arch.pdf".replace(".", "_")), "df/dval/fin-1234/arch_pdf");
  assert.equal(rutaArchivo("vfoto::v1::f1", "otra"), "otra/vfoto/v1/f1");
  for (const mala of ["foto::../../x::y", "foto::a::..", "foto::a::.", "foto::a b::c/d"]) {
    const r = rutaArchivo(mala);
    assert.ok(!r.includes(".."), r);
    assert.ok(!/(^|\/)\.(\/|$)/.test(r), r);
    assert.equal(r.split("/").length, 4, `${mala} -> ${r}`);
  }
  assert.notEqual(rutaArchivo("foto::a b::c"), rutaArchivo("foto::a_b::c"), "dos claves distintas nunca comparten ruta");
  assert.throws(() => rutaArchivo("inspeccion::a::b"));
  assert.throws(() => rutaArchivo("foto"));
});

test("data: se lee a bytes y vuelve igual; lo que no es base64 se rechaza", () => {
  const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const url = aDataUrl(bytes, "image/JPEG");
  assert.match(url, /^data:image\/jpeg;base64,/);
  const d = leerDataUrl(url);
  assert.equal(d.mime, "image/jpeg");
  assert.deepEqual([...d.bytes], [...bytes]);
  assert.equal(leerDataUrl("data:text/plain,hola"), null);
  assert.equal(leerDataUrl("no es un data"), null);
  assert.equal(leerDataUrl(""), null);
  assert.equal(leerDataUrl(null), null);
  // Con parámetros del tipo («audio/ogg; codecs=opus») se queda con el tipo base.
  assert.equal(leerDataUrl("data:audio/ogg;codecs=opus;base64,AAEC").mime, "audio/ogg");
  assert.equal(aDataUrl(bytes, "audio/ogg; codecs=opus").slice(0, 21), "data:audio/ogg;base64");
});

test("Un archivo grande no rompe la conversión (por trozos)", () => {
  const bytes = new Uint8Array(1_500_000).map((_, i) => i % 251);
  const d = leerDataUrl(aDataUrl(bytes, "application/pdf"));
  assert.equal(d.bytes.length, bytes.length);
  assert.equal(d.bytes[1_499_999], bytes[1_499_999]);
});

test("archivoEnLaBase: solo un archivo con contenido data: que aún no se movió", () => {
  assert.equal(archivoEnLaBase("foto::a::b", "data:image/jpeg;base64,AAAA"), true);
  assert.equal(archivoEnLaBase("foto::a::b", marcadorDe("df/foto/a/b")), false);
  assert.equal(archivoEnLaBase("inspeccion::a::b", "data:image/jpeg;base64,AAAA"), false);
  assert.equal(archivoEnLaBase("foto::a::b", "texto"), false);
});
