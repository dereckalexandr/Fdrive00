// Núcleo del sitio web público: qué vehículos se muestran, qué datos salen y cómo se validan las solicitudes de los visitantes.
// JavaScript puro (sin APIs de Deno ni del navegador): lo usan el servidor, la pantalla y las pruebas.
//
// PRIVACIDAD: todo lo que sale hacia el público pasa por `vehiculoPublico`, que arma el vehículo con una lista cerrada de campos.
// Nunca salen la patente, el costo, las notas internas ni quién lo creó.
import { normalizarPatente, patenteValida, soloDigitos, cuotaEstimada } from "./ventas-core.js";

/* ---------- Catálogo ---------- */
export const ESTADOS_VISIBLES = ["disponible", "reservado"];

/** ¿Se muestra este vehículo en el sitio? Disponibles y reservados (estos con la etiqueta «Reservado»), activos y con precio. */
export const visibleEnCatalogo = (v) => !!v && v.activo !== false && ESTADOS_VISIBLES.includes(v.estado) && Number(v.precio_lista) > 0;

/** Datos del vehículo que ven los visitantes. */
export function vehiculoPublico(v) {
  return {
    id: v.id, marca: v.marca, modelo: v.modelo, version: v.version || null, anio: v.anio, km: Number(v.km) || 0,
    color: v.color || null, transmision: v.transmision || null, combustible: v.combustible || null,
    precio: Number(v.precio_lista), reservado: v.estado === "reservado",
    fotos: Array.isArray(v.fotos) ? v.fotos.filter((f) => /^[A-Za-z0-9]{6,40}$/.test(String(f))).slice(0, 12) : [],
    localId: v.local_id || null,
  };
}

/* ---------- Solicitudes ---------- */
export const TIPOS_SOLICITUD = [
  { id: "consulta", nombre: "Consulta por un vehículo", vehiculo: true },
  { id: "visita", nombre: "Agendar una visita o test drive", vehiculo: true },
  { id: "financiamiento", nombre: "Cotizar financiamiento", vehiculo: true },
  { id: "vender", nombre: "Vender o consignar mi auto", vehiculo: false },
];
export const PLAZOS_FINANCIAMIENTO = [12, 24, 36, 48, 60, 72];
export const ESPERA_MINIMA_MS = 3_000;      // tiempo mínimo entre abrir el formulario y enviarlo (los robots envían al instante)
export const VIGENCIA_FORMULARIO_MS = 6 * 3_600_000;
export const LIMITE_IP_HORA = 8;            // solicitudes por dirección IP por hora
export const LIMITE_TELEFONO_HORA = 3;      // solicitudes por teléfono por hora
export const LIMITE_LOCAL_HORA = 60;        // tope general de solicitudes web por hora en un local (freno de emergencia)
export const FUENTE_WEB = "Sitio web";

const texto = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const entero = (v, min, max) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};

/**
 * Valida una solicitud del sitio. Si es sospechosa de ser un robot devuelve `silencioso: true`: el servidor responde "ok"
 * sin crear nada, para no darle pistas.
 */
export function validarSolicitudWeb(input, ahora = new Date()) {
  const i = input || {};
  if (texto(i.web, 200)) return { ok: false, error: "spam", silencioso: true }; // campo trampa: una persona nunca lo ve ni lo llena
  const espera = ahora.getTime() - Number(i.abiertoEn);
  if (!Number.isFinite(espera) || espera < 0) return { ok: false, error: "formulario_invalido" };
  if (espera < ESPERA_MINIMA_MS) return { ok: false, error: "spam", silencioso: true };
  if (espera > VIGENCIA_FORMULARIO_MS) return { ok: false, error: "formulario_vencido" };
  if (i.acepta !== true) return { ok: false, error: "consentimiento_requerido" };

  const tipo = TIPOS_SOLICITUD.find((t) => t.id === i.tipo);
  if (!tipo) return { ok: false, error: "tipo_invalido" };
  const nombre = texto(i.nombre, 80);
  if (nombre.length < 3) return { ok: false, error: "nombre_invalido" };
  const telefono = texto(i.telefono, 30);
  if (soloDigitos(telefono).length < 8 || soloDigitos(telefono).length > 15) return { ok: false, error: "telefono_invalido" };
  const email = texto(i.email, 80).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "email_invalido" };
  const mensaje = String(i.mensaje ?? "").replace(/\r/g, "").trim().slice(0, 500);
  const base = { tipo: tipo.id, contacto: { nombre, telefono, email: email || null }, mensaje: mensaje || null, localId: i.localId ? String(i.localId) : null };

  if (tipo.vehiculo) {
    if (!i.vehiculoId) return { ok: false, error: "vehiculo_requerido" };
    base.vehiculoId = String(i.vehiculoId);
  }
  if (tipo.id === "visita") {
    const t = Date.parse(i.fechaHora);
    if (Number.isNaN(t) || t < ahora.getTime() - 3_600_000 || t > ahora.getTime() + 45 * 86_400_000) return { ok: false, error: "fecha_invalida" };
    base.fechaHora = new Date(t).toISOString();
  }
  if (tipo.id === "financiamiento") {
    const pie = entero(i.pie, 0, 2_000_000_000);
    if (pie === null || Number.isNaN(pie)) return { ok: false, error: "pie_invalido" };
    const plazo = Number(i.plazo);
    if (!PLAZOS_FINANCIAMIENTO.includes(plazo)) return { ok: false, error: "plazo_invalido" };
    base.pie = pie;
    base.plazo = plazo;
  }
  if (tipo.id === "vender") {
    const patente = normalizarPatente(i.patente);
    if (!patenteValida(patente)) return { ok: false, error: "patente_invalida" };
    const marca = texto(i.marca, 40);
    const modelo = texto(i.modelo, 60);
    if (marca.length < 2 || modelo.length < 1) return { ok: false, error: "marca_modelo_requeridos" };
    const anio = entero(i.anio, 1950, new Date(ahora).getFullYear() + 1);
    if (anio === null || Number.isNaN(anio)) return { ok: false, error: "anio_invalido" };
    const km = entero(i.km, 0, 2_000_000);
    if (km === null || Number.isNaN(km)) return { ok: false, error: "km_invalido" };
    const modalidad = i.modalidad === "consignar" ? "consignar" : "vender";
    base.vende = { patente, marca, modelo, anio, km, modalidad };
  }
  return { ok: true, value: base };
}

/** Cuota referencial para el visitante (no es una oferta: sujeta a evaluación crediticia). */
export function cuotaReferencial(precio, pie, plazo, tasaMensualPct) {
  const financiar = Math.max(0, Number(precio) - Number(pie));
  return { montoFinanciar: financiar, cuota: financiar > 0 ? cuotaEstimada(financiar, plazo, tasaMensualPct) : 0 };
}

/** Tipo de lead que se crea según la solicitud. */
export const tipoLeadDe = (v) => (v.tipo === "vender" ? (v.vende.modalidad === "consignar" ? "consignacion" : "compra") : "venta");

/** Texto que ve el ejecutivo en el lead (qué pidió el visitante). */
export function resumenSolicitud(v, vehiculoTexto = "") {
  const partes = [];
  if (v.tipo === "consulta") partes.push(`Consulta por ${vehiculoTexto}`);
  if (v.tipo === "visita") partes.push(`Pide visita o test drive de ${vehiculoTexto}`);
  if (v.tipo === "financiamiento") partes.push(`Cotiza financiamiento de ${vehiculoTexto}: pie $${Number(v.pie).toLocaleString("es-CL")}, ${v.plazo} cuotas`);
  if (v.tipo === "vender") partes.push(`${v.vende.modalidad === "consignar" ? "Quiere consignar" : "Quiere vender"}: ${v.vende.marca} ${v.vende.modelo} ${v.vende.anio} · ${v.vende.km.toLocaleString("es-CL")} km · ${v.vende.patente}`);
  if (v.mensaje) partes.push(`Mensaje: ${v.mensaje}`);
  return partes.join(". ");
}

/** Mensajes para el visitante (no técnicos). */
export const MENSAJES_WEB = {
  consentimiento_requerido: "Para continuar, acepta el uso de tus datos para que podamos contactarte.",
  nombre_invalido: "Escribe tu nombre completo.",
  telefono_invalido: "Escribe un teléfono válido, con al menos 8 dígitos.",
  email_invalido: "El correo no parece válido.",
  vehiculo_requerido: "Elige el vehículo.",
  fecha_invalida: "Elige una fecha y hora dentro de los próximos 45 días.",
  pie_invalido: "Escribe el pie (puede ser 0).",
  plazo_invalido: "Elige un plazo de la lista.",
  patente_invalida: "La patente no es válida (formato ABCD12 o AB1234).",
  no_encontrada: "No encontramos esa patente. Completa los datos a mano.",
  cupo_agotado: "La búsqueda automática no está disponible en este momento. Completa los datos a mano.",
  servicio_no_disponible: "La búsqueda automática no está disponible en este momento. Completa los datos a mano.",
  no_configurado: "La búsqueda automática no está disponible en este momento. Completa los datos a mano.",
  marca_modelo_requeridos: "Escribe la marca y el modelo.",
  anio_invalido: "El año no es válido.",
  km_invalido: "El kilometraje no es válido.",
  formulario_vencido: "El formulario estuvo abierto mucho tiempo. Recarga la página e inténtalo de nuevo.",
  demasiadas_solicitudes: "Recibimos muchas solicitudes desde tu conexión o teléfono. Inténtalo más tarde o escríbenos por WhatsApp.",
  vehiculo_no_disponible: "Ese vehículo ya no está disponible.",
  sin_local: "No pudimos registrar tu solicitud. Escríbenos por WhatsApp.",
};
