// Núcleo de compras y consignaciones del CRM.
// JavaScript puro (sin APIs de Deno ni del navegador): lo usan el servidor, la pantalla y las pruebas.
//
//  COMPRA: la automotora le compra un vehículo a un cliente.
//    lead de compra → tasación completada → oferta (tope = lo tasado) → el cliente acepta → pago solicitado
//    (con documentos validados) → el Jefe Local aprueba → el vehículo entra al inventario en preparación.
//  CONSIGNACIÓN: el dueño deja su vehículo para que la automotora lo venda.
//    contrato con precio piso y precio de publicación → documentos validados → el vehículo entra al inventario como
//    «consignado» → al venderse, el margen (precio de venta − piso) paga la comisión del ejecutivo.
import { MEDIOS_PAGO, mesChile, esMes, normalizarPatente } from "./ventas-core.js";
import { validarVehiculoTasacion } from "./tasaciones-core.js";

/* ---------- Catálogos ---------- */
export const ESTADOS_COMPRA = [
  { id: "oferta", nombre: "Oferta hecha" },
  { id: "aceptada", nombre: "Oferta aceptada" },
  { id: "pago_pendiente", nombre: "Pago por aprobar" },
  { id: "comprada", nombre: "Comprada" },
  { id: "rechazada", nombre: "Rechazada por el cliente" },
  { id: "anulada", nombre: "Anulada" },
  { id: "cancelada", nombre: "Cancelada" },
];
export const compraNombre = (id) => (ESTADOS_COMPRA.find((e) => e.id === id) || {}).nombre || id;
export const COMPRA_ABIERTA = ["oferta", "aceptada", "pago_pendiente"];
export const folioCompra = (n) => `CMP-${String(n || 0).padStart(5, "0")}`;

export const ESTADOS_CONSIGNACION = [
  { id: "en_validacion", nombre: "En validación" },
  { id: "vigente", nombre: "Vigente" },
  { id: "vendida", nombre: "Vendida" },
  { id: "devuelta", nombre: "Devuelta al dueño" },
  { id: "cancelada", nombre: "Cancelada" },
];
export const consignacionNombre = (id) => (ESTADOS_CONSIGNACION.find((e) => e.id === id) || {}).nombre || id;
export const CONSIGNACION_ABIERTA = ["en_validacion", "vigente"];
export const folioConsignacion = (n) => `CNS-${String(n || 0).padStart(5, "0")}`;

/** Lo que cada tipo de lead exige a quien lo trabaja. */
export const PERMISO_DE_TIPO = { venta: "ventas.operar", compra: "compras.operar", consignacion: "consignaciones.operar" };
export const TIPOS_LEAD = [
  { id: "venta", nombre: "Venta" },
  { id: "compra", nombre: "Compra (me venden un auto)" },
  { id: "consignacion", nombre: "Consignación" },
];
export const tipoLeadNombre = (id) => (TIPOS_LEAD.find((t) => t.id === id) || {}).nombre || id;
/**
 * Grupo de reparto automático de leads. Cada grupo rota por separado entre sus habilitados:
 *  - «ventas»: leads de venta (consultas, visitas y financiamiento) -> ejecutivos con la habilitación de Ventas.
 *  - «compras»: leads de compra y de consignación -> ejecutivos con Compras (para los de compra) o Consignaciones (para los de consignación).
 * Así, recibir un lead de venta no te saca el turno de los de compra, ni al revés.
 */
export const grupoDeReparto = (tipo) => (tipo === "compra" || tipo === "consignacion" ? "compras" : "ventas");

export const permisoDeTipo = (tipo) => PERMISO_DE_TIPO[tipo] || PERMISO_DE_TIPO.venta;

/** Nombre de la etapa del lead según su tipo (la etapa interna es la misma: cotizado, reservado, ganado). */
export function etapaDeOperacion(tipo, etapa, nombreBase) {
  if (tipo === "compra") return { cotizado: "Oferta hecha", reservado: "Oferta aceptada", ganado: "Comprado" }[etapa] || nombreBase;
  if (tipo === "consignacion") return { cotizado: "En validación", reservado: "En validación", ganado: "Consignado" }[etapa] || nombreBase;
  return nombreBase;
}

const texto = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const entero = (v, min, max) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};
const DIA = 86_400_000;

/* ---------- Vehículo que ofrece el cliente ---------- */
/** El vehículo que el cliente ofrece vender o consignar (lo exigen los leads de compra y consignación). */
export function validarVehiculoOfrecido(input) {
  const r = validarVehiculoTasacion(input);
  return r.ok ? { ok: true, value: r.value } : r;
}

/* ---------- Compras ---------- */
/**
 * Oferta al cliente. La tasación debe estar completada, ser del mismo vehículo y la oferta no puede superar lo tasado
 * (lo que se reconoce al cliente es el «valor de compra» de la tasación).
 */
export function validarOferta(input, tasacion, patenteLead) {
  if (!tasacion || tasacion.estado !== "completada" || !(Number(tasacion.valor_compra) > 0)) return { ok: false, error: "tasacion_incompleta" };
  if (patenteLead && normalizarPatente(tasacion.patente) !== normalizarPatente(patenteLead)) return { ok: false, error: "tasacion_no_corresponde" };
  const monto = entero(input && input.monto, 1, 2_000_000_000);
  if (monto === null || Number.isNaN(monto)) return { ok: false, error: "monto_invalido" };
  if (monto > Number(tasacion.valor_compra)) return { ok: false, error: "oferta_excede_tasacion" };
  return { ok: true, value: { monto_oferta: monto, notas: texto(input && input.notas, 300) || null } };
}

export function validarRespuestaOferta(input) {
  const i = input || {};
  if (i.acepta === true) return { ok: true, value: { acepta: true, motivo: null } };
  const motivo = texto(i.motivo, 150);
  if (motivo.length < 3) return { ok: false, error: "motivo_requerido" };
  return { ok: true, value: { acepta: false, motivo } };
}

/** Pago de la compra: lo que se paga (hasta lo ofertado), cómo y cuándo. */
export function validarPagoCompra(input, compra, ahora = new Date()) {
  const i = input || {};
  const monto = entero(i.montoFinal, 1, 2_000_000_000);
  if (monto === null || Number.isNaN(monto)) return { ok: false, error: "monto_invalido" };
  if (monto > Number(compra.monto_oferta)) return { ok: false, error: "monto_excede_oferta" };
  if (!MEDIOS_PAGO.includes(i.medioPago)) return { ok: false, error: "medio_invalido" };
  const f = String(i.fechaPago || "");
  const t = Date.parse(`${f}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || Number.isNaN(t) || t < ahora.getTime() - 30 * DIA || t > ahora.getTime() + 10 * DIA) return { ok: false, error: "fecha_invalida" };
  return { ok: true, value: { monto_final: monto, medio_pago: i.medioPago, fecha_pago: f, notas_pago: texto(i.notas, 300) || null } };
}

const PERMITIDAS_COMPRA = {
  responder: ["oferta"],
  solicitarPago: ["aceptada"],
  aprobar: ["pago_pendiente"],
  rechazarPago: ["pago_pendiente"],
  anular: ["comprada"],
  cancelar: ["oferta", "aceptada", "pago_pendiente"],
};
export function validarTransicionCompra(estado, accion) {
  return (PERMITIDAS_COMPRA[accion] || []).includes(estado) ? { ok: true } : { ok: false, error: "compra_estado_invalido" };
}

/** Vehículo que entra al inventario cuando se aprueba la compra (en preparación, con el costo realmente pagado). */
export function vehiculoDeCompra(compra, tasacion) {
  const v = (tasacion && tasacion.vehiculo) || compra.vehiculo || {};
  return {
    patente: normalizarPatente(v.patente || compra.patente), marca: v.marca, modelo: v.modelo, version: v.version || null, anio: v.anio, km: Number(v.km) || 0,
    color: v.color || null, transmision: v.transmision || null, combustible: v.combustible || null,
    precio_lista: tasacion && Number(tasacion.valor_venta) > 0 ? Number(tasacion.valor_venta) : null,
    costo: Number(compra.monto_final), estado: "preparacion", origen: "compra",
  };
}

/* ---------- Consignaciones ---------- */
export const PLAZO_CONSIGNACION_DEFECTO = 90;

/** Contrato: el piso es lo que el dueño quiere recibir; la publicación, el precio al que se ofrece. */
export function validarConsignacion(input) {
  const i = input || {};
  const piso = entero(i.precioPiso, 1, 2_000_000_000);
  const publicacion = entero(i.precioPublicacion, 1, 2_000_000_000);
  if (piso === null || Number.isNaN(piso) || publicacion === null || Number.isNaN(publicacion)) return { ok: false, error: "precio_invalido" };
  if (publicacion < piso) return { ok: false, error: "publicacion_bajo_piso" };
  const plazo = i.plazoDias === "" || i.plazoDias === undefined || i.plazoDias === null ? PLAZO_CONSIGNACION_DEFECTO : Number(i.plazoDias);
  if (!Number.isInteger(plazo) || plazo < 15 || plazo > 365) return { ok: false, error: "plazo_invalido" };
  return { ok: true, value: { precio_piso: piso, precio_publicacion: publicacion, plazo_dias: plazo, notas: texto(i.notas, 300) || null } };
}

/** Fecha (AAAA-MM-DD, hora de Chile) en que vence una consignación que parte hoy. */
export function vencimientoConsignacion(desde, dias) {
  const d = new Date(new Date(desde).getTime() + dias * DIA);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
}

/** Cuántos días le quedan (negativo = vencida). */
export function diasParaVencer(venceEn, ahora = new Date()) {
  if (!venceEn) return null;
  return Math.ceil((Date.parse(`${String(venceEn).slice(0, 10)}T23:59:59Z`) - ahora.getTime()) / DIA);
}

const PERMITIDAS_CONSIGNACION = {
  cancelar: ["en_validacion"],
  devolver: ["vigente"],
  extender: ["vigente"],
};
export function validarTransicionConsignacion(estado, accion) {
  return (PERMITIDAS_CONSIGNACION[accion] || []).includes(estado) ? { ok: true } : { ok: false, error: "consignacion_estado_invalido" };
}

export function validarExtension(input) {
  const d = Number(input && input.dias);
  if (!Number.isInteger(d) || d < 7 || d > 180) return { ok: false, error: "plazo_invalido" };
  return { ok: true, value: d };
}

/** Lo que gana la automotora al vender un vehículo consignado (sobre esto se calcula la comisión del ejecutivo). */
export const margenConsignacion = (precioVenta, precioPiso) => Number(precioVenta) - Number(precioPiso);

/** Vehículo que entra al inventario cuando el contrato queda validado: disponible, con costo = piso. */
export function vehiculoDeConsignacion(c) {
  const v = c.vehiculo || {};
  return {
    patente: normalizarPatente(v.patente || c.patente), marca: v.marca, modelo: v.modelo, version: v.version || null, anio: v.anio, km: Number(v.km) || 0,
    color: v.color || null, transmision: v.transmision || null, combustible: v.combustible || null,
    precio_lista: Number(c.precio_publicacion), costo: Number(c.precio_piso), precio_piso: Number(c.precio_piso), estado: "disponible", origen: "consignacion",
  };
}

/** Un vehículo consignado no se puede publicar ni vender bajo el precio piso del dueño. */
export function verificarPisoConsignado(vehiculo, precio) {
  if (vehiculo && Number(vehiculo.precio_piso) > 0 && Number(precio) < Number(vehiculo.precio_piso)) return { ok: false, error: "bajo_precio_piso" };
  return { ok: true };
}

/* ---------- Métricas ---------- */
export function metricasCompras(compras, ejecutivoId, mes) {
  const suyas = compras.filter((c) => c.ejecutivo_id === ejecutivoId);
  const hechas = suyas.filter((c) => c.estado === "comprada" && c.mes === mes);
  return {
    hechas: hechas.length,
    montoPagado: hechas.reduce((a, c) => a + Number(c.monto_final || 0), 0),
    abiertas: suyas.filter((c) => COMPRA_ABIERTA.includes(c.estado)).length,
  };
}

/** Filas para el cálculo de comisión de consignaciones: las vendidas en el mes por ese ejecutivo. */
export function filasConsignacion(consignaciones, ejecutivoId, mes) {
  return consignaciones
    .filter((c) => c.ejecutivo_id === ejecutivoId && c.estado === "vendida" && c.mes === mes)
    .map((c) => ({ precioVenta: Number(c.precio_venta), precioPiso: Number(c.precio_piso), descuentos: 0 }));
}

export { mesChile, esMes };
