// Reempaquetado de las notas de voz: lo que graba Chrome (WebM/Opus) debe salir como Ogg/Opus válido para WhatsApp.
import test from "node:test";
import assert from "node:assert/strict";
import { webmOpusAOgg, leerWebmOpus, muestrasPaquete, crcOgg } from "../src/webm-ogg.js";

/* ---------- Armar un WebM como lo hace Chrome ---------- */
const idBytes = (id) => { const o = []; let v = id; while (v > 0) { o.unshift(v & 255); v = Math.floor(v / 256); } return o; };
const tamBytes = (n) => { // varint EBML de 1, 2 o 4 bytes
  if (n < 127) return [0x80 | n];
  if (n < 16383) return [0x40 | (n >> 8), n & 255];
  return [0x10 | (n >>> 24), (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
};
const TAM_DESCONOCIDO = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const el = (id, datos) => [...idBytes(id), ...tamBytes(datos.length), ...datos];
const elDesconocido = (id, datos) => [...idBytes(id), ...TAM_DESCONOCIDO, ...datos];
const opusHead = (canales = 1, preskip = 312) => [...Buffer.from("OpusHead"), 1, canales, preskip & 255, preskip >> 8, 0x80, 0xbb, 0, 0, 0, 0, 0];
const simpleBlock = (pista, tc, datos, flags = 0x80) => el(0xa3, [0x80 | pista, (tc >> 8) & 255, tc & 255, flags, ...datos]);

function armarWebm(paquetes, { cabecera = opusHead(), conBlockGroup = false } = {}) {
  const ebml = el(0x1a45dfa3, [...el(0x4282, [...Buffer.from("webm")])]);
  const pistas = el(0x1654ae6b, el(0xae, [...el(0xd7, [1]), ...el(0x86, [...Buffer.from("A_OPUS")]), ...el(0x63a2, cabecera)]));
  const bloques = paquetes.flatMap((p, i) => (conBlockGroup && i === 1
    ? el(0xa0, [...el(0xa1, [0x81, 0, 20, 0x00, ...p]), ...el(0x9b, [1])])
    : simpleBlock(1, i * 20, [...p])));
  const cluster = elDesconocido(0x1f43b675, [...el(0xe7, [0]), ...bloques]);
  const segmento = elDesconocido(0x18538067, [...pistas, ...cluster]);
  return Uint8Array.from([...ebml, ...segmento]);
}
// Paquete Opus falso: byte TOC de CELT 20 ms, 1 trama (0xF8) + relleno.
const paquete = (n, largo = 40) => Uint8Array.from([0xf8, ...Array.from({ length: largo - 1 }, (_, i) => (n * 7 + i) & 255)]);

/* ---------- Leer un Ogg y validarlo ---------- */
function leerOgg(b) {
  const paginas = [];
  let p = 0;
  while (p < b.length) {
    assert.equal(Buffer.from(b.subarray(p, p + 4)).toString(), "OggS", "firma de página");
    const nseg = b[p + 26];
    const segs = Array.from(b.subarray(p + 27, p + 27 + nseg));
    const datos = segs.reduce((s, x) => s + x, 0);
    const largo = 27 + nseg + datos;
    const pag = b.slice(p, p + largo);
    const crcGuardado = (pag[22] | (pag[23] << 8) | (pag[24] << 16) | (pag[25] << 24)) >>> 0;
    const copia = pag.slice(); copia.fill(0, 22, 26);
    assert.equal(crcOgg(copia), crcGuardado, "CRC de la página");
    let g = 0n; for (let i = 7; i >= 0; i--) g = (g << 8n) | BigInt(pag[6 + i]);
    // Separar paquetes (un segmento < 255 cierra el paquete)
    const paquetes = []; let actual = []; let q = 27 + nseg;
    for (const s of segs) { actual.push(...pag.subarray(q, q + s)); q += s; if (s < 255) { paquetes.push(Uint8Array.from(actual)); actual = []; } }
    paginas.push({ tipo: pag[5], granulo: g, serie: pag.slice(14, 18).join(","), seq: (pag[18] | (pag[19] << 8) | (pag[20] << 16) | (pag[21] << 24)) >>> 0, paquetes, abierto: actual.length > 0 });
    p += largo;
  }
  return paginas;
}

test("Duración de los paquetes Opus según su byte TOC", () => {
  assert.equal(muestrasPaquete(Uint8Array.from([0xf8])), 960, "CELT 20 ms");
  assert.equal(muestrasPaquete(Uint8Array.from([0xe0])), 120, "CELT 2,5 ms");
  assert.equal(muestrasPaquete(Uint8Array.from([0x08])), 960, "SILK 20 ms");
  assert.equal(muestrasPaquete(Uint8Array.from([0x00])), 480, "SILK 10 ms");
  assert.equal(muestrasPaquete(Uint8Array.from([0x18])), 2880, "SILK 60 ms");
  assert.equal(muestrasPaquete(Uint8Array.from([0xf9, 0])), 1920, "dos tramas de 20 ms (código 1)");
  assert.equal(muestrasPaquete(Uint8Array.from([0xfb, 3])), 960 * 3, "código 3: tres tramas");
});

test("WebM de Chrome (tamaños desconocidos) → Ogg/Opus válido: firma, CRC, cabeceras, orden y granule", () => {
  const originales = Array.from({ length: 120 }, (_, i) => paquete(i)); // 2,4 s
  const ogg = webmOpusAOgg(armarWebm(originales));
  const pag = leerOgg(ogg);
  assert.equal(pag[0].tipo, 0x02, "primera página marcada como inicio");
  assert.equal(Buffer.from(pag[0].paquetes[0].subarray(0, 8)).toString(), "OpusHead");
  assert.equal(pag[0].paquetes[0][9], 1, "1 canal");
  assert.equal(Buffer.from(pag[1].paquetes[0].subarray(0, 8)).toString(), "OpusTags");
  assert.ok(pag.every((x) => x.serie === pag[0].serie), "misma secuencia lógica");
  assert.deepEqual(pag.map((x) => x.seq), pag.map((_, i) => i), "números de página correlativos");
  assert.ok(pag.slice(2).every((x) => !x.abierto), "ningún paquete queda partido");
  const audio = pag.slice(2).flatMap((x) => x.paquetes);
  assert.equal(audio.length, 120);
  audio.forEach((a, i) => assert.deepEqual(a, originales[i], `paquete ${i} idéntico (no se recodifica)`));
  const ultima = pag[pag.length - 1];
  assert.equal(ultima.tipo & 0x04, 0x04, "última página marcada como fin");
  assert.equal(ultima.granulo, 120n * 960n, "granule = muestras a 48 kHz");
  for (let i = 3; i < pag.length; i++) assert.ok(pag[i].granulo > pag[i - 1].granulo, "granule creciente");
});

test("Paquetes grandes (varios segmentos), BlockGroup y grabaciones cortadas al final", () => {
  const ps = [paquete(0), paquete(1, 300), paquete(2, 510), paquete(3)]; // 300 = 255+45; 510 = 255+255+0
  const ogg = webmOpusAOgg(armarWebm(ps, { conBlockGroup: true }));
  const audio = leerOgg(ogg).slice(2).flatMap((x) => x.paquetes);
  assert.equal(audio.length, 4);
  ps.forEach((p, i) => assert.deepEqual(audio[i], p));
  // Corte a la mitad del último bloque: se descarta ese trozo y el resto sirve.
  const webm = armarWebm([paquete(0), paquete(1), paquete(2)]);
  const cortado = webm.slice(0, webm.length - 10);
  assert.equal(leerWebmOpus(cortado).paquetes.length, 2);
  assert.equal(leerOgg(webmOpusAOgg(cortado)).slice(2).flatMap((x) => x.paquetes).length, 2);
});

test("Sin CodecPrivate se usan valores de voz; lo que no es WebM/Opus se rechaza", () => {
  const sin = Uint8Array.from([...el(0x1a45dfa3, []), ...elDesconocido(0x18538067, [...elDesconocido(0x1f43b675, simpleBlock(1, 0, [...paquete(0)]))])]);
  const pag = leerOgg(webmOpusAOgg(sin));
  assert.equal(pag[0].paquetes[0].length, 19);
  assert.equal(pag[0].paquetes[0][9], 1);
  assert.throws(() => webmOpusAOgg(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), /webm_/);
  assert.throws(() => webmOpusAOgg(new Uint8Array(0)), /webm_sin_audio/);
  // Con lacing no se sabe separar los paquetes: se rechaza en vez de mandar audio roto.
  const lacing = Uint8Array.from([...elDesconocido(0x18538067, elDesconocido(0x1f43b675, simpleBlock(1, 0, [...paquete(0)], 0x82)))]);
  assert.throws(() => webmOpusAOgg(lacing), /webm_con_lacing/);
});
