// Núcleo del sitio web público: qué vehículos se muestran, qué datos salen y cómo se validan las solicitudes de los visitantes.
// JavaScript puro (sin APIs de Deno ni del navegador): lo usan el servidor, la pantalla y las pruebas.
//
// PRIVACIDAD: todo lo que sale hacia el público pasa por `vehiculoPublico`, que arma el vehículo con una lista cerrada de campos.
// Nunca salen la patente, el costo, las notas internas ni quién lo creó.
import { normalizarPatente, patenteValida, soloDigitos, cuotaEstimada, TRANSMISIONES, COMBUSTIBLES } from "./ventas-core.js";

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
  // Renovar: quiere cambiar su auto por uno del catálogo (su auto queda como vehículo en parte de pago).
  { id: "renovar", nombre: "Cambiar mi auto por este", vehiculo: true },
];
/** Códigos de área de país para el teléfono. Chile primero (es el que se usa por defecto). */
export const PAISES = [
  { id: "CL", nombre: "Chile", codigo: "56" }, { id: "AR", nombre: "Argentina", codigo: "54" }, { id: "BO", nombre: "Bolivia", codigo: "591" },
  { id: "BR", nombre: "Brasil", codigo: "55" }, { id: "CO", nombre: "Colombia", codigo: "57" }, { id: "CR", nombre: "Costa Rica", codigo: "506" },
  { id: "CU", nombre: "Cuba", codigo: "53" }, { id: "EC", nombre: "Ecuador", codigo: "593" }, { id: "SV", nombre: "El Salvador", codigo: "503" },
  { id: "ES", nombre: "España", codigo: "34" }, { id: "US", nombre: "Estados Unidos / Canadá", codigo: "1" }, { id: "GT", nombre: "Guatemala", codigo: "502" },
  { id: "HT", nombre: "Haití", codigo: "509" }, { id: "HN", nombre: "Honduras", codigo: "504" }, { id: "MX", nombre: "México", codigo: "52" },
  { id: "NI", nombre: "Nicaragua", codigo: "505" }, { id: "PA", nombre: "Panamá", codigo: "507" }, { id: "PY", nombre: "Paraguay", codigo: "595" },
  { id: "PE", nombre: "Perú", codigo: "51" }, { id: "DO", nombre: "República Dominicana", codigo: "1809" }, { id: "UY", nombre: "Uruguay", codigo: "598" },
  { id: "VE", nombre: "Venezuela", codigo: "58" },
];

/**
 * Teléfono con código de país: devuelve "+569XXXXXXXX". En Chile el número tiene 9 dígitos (un 0 al comienzo se ignora); en los demás países, entre 6 y 12.
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validarTelefonoInternacional(codigoPais, numero) {
  const codigo = String(codigoPais ?? "").replace(/\D/g, "");
  const pais = PAISES.find((p) => p.codigo === codigo);
  if (!pais) return { ok: false, error: "codigo_pais_invalido" };
  const nacional = soloDigitos(numero).replace(/^0+/, "");
  const [min, max] = pais.codigo === "56" ? [9, 9] : [6, 12];
  if (nacional.length < min || nacional.length > max) return { ok: false, error: "telefono_invalido" };
  return { ok: true, value: `+${pais.codigo}${nacional}` };
}

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
  let telefono;
  if (i.codigoPais !== undefined && i.codigoPais !== null && i.codigoPais !== "") {
    const t = validarTelefonoInternacional(i.codigoPais, i.telefono);
    if (!t.ok) return { ok: false, error: t.error };
    telefono = t.value;
  } else {
    telefono = texto(i.telefono, 30); // formularios antiguos: el número completo en un solo campo
    if (soloDigitos(telefono).length < 8 || soloDigitos(telefono).length > 15) return { ok: false, error: "telefono_invalido" };
  }
  const email = texto(i.email, 80).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "email_invalido" };
  const mensaje = String(i.mensaje ?? "").replace(/\r/g, "").trim().slice(0, 500);
  // Al vender, consignar o cambiar su auto, todos los datos son obligatorios.
  const conAuto = tipo.id === "vender" || tipo.id === "renovar";
  if (conAuto) {
    if (!email) return { ok: false, error: "email_requerido" };
  }
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
  if (conAuto) {
    const patente = normalizarPatente(i.patente);
    if (!patenteValida(patente)) return { ok: false, error: "patente_invalida" };
    const marca = texto(i.marca, 40);
    const modelo = texto(i.modelo, 60);
    if (marca.length < 2 || modelo.length < 1) return { ok: false, error: "marca_modelo_requeridos" };
    const anio = entero(i.anio, 1950, new Date(ahora).getFullYear() + 1);
    if (anio === null || Number.isNaN(anio)) return { ok: false, error: "anio_invalido" };
    const km = entero(i.km, 0, 2_000_000);
    if (km === null || Number.isNaN(km)) return { ok: false, error: "km_invalido" };
    const modalidad = tipo.id === "renovar" ? "cambiar" : i.modalidad === "consignar" ? "consignar" : "vender";
    if (!TRANSMISIONES.includes(i.transmision)) return { ok: false, error: "transmision_invalida" };
    if (!COMBUSTIBLES.includes(i.combustible)) return { ok: false, error: "combustible_invalido" };
    const duenos = entero(i.duenos, 1, 30);
    if (duenos === null || Number.isNaN(duenos)) return { ok: false, error: "duenos_invalido" };
    if (!["si", "no"].includes(i.prenda)) return { ok: false, error: "prenda_invalida" };
    if (!["si", "no"].includes(i.mantenciones)) return { ok: false, error: "mantenciones_invalidas" };
    const precioEsperado = entero(i.precioEsperado, 1, 2_000_000_000);
    if (precioEsperado === null || Number.isNaN(precioEsperado)) return { ok: false, error: "precio_esperado_invalido" };
    base.vende = { patente, marca, modelo, anio, km, modalidad, transmision: i.transmision, combustible: i.combustible, duenos, prenda: i.prenda, mantenciones: i.mantenciones, precioEsperado };
  }
  return { ok: true, value: base };
}

/** Cuota referencial para el visitante (no es una oferta: sujeta a evaluación crediticia). */
export function cuotaReferencial(precio, pie, plazo, tasaMensualPct) {
  const financiar = Math.max(0, Number(precio) - Number(pie));
  return { montoFinanciar: financiar, cuota: financiar > 0 ? cuotaEstimada(financiar, plazo, tasaMensualPct) : 0 };
}

/** Tipo de lead que se crea según la solicitud. */
export const tipoLeadDe = (v) => (v.tipo === "vender" ? (v.vende.modalidad === "consignar" ? "consignacion" : "compra") : "venta"); // renovar es una venta: su auto va como parte de pago

/** Texto que ve el ejecutivo en el lead (qué pidió el visitante). */
export function resumenSolicitud(v, vehiculoTexto = "") {
  const partes = [];
  if (v.tipo === "consulta") partes.push(`Consulta por ${vehiculoTexto}`);
  if (v.tipo === "visita") partes.push(`Pide visita o test drive de ${vehiculoTexto}`);
  if (v.tipo === "financiamiento") partes.push(`Cotiza financiamiento de ${vehiculoTexto}: pie $${Number(v.pie).toLocaleString("es-CL")}, ${v.plazo} cuotas`);
  if (v.tipo === "vender") partes.push(`${v.vende.modalidad === "consignar" ? "Quiere consignar" : "Quiere vender"}: ${v.vende.marca} ${v.vende.modelo} ${v.vende.anio} · ${v.vende.km.toLocaleString("es-CL")} km · ${v.vende.patente}`);
  if (v.tipo === "renovar") partes.push(`Quiere cambiar su ${v.vende.marca} ${v.vende.modelo} ${v.vende.anio} · ${v.vende.km.toLocaleString("es-CL")} km · ${v.vende.patente} por ${vehiculoTexto}`);
  if ((v.tipo === "vender" || v.tipo === "renovar") && v.vende.transmision) partes.push(`${v.vende.transmision} · ${v.vende.combustible}`);
  if ((v.tipo === "vender" || v.tipo === "renovar") && v.vende.duenos) partes.push(`${v.vende.duenos} dueño${v.vende.duenos === 1 ? "" : "s"} · prenda: ${v.vende.prenda === "si" ? "sí" : "no"} · mantenciones en la marca: ${v.vende.mantenciones === "si" ? "sí" : "no"} · precio esperado $${Number(v.vende.precioEsperado).toLocaleString("es-CL")}`);
  if (v.mensaje) partes.push(`Mensaje: ${v.mensaje}`);
  return partes.join(". ");
}

/** Mensajes para el visitante (no técnicos). */
export const MENSAJES_WEB = {
  consentimiento_requerido: "Para continuar, acepta el uso de tus datos para que podamos contactarte.",
  nombre_invalido: "Escribe tu nombre completo.",
  telefono_invalido: "Revisa el teléfono: en Chile son 9 dígitos (ej. 9 1234 5678); en otros países, entre 6 y 12 dígitos, sin el código de área.",
  email_invalido: "El correo no parece válido.",
  vehiculo_requerido: "Elige el vehículo.",
  fecha_invalida: "Elige una fecha y hora dentro de los próximos 45 días.",
  pie_invalido: "Escribe el pie (puede ser 0).",
  plazo_invalido: "Elige un plazo de la lista.",
  patente_invalida: "La patente no es válida (formato ABCD12 o AB1234).",
  codigo_pais_invalido: "Elige el código de área de tu país.",
  email_requerido: "Escribe tu correo electrónico.",
  transmision_invalida: "Elige la transmisión de tu auto.",
  combustible_invalido: "Elige el combustible de tu auto.",
  duenos_invalido: "Indica cuántos dueños ha tenido el auto (un número entre 1 y 30).",
  prenda_invalida: "Indica si el auto tiene prenda (Sí o No).",
  mantenciones_invalidas: "Indica si tiene las mantenciones en la marca (Sí o No).",
  precio_esperado_invalido: "Escribe el precio que esperas por tu auto.",
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
