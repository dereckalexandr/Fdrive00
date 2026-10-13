/**
 * Piezas de interfaz compartidas por los módulos del CRM (comercial, inventario…).
 */
import React, { useState, useEffect, useCallback } from "react";

export const INPUT = "border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 w-full";
export const BTN = "px-3 py-1.5 text-sm border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50";
export const BTN_PRIMARIO = "px-4 py-2 text-sm bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-50";
export const BTN_AMBAR = "px-4 py-2 text-sm bg-amber-500 text-stone-900 font-medium hover:bg-amber-400 disabled:opacity-50";

export const clp = (n) => (n === null || n === undefined || n === "" || Number.isNaN(Number(n)) ? "—" : `$${Math.round(Number(n)).toLocaleString("es-CL")}`);
export const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "—");
export const fechaCorta = (iso) => (iso ? new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "short" }) : "—");

/** "hace 3 h", "hace 2 d"… */
export function hace(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return "recién";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

const MENSAJES = {
  crm_not_installed: "Faltan las tablas del módulo comercial. Ejecuta supabase-crm-ventas.sql en Supabase (SQL Editor) y recarga.",
  server_not_configured: "Este módulo necesita Supabase configurado: no está disponible en modo de prueba local.",
  forbidden: "No tienes permiso para esa operación.",
  unauthorized: "Tu sesión venció. Recarga la página para volver a ingresar.",
  no_existe: "Ese registro ya no existe o no tienes acceso a él.",
  sin_local: "Falta definir en qué local trabajas. Pídele al administrador que te asigne uno.",
  patente_invalida: "La patente no es válida (formato ABCD12 o AB1234).",
  patente_duplicada: "Ya hay un vehículo activo con esa patente.",
  marca_modelo_requeridos: "Escribe la marca y el modelo.",
  anio_invalido: "El año no es válido.",
  km_invalido: "El kilometraje no es válido.",
  precio_invalido: "Revisa los precios: deben ser números.",
  nombre_invalido: "Escribe el nombre completo.",
  rut_invalido: "El RUT no es válido.",
  telefono_invalido: "El teléfono debe tener al menos 8 dígitos.",
  email_invalido: "El correo no es válido.",
  contacto_requerido: "Ingresa al menos un teléfono o un correo.",
  parte_pago_invalida: "Revisa los datos del vehículo en parte de pago.",
  financiamiento_invalido: "Revisa los datos de financiamiento.",
  vehiculo_invalido: "Ese vehículo no pertenece a este local.",
  cliente_invalido: "Ese cliente no pertenece a este local.",
  asignado_invalido: "Esa persona no puede recibir leads de venta (revisa que esté activa y habilitada).",
  sin_candidatos: "No hay otra persona habilitada para recibir este lead.",
  etapa_no_disponible: "Esa etapa todavía no está disponible.",
  motivo_requerido: "Elige el motivo por el que se pierde.",
  lead_cerrado: "Este lead está cerrado: solo el supervisor puede reabrirlo.",
  sin_cambio: "El lead ya está en esa etapa.",
  detalle_requerido: "Escribe la nota.",
  titulo_invalido: "Escribe qué hay que hacer (mínimo 3 letras).",
  fecha_invalida: "Elige una fecha y hora válidas.",
  duplicado: "Ya existe un registro con esos datos.",
};
export const mensajeError = (e) => MENSAJES[e && e.message] || "No se pudo completar la operación. Inténtalo de nuevo.";

export function Aviso({ tipo = "error", children }) {
  const estilos = tipo === "error" ? "bg-rose-50 border-rose-200 text-rose-800" : tipo === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-stone-800";
  return <div className={`border px-4 py-3 text-sm ${estilos}`}>{children}</div>;
}
export const Cargando = ({ texto = "Cargando…" }) => <p className="text-sm text-stone-500">{texto}</p>;

export function Tarjeta({ titulo, ayuda, children, derecha }) {
  return (
    <div className="bg-white border border-stone-200 p-5">
      {(titulo || derecha) && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            {titulo && <h3 className="font-serif text-lg text-stone-900">{titulo}</h3>}
            {ayuda && <p className="text-xs text-stone-500 mt-1">{ayuda}</p>}
          </div>
          {derecha}
        </div>
      )}
      {children}
    </div>
  );
}

export function Campo({ etiqueta, children, ayuda, className = "" }) {
  return (
    <label className={`text-sm text-stone-700 flex flex-col gap-1 ${className}`}>
      {etiqueta}
      {children}
      {ayuda && <span className="text-xs text-stone-500">{ayuda}</span>}
    </label>
  );
}

/** Ventana superpuesta; en celular ocupa toda la pantalla. */
export function Modal({ titulo, onCerrar, children, ancho = "max-w-2xl" }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);
  return (
    <div className="fixed inset-0 z-40 bg-stone-900/50 flex md:items-start md:justify-center md:overflow-y-auto md:py-10" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className={`bg-stone-100 w-full ${ancho} md:my-auto flex flex-col max-h-screen md:max-h-none overflow-y-auto`}>
        <div className="bg-stone-900 text-stone-100 px-5 py-3 flex items-center justify-between sticky top-0 z-10">
          <h2 className="font-serif text-lg">{titulo}</h2>
          <button onClick={onCerrar} className="text-stone-300 hover:text-white px-2 py-1" aria-label="Cerrar">✕</button>
        </div>
        <div className="p-5 flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}

/** Carga de datos con estado de espera y error. `recargar()` vuelve a pedirlos. */
export function useCarga(fn, deps) {
  const [estado, setEstado] = useState({ cargando: true, error: "", datos: null });
  const recargar = useCallback(async () => {
    setEstado((e) => ({ ...e, cargando: true, error: "" }));
    try { setEstado({ cargando: false, error: "", datos: await fn() }); }
    catch (e) { setEstado((p) => ({ cargando: false, error: mensajeError(e), datos: p.datos })); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { recargar(); }, [recargar]);
  return { ...estado, recargar };
}

/** Pestañas horizontales con el estilo del panel. */
export function Pestanas({ valor, onCambio, opciones }) {
  return (
    <div className="flex gap-1 border-b border-stone-300 overflow-x-auto whitespace-nowrap">
      {opciones.map(([id, texto, extra]) => (
        <button key={id} onClick={() => onCambio(id)} className={`px-4 py-2.5 text-sm ${valor === id ? "text-stone-900 border-b-2 border-amber-500 font-medium" : "text-stone-500 hover:text-stone-800"}`}>
          {texto}{extra ? <span className="ml-1.5 text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full">{extra}</span> : null}
        </button>
      ))}
    </div>
  );
}
