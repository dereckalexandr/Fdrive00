// Núcleo del módulo comercial (entrega 2A): inventario, clientes, leads de venta y tareas.
// JavaScript puro, sin APIs de Deno ni del navegador: lo usan el servidor, la pantalla y las pruebas.
import { validarRut, normalizarRut } from "./crm-core.js";
import { FINANCIERAS } from "./comisiones-core.js";

/* ---------- Catálogos fijos ---------- */
export const ESTADOS_VEHICULO = [
  { id: "preparacion", nombre: "En preparación" },
  { id: "disponible", nombre: "Disponible" },
  { id: "reservado", nombre: "Reservado" },
  { id: "vendido", nombre: "Vendido" },
];

/**
 * Etapas del embudo. `disponible:false` = todavía no se usa.
 * `automatica:true` = el lead llega ahí solo (al cotizar o reservar); no se mueve a mano.
 */
export const ETAPAS = [
  { id: "nuevo", nombre: "Nuevo", disponible: true },
  { id: "contactado", nombre: "Contactado", disponible: true },
  { id: "seguimiento", nombre: "En seguimiento", disponible: true },
  { id: "cotizado", nombre: "Cotizado", disponible: true, automatica: true },
  { id: "reservado", nombre: "Reservado", disponible: true, automatica: true },
  { id: "ganado", nombre: "Cerrado ganado", disponible: true, automatica: true },
  { id: "perdido", nombre: "Cerrado perdido", disponible: true },
];
/**
 * Etapas que solo existen en compras y consignaciones. Son automáticas (el sistema las mueve según lo que va pasando) y no se pueden elegir a mano.
 * Se suman a las de siempre; los leads de venta no las usan.
 */
export const ETAPAS_EXTRA = [
  { id: "tasacion", nombre: "Tasación", disponible: true, automatica: true },
  { id: "contrato", nombre: "Contrato", disponible: true, automatica: true },
  { id: "documentos", nombre: "Documentos y pago", disponible: true, automatica: true },
];
export const ETAPAS_TODAS = [...ETAPAS, ...ETAPAS_EXTRA];
export const ETAPAS_MANUALES = ETAPAS.filter((e) => e.disponible && !e.automatica).map((e) => e.id);
export const ETAPAS_ACTIVAS = ETAPAS.filter((e) => e.disponible).map((e) => e.id);
export const ETAPAS_CERRADAS = ["ganado", "perdido"];
export const etapaNombre = (id) => (ETAPAS_TODAS.find((e) => e.id === id) || {}).nombre || id;

export const TIPOS_CONTACTO = [
  { id: "llamada", nombre: "Llamada" },
  { id: "whatsapp", nombre: "WhatsApp" },
  { id: "visita", nombre: "Visita" },
  { id: "nota", nombre: "Nota" },
];
export const TIPOS_TAREA = [
  { id: "llamada", nombre: "Llamar" },
  { id: "whatsapp", nombre: "Escribir por WhatsApp" },
  { id: "visita", nombre: "Visita" },
  { id: "otro", nombre: "Otro" },
];
export const ESTADOS_FINANCIAMIENTO = [
  { id: "no_aplica", nombre: "No necesita" },
  { id: "por_evaluar", nombre: "Por evaluar" },
  { id: "en_evaluacion", nombre: "En evaluación" },
  { id: "aprobado", nombre: "Aprobado" },
  { id: "rechazado", nombre: "Rechazado" },
];
export const TRANSMISIONES = ["Mecánica", "Automática"];
export const COMBUSTIBLES = ["Bencina", "Diesel", "Híbrido", "Eléctrico"];

/* ---------- Utilidades ---------- */
const texto = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const entero = (v, min, max) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};

/** "ab cd-12" -> "ABCD12". */
export function normalizarPatente(p) {
  return String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export const patenteValida = (p) => /^(?:[A-Z]{4}\d{2}|[A-Z]{2}\d{4})$/.test(normalizarPatente(p));

/** Solo dígitos: "+56 9 1234 5678" -> "56912345678". */
export const soloDigitos = (t) => String(t || "").replace(/\D/g, "");

/* ---------- Vehículos ---------- */
export function validarVehiculo(input) {
  const i = input || {};
  const patente = normalizarPatente(i.patente);
  if (!patenteValida(patente)) return { ok: false, error: "patente_invalida" };
  const marca = texto(i.marca, 40);
  const modelo = texto(i.modelo, 60);
  if (marca.length < 2 || modelo.length < 1) return { ok: false, error: "marca_modelo_requeridos" };
  const anio = entero(i.anio, 1950, new Date().getFullYear() + 1);
  if (anio === null || Number.isNaN(anio)) return { ok: false, error: "anio_invalido" };
  const km = entero(i.km ?? 0, 0, 2_000_000);
  if (km === null || Number.isNaN(km)) return { ok: false, error: "km_invalido" };
  const precio = entero(i.precioLista, 0, 2_000_000_000);
  const costo = entero(i.costo, 0, 2_000_000_000);
  const financiamiento = entero(i.precioFinanciamiento, 0, 2_000_000_000);
  if (Number.isNaN(precio) || Number.isNaN(costo) || Number.isNaN(financiamiento)) return { ok: false, error: "precio_invalido" };
  // El precio con financiamiento es opcional y nunca supera al de lista: la diferencia es el «bono financiamiento».
  if (financiamiento && !precio) return { ok: false, error: "financiamiento_sin_lista" };
  if (financiamiento && financiamiento > precio) return { ok: false, error: "financiamiento_mayor_que_lista" };
  const estado = i.estado || "disponible";
  if (!ESTADOS_VEHICULO.some((e) => e.id === estado)) return { ok: false, error: "estado_invalido" };
  const transmision = texto(i.transmision, 20);
  const combustible = texto(i.combustible, 20);
  if (transmision && !TRANSMISIONES.includes(transmision)) return { ok: false, error: "transmision_invalida" };
  if (combustible && !COMBUSTIBLES.includes(combustible)) return { ok: false, error: "combustible_invalido" };
  const fotos = Array.isArray(i.fotos) ? Array.from(new Set(i.fotos.map(String))).filter((f) => /^[A-Za-z0-9]{6,40}$/.test(f)).slice(0, 8) : [];
  return {
    ok: true,
    value: {
      patente, marca, modelo, version: texto(i.version, 60) || null, anio, km, color: texto(i.color, 30) || null,
      transmision: transmision || null, combustible: combustible || null, precio_lista: precio, precio_financiamiento: financiamiento || null, costo, estado,
      notas: texto(i.notas, 500) || null, fotos,
    },
  };
}

/** Quita el costo (dato sensible) si la persona no puede verlo. */
export function ocultarCosto(vehiculo, puedeVerCosto) {
  if (puedeVerCosto) return vehiculo;
  const { costo, ...resto } = vehiculo; // eslint-disable-line no-unused-vars
  return resto;
}

/* ---------- Clientes ---------- */
export function validarCliente(input) {
  const i = input || {};
  const nombre = texto(i.nombre, 80);
  if (nombre.length < 3) return { ok: false, error: "nombre_invalido" };
  let rut = null;
  if (String(i.rut ?? "").trim()) {
    if (!validarRut(i.rut)) return { ok: false, error: "rut_invalido" };
    rut = normalizarRut(i.rut);
  }
  const telefono = texto(i.telefono, 30);
  if (telefono && soloDigitos(telefono).length < 8) return { ok: false, error: "telefono_invalido" };
  const email = texto(i.email, 80).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "email_invalido" };
  if (!telefono && !email) return { ok: false, error: "contacto_requerido" };
  return { ok: true, value: { nombre, rut, telefono: telefono || null, email: email || null, notas: texto(i.notas, 500) || null } };
}

/* ---------- Leads ---------- */
function validarParteDePago(p) {
  if (!p || !p.tiene) return { ok: true, value: {} };
  const anio = entero(p.anio, 1950, new Date().getFullYear() + 1);
  const km = entero(p.km, 0, 2_000_000);
  const valor = entero(p.valor, 0, 2_000_000_000);
  if ([anio, km, valor].some((n) => Number.isNaN(n))) return { ok: false, error: "parte_pago_invalida" };
  const patente = normalizarPatente(p.patente);
  if (patente && !patenteValida(patente)) return { ok: false, error: "patente_invalida" };
  // Lo que declaró el dueño (opcional): se conserva al editar el lead.
  const extra = {};
  const d = entero(p.duenos, 1, 30);
  if (d !== null && !Number.isNaN(d)) extra.duenos = d;
  if (["si", "no"].includes(p.prenda)) extra.prenda = p.prenda;
  if (["si", "no"].includes(p.mantenciones)) extra.mantenciones = p.mantenciones;
  const pe = entero(p.precioEsperado, 1, 2_000_000_000);
  if (pe !== null && !Number.isNaN(pe)) extra.precioEsperado = pe;
  return { ok: true, value: { tiene: true, patente: patente || null, marca: texto(p.marca, 40) || null, modelo: texto(p.modelo, 60) || null, anio, km, valor, ...extra } };
}

function validarFinanciamiento(f) {
  if (!f || !f.quiere) return { ok: true, value: {} };
  const pie = entero(f.pie, 0, 2_000_000_000);
  if (Number.isNaN(pie)) return { ok: false, error: "financiamiento_invalido" };
  const estado = f.estado || "por_evaluar";
  if (!ESTADOS_FINANCIAMIENTO.some((e) => e.id === estado)) return { ok: false, error: "financiamiento_invalido" };
  return { ok: true, value: { quiere: true, pie, banco: texto(f.banco, 60) || null, estado } };
}

/** Datos editables de un lead (sin etapa ni asignación: esas tienen sus propias operaciones). */
export function validarLead(input) {
  const i = input || {};
  const pp = validarParteDePago(i.parteDePago);
  if (!pp.ok) return pp;
  const fin = validarFinanciamiento(i.financiamiento);
  if (!fin.ok) return fin;
  return {
    ok: true,
    value: {
      vehiculo_id: i.vehiculoId ? String(i.vehiculoId) : null,
      vehiculo_interes: texto(i.vehiculoInteres, 120) || null,
      fuente: texto(i.fuente, 60) || null,
      parte_pago: pp.value,
      financiamiento: fin.value,
      notas: texto(i.notas, 1000) || null,
    },
  };
}

/**
 * ¿Se puede pasar el lead de `desde` a `hacia`?
 * - Solo a etapas disponibles hoy (cotizado/reservado/ganado llegan con sus entregas).
 * - Un lead cerrado solo lo reabre quien puede reasignar (supervisor).
 * - Perder exige un motivo.
 */
export function validarCambioEtapa({ desde, hacia, motivo, puedeReabrir = false }) {
  if (!ETAPAS_ACTIVAS.includes(hacia)) return { ok: false, error: "etapa_no_disponible" };
  if (!ETAPAS_MANUALES.includes(hacia)) return { ok: false, error: "etapa_automatica" };
  if (desde === "ganado") return { ok: false, error: "venta_cerrada" }; // una venta cerrada solo se revierte anulando el cierre
  if (desde === hacia) return { ok: false, error: "sin_cambio" };
  if (ETAPAS_CERRADAS.includes(desde) && !puedeReabrir) return { ok: false, error: "lead_cerrado" };
  const m = texto(motivo, 80);
  if (hacia === "perdido" && !m) return { ok: false, error: "motivo_requerido" };
  return { ok: true, value: { etapa: hacia, motivo_perdida: hacia === "perdido" ? m : null } };
}

/**
 * Reparto rotativo: elige a quien lleva MÁS tiempo sin recibir un lead (o nunca recibió).
 * `candidatos`: [{id, nombre}]; `ultimaAsignacion`: { [id]: ISO | undefined }.
 */
export function elegirAsignado(candidatos, ultimaAsignacion) {
  if (!candidatos || candidatos.length === 0) return null;
  const orden = [...candidatos].sort((a, b) => {
    const ta = ultimaAsignacion[a.id] ? Date.parse(ultimaAsignacion[a.id]) : -Infinity;
    const tb = ultimaAsignacion[b.id] ? Date.parse(ultimaAsignacion[b.id]) : -Infinity;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : 1; // desempate estable
  });
  return orden[0];
}

/* ---------- Tareas ---------- */
export const ZONA_HORARIA = "America/Santiago";
const diaLocal = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: ZONA_HORARIA }); // AAAA-MM-DD

export function validarTarea(input) {
  const i = input || {};
  const titulo = texto(i.titulo, 120);
  if (titulo.length < 3) return { ok: false, error: "titulo_invalido" };
  const tipo = i.tipo || "llamada";
  if (!TIPOS_TAREA.some((t) => t.id === tipo)) return { ok: false, error: "tipo_invalido" };
  const ms = Date.parse(i.venceEn);
  if (!Number.isFinite(ms)) return { ok: false, error: "fecha_invalida" };
  return { ok: true, value: { titulo, tipo, vence_en: new Date(ms).toISOString() } };
}

/** 'vencida' (día anterior o antes), 'hoy' o 'proxima', según el día en Chile. */
export function claseTarea(venceEn, ahora = new Date()) {
  const v = diaLocal(venceEn);
  const h = diaLocal(ahora);
  return v < h ? "vencida" : v === h ? "hoy" : "proxima";
}

/** Agrupa tareas pendientes en vencidas / hoy / próximas, cada grupo ordenado por fecha. */
export function agruparTareas(tareas, ahora = new Date()) {
  const out = { vencidas: [], hoy: [], proximas: [] };
  for (const t of tareas) {
    if (t.hecha) continue;
    const c = claseTarea(t.vence_en ?? t.venceEn, ahora);
    (c === "vencida" ? out.vencidas : c === "hoy" ? out.hoy : out.proximas).push(t);
  }
  const porFecha = (a, b) => Date.parse(a.vence_en ?? a.venceEn) - Date.parse(b.vence_en ?? b.venceEn);
  out.vencidas.sort(porFecha); out.hoy.sort(porFecha); out.proximas.sort(porFecha);
  return out;
}

/* ---------- Embudo ---------- */
/** Cuenta leads por etapa (todas las etapas, aunque estén en 0). */
export function contarPorEtapa(leads) {
  const out = {};
  for (const e of ETAPAS_TODAS) out[e.id] = 0;
  for (const l of leads) if (out[l.etapa] !== undefined) out[l.etapa]++;
  return out;
}

/** Leads "nuevos por atender": etapa nueva y todavía sin ningún contacto. */
export const leadsPorAtender = (leads) => leads.filter((l) => l.etapa === "nuevo" && !l.ultimo_contacto);

/* ---------- Cotizaciones ---------- */
export const ESTADOS_COTIZACION = [
  { id: "vigente", nombre: "Vigente" },
  { id: "pendiente", nombre: "Esperando aprobación" },
  { id: "rechazada", nombre: "Descuento rechazado" },
  { id: "reservada", nombre: "Con reserva" },
  { id: "vendida", nombre: "Vendida" },
  { id: "anulada", nombre: "Anulada" },
];
export const cotizacionNombre = (id) => (ESTADOS_COTIZACION.find((e) => e.id === id) || {}).nombre || id;
/** Estados en que la cotización se puede entregar al cliente (PDF). Solo "vigente" se puede reservar. */
export const COTIZACION_ENTREGABLE = ["vigente", "reservada"];

/** Cuota mensual estimada (sistema francés). Con tasa 0 es una división simple. */
export function cuotaEstimada(monto, plazoMeses, tasaMensualPct) {
  const P = Number(monto), n = Number(plazoMeses), r = Number(tasaMensualPct || 0) / 100;
  if (!(P > 0) || !(n > 0)) return 0;
  if (r === 0) return Math.round(P / n);
  return Math.round((P * r) / (1 - Math.pow(1 + r, -n)));
}

/**
 * Números de una cotización: precio final, parte de pago, pie, saldo y cuota.
 * `saldo` = lo que el cliente debe pagar además del vehículo en parte de pago.
 * Si necesita financiamiento, `montoFinanciar` = saldo − pie.
 */
export function calcularCotizacion({ precioLista, descuento, parteDePago, financiamiento }) {
  const lista = Number(precioLista) || 0;
  const desc = Number(descuento) || 0;
  const precioFinal = lista - desc;
  const parte = parteDePago && parteDePago.tiene ? Number(parteDePago.valor) || 0 : 0;
  const quiere = !!(financiamiento && financiamiento.quiere);
  const pie = quiere ? Number(financiamiento.pie) || 0 : 0;
  const saldo = precioFinal - parte;
  const montoFinanciar = quiere ? Math.max(0, saldo - pie) : 0;
  const cuota = quiere ? cuotaEstimada(montoFinanciar, financiamiento.plazo_meses ?? financiamiento.plazoMeses, financiamiento.tasa_mensual_pct ?? financiamiento.tasaMensualPct) : 0;
  return {
    precioFinal, descuentoPct: lista > 0 ? Math.round((desc / lista) * 1000) / 10 : 0, parte, pie, saldo, montoFinanciar, cuota,
    excede: parte + pie > precioFinal,
  };
}

/**
 * Valida los datos que la persona ingresa en una cotización. El precio de lista NO viene de la pantalla:
 * lo fija el servidor desde el inventario (`precioLista` del vehículo).
 */
export function validarCotizacion(input, precioLista) {
  const i = input || {};
  const lista = Number(precioLista);
  if (!Number.isFinite(lista) || lista <= 0) return { ok: false, error: "vehiculo_sin_precio" };
  const descuento = entero(i.descuento ?? 0, 0, 2_000_000_000);
  if (descuento === null || Number.isNaN(descuento) || descuento > lista) return { ok: false, error: "descuento_invalido" };
  const pp = validarParteDePago(i.parteDePago);
  if (!pp.ok) return pp;
  let fin = { quiere: false };
  if (i.financiamiento && i.financiamiento.quiere) {
    const f = validarFinanciamiento(i.financiamiento);
    if (!f.ok) return f;
    const plazo = entero(i.financiamiento.plazoMeses ?? i.financiamiento.plazo_meses, 1, 120);
    const tasa = i.financiamiento.tasaMensualPct ?? i.financiamiento.tasa_mensual_pct;
    const tasaN = tasa === "" || tasa === undefined || tasa === null ? 0 : Number(tasa);
    if (Number.isNaN(plazo) || !Number.isFinite(tasaN) || tasaN < 0 || tasaN > 10) return { ok: false, error: "financiamiento_invalido" };
    fin = { ...f.value, plazo_meses: plazo, tasa_mensual_pct: tasaN };
  }
  const calc = calcularCotizacion({ precioLista: lista, descuento, parteDePago: pp.value, financiamiento: fin });
  if (calc.excede) return { ok: false, error: "pago_excede_precio" };
  return {
    ok: true,
    value: { precio_lista: lista, descuento, precio_final: calc.precioFinal, parte_pago: pp.value, financiamiento: fin, notas: texto(i.notas, 500) || null },
  };
}

/** Sin descuento, o con descuento y quien cotiza puede aprobarlo: vigente. Si no, espera al supervisor. */
export function estadoCotizacionInicial({ descuento, puedeAprobar }) {
  return Number(descuento) > 0 && !puedeAprobar ? "pendiente" : "vigente";
}

/** ¿Hay que volver a pedir aprobación al editar? Si hay descuento y cambió el monto, el precio de lista, o no estaba aprobada. */
export function requiereNuevaAprobacion(antes, despues) {
  return Number(despues.descuento) > 0 && (Number(antes.descuento) !== Number(despues.descuento) || Number(antes.precio_lista) !== Number(despues.precio_lista) || antes.estado !== "vigente");
}

/* ---------- Reservas ---------- */
export const MEDIOS_PAGO = ["Efectivo", "Transferencia", "Tarjeta", "Cheque", "Otro"];

export function validarReserva(input, { precioFinal, diasDefecto = 3 } = {}) {
  const i = input || {};
  const monto = entero(i.monto, 1, 2_000_000_000);
  if (monto === null || Number.isNaN(monto)) return { ok: false, error: "monto_invalido" };
  if (precioFinal && monto > precioFinal) return { ok: false, error: "monto_invalido" };
  const dias = entero(i.dias ?? diasDefecto, 1, 30);
  if (dias === null || Number.isNaN(dias)) return { ok: false, error: "dias_invalidos" };
  const medio = texto(i.medioPago, 20);
  if (medio && !MEDIOS_PAGO.includes(medio)) return { ok: false, error: "medio_invalido" };
  return { ok: true, value: { monto, dias, medio_pago: medio || null, notas: texto(i.notas, 300) || null } };
}

export const reservaVencida = (reserva, ahora = new Date()) => reserva.estado === "activa" && Date.parse(reserva.vence_en) < ahora.getTime();

/** "vence en 5 h", "vence en 3 d", "vencida". */
export function textoVencimiento(venceEn, ahora = new Date()) {
  const ms = Date.parse(venceEn) - ahora.getTime();
  if (ms <= 0) return "vencida";
  const horas = ms / 3_600_000;
  if (horas < 24) return `vence en ${Math.max(1, Math.round(horas))} h`;
  return `vence en ${Math.round(horas / 24)} d`;
}

/* ---------- Cierre de venta ---------- */
export { FINANCIERAS };
export const ESTADOS_CIERRE = [
  { id: "pendiente", nombre: "Esperando aprobación" },
  { id: "aprobada", nombre: "Venta aprobada" },
  { id: "rechazada", nombre: "Rechazada" },
  { id: "anulada", nombre: "Anulada" },
];
export const cierreNombre = (id) => (ESTADOS_CIERRE.find((e) => e.id === id) || {}).nombre || id;

/** "2026-10" según el día en Chile. */
export const mesChile = (fecha = new Date()) => new Date(fecha).toLocaleDateString("en-CA", { timeZone: ZONA_HORARIA }).slice(0, 7);
export const esMes = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ""));
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const nombreMes = (m) => (esMes(m) ? `${MESES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` : "");

function fechaIso(t) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t || ""))) return null;
  const d = new Date(`${t}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : d;
}

/**
 * Datos que registra el cierre de una venta. Reglas:
 *  - precio final > 0; los pagos informados (parte de pago + financiado) no pueden superarlo;
 *  - si hay monto financiado, se exige la financiera (y su comisión, que alimenta la comisión por créditos);
 *  - la fecha de entrega es obligatoria y razonable (hasta 60 días atrás y 1 año adelante).
 */
export function validarCierre(input, ahora = new Date()) {
  const i = input || {};
  const precio = entero(i.precioFinal, 1, 2_000_000_000);
  if (precio === null || Number.isNaN(precio)) return { ok: false, error: "precio_cierre_invalido" };
  const parte = entero(i.montoParteDePago ?? 0, 0, 2_000_000_000);
  const financiado = entero(i.montoFinanciado ?? 0, 0, 2_000_000_000);
  if (parte === null || financiado === null || Number.isNaN(parte) || Number.isNaN(financiado)) return { ok: false, error: "pagos_invalidos" };
  if (parte + financiado > precio) return { ok: false, error: "pagos_exceden_precio" };

  let financiera = null;
  let comision = 0;
  if (financiado > 0) {
    financiera = texto(i.financiera, 30);
    if (!FINANCIERAS.includes(financiera)) return { ok: false, error: "financiera_requerida" };
    comision = entero(i.comisionFinanciera ?? 0, 0, 2_000_000_000);
    if (comision === null || Number.isNaN(comision)) return { ok: false, error: "comision_invalida" };
  }

  const entrega = fechaIso(i.fechaEntrega);
  if (!entrega) return { ok: false, error: "fecha_entrega_invalida" };
  const dias = (entrega.getTime() - ahora.getTime()) / 86_400_000;
  if (dias < -61 || dias > 366) return { ok: false, error: "fecha_entrega_invalida" };

  return {
    ok: true,
    value: {
      precio_final: precio, monto_parte_pago: parte, monto_financiado: financiado, financiera, comision_financiera: comision,
      seguro: i.seguro === true, fecha_entrega: i.fechaEntrega, notas: texto(i.notas, 500) || null,
    },
  };
}

/** Margen de una venta: precio final − costo del vehículo (null si no se conoce el costo). */
export const margenVenta = (precioFinal, costo) => (costo === null || costo === undefined ? null : Number(precioFinal) - Number(costo));

/* ---------- Gestión del supervisor: alertas y embudo ---------- */
export const ETAPAS_DETENIBLES = ["contactado", "seguimiento", "cotizado"];
export const ETAPAS_ABIERTAS = ["nuevo", "contactado", "seguimiento", "tasacion", "contrato", "cotizado", "reservado", "documentos"];

const marca = (t) => (t ? Date.parse(t) : NaN);
export const horasDesde = (iso, ahora = new Date()) => (ahora.getTime() - Date.parse(iso)) / 3_600_000;

/** Último momento en que pasó algo en el lead (el más reciente entre sus marcas de tiempo). */
export function ultimaActividad(lead) {
  const t = [lead.ultima_actividad, lead.ultimo_contacto, lead.actualizado_en, lead.creado_en].map(marca).filter(Number.isFinite);
  return t.length ? new Date(Math.max(...t)).toISOString() : null;
}

/** Lead nuevo, sin ningún contacto, que lleva `horas` o más esperando. */
export const esSinAtender = (lead, ahora, horas) => lead.etapa === "nuevo" && !lead.ultimo_contacto && horasDesde(lead.creado_en, ahora) >= horas;

/** Lead en seguimiento / cotizado sin actividad hace `dias` o más. (Las reservas se vigilan por su vencimiento.) */
export function esDetenido(lead, ahora, dias) {
  const u = ultimaActividad(lead);
  return ETAPAS_DETENIBLES.includes(lead.etapa) && u !== null && horasDesde(u, ahora) >= dias * 24;
}

/** "hace 5 h", "hace 3 d". */
export function edadTexto(iso, ahora = new Date()) {
  if (!iso) return "";
  const h = horasDesde(iso, ahora);
  if (h < 1) return "hace minutos";
  if (h < 48) return `hace ${Math.floor(h)} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

/**
 * Embudo de un grupo de leads (los que llegaron en un mes). `conjuntos` = ids de leads que llegaron a cada punto:
 * { cotizados, reservados, vendidos } (Set). Un lead cuenta como contactado si tuvo un contacto o ya salió de "Nuevo".
 */
export function embudoCohorte(leads, { cotizados, reservados, vendidos }) {
  const total = leads.length;
  const contactados = leads.filter((l) => l.etapa !== "nuevo" || l.ultimo_contacto).length;
  const nCot = leads.filter((l) => cotizados.has(l.id)).length;
  const nRes = leads.filter((l) => reservados.has(l.id)).length;
  const nVen = leads.filter((l) => vendidos.has(l.id)).length;
  const perdidos = leads.filter((l) => l.etapa === "perdido").length;
  const pasos = [
    { id: "leads", nombre: "Leads recibidos", n: total, pctTotal: total ? 100 : 0, pctPaso: total ? 100 : 0 },
    { id: "contactados", nombre: "Contactados", n: contactados, pctTotal: pct(contactados, total), pctPaso: pct(contactados, total) },
    { id: "cotizados", nombre: "Cotizados", n: nCot, pctTotal: pct(nCot, total), pctPaso: pct(nCot, contactados) },
    { id: "reservados", nombre: "Reservados", n: nRes, pctTotal: pct(nRes, total), pctPaso: pct(nRes, nCot) },
    { id: "vendidos", nombre: "Vendidos", n: nVen, pctTotal: pct(nVen, total), pctPaso: pct(nVen, nRes) },
  ];
  return { total, perdidos, pasos };
}

/** Rendimiento por fuente de lead. `ventas` = Map(leadId -> { monto, margen }) de las ventas aprobadas. */
export function rendimientoPorFuente(leads, { cotizados, reservados, vendidos }, ventas = new Map()) {
  const grupos = new Map();
  for (const l of leads) {
    const f = l.fuente || "Sin fuente";
    const g = grupos.get(f) || { fuente: f, leads: 0, cotizados: 0, reservados: 0, vendidos: 0, perdidos: 0, monto: 0, margen: 0, margenCompleto: true };
    g.leads++;
    if (cotizados.has(l.id)) g.cotizados++;
    if (reservados.has(l.id)) g.reservados++;
    if (l.etapa === "perdido") g.perdidos++;
    if (vendidos.has(l.id)) {
      g.vendidos++;
      const v = ventas.get(l.id);
      if (v) { g.monto += Number(v.monto) || 0; if (v.margen === null || v.margen === undefined) g.margenCompleto = false; else g.margen += Number(v.margen); }
    }
    grupos.set(f, g);
  }
  return Array.from(grupos.values())
    .map((g) => ({ ...g, conversion: pct(g.vendidos, g.leads), margen: g.margenCompleto ? g.margen : null }))
    .sort((a, b) => b.leads - a.leads || a.fuente.localeCompare(b.fuente));
}

/** Motivos de pérdida, del más frecuente al menos. */
export function motivosDePerdida(leads) {
  const cuenta = new Map();
  for (const l of leads) if (l.etapa === "perdido") cuenta.set(l.motivo_perdida || "Sin motivo", (cuenta.get(l.motivo_perdida || "Sin motivo") || 0) + 1);
  return Array.from(cuenta, ([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n || a.motivo.localeCompare(b.motivo));
}

/** Valida un aviso del supervisor. */
export function validarAviso(input) {
  const texto = String((input && input.texto) ?? "").trim().replace(/\s+/g, " ");
  if (texto.length < 3 || texto.length > 300) return { ok: false, error: "aviso_invalido" };
  return { ok: true, value: { texto } };
}

/**
 * ¿Es la solicitud de un cliente que ofrece su auto (vender o consignar) y llegó sola por un canal, como el sitio web?
 * Esos datos los declaró el cliente y no se editan; los leads de compra o consignación que el equipo crea a mano (tienen quien los creó) sí.
 */
export function solicitudDeCanal(lead) {
  const l = lead || {};
  return (l.tipo === "compra" || l.tipo === "consignacion") && !l.creado_por && l.fuente === "Sitio web";
}

/* ---------- Permisos del módulo ---------- */
/** Quién puede modificar un lead: quien reasigna (supervisor) o su dueño con permiso de leads propios. Y debe estar habilitado para ventas, salvo el supervisor. */
export function puedeEditarLead({ permisos, esAdmin, usuarioId, lead }) {
  if (esAdmin || permisos.includes("leads.asignar")) return true;
  // Cada tipo de lead exige su habilitación: venta, compra o consignación.
  const habilitacion = lead.tipo === "compra" ? "compras.operar" : lead.tipo === "consignacion" ? "consignaciones.operar" : "ventas.operar";
  return permisos.includes("leads.propios") && permisos.includes(habilitacion) && lead.asignado_a === usuarioId;
}

/* ---------- Hoy: qué hacer ahora ---------- */
/** Grupos de la vista «Hoy», en el orden en que se atienden. */
export const GRUPOS_HOY = [
  { id: "sin_contacto", nombre: "Sin primer contacto", ayuda: "Llegaron hace más del plazo y nadie los ha contactado." },
  { id: "por_atender", nombre: "Recién llegados", ayuda: "Nuevos, todavía dentro del plazo para el primer contacto." },
  { id: "vencida", nombre: "Próxima acción vencida", ayuda: "La tarea agendada ya pasó y sigue pendiente." },
  { id: "hoy", nombre: "Para hoy", ayuda: "Tienen una acción agendada para hoy." },
  { id: "sin_accion", nombre: "Sin próxima acción", ayuda: "Están abiertos pero no tienen nada agendado: define el siguiente paso." },
  { id: "programada", nombre: "Programados", ayuda: "Su próxima acción es otro día." },
];

/**
 * En qué grupo de «Hoy» cae un lead abierto (o null si está cerrado).
 * `tareas`: las tareas PENDIENTES de ese lead. `proxima` es la más cercana en el tiempo.
 * Prioridad: primer contacto > acción vencida > acción de hoy > sin acción > programado.
 */
export function clasificarLeadHoy({ lead, tareas = [], ahora = new Date(), horasPrimerContacto = 2, horasJefe = 4, diasDetenido = 7 }) {
  if (!lead || ETAPAS_CERRADAS.includes(lead.etapa)) return null;
  const pendientes = tareas.filter((t) => !t.hecha && Number.isFinite(Date.parse(t.vence_en))).sort((a, b) => Date.parse(a.vence_en) - Date.parse(b.vence_en));
  const proxima = pendientes[0] || null;
  const edadHoras = horasDesde(lead.creado_en, ahora);
  const sinContactar = lead.etapa === "nuevo" && !lead.ultimo_contacto;
  let grupo;
  let nivelJefe = false;
  if (sinContactar) {
    if (edadHoras >= horasPrimerContacto) { grupo = "sin_contacto"; nivelJefe = edadHoras >= horasJefe; } else grupo = "por_atender";
  } else if (proxima && Date.parse(proxima.vence_en) < ahora.getTime()) grupo = "vencida";
  else if (proxima && diaLocal(proxima.vence_en) === diaLocal(ahora)) grupo = "hoy";
  else if (!proxima) grupo = "sin_accion";
  else grupo = "programada";
  return { grupo, proxima, edadHoras: Math.round(edadHoras * 10) / 10, nivelJefe, estancado: esDetenido(lead, ahora, diasDetenido) };
}

/** Orden dentro de cada grupo: lo más urgente o más antiguo primero. */
export function ordenarHoy(items) {
  const peso = Object.fromEntries(GRUPOS_HOY.map((g, i) => [g.id, i]));
  const clave = (x) => (x.hoy.grupo === "sin_contacto" || x.hoy.grupo === "por_atender" ? Date.parse(x.lead.creado_en) : x.hoy.proxima ? Date.parse(x.hoy.proxima.vence_en) : Date.parse(ultimaActividad(x.lead) || x.lead.creado_en));
  return [...items].sort((a, b) => (peso[a.hoy.grupo] - peso[b.hoy.grupo]) || (clave(a) - clave(b)));
}

/** ¿A este lead hay que pedirle un siguiente paso? Está abierto y no tiene ninguna tarea pendiente que aún no venza. */
export function faltaProximaAccion(lead, tareas = [], ahora = new Date()) {
  if (!lead || ETAPAS_CERRADAS.includes(lead.etapa)) return false;
  return !tareas.some((t) => !t.hecha && Date.parse(t.vence_en) > ahora.getTime());
}

/** Días que el lead lleva en su etapa actual (usa la marca de cambio de etapa; si aún no existe, la última actualización). */
export function diasEnEtapa(lead, ahora = new Date()) {
  const desde = lead && (lead.etapa_desde || lead.actualizado_en || lead.creado_en);
  if (!desde || !Number.isFinite(Date.parse(desde))) return 0;
  return Math.max(0, Math.floor((ahora.getTime() - Date.parse(desde)) / 86_400_000));
}

/** Semáforo de una tarjeta del tablero según los días en la etapa: verde (normal), ámbar (atento) o rojo (detenido). */
export function colorDeAntiguedad(dias, { atento = 3, detenido = 7 } = {}) {
  return dias >= detenido ? "rojo" : dias >= atento ? "ambar" : "verde";
}
