// Núcleo del CRM: roles, permisos, RUT y configuración del negocio.
//
// Es JavaScript puro (sin APIs de Deno ni del navegador) para que lo usen las TRES partes:
//   - la Edge Function (servidor), que es quien realmente decide qué puede hacer cada persona;
//   - la pantalla (src/crm-admin.jsx), que solo lo usa para dibujar el panel;
//   - las pruebas (tests/crm-core.test.mjs).
// Así hay una sola fuente de verdad para la lista de permisos.

/* ---------- Roles ---------- */
export const ROLES = [
  { id: "admin_general", nombre: "Administrador general", asignable: false,
    descripcion: "Todo el sistema. Hoy este acceso es la cuenta maestra (correo y clave), no se asigna a personas." },
  { id: "jefe_local", nombre: "Jefe Local (Supervisor)", asignable: true,
    descripcion: "Supervisa su local: leads, equipo, inventario, comisiones y metas." },
  { id: "ejecutivo", nombre: "Ejecutivo", asignable: true,
    descripcion: "Estación de trabajo comercial. Se habilita aparte para ventas, compras y consignaciones." },
  { id: "tasador", nombre: "Tasador", asignable: true,
    descripcion: "Valoriza vehículos para compra y consignación." },
  { id: "inspector", nombre: "Inspector", asignable: true,
    descripcion: "Realiza inspecciones y tasaciones en terreno." },
  { id: "validador", nombre: "Validador", asignable: true,
    descripcion: "Revisa y valida la documentación y las operaciones." },
  { id: "anunciante", nombre: "Anunciante", asignable: true,
    descripcion: "Publica y mantiene los avisos de los vehículos." },
  { id: "marketing", nombre: "Marketing y RRSS", asignable: true,
    descripcion: "Campañas, redes sociales y fuentes de leads." },
];
export const ROL_IDS = ROLES.map((r) => r.id);
export const ROLES_ASIGNABLES = ROLES.filter((r) => r.asignable).map((r) => r.id);

/* ---------- Permisos ----------
   `disponible: false` = el módulo aún no existe; el permiso queda definido para que la matriz
   esté completa, pero no hace nada hasta que se construya ese perfil. */
export const PERMISOS = [
  // Administración
  { id: "usuarios.ver", grupo: "Administración", nombre: "Ver usuarios", disponible: true },
  { id: "usuarios.gestionar", grupo: "Administración", nombre: "Crear, editar y desactivar usuarios", disponible: true },
  { id: "permisos.gestionar", grupo: "Administración", nombre: "Editar permisos de roles y personas", disponible: true },
  { id: "locales.gestionar", grupo: "Administración", nombre: "Gestionar locales", disponible: true },
  { id: "config.editar", grupo: "Administración", nombre: "Editar la configuración del negocio", disponible: true },
  { id: "bitacora.ver", grupo: "Administración", nombre: "Ver la bitácora de acciones", disponible: true },
  { id: "reportes.globales", grupo: "Administración", nombre: "Ver reportes de todos los locales", disponible: true },
  { id: "reportes.local", grupo: "Administración", nombre: "Ver reportes de su local", disponible: false },
  // Comercial
  { id: "leads.propios", grupo: "Comercial", nombre: "Ver y gestionar sus propios leads", disponible: false },
  { id: "leads.local", grupo: "Comercial", nombre: "Ver los leads de su local", disponible: false },
  { id: "leads.asignar", grupo: "Comercial", nombre: "Asignar y reasignar leads", disponible: false },
  { id: "ventas.operar", grupo: "Comercial", nombre: "Operar ventas", disponible: false },
  { id: "compras.operar", grupo: "Comercial", nombre: "Operar compras", disponible: false },
  { id: "consignaciones.operar", grupo: "Comercial", nombre: "Operar consignaciones", disponible: false },
  { id: "inventario.ver", grupo: "Comercial", nombre: "Ver el inventario", disponible: false },
  { id: "inventario.editar", grupo: "Comercial", nombre: "Editar el inventario", disponible: false },
  { id: "cotizaciones.crear", grupo: "Comercial", nombre: "Crear cotizaciones y cierres", disponible: false },
  { id: "agenda.usar", grupo: "Comercial", nombre: "Seguimiento y agenda", disponible: false },
  { id: "comisiones.propias", grupo: "Comercial", nombre: "Ver sus propias comisiones", disponible: false },
  { id: "comisiones.local", grupo: "Comercial", nombre: "Ver las comisiones de su local", disponible: false },
  { id: "metas.gestionar", grupo: "Comercial", nombre: "Definir metas", disponible: false },
  // Operación
  { id: "inspecciones.usar", grupo: "Operación", nombre: "Módulo de inspecciones", disponible: true },
  { id: "tasaciones.usar", grupo: "Operación", nombre: "Módulo de tasaciones (valorizaciones)", disponible: true },
  { id: "tasacion_compra.usar", grupo: "Operación", nombre: "Tasación de compra (Chileautos)", disponible: true },
  { id: "validacion.usar", grupo: "Operación", nombre: "Validar documentación y operaciones", disponible: false },
  { id: "anuncios.gestionar", grupo: "Operación", nombre: "Publicar y mantener avisos", disponible: false },
  { id: "marketing.gestionar", grupo: "Operación", nombre: "Campañas y redes sociales", disponible: false },
];
export const PERMISO_IDS = PERMISOS.map((p) => p.id);

/** Permisos que cada rol trae por defecto (el administrador puede cambiarlos en el panel). */
export const PERMISOS_POR_ROL = {
  admin_general: PERMISO_IDS.slice(),
  jefe_local: [
    "usuarios.ver", "reportes.local", "leads.propios", "leads.local", "leads.asignar", "inventario.ver", "inventario.editar",
    "cotizaciones.crear", "agenda.usar", "comisiones.propias", "comisiones.local", "metas.gestionar", "tasacion_compra.usar",
  ],
  ejecutivo: ["leads.propios", "inventario.ver", "cotizaciones.crear", "agenda.usar", "comisiones.propias"],
  tasador: ["tasacion_compra.usar", "tasaciones.usar", "inventario.ver"],
  inspector: ["inspecciones.usar", "tasaciones.usar"],
  validador: ["validacion.usar", "inventario.ver"],
  anunciante: ["anuncios.gestionar", "inventario.ver"],
  marketing: ["marketing.gestionar", "leads.local"],
};

/** Las tres habilitaciones del Ejecutivo: se guardan como permisos extra de la persona. */
export const HABILITACIONES_EJECUTIVO = [
  { permiso: "ventas.operar", nombre: "Ventas" },
  { permiso: "compras.operar", nombre: "Compras" },
  { permiso: "consignaciones.operar", nombre: "Consignaciones" },
];

const esPermiso = (p) => PERMISO_IDS.includes(p);
const unicos = (arr) => Array.from(new Set(arr));

/** Limpia la lista de permisos de un rol que llega de la base (ignora ids desconocidos). */
export function permisosDeRol(rol, overrides) {
  const o = overrides && Array.isArray(overrides[rol]) ? overrides[rol] : null;
  return unicos((o || PERMISOS_POR_ROL[rol] || []).filter(esPermiso));
}

/**
 * Permisos efectivos de una persona = (unión de los permisos de sus roles) + otorgados − quitados.
 * `extra` = { otorgar: [...], quitar: [...] }. Un permiso quitado gana sobre uno heredado.
 */
export function permisosEfectivos(roles, overrides, extra) {
  const set = new Set();
  for (const r of roles || []) for (const p of permisosDeRol(r, overrides)) set.add(p);
  const otorgar = extra && Array.isArray(extra.otorgar) ? extra.otorgar : [];
  const quitar = extra && Array.isArray(extra.quitar) ? extra.quitar : [];
  for (const p of otorgar) if (esPermiso(p)) set.add(p);
  for (const p of quitar) set.delete(p);
  return PERMISO_IDS.filter((p) => set.has(p)); // orden estable (el del catálogo)
}

export function tienePermiso(permisos, permiso) {
  return Array.isArray(permisos) && permisos.includes(permiso);
}

/** Normaliza lo que manda la pantalla: solo ids válidos, sin repetidos, sin contradicciones. */
export function limpiarExtra(extra) {
  const otorgar = unicos(((extra && extra.otorgar) || []).filter(esPermiso));
  const quitar = unicos(((extra && extra.quitar) || []).filter(esPermiso)).filter((p) => !otorgar.includes(p));
  return { otorgar, quitar };
}

/* ---------- RUT chileno ---------- */
/** "12.345.678-5", "12345678k", " 12 345 678 - 5 " -> "123456785" (cuerpo + dígito, mayúsculas). */
export function limpiarRut(rut) {
  return String(rut || "").replace(/[^0-9kK]/g, "").toUpperCase();
}

export function digitoVerificador(cuerpo) {
  let suma = 0;
  let mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i], 10) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const dv = 11 - (suma % 11);
  return dv === 11 ? "0" : dv === 10 ? "K" : String(dv);
}

export function validarRut(rut) {
  const limpio = limpiarRut(rut);
  if (limpio.length < 2 || limpio.length > 9) return false;
  const cuerpo = limpio.slice(0, -1);
  if (!/^\d+$/.test(cuerpo) || parseInt(cuerpo, 10) < 1) return false;
  return digitoVerificador(cuerpo) === limpio.slice(-1);
}

/** Forma canónica que se guarda y se compara: "12345678-5" (sin puntos). */
export function normalizarRut(rut) {
  const limpio = limpiarRut(rut);
  return limpio.length < 2 ? "" : `${limpio.slice(0, -1)}-${limpio.slice(-1)}`;
}

/** Forma para mostrar: "12.345.678-5". */
export function formatearRut(rut) {
  const n = normalizarRut(rut);
  if (!n) return "";
  const [cuerpo, dv] = n.split("-");
  return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}`;
}

/* ---------- Claves de usuario ---------- */
/** Mínimo 8 caracteres, con al menos una letra y un número (misma regla que el administrador). */
export function claveValida(pw) {
  return typeof pw === "string" && pw.length >= 8 && pw.length <= 64 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}

const CLAVE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
/** Clave provisoria legible (sin 0/O/1/l/I). `aleatorios` = bytes aleatorios, para poder probarla. */
export function claveProvisoria(aleatorios) {
  let out = "";
  for (let i = 0; i < 10; i++) out += CLAVE_CHARS[aleatorios[i] % CLAVE_CHARS.length];
  // Garantiza letra y número aunque el azar no los haya dado.
  if (!/\d/.test(out)) out = out.slice(0, 9) + "7";
  if (!/[A-Za-z]/.test(out)) out = "K" + out.slice(1);
  return out;
}

/* ---------- Validación de un usuario ---------- */
/**
 * Valida y limpia los datos de un usuario que envía el panel.
 * Devuelve { ok: true, value } o { ok: false, error }.
 * `esAlta` exige RUT; en una edición el RUT no se cambia.
 */
export function validarUsuario(input, { esAlta = true } = {}) {
  const i = input || {};
  const nombre = String(i.nombre || "").trim().replace(/\s+/g, " ");
  if (nombre.length < 3 || nombre.length > 80) return { ok: false, error: "nombre_invalido" };

  let rut = "";
  if (esAlta) {
    if (!validarRut(i.rut)) return { ok: false, error: "rut_invalido" };
    rut = normalizarRut(i.rut);
  }

  const roles = unicos((Array.isArray(i.roles) ? i.roles : []).map(String));
  if (roles.length === 0) return { ok: false, error: "roles_requeridos" };
  if (roles.some((r) => !ROLES_ASIGNABLES.includes(r))) return { ok: false, error: "rol_invalido" };

  const email = String(i.email || "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "email_invalido" };

  const telefono = String(i.telefono || "").trim().slice(0, 30);
  const localId = i.localId ? String(i.localId) : null;

  return { ok: true, value: { nombre, rut, roles, email: email || null, telefono: telefono || null, localId, extra: limpiarExtra(i.extra) } };
}

/* ---------- Configuración del negocio ----------
   Cada clave tiene su forma y valor inicial. El servidor valida con `validarConfig`
   antes de guardar, para que nadie guarde basura aunque manipule la petición. */
export const CONFIG_DEFECTO = {
  fuentes_lead: ["Sitio web", "Llamada", "WhatsApp", "Redes sociales", "Referido", "Visita al local"],
  estados_lead: ["Nuevo", "Contactado", "En seguimiento", "Cotizado", "Reservado", "Cerrado ganado", "Cerrado perdido"],
  motivos_perdida: ["Precio", "Compró en otro lugar", "Sin respuesta", "Cambió de idea", "Financiamiento rechazado"],
  comision_ventas_pct: 0,
  comision_compras_pct: 0,
  comision_consignaciones_pct: 0,
  meta_mensual_unidades: 0,
};

const CLAVES_LISTA_TEXTO = ["fuentes_lead", "estados_lead", "motivos_perdida"];
const CLAVES_PORCENTAJE = ["comision_ventas_pct", "comision_compras_pct", "comision_consignaciones_pct"];

/** Devuelve { ok, value } con el valor limpio, o { ok:false }. */
export function validarConfig(clave, valor) {
  if (CLAVES_LISTA_TEXTO.includes(clave)) {
    if (!Array.isArray(valor) || valor.length > 40) return { ok: false };
    const limpio = unicos(valor.map((v) => String(v).trim().replace(/\s+/g, " ")).filter(Boolean));
    if (limpio.length === 0 || limpio.some((v) => v.length > 60)) return { ok: false };
    return { ok: true, value: limpio };
  }
  if (CLAVES_PORCENTAJE.includes(clave)) {
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false };
    return { ok: true, value: Math.round(n * 100) / 100 };
  }
  if (clave === "meta_mensual_unidades") {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0 || n > 10_000) return { ok: false };
    return { ok: true, value: n };
  }
  return { ok: false };
}

/** Mezcla lo guardado con los valores iniciales (lo que falte o venga roto usa el inicial). */
export function configCompleta(guardada) {
  const out = {};
  for (const k of Object.keys(CONFIG_DEFECTO)) {
    const v = guardada && guardada[k];
    const r = v === undefined ? { ok: false } : validarConfig(k, v);
    out[k] = r.ok ? r.value : CONFIG_DEFECTO[k];
  }
  return out;
}
