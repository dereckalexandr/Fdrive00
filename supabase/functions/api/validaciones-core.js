// Núcleo de las validaciones del CRM: revisión de documentos de cierres de venta, vehículos y compras.
// JavaScript puro (sin APIs de Deno ni del navegador): lo usan el servidor, la pantalla y las pruebas.
import { horasDesde, mesChile, soloDigitos } from "./ventas-core.js";
import { validarRut, normalizarRut } from "./crm-core.js";

/* ---------- Catálogos ---------- */
export const TIPOS_VALIDACION = [
  { id: "venta", nombre: "Cierre de venta" },
  { id: "vehiculo", nombre: "Documentos del vehículo" },
  { id: "compra", nombre: "Compra directa" },
  { id: "consignacion", nombre: "Consignación" },
];
export const tipoValidacionNombre = (id) => (TIPOS_VALIDACION.find((t) => t.id === id) || {}).nombre || id;

export const ESTADOS_VALIDACION = [
  { id: "pendiente", nombre: "Por tomar" },
  { id: "en_revision", nombre: "En revisión" },
  { id: "observada", nombre: "Con observaciones" },
  { id: "rechazada", nombre: "Rechazada" },
  { id: "aprobada", nombre: "Aprobada" },
  { id: "cancelada", nombre: "Cancelada" },
];
export const validacionNombre = (id) => (ESTADOS_VALIDACION.find((e) => e.id === id) || {}).nombre || id;

export const ESTADOS_DOC = [
  { id: "pendiente", nombre: "Por revisar" },
  { id: "aprobado", nombre: "Aprobado" },
  { id: "observado", nombre: "Observado" },
  { id: "rechazado", nombre: "Rechazado" },
  { id: "no_aplica", nombre: "No aplica" },
];
export const docNombre = (id) => (ESTADOS_DOC.find((e) => e.id === id) || {}).nombre || id;
export const folioValidacion = (n) => `VAL-${String(n || 0).padStart(6, "0")}`;

const texto = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/* ---------- Listas de documentos ---------- */
const D = (clave, nombre, grupo, requerido = true) => ({ clave, nombre, grupo, requerido });
export const DOCS_VEHICULO = [
  D("padron", "Padrón / certificado de anotaciones vigentes (CAV)", "vehiculo"),
  D("permiso_circulacion", "Permiso de circulación al día", "vehiculo"),
  D("revision_tecnica", "Revisión técnica vigente", "vehiculo"),
  D("soap", "SOAP vigente", "vehiculo"),
  D("multas_prendas", "Certificado de multas, prendas y limitaciones", "vehiculo"),
];

/* ---------- Compra de vehículos: documentos y datos obligatorios ---------- */
const PDF = ["application/pdf"];
const IMG_PDF = ["image/jpeg", "application/pdf"];
const DC = (clave, nombre, grupo, tipos, extra = {}) => ({ clave, nombre, grupo, requerido: true, tipos, ...extra });
/** Documentos que deben estar cargados para concretar una compra. «vence»: lleva fecha de vencimiento; «precio»: lleva el precio pagado. */
export const DOCS_COMPRA = [
  DC("cav", "CAV (certificado de anotaciones vigentes)", "vehiculo", PDF),
  DC("multas", "Multas", "vehiculo", PDF),
  DC("dicom", "Dicom", "cliente", PDF),
  DC("pension_alimentos", "Pensión de alimentos", "cliente", IMG_PDF),
  DC("carnet_identidad", "Carnet de identidad", "cliente", IMG_PDF),
  DC("informe_legal", "Informe legal", "vehiculo", PDF),
  DC("permiso_circulacion", "Permiso de circulación", "vehiculo", IMG_PDF, { vence: true, precio: true }),
  DC("revision_tecnica", "Revisión técnica", "vehiculo", IMG_PDF, { vence: true }),
  DC("soap", "SOAP", "vehiculo", IMG_PDF, { vence: true }),
  DC("padron", "Padrón", "vehiculo", IMG_PDF),
  DC("contrato_compraventa", "Contrato de compra-venta", "cliente", IMG_PDF),
];
/**
 * Documentos que deben estar cargados para concretar una consignación: los mismos de la compra, salvo Dicom y Pensión de alimentos
 * (no son obligatorios), y con «Contrato de consignación» en lugar del contrato de compra-venta.
 */
export const DOCS_CONSIGNACION = DOCS_COMPRA.filter((d) => !["dicom", "pension_alimentos"].includes(d.clave)).map((d) => (
  d.clave === "contrato_compraventa" ? { ...d, clave: "contrato_consignacion", nombre: "Contrato de consignación" } : d
));
/** Reglas de un documento obligatorio de compra o de consignación por su clave (o null si no es uno de ellos). */
export const reglaDocCompra = (clave) => DOCS_COMPRA.find((d) => d.clave === clave) || DOCS_CONSIGNACION.find((d) => d.clave === clave) || null;
/** Tipos de validación cuyos documentos llevan estas reglas (tipo de archivo, vencimiento y precio). */
export const TIPOS_CON_REGLAS = ["compra", "consignacion"];
/** Solo las columnas que se guardan de cada documento. */
export const filaDoc = ({ clave, nombre, grupo, requerido }) => ({ clave, nombre, grupo, requerido });
/** Una validación de compra o consignación es del formato actual si trae el CAV; las anteriores siguen con su lista de siempre. */
export const esChecklistCompraActual = (docs) => (docs || []).some((d) => d.clave === "cav");

/** ¿El archivo es de un tipo permitido para ese documento de compra? */
export function archivoPermitidoParaDoc(clave, tipoArchivo) {
  const r = reglaDocCompra(clave);
  if (!r) return { ok: true };
  return r.tipos.includes(tipoArchivo) ? { ok: true } : { ok: false, error: r.tipos.length === 1 ? "archivo_solo_pdf" : "archivo_tipo_invalido" };
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fechaValida = (f) => FECHA.test(f) && !Number.isNaN(Date.parse(`${f}T12:00:00Z`)) && new Date(`${f}T12:00:00Z`).toISOString().slice(0, 10) === f;

/** Fecha de vencimiento y precio de un documento de compra. */
export function validarDatosDoc(clave, input) {
  const r = reglaDocCompra(clave);
  if (!r || (!r.vence && !r.precio)) return { ok: false, error: "doc_sin_datos" };
  const i = input || {};
  const out = {};
  if (r.vence) {
    const f = String(i.venceEn ?? "").trim();
    if (!fechaValida(f)) return { ok: false, error: "vencimiento_invalido" };
    out.vence_en = f;
  }
  if (r.precio) {
    const n = Number(i.precio);
    if (i.precio === "" || i.precio === null || i.precio === undefined || !Number.isInteger(n) || n < 0 || n > 2_000_000_000) return { ok: false, error: "precio_doc_invalido" };
    out.precio = n;
  }
  return { ok: true, value: out };
}

/** Bancos e instituciones financieras de Chile donde se puede recibir un pago. */
export const BANCOS_CHILE = [
  "Banco de Chile", "BancoEstado", "Banco Santander Chile", "Banco de Crédito e Inversiones (BCI)", "Scotiabank Chile", "Banco Itaú Chile", "Banco Security",
  "Banco Falabella", "Banco Ripley", "Banco Consorcio", "Banco BICE", "Banco Internacional", "BTG Pactual Chile", "HSBC Bank Chile", "Coopeuch", "Tenpo", "Mercado Pago", "Otro banco",
];
export const TIPOS_CUENTA = ["Cuenta corriente", "Cuenta vista", "Cuenta RUT", "Cuenta de ahorro"];
/** Número de cuenta sin espacios, puntos ni guiones (solo dígitos, entre 4 y 20). */
export const limpiarNumeroCuenta = (v) => String(v ?? "").replace(/[\s.-]/g, "");
export const numeroCuentaValido = (v) => /^\d{4,20}$/.test(limpiarNumeroCuenta(v));

/**
 * Cuenta bancaria donde se paga: banco, tipo de cuenta y número (para el vendedor de una compra o el dueño de una consignación).
 * @returns { ok, value: { banco, tipo_cuenta, numero_cuenta } } o { ok: false, error }
 */
export function validarCuentaBancaria(input) {
  const i = input || {};
  if (!BANCOS_CHILE.includes(i.banco)) return { ok: false, error: "banco_invalido" };
  if (!TIPOS_CUENTA.includes(i.tipoCuenta)) return { ok: false, error: "tipo_cuenta_invalido" };
  if (!numeroCuentaValido(i.numeroCuenta)) return { ok: false, error: "numero_cuenta_invalido" };
  return { ok: true, value: { banco: i.banco, tipo_cuenta: i.tipoCuenta, numero_cuenta: limpiarNumeroCuenta(i.numeroCuenta) } };
}

/** Datos críticos del vendedor que debe completar el ejecutivo. Cada uno con su regla (campo de la base, etiqueta, error y comprobación). */
const DATOS_CLIENTE = [
  { campo: "rut", etiqueta: "RUT del vendedor", error: "rut_invalido", ok: (v) => validarRut(v) },
  { campo: "nombre", etiqueta: "Nombre y apellido del vendedor", error: "nombre_apellido_requerido", ok: (v) => texto(v, 80).split(" ").filter((p) => p.length >= 2).length >= 2 },
  { campo: "telefono", etiqueta: "Teléfono del vendedor", error: "telefono_invalido", ok: (v) => soloDigitos(texto(v, 30)).length >= 8 },
  { campo: "email", etiqueta: "Correo del vendedor", error: "email_invalido", ok: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto(v, 80)) },
  { campo: "direccion", etiqueta: "Dirección del vendedor", error: "direccion_requerida", ok: (v) => texto(v, 160).length >= 6 },
  { campo: "banco", etiqueta: "Banco del vendedor", error: "banco_invalido", ok: (v) => BANCOS_CHILE.includes(v) },
  { campo: "tipo_cuenta", etiqueta: "Tipo de cuenta del vendedor", error: "tipo_cuenta_invalido", ok: (v) => TIPOS_CUENTA.includes(v) },
  { campo: "numero_cuenta", etiqueta: "Número de cuenta del vendedor", error: "numero_cuenta_invalido", ok: (v) => numeroCuentaValido(v) },
];

export function validarDatosCliente(input) {
  const i = input || {};
  const v = { rut: i.rut, nombre: i.nombre, telefono: i.telefono, email: i.email, direccion: i.direccion, banco: i.banco, tipo_cuenta: i.tipoCuenta, numero_cuenta: i.numeroCuenta };
  for (const d of DATOS_CLIENTE) if (!d.ok(v[d.campo])) return { ok: false, error: d.error };
  return { ok: true, value: { nombre: texto(v.nombre, 80), rut: normalizarRut(v.rut), telefono: texto(v.telefono, 30), email: texto(v.email, 80).toLowerCase(), direccion: texto(v.direccion, 160), banco: v.banco, tipo_cuenta: v.tipo_cuenta, numero_cuenta: limpiarNumeroCuenta(v.numero_cuenta) } };
}

/**
 * Qué falta para concretar la compra o la consignación: datos de la persona y documentos (cada uno con su archivo y, si corresponde,
 * vencimiento y precio). `lista` = DOCS_COMPRA (por defecto) o DOCS_CONSIGNACION; `persona` = «vendedor» o «dueño».
 */
export function faltantesCompra({ cliente, docs, lista = DOCS_COMPRA, persona = "vendedor" }) {
  const f = [];
  const c = cliente || {};
  for (const d of DATOS_CLIENTE) if (!d.ok(c[d.campo])) f.push({ tipo: "dato", clave: d.campo, texto: d.etiqueta.replace("del vendedor", `del ${persona}`) });
  for (const r of lista) {
    const d = (docs || []).find((x) => x.clave === r.clave);
    if (!d || !(d.archivos || []).length) { f.push({ tipo: "doc", clave: r.clave, texto: `Documento: ${r.nombre}` }); continue; }
    if (r.vence && !d.vence_en) f.push({ tipo: "doc", clave: r.clave, texto: `Fecha de vencimiento de: ${r.nombre}` });
    if (r.precio && (d.precio === null || d.precio === undefined)) f.push({ tipo: "doc", clave: r.clave, texto: `Precio de pago de: ${r.nombre}` });
  }
  return f;
}

/**
 * Qué documentos hay que revisar según el tipo de validación.
 * opciones: { conFinanciamiento, conParteDePago } (solo para ventas).
 */
export function checklistPara(tipo, opciones = {}) {
  if (tipo === "vehiculo") return DOCS_VEHICULO.map((d) => ({ ...d }));
  if (tipo === "compra") return DOCS_COMPRA.map((d) => ({ ...d }));
  if (tipo === "consignacion") return DOCS_CONSIGNACION.map((d) => ({ ...d }));
  if (tipo === "venta") {
    const docs = [
      ...DOCS_VEHICULO.map((d) => ({ ...d })),
      D("cedula_cliente", "Cédula de identidad del cliente (ambos lados)", "cliente"),
      D("domicilio", "Comprobante de domicilio", "cliente"),
      D("comprobante_pago", "Comprobante de pago o transferencia", "cliente"),
    ];
    if (opciones.conFinanciamiento) docs.push(D("renta", "Liquidaciones de sueldo o comprobante de renta", "cliente"), D("antecedentes_credito", "Solicitud de crédito firmada", "cliente"));
    if (opciones.conParteDePago) docs.push(D("docs_parte_pago", "Documentos del vehículo recibido en parte de pago", "cliente"));
    return docs;
  }
  return [];
}

/* ---------- Revisión de un documento ---------- */
export function validarRevision(input) {
  const i = input || {};
  const estado = String(i.estado || "");
  if (!["aprobado", "observado", "rechazado", "no_aplica"].includes(estado)) return { ok: false, error: "estado_doc_invalido" };
  const comentario = texto(i.comentario, 300);
  if (estado !== "aprobado" && comentario.length < 3) return { ok: false, error: "comentario_requerido" };
  return { ok: true, value: { estado, comentario: comentario || null } };
}

/* ---------- Archivos ---------- */
export const MAX_ARCHIVOS_DOC = 3;
export const MAX_BYTES_ARCHIVO = 4 * 1024 * 1024;
const ID_ARCHIVO = /^[A-Za-z0-9]{6,40}$/;
export const TIPOS_ARCHIVO = ["image/jpeg", "application/pdf"];

export function validarArchivo(input) {
  const i = input || {};
  if (!ID_ARCHIVO.test(String(i.id || ""))) return { ok: false, error: "archivo_invalido" };
  if (!TIPOS_ARCHIVO.includes(i.tipo)) return { ok: false, error: "archivo_tipo_invalido" };
  const tam = Number(i.tam);
  if (!Number.isFinite(tam) || tam <= 0 || tam > MAX_BYTES_ARCHIVO) return { ok: false, error: "archivo_muy_grande" };
  return { ok: true, value: { id: String(i.id), nombre: texto(i.nombre, 80) || "documento", tipo: i.tipo, tam: Math.round(tam) } };
}

/** Clave donde se guarda el contenido de un archivo (la validación dueña puede ser otra si se reutilizó). */
export const claveArchivo = (validacionId, archivoId) => `dval::${validacionId}::${archivoId}`;

/* ---------- Estado ---------- */
/** El estado de la validación sale de sus documentos; el supervisor/Validador no lo cambia a mano. */
export function estadoDeValidacion(docs, tieneValidador) {
  const lista = docs || [];
  const requeridos = lista.filter((d) => d.requerido);
  if (requeridos.length > 0 && requeridos.every((d) => d.estado === "aprobado" || d.estado === "no_aplica")) return "aprobada";
  if (lista.some((d) => d.estado === "rechazado")) return "rechazada";
  if (lista.some((d) => d.estado === "observado")) return "observada";
  return tieneValidador ? "en_revision" : "pendiente";
}

/** Lo mismo para una consignación (datos del dueño y 9 documentos). */
export const faltantesConsignacion = ({ cliente, docs }) => faltantesCompra({ cliente, docs, lista: DOCS_CONSIGNACION, persona: "dueño" });

export const ESTADOS_ABIERTOS = ["pendiente", "en_revision", "observada", "rechazada"];

/** Cuántos documentos hay en cada estado y cuántos requeridos faltan. */
export function progreso(docs) {
  const lista = docs || [];
  const c = { total: lista.length, aprobados: 0, observados: 0, rechazados: 0, porRevisar: 0, noAplica: 0, sinArchivo: 0 };
  for (const d of lista) {
    if (d.estado === "aprobado") c.aprobados++;
    else if (d.estado === "observado") c.observados++;
    else if (d.estado === "rechazado") c.rechazados++;
    else if (d.estado === "no_aplica") c.noAplica++;
    else c.porRevisar++;
    if (d.requerido && d.estado === "pendiente" && (!d.archivos || d.archivos.length === 0)) c.sinArchivo++;
  }
  return c;
}

/** Documentos del vehículo ya aprobados en otra validación: se reutilizan para no volver a pedirlos. */
export function docsReutilizables(docsOrigen, validacionOrigenId) {
  const out = {};
  for (const d of docsOrigen || []) {
    if (d.grupo === "vehiculo" && d.estado === "aprobado") {
      // En una compra, «Multas» hace de «certificado de multas, prendas y limitaciones» del vehículo.
      out[d.clave === "multas" ? "multas_prendas" : d.clave] = { estado: "aprobado", comentario: d.comentario || null, revisado_por: d.revisado_por || null, revisado_en: d.revisado_en || null, archivos: (d.archivos || []).map((a) => ({ ...a, v: a.v || validacionOrigenId })) };
    }
  }
  return out;
}

/* ---------- Cola y métricas ---------- */
export function colaValidaciones(filas, ahora = new Date(), horasLimite = 8) {
  const pendientes = filas.filter((v) => v.estado === "pendiente");
  const edades = pendientes.map((v) => horasDesde(v.solicitada_en, ahora));
  return {
    pendientes: pendientes.length,
    masAntiguaHoras: edades.length ? Math.round(Math.max(...edades) * 10) / 10 : 0,
    atrasadas: pendientes.filter((v) => horasDesde(v.solicitada_en, ahora) >= horasLimite),
  };
}

const promedio = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** Actividad de un Validador: validaciones aprobadas en el mes, tiempo medio (desde que se pidió) y lo que tiene abierto. */
export function metricasValidador(filas, validadorId, mes) {
  const suyas = filas.filter((v) => v.validador_id === validadorId);
  const aprobadas = suyas.filter((v) => v.estado === "aprobada" && v.resuelta_en && mesChile(v.resuelta_en) === mes);
  const horas = aprobadas.map((v) => (Date.parse(v.resuelta_en) - Date.parse(v.solicitada_en)) / 3_600_000).filter((h) => Number.isFinite(h) && h >= 0);
  return {
    aprobadas: aprobadas.length,
    tiempoMedioHoras: Math.round(promedio(horas) * 10) / 10,
    abiertas: suyas.filter((v) => ESTADOS_ABIERTOS.includes(v.estado)).length,
    conObservaciones: suyas.filter((v) => v.estado === "observada" || v.estado === "rechazada").length,
  };
}

/** Transiciones de la cola. */
const PERMITIDAS = {
  tomar: ["pendiente"],
  liberar: ["en_revision", "observada", "rechazada"],
  asignar: ["pendiente", "en_revision", "observada", "rechazada"],
  revisar: ["en_revision", "observada", "rechazada"],
};
export function validarTransicionValidacion(estado, accion) {
  return (PERMITIDAS[accion] || []).includes(estado) ? { ok: true } : { ok: false, error: "validacion_estado_invalido" };
}
