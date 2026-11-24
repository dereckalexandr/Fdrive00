// Reempaqueta una grabación WebM/Opus (lo que graban Chrome y Edge) como Ogg/Opus, SIN recodificar el audio.
// WhatsApp acepta audio/ogg (opus) y lo muestra como nota de voz; el MP4 fragmentado de Chrome lo rechaza.
// Texto puro y sin dependencias: lo usan la pantalla y las pruebas.

/* ---------- CRC de Ogg (polinomio 0x04C11DB7, sin reflejar) ---------- */
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
    t[i] = r >>> 0;
  }
  return t;
})();
export function crcOgg(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ TABLA_CRC[((crc >>> 24) & 0xff) ^ bytes[i]]) >>> 0;
  return crc;
}

/* ---------- Lectura de WebM (Matroska/EBML) ---------- */
// Elementos que contienen a otros: se recorren «de corrido» (Chrome los escribe con tamaño desconocido al grabar en vivo).
const CONTENEDORES = new Set([0x18538067 /* Segment */, 0x1f43b675 /* Cluster */, 0x1654ae6b /* Tracks */, 0xae /* TrackEntry */, 0xa0 /* BlockGroup */]);
const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK = 0xa1;
const ID_CODEC_PRIVATE = 0x63a2;

function leerId(b, p) {
  const f = b[p];
  let n = 1;
  let m = 0x80;
  while (n <= 4 && !(f & m)) { n++; m >>= 1; }
  if (f === undefined || n > 4) throw new Error("webm_invalido");
  let id = 0;
  for (let i = 0; i < n; i++) id = id * 256 + b[p + i];
  return [id, n];
}
function leerTam(b, p) {
  const f = b[p];
  let n = 1;
  let m = 0x80;
  while (n <= 8 && !(f & m)) { n++; m >>= 1; }
  if (f === undefined || n > 8) throw new Error("webm_invalido");
  let v = f & (m - 1);
  let desconocido = v === m - 1;
  for (let i = 1; i < n; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) desconocido = false; }
  return [v, n, desconocido];
}

/** Paquetes Opus (en orden) y el encabezado OpusHead (CodecPrivate) de una grabación WebM. */
export function leerWebmOpus(b) {
  const paquetes = [];
  let cabecera = null;
  let p = 0;
  while (p < b.length) {
    const [id, ni] = leerId(b, p);
    const [tam, nt, desconocido] = leerTam(b, p + ni);
    const ini = p + ni + nt;
    if (CONTENEDORES.has(id)) { p = ini; continue; }
    if (desconocido) throw new Error("webm_invalido");
    const fin = ini + tam;
    if (id === ID_CODEC_PRIVATE && fin <= b.length) cabecera = b.subarray(ini, fin);
    else if (id === ID_SIMPLE_BLOCK || id === ID_BLOCK) {
      if (fin > b.length) break; // grabación cortada al final: se ignora ese último trozo
      const [, ntrack] = leerTam(b, ini); // número de pista (solo hay una)
      const flags = b[ini + ntrack + 2];
      if (flags & 0x06) throw new Error("webm_con_lacing"); // Chrome no usa lacing en audio
      const paquete = b.subarray(ini + ntrack + 3, fin);
      if (paquete.length) paquetes.push(paquete);
    }
    p = fin;
  }
  if (!paquetes.length) throw new Error("webm_sin_audio");
  return { paquetes, cabecera };
}

/* ---------- Duración de un paquete Opus (en muestras a 48 kHz, según su byte TOC) ---------- */
export function muestrasPaquete(pq) {
  const toc = pq[0];
  const cfg = toc >> 3;
  const codigo = toc & 3;
  let dur;
  if (cfg < 12) dur = [480, 960, 1920, 2880][cfg & 3]; // SILK: 10, 20, 40, 60 ms
  else if (cfg < 16) dur = (cfg & 1) ? 960 : 480; // híbrido: 10 o 20 ms
  else dur = [120, 240, 480, 960][cfg & 3]; // CELT: 2,5 / 5 / 10 / 20 ms
  const tramas = codigo === 0 ? 1 : codigo === 3 ? ((pq[1] || 0) & 63) : 2;
  return dur * tramas;
}

/* ---------- Escritura de Ogg ---------- */
const enc = new TextEncoder();
const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

/** Una página Ogg con los paquetes completos dados. `granulo` = muestras a 48 kHz hasta el final de la página. */
function pagina({ tipo, granulo, serie, seq, paquetes }) {
  const segmentos = [];
  for (const pq of paquetes) {
    let resto = pq.length;
    while (resto >= 255) { segmentos.push(255); resto -= 255; }
    segmentos.push(resto);
  }
  if (segmentos.length > 255) throw new Error("ogg_pagina_grande");
  const largo = 27 + segmentos.length + paquetes.reduce((s, x) => s + x.length, 0);
  const out = new Uint8Array(largo);
  out.set(enc.encode("OggS"), 0);
  out[4] = 0; out[5] = tipo;
  const g = BigInt(granulo);
  for (let i = 0; i < 8; i++) out[6 + i] = Number((g >> BigInt(8 * i)) & 0xffn);
  out.set(u32(serie), 14); out.set(u32(seq), 18);
  // CRC (22..25) en cero hasta calcularlo sobre toda la página
  out[26] = segmentos.length;
  out.set(segmentos, 27);
  let pos = 27 + segmentos.length;
  for (const pq of paquetes) { out.set(pq, pos); pos += pq.length; }
  out.set(u32(crcOgg(out)), 22);
  return out;
}

function cabeceraOpus(cabecera) {
  if (cabecera && cabecera.length >= 19 && String.fromCharCode(...cabecera.subarray(0, 8)) === "OpusHead") return cabecera;
  // Valores habituales de una grabación de voz: 1 canal, 48 kHz, descarte inicial de 312 muestras.
  return new Uint8Array([...enc.encode("OpusHead"), 1, 1, 312 & 255, 312 >> 8, ...u32(48000), 0, 0, 0]);
}
function etiquetasOpus() {
  const vendor = enc.encode("Drive Futuro");
  return new Uint8Array([...enc.encode("OpusTags"), ...u32(vendor.length), ...vendor, ...u32(0)]);
}

/** Convierte una grabación WebM/Opus (Uint8Array) en un archivo Ogg/Opus (Uint8Array). Lanza error si no es WebM/Opus legible. */
export function webmOpusAOgg(bytes) {
  const { paquetes, cabecera } = leerWebmOpus(bytes);
  const serie = (typeof crypto !== "undefined" && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : 0x44465554) >>> 0;
  const trozos = [
    pagina({ tipo: 0x02, granulo: 0, serie, seq: 0, paquetes: [cabeceraOpus(cabecera)] }),
    pagina({ tipo: 0x00, granulo: 0, serie, seq: 1, paquetes: [etiquetasOpus()] }),
  ];
  let seq = 2;
  let acumulado = 0;
  let grupo = [];
  let segs = 0;
  const volcar = (ultima) => {
    if (!grupo.length) return;
    trozos.push(pagina({ tipo: ultima ? 0x04 : 0x00, granulo: acumulado, serie, seq: seq++, paquetes: grupo }));
    grupo = []; segs = 0;
  };
  paquetes.forEach((pq, i) => {
    const s = Math.floor(pq.length / 255) + 1;
    if (grupo.length >= 50 || segs + s > 255) volcar(false);
    grupo.push(pq); segs += s;
    acumulado += muestrasPaquete(pq);
    if (i === paquetes.length - 1) volcar(true);
  });
  const total = trozos.reduce((n, t) => n + t.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const t of trozos) { out.set(t, pos); pos += t.length; }
  return out;
}
