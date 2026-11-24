// Ayuda compartida de las pruebas de la Edge Function: base de datos falsa en memoria + carga del código real.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
void test; void assert;

/* ---------- base falsa ---------- */
let contadorCotizaciones = 0;
let contadorCierres = 0;
let contadorTasaciones = 0;
let contadorInspecciones = 0;
let contadorValidaciones = 0;
let contadorAnuncios = 0;
let contadorCompras = 0;
let contadorConsig = 0;
let contadorCampanias = 0;
let contadorFin = 0;
let contadorPublicaciones = 0;
let relojWa = Date.now();
const marcaWa = () => new Date(++relojWa).toISOString();
const DEFAULTS = {
  wa_conversaciones: () => ({ id: randomUUID(), etiquetas: [], no_leidos: 0, cliente_id: null, lead_id: null, local_id: null, ultimo_mensaje_en: null, ultimo_entrante_en: null, creado_en: marcaWa(), actualizado_en: marcaWa() }),
  wa_mensajes: () => ({ id: randomUUID(), estado: "recibido", media: null, wamid: null, creado_en: marcaWa() }),
  usuarios: () => ({ id: randomUUID(), comision: {}, activo: true, debe_cambiar_clave: true, roles: [], permisos_extra: { otorgar: [], quitar: [] },
    email: null, telefono: null, local_id: null, ultimo_acceso: null, creado_en: new Date().toISOString() }),
  locales: () => ({ id: randomUUID(), activo: true, direccion: null, creado_en: new Date().toISOString() }),
  vehiculos: () => ({ id: randomUUID(), activo: true, estado: "disponible", fotos: [], creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  clientes: () => ({ id: randomUUID(), creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  leads: () => ({ id: randomUUID(), etapa: "nuevo", tipo: "venta", parte_pago: {}, financiamiento: {}, ultimo_contacto: null, motivo_perdida: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  lead_eventos: () => ({ id: Math.floor(Math.random() * 1e9), creado_en: new Date().toISOString() }),
  cotizaciones: () => ({ id: randomUUID(), numero: ++contadorCotizaciones, estado: "vigente", descuento: 0, aprobado_por: null, aprobado_en: null, motivo_rechazo: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  tasaciones: () => ({ id: randomUUID(), numero: ++contadorTasaciones, estado: "pendiente", tipo: "parte_pago", tasador_id: null, contacto: {}, estimacion: {}, inspeccion: {}, fotos: [], valor_compra: null, valor_venta: null, observaciones: null, solicitada_en: new Date().toISOString(), tomada_en: null, completada_en: null, cancelada_en: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  inspecciones: () => ({ id: randomUUID(), numero: ++contadorInspecciones, estado: "pendiente", origen: "lead", inspector_id: null, inspeccion_key: null, resultado: {}, fotos: [], vehiculo: {}, solicitada_en: new Date().toISOString(), tomada_en: null, completada_en: null, cancelada_en: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  validaciones: () => ({ id: randomUUID(), numero: ++contadorValidaciones, estado: "pendiente", validador_id: null, sujeto: {}, solicitada_en: new Date().toISOString(), tomada_en: null, resuelta_en: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  validacion_docs: () => ({ id: randomUUID(), estado: "pendiente", comentario: null, archivos: [], requerido: true, grupo: "vehiculo", revisado_por: null, revisado_en: null, orden: 0, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  anuncios: () => ({ id: randomUUID(), numero: ++contadorAnuncios, estado: "por_publicar", baja_en: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  anuncio_portales: () => ({ id: randomUUID(), estado: "pendiente", url: null, precio_publicado: null, publicado_en: null, vence_en: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  campanias: () => ({ plataforma: null, externo_id: null, externo: {}, sync_en: null, sync_error: null, id: randomUUID(), numero: ++contadorCampanias, estado: "borrador", presupuesto: 0, presupuesto_aprobado: 0, gasto: 0, alcance: 0, impresiones: 0, clics: 0, motivo_rechazo: null, aprobado_por: null, aprobado_en: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  publicaciones_rrss: () => ({ id: randomUUID(), numero: ++contadorPublicaciones, estado: "idea", tipo: "post", fecha_programada: null, texto: null, url: null, campania_id: null, vehiculo_id: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  material_vehiculo: () => ({ id: randomUUID(), estado: "pendiente", url: null, notas: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  compras: () => ({ id: randomUUID(), numero: ++contadorCompras, estado: "oferta", vehiculo: {}, motivo: null, monto_final: null, mes: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  consignaciones: () => ({ id: randomUUID(), numero: ++contadorConsig, estado: "en_validacion", vehiculo: {}, plazo_dias: 90, vence_en: null, motivo: null, cierre_id: null, precio_venta: null, margen: null, mes: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  cierre_pagos: () => ({ id: randomUUID(), estado: "vigente", archivos: [], cuenta_id: null, cuenta_detalle: null, referencia: null, notas: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  compra_pagos: () => ({ id: randomUUID(), estado: "vigente", archivos: [], cuenta_id: null, cuenta_detalle: null, referencia: null, notas: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  cuentas_empresa: () => ({ id: randomUUID(), activa: true, local_id: null, tipo_cuenta: null, titular: null, rut_titular: null, alias: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  avisos: () => ({ id: randomUUID(), leido_en: null, creado_en: new Date().toISOString() }),
  cierres: () => ({ id: randomUUID(), numero: ++contadorCierres, estado: "pendiente", mes: null, aprobado_por: null, aprobado_en: null, motivo_rechazo: null, anulado_por: null, anulado_en: null, motivo_anulacion: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  reservas: () => ({ id: randomUUID(), estado: "activa", motivo: null, cerrado_en: null, creado_en: new Date().toISOString() }),
  tareas: () => ({ id: randomUUID(), hecha: false, hecha_en: null, creado_en: new Date().toISOString() }),
  bitacora: () => ({ id: Math.floor(Math.random() * 1e9), creado_en: new Date().toISOString() }),
  fin_trabajadores: () => ({ id: randomUUID(), activo: true, usuario_id: null, rut: null, cargo: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  fin_nominas: () => ({ id: randomUUID(), creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
  fin_movimientos: () => ({ id: randomUUID(), archivos: [], recurrente: false, serie_id: null, nomina_id: null, nomina_concepto: null, mes_resultado: null, numero: ++contadorFin, estado: "vigente", cuenta_id: null, cuenta_destino_id: null, vehiculo_id: null, contraparte: null, documento_numero: null, notas: null, anulado_por: null, anulado_en: null, motivo_anulacion: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }),
};
const UNICOS = { wa_conversaciones: ["telefono"], vehiculos: ["patente"], usuarios: ["rut"], locales: ["nombre"], roles_permisos: ["rol"], config_negocio: ["clave"], kv_store: ["key"], patentes_consultadas: ["patente"] };

/** Convierte un patrón LIKE/ILIKE de SQL (% = cualquier texto, _ = una letra, \ escapa) a una expresión regular. */
function patronARegex(patron, insensible) {
  const BARRA = String.fromCharCode(92);
  const ESPECIALES = ".*+?^${}()|[]" + BARRA;
  let fuente = "";
  for (let i = 0; i < patron.length; i++) {
    const c = patron[i];
    if (c === BARRA && i + 1 < patron.length) { const n = patron[++i]; fuente += ESPECIALES.includes(n) ? BARRA + n : n; }
    else if (c === "%") fuente += ".*";
    else if (c === "_") fuente += ".";
    else fuente += ESPECIALES.includes(c) ? BARRA + c : c;
  }
  return new RegExp("^" + fuente + "$", insensible ? "is" : "s");
}

export function crearBaseFalsa() {
  const tablas = { usuarios: [], locales: [], roles_permisos: [], bitacora: [], config_negocio: [], kv_store: [], vehiculos: [], clientes: [], leads: [], lead_eventos: [], tareas: [], cotizaciones: [], reservas: [], cierres: [], avisos: [], tasaciones: [], inspecciones: [], validaciones: [], validacion_docs: [], anuncios: [], anuncio_portales: [], campanias: [], publicaciones_rrss: [], material_vehiculo: [], compras: [], consignaciones: [], cierre_pagos: [], compra_pagos: [], cuentas_empresa: [], fin_movimientos: [], fin_saldos: [], fin_trabajadores: [], fin_nominas: [], wa_conversaciones: [], wa_mensajes: [], patentes_consultadas: [], alertas_leads: [] };
  const consultas = [];

  function builder(nombre) {
    const st = { op: "select", filtros: [], payload: null, devolver: false, uno: null, opts: {}, orden: null, rango: null, likes: [] };
    const b = {
      select(_c, opts) { if (st.op !== "select") st.devolver = true; st.opts = opts || {}; return b; },
      insert(p) { st.op = "insert"; st.payload = p; return b; },
      update(p) { st.op = "update"; st.payload = p; return b; },
      upsert(p, o) { st.op = "upsert"; st.payload = p; st.upsertOn = o && o.onConflict; return b; },
      delete() { st.op = "delete"; return b; },
      eq(c, v) { st.filtros.push([c, v]); return b; },
      neq(c, v) { st.filtros.push([c, (x) => x !== v]); return b; },
      in(c, arr) { st.filtros.push([c, (x) => arr.includes(x)]); return b; },
      limit(n) { st.limite = n; return b; },
      gte(c, v) { st.filtros.push([c, (x) => x !== null && x !== undefined && x >= v]); return b; },
      lt(c, v) { st.filtros.push([c, (x) => x !== null && x !== undefined && x < v]); return b; },
      like(c, p) { st.likes.push([c, patronARegex(p, false)]); return b; },
      ilike(c, p) { st.likes.push([c, patronARegex(p, true)]); return b; },
      order(c, o) { st.orden = [c, o && o.ascending === false ? -1 : 1]; return b; },
      range(a, z) { st.rango = [a, z]; return b; },
      maybeSingle() { st.uno = "maybe"; return b; },
      single() { st.uno = "single"; return b; },
      // LATENCIA_MS (opcional) simula el viaje de ida y vuelta a la base real, para medir tiempos de las pantallas.
      then(res, rej) {
        const ms = Number(process.env.LATENCIA_MS || 0);
        const p = ms > 0 ? new Promise((r) => setTimeout(r, ms)).then(() => ejecutar()) : Promise.resolve(ejecutar());
        return p.then(res, rej);
      },
    };
    const coincide = (f) => st.filtros.every(([c, v]) => (typeof v === "function" ? v(f[c]) : f[c] === v));
    function ejecutar() {
      consultas.push({ tabla: nombre, op: st.op });
      const T = tablas[nombre];
      if (!T) return { data: null, error: { code: "42P01", message: `relation "${nombre}" does not exist` } };
      let filas = [];
      if (st.op === "insert" && Array.isArray(st.payload)) {
        // Varias filas a la vez (como la base real).
        filas = st.payload.map((p) => ({ ...(DEFAULTS[nombre] ? DEFAULTS[nombre]() : {}), ...p }));
        T.push(...filas);
      } else if (st.op === "insert" || st.op === "upsert") {
        const nuevo = { ...(DEFAULTS[nombre] ? DEFAULTS[nombre]() : {}), ...st.payload };
        const claves = UNICOS[nombre] || [];
        const dup = T.find((f) => claves.some((c) => String(f[c]).toLowerCase() === String(nuevo[c]).toLowerCase()));
        if (dup && st.op === "insert") return { data: null, error: { code: "23505", message: "duplicate key" } };
        if (dup) { Object.assign(dup, st.payload); filas = [dup]; } else { T.push(nuevo); filas = [nuevo]; }
      } else if (st.op === "update") {
        filas = T.filter(coincide);
        filas.forEach((f) => Object.assign(f, st.payload));
      } else if (st.op === "delete") {
        const quedan = T.filter((f) => !coincide(f));
        filas = T.filter(coincide);
        T.length = 0; T.push(...quedan);
      } else {
        filas = T.filter(coincide);
        for (const [col, re] of st.likes) filas = filas.filter((f) => re.test(String(f[col])));
        if (st.orden) filas = [...filas].sort((a, z) => (a[st.orden[0]] > z[st.orden[0]] ? 1 : -1) * st.orden[1]);
      }
      filas = filas.map((f) => structuredClone(f)); // como la base real: devuelve copias, no las filas guardadas
      const total = filas.length;
      if (st.limite) filas = filas.slice(0, st.limite);
      if (st.rango) filas = filas.slice(st.rango[0], st.rango[1] + 1);
      const quiereFilas = st.op === "select" || st.devolver;
      if (!quiereFilas) return { data: null, error: null };
      if (st.uno === "maybe") return { data: filas[0] ?? null, error: null };
      if (st.uno === "single") return filas[0] ? { data: filas[0], error: null } : { data: null, error: { message: "sin filas" } };
      return { data: filas, error: null, count: st.opts.count ? total : null };
    }
    return b;
  }
  return { tablas, consultas, cliente: { from: builder } };
}

/* ---------- carga de la función real ---------- */
const ADMIN_EMAIL = "admin@prueba.cl";
const ADMIN_PW = "MaestraSegura123";
const SESSION_SECRET = "secreto-de-prueba-largo-largo-largo";
const hashPw = (pw) => { const salt = randomBytes(16); return `pbkdf2$150000$${salt.toString("base64")}$${pbkdf2Sync(pw, salt, 150000, 32, "sha256").toString("base64")}`; };

let handler;
export let db;
/** Correos que la función habría enviado (uno por destinatario). */
export const correos = [];

/** Deja registrado (directo en la base falsa) el pago al dueño que cubre el monto de una compra, para las pruebas que solo necesitan aprobarla. */
export function pagarCompra(compraId) {
  const c = db.tablas.compras.find((x) => x.id === compraId);
  if (!c) throw new Error("pagarCompra: no existe la compra " + compraId);
  if (db.tablas.compra_pagos.some((p) => p.compra_id === compraId && p.estado !== "anulado")) return;
  db.tablas.compra_pagos.push({
    id: randomUUID(), numero: db.tablas.compra_pagos.length + 1, compra_id: c.id, local_id: c.local_id ?? null, medio: "efectivo", monto: Number(c.monto_final ?? c.monto_oferta),
    fecha_pago: "2026-11-01", estado: "vigente", archivos: [{ id: "archcmp00001", nombre: "recibo.jpg", tipo: "image/jpeg", tam: 1000 }], cuenta_id: null, cuenta_detalle: null,
    referencia: null, notas: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString(),
  });
}

/** El pago de una reserva (efectivo con su respaldo) para las pruebas que solo necesitan reservar. */
export const pagoReserva = () => ({ medio: "efectivo", fechaPago: new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }), archivos: [{ id: "archres" + randomUUID().slice(0, 8).replace(/-/g, ""), nombre: "recibo.jpg", tipo: "image/jpeg", tam: 1000 }] });

/**
 * Deja listo (directo en la base falsa) lo que pide la aprobación de una venta: el pago de la reserva validado y los pagos que cubren el resto del precio.
 * Para las pruebas que solo necesitan aprobar la venta.
 */
export function pagarTodo(cierreId) {
  const cierre = db.tablas.cierres.find((c) => c.id === cierreId);
  if (!cierre) throw new Error("pagarTodo: no existe el cierre " + cierreId);
  const reserva = db.tablas.reservas.find((r) => r.id === cierre.reserva_id);
  if (reserva && (reserva.pago_estado === "pendiente" || reserva.pago_estado === "rechazado")) reserva.pago_estado = "validado";
  if (db.tablas.cierre_pagos.some((p) => p.cierre_id === cierreId && p.estado !== "anulado")) return; // ya tiene pagos
  const resto = Number(cierre.precio_final) - (Number(cierre.reserva_monto) || 0);
  if (resto <= 0) return;
  db.tablas.cierre_pagos.push({
    id: randomUUID(), numero: db.tablas.cierre_pagos.length + 1, cierre_id: cierre.id, local_id: cierre.local_id ?? null, medio: "efectivo", monto: resto,
    fecha_pago: "2026-11-01", estado: "vigente", archivos: [{ id: "arch000001", nombre: "recibo.jpg", tipo: "image/jpeg", tam: 1000 }], cuenta_id: null, cuenta_detalle: null,
    referencia: null, notas: null, creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString(),
  });
}
/** Respuestas simuladas de la API de patentes (Boostr): `respuestas[PATENTE]` = JSON, un número de estado HTTP o un Error. */
export const boostr = { llamadas: [], respuestas: {} };
/** Páginas de referencia del sueldo mínimo (simuladas): dirección → texto de la página, o un número de estado de error. */
export const paginasMinimo = { llamadas: [], respuestas: {} };
/**
 * Graph API de Meta (WhatsApp) simulada. `llamadas`: cada petición { metodo, ruta, cuerpo }. `plantillas`: lo que devuelve message_templates.
 * `fallarEnvio`: si es un texto, el próximo envío de mensajes responde con ese error. `archivos`: id de media → { mime, bytes }.
 */
export const meta = { llamadas: [], plantillas: [], fallarEnvio: "", archivos: {}, n: 0 };
/**
 * Google (OAuth y Calendar API) simulado. `llamadas`: { metodo, url, cuerpo, auth }. `eventos`: id → evento vigente.
 * `fallar`: si es un número, la próxima llamada a Calendar responde con ese estado de error.
 */
/** Meta Ads y Google Ads simulados: cuentas, campañas y métricas que devuelven las APIs de lectura. */
export const ads = {
  meta: { cuenta: { name: "Cuenta BuyCar", currency: "CLP", account_status: 1 }, campanias: [], insights: {}, leads: {}, gastoMensual: {}, fallar: "", llamadas: [] },
  google: { cuenta: { descriptiveName: "BuyCar Google", currencyCode: "CLP" }, campanias: [], metricas: {}, gastoMensual: {}, mutaciones: [], n: 0, fallar: 0, llamadas: [] },
};
export const google = { llamadas: [], eventos: {}, fallar: 0, n: 0, tokens: 0 };
/** Variables de entorno de la función simulada (las pruebas pueden cambiarlas). */
export let entorno = {};
const IP = { n: 1 };

export const iniciarFuncion = async () => {
  db = crearBaseFalsa();
  const dir = mkdtempSync(join(tmpdir(), "df-api-"));
  const fake = join(dir, "fake-supabase.mjs");
  writeFileSync(fake, "export const createClient = () => globalThis.__baseFalsa.cliente;\n");
  const core = pathToFileURL(resolve("supabase/functions/api/crm-core.js")).href;
  let src = readFileSync("supabase/functions/api/index.ts", "utf8");
  src = src.replace("npm:@supabase/supabase-js@2", pathToFileURL(fake).href).replace("./crm-core.js", core).replace("./ventas.ts", pathToFileURL(resolve("supabase/functions/api/ventas.ts")).href).replace("./publico.ts", pathToFileURL(resolve("supabase/functions/api/publico.ts")).href).replace("./alertas.ts", pathToFileURL(resolve("supabase/functions/api/alertas.ts")).href).replace("./patentes-core.js", pathToFileURL(resolve("supabase/functions/api/patentes-core.js")).href).replace("./whatsapp.ts", pathToFileURL(resolve("supabase/functions/api/whatsapp.ts")).href).replace("./ads.ts", pathToFileURL(resolve("supabase/functions/api/ads.ts")).href).replace("./leads-ads.ts", pathToFileURL(resolve("supabase/functions/api/leads-ads.ts")).href).replace("./catalogo.ts", pathToFileURL(resolve("supabase/functions/api/catalogo.ts")).href);
  const archivo = join(dir, "index.mts");
  writeFileSync(archivo, src);
  globalThis.__baseFalsa = db;
  const env = { SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k", SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD_HASH: hashPw(ADMIN_PW), RESEND_API_KEY: "re_prueba", MAIL_FROM: "Drive Futuro <avisos@prueba.cl>", APP_URL: "https://app.prueba.cl", BOOSTR_API_KEY: "clave_prueba", BOOSTR_LIMITE_DIARIO: "5",
    WA_TOKEN: "EAAprueba", WA_PHONE_NUMBER_ID: "PNID1", WA_WABA_ID: "WABA1", WA_APP_SECRET: "secreto-app-prueba", WA_VERIFY_TOKEN: "verificar-prueba-123" };
  entorno = env;
  // Los avisos por correo no salen a internet: se guardan para revisarlos.
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.boostr.cl/vehicle/")) {
      const placa = String(url).split("/vehicle/")[1].replace(".json", "").split("?")[0];
      boostr.llamadas.push({ placa, clave: init && init.headers && init.headers["x-api-key"], url: String(url) });
      const r = boostr.respuestas[placa];
      if (r instanceof Error) throw r;
      if (typeof r === "number") return new Response("{}", { status: r });
      return new Response(JSON.stringify(r !== undefined ? r : { status: "error", data: "", code: "V-02", message: "No encontramos datos asociados a la patente ingresada" }), { status: 200 });
    }
    if (String(url).startsWith("https://www.calcular.cl/") || String(url).startsWith("https://finclaro.cl/")) {
      paginasMinimo.llamadas.push(String(url));
      const r = paginasMinimo.respuestas[String(url)];
      if (r instanceof Error) throw r;
      if (typeof r === "number") return new Response("", { status: r });
      return new Response(r ?? "<html>sin datos</html>", { status: 200 });
    }
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      google.tokens++;
      google.llamadas.push({ metodo: "POST", url: String(url), cuerpo: String(init.body) });
      return new Response(JSON.stringify({ access_token: `ya29.prueba${google.tokens}`, expires_in: 3599, token_type: "Bearer" }), { status: 200 });
    }
    if (String(url).startsWith("https://www.googleapis.com/calendar/v3/")) {
      const u = new URL(String(url));
      const metodo = (init && init.method) || "GET";
      const cuerpo = init && typeof init.body === "string" ? JSON.parse(init.body) : null;
      google.llamadas.push({ metodo, url: String(url), ruta: u.pathname, query: Object.fromEntries(u.searchParams), cuerpo, auth: init && init.headers && init.headers.authorization });
      if (google.fallar) { const st = google.fallar; google.fallar = 0; return new Response(JSON.stringify({ error: { code: st, message: "falla simulada" } }), { status: st }); }
      const partes = u.pathname.split("/");
      const id = partes[partes.length - 1];
      if (metodo === "POST") { const nuevo = { ...cuerpo, id: `evt${++google.n}`, status: "confirmed" }; google.eventos[nuevo.id] = nuevo; return new Response(JSON.stringify(nuevo), { status: 200 }); }
      if (metodo === "PATCH") { if (!google.eventos[id]) return new Response(JSON.stringify({ error: { code: 404, message: "Not Found" } }), { status: 404 }); Object.assign(google.eventos[id], cuerpo); return new Response(JSON.stringify(google.eventos[id]), { status: 200 }); }
      if (metodo === "DELETE") { if (google.eventos[id]) google.eventos[id].status = "cancelled"; return new Response(null, { status: 204 }); }
      return new Response("{}", { status: 404 });
    }
    if (String(url).startsWith("https://graph.facebook.com/") || String(url).startsWith("https://lookaside.prueba/")) {
      const u = new URL(String(url));
      const metodo = (init && init.method) || "GET";
      let cuerpo = null;
      if (init && typeof init.body === "string") cuerpo = JSON.parse(init.body);
      else if (init && init.body && typeof init.body.get === "function") cuerpo = { form: true, type: init.body.get("type"), messaging_product: init.body.get("messaging_product") };
      meta.llamadas.push({ metodo, ruta: u.pathname, cuerpo, auth: init && init.headers && init.headers.authorization });
      const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
      if (u.hostname === "lookaside.prueba") { const a = meta.archivos[u.pathname.slice(1)]; return a ? new Response(a.bytes, { status: 200 }) : new Response("", { status: 404 }); }
      // Meta Ads (solo lectura): cuenta publicitaria, campañas y métricas (insights) de una campaña.
      // Formulario respondido (Lead Ads): /{leadgen_id}?fields=field_data,...
      const idLead = u.pathname.split("/").pop();
      if (metodo === "GET" && ads.meta.leads[idLead]) {
        ads.meta.llamadas.push({ ruta: u.pathname, query: Object.fromEntries(u.searchParams), auth: init && init.headers && init.headers.authorization });
        if (ads.meta.fallar) { const m = ads.meta.fallar; ads.meta.fallar = ""; return new Response(JSON.stringify({ error: { message: m, code: 200 } }), { status: 403 }); }
        return ok({ id: idLead, created_time: "2026-11-23T15:00:00+0000", ...ads.meta.leads[idLead] });
      }
      if (/\/act_\d+\/insights$/.test(u.pathname)) {
        ads.meta.llamadas.push({ ruta: u.pathname, query: Object.fromEntries(u.searchParams) });
        return ok({ data: Object.entries(ads.meta.gastoMensual).map(([mes, spend]) => ({ spend: String(spend), date_start: `${mes}-01` })) });
      }
      const mAct = /\/act_(\d+)(\/campaigns)?$/.exec(u.pathname);
      const mIns = /\/(\d+)\/insights$/.exec(u.pathname);
      if (mAct || mIns) {
        ads.meta.llamadas.push({ ruta: u.pathname, query: Object.fromEntries(u.searchParams), auth: init && init.headers && init.headers.authorization });
        if (ads.meta.fallar) { const m = ads.meta.fallar; ads.meta.fallar = ""; return new Response(JSON.stringify({ error: { message: m, code: 190 } }), { status: 400 }); }
        if (mAct && mAct[2]) return ok({ data: ads.meta.campanias });
        if (mAct) return ok(ads.meta.cuenta);
        const rango = JSON.parse(u.searchParams.get("time_range") || "{}");
        const fila = ads.meta.insights[mIns[1]];
        return ok({ data: fila ? [{ ...fila, date_start: rango.since, date_stop: rango.until }] : [] });
      }
      if (u.pathname.endsWith("/message_templates")) {
        if (metodo === "POST") {
          if (meta.plantillas.some((p) => p.name === cuerpo.name)) return new Response(JSON.stringify({ error: { message: "Ya existe una plantilla con ese nombre", error_user_msg: "Ya existe una plantilla con ese nombre", code: 100 } }), { status: 400 });
          const nueva = { ...cuerpo, id: "tpl" + ++meta.n, status: "PENDING" };
          meta.plantillas.push(nueva);
          return ok({ id: nueva.id, status: "PENDING", category: cuerpo.category });
        }
        if (metodo === "DELETE") { const nombre = u.searchParams.get("name"); meta.plantillas = meta.plantillas.filter((p) => p.name !== nombre); return ok({ success: true }); }
        return ok({ data: meta.plantillas });
      }
      if (u.pathname.endsWith("/media") && metodo === "POST") return ok({ id: "mediasal" + ++meta.n });
      if (u.pathname.endsWith("/messages") && metodo === "POST") {
        if (meta.fallarEnvio) { const m = meta.fallarEnvio; meta.fallarEnvio = ""; return new Response(JSON.stringify({ error: { message: m, code: 131047 } }), { status: 400 }); }
        if (cuerpo && cuerpo.status === "read") return ok({ success: true });
        return ok({ messaging_product: "whatsapp", contacts: [{ wa_id: cuerpo && cuerpo.to }], messages: [{ id: "wamid.SAL" + ++meta.n }] });
      }
      const mid = u.pathname.split("/").pop();
      if (metodo === "GET" && meta.archivos[mid]) return ok({ url: "https://lookaside.prueba/" + mid, mime_type: meta.archivos[mid].mime, file_size: meta.archivos[mid].bytes.length, id: mid });
      return new Response(JSON.stringify({ error: { message: "no encontrado", code: 100 } }), { status: 404 });
    }
    if (String(url).startsWith("https://googleads.googleapis.com/") && String(url).endsWith(":mutate")) {
      const cuerpo = JSON.parse(init.body);
      ads.google.llamadas.push({ url: String(url), mutate: cuerpo.mutateOperations, headers: init.headers });
      if (ads.google.fallar) { const st = ads.google.fallar; ads.google.fallar = 0; return new Response(JSON.stringify({ error: { code: st, message: "falla simulada", details: [{ errors: [{ message: "La campaña no cumple las políticas" }] }] } }), { status: st }); }
      ads.google.mutaciones.push(cuerpo.mutateOperations);
      const cliente = String(url).split("/customers/")[1].split("/")[0];
      const respuestas = cuerpo.mutateOperations.map((op) => {
        const [tipo, cambio] = Object.entries(op)[0];
        const recurso = { campaignBudgetOperation: "campaignBudgets", campaignOperation: "campaigns", campaignCriterionOperation: "campaignCriteria", adGroupOperation: "adGroups", adGroupAdOperation: "adGroupAds", adGroupCriterionOperation: "adGroupCriteria" }[tipo];
        const nombre = tipo.replace("Operation", "Result");
        const rn = cambio.update ? cambio.update.resourceName : `customers/${cliente}/${recurso}/${tipo === "campaignOperation" ? 9000000 + ++ads.google.n : ++ads.google.n}`;
        if (tipo === "campaignOperation" && cambio.update) { const id = rn.split("/").pop(); const c = ads.google.campanias.find((x) => x.id === id); if (c) c.status = cambio.update.status; }
        if (tipo === "campaignOperation" && cambio.create) ads.google.campanias.push({ id: rn.split("/").pop(), name: cambio.create.name, status: cambio.create.status });
        return { [nombre]: { resourceName: rn } };
      });
      return new Response(JSON.stringify({ mutateOperationResponses: respuestas }), { status: 200 });
    }
    if (String(url).startsWith("https://googleads.googleapis.com/")) {
      const cuerpo = JSON.parse(init.body);
      ads.google.llamadas.push({ url: String(url), query: cuerpo.query, headers: init.headers });
      if (ads.google.fallar) { const st = ads.google.fallar; ads.google.fallar = 0; return new Response(JSON.stringify({ error: { code: st, message: "falla simulada", details: [{ errors: [{ message: "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION" }] }] } }), { status: st }); }
      const q = cuerpo.query;
      if (/segments\.month/.test(q)) return new Response(JSON.stringify({ results: Object.entries(ads.google.gastoMensual).map(([mes, pesos]) => ({ segments: { month: `${mes}-01` }, metrics: { costMicros: String(pesos * 1_000_000) } })) }), { status: 200 });
      if (/FROM customer/.test(q)) return new Response(JSON.stringify({ results: [{ customer: ads.google.cuenta }] }), { status: 200 });
      const id = (/campaign\.id = (\d+)/.exec(q) || [])[1];
      if (id) {
        const m = ads.google.metricas[id];
        const fecha = /BETWEEN '(\S+)' AND '(\S+)'/.exec(q);
        // Dos filas por campaña (segmentadas por día) para comprobar que se suman.
        return new Response(JSON.stringify({ results: m ? [{ campaign: { id }, metrics: { costMicros: String(Math.round(m.costMicros / 2)), impressions: String(Math.floor(m.impressions / 2)), clicks: String(Math.floor(m.clicks / 2)), conversions: m.conversions / 2 } }, { campaign: { id }, metrics: { costMicros: String(m.costMicros - Math.round(m.costMicros / 2)), impressions: String(m.impressions - Math.floor(m.impressions / 2)), clicks: String(m.clicks - Math.floor(m.clicks / 2)), conversions: m.conversions / 2 } }] : [], fechas: fecha && [fecha[1], fecha[2]] }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: ads.google.campanias.map((c) => ({ campaign: c })) }), { status: 200 });
    }
    if (String(url).startsWith("https://api.resend.com/")) { correos.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
    return fetchReal(url, init);
  };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  await import(pathToFileURL(archivo).href);
};
export const prepararFuncion = () => before(iniciarFuncion);

/** Atiende una petición HTTP tal cual la recibiría la función (lo usa el entorno de demostración). */
export const manejar = (req) => handler(req);

export async function api(body) {
  const ip = `10.0.0.${IP.n}`;
  const res = await handler(new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));
  return { status: res.status, ...(await res.json()) };
}
export const nuevaIp = () => { IP.n++; };
/** GET sin cuerpo (chequeo de salud). */
export async function obtener(ruta) {
  const res = await handler(new Request("http://x/api" + ruta, { method: "GET" }));
  return { status: res.status, ...(await res.json()) };
}

export async function loginAdmin() {
  const r = await api({ action: "adminLogin", email: ADMIN_EMAIL, password: ADMIN_PW });
  assert.equal(r.status, 200);
  return r.token;
}
export const crm = (token, op, extra = {}) => api({ action: "crm", token, op, ...extra });


export { ADMIN_EMAIL, ADMIN_PW };
